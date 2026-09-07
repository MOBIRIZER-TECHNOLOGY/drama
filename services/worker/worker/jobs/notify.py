"""Push delivery and the lifecycle jobs that decide who hears from us and when.

`send_push` delivers one admin-composed Notification row. The rest are the automatic loops: a new episode in a
series someone is watching, a streak about to lapse, and an episode left unfinished. These are the only reason
day 7 exists for a dripping-content app — without them a viewer has to remember the app on their own.

Every job resolves its own audience, sends through `app.services.push`, and commits. All of them are safe to
re-run: delivery is keyed on rows that already exist, and a double send is bounded by the daily cron schedule.
"""

import uuid
from datetime import UTC, datetime, timedelta

import structlog
from app.core.db import SessionLocal
from app.models.catalog import Episode, PublishStatus, Series
from app.models.engagement import Favorite, WatchProgress
from app.models.ops import Notification
from app.models.wallet import CoinLedger, LedgerKind
from app.services import push
from sqlalchemy import distinct, func, select

log = structlog.get_logger()

# A viewer who has not opened the app in this long is churned, not dormant; stop paying to reach them.
MAX_IDLE_DAYS = 45
BATCH = 500


def _title_for(series: Series, lang: str = "en") -> str:
    by_lang = {t.lang: t for t in series.translations}
    tr = by_lang.get(lang) or by_lang.get(series.original_language) or by_lang.get("en")
    return tr.title if tr else series.slug


async def send_push(ctx: dict, notification_id: str) -> dict:
    """Deliver one Notification row composed in the admin console."""
    async with SessionLocal() as db:
        row = await db.get(Notification, uuid.UUID(notification_id))
        if row is None:
            return {"status": "missing", "notification_id": notification_id}
        if row.sent_at is not None:
            return {"status": "already_sent", "notification_id": notification_id}

        segment = row.segment or {"all": True}
        user_ids = await _resolve_segment(db, segment)
        result = await push.deliver(
            db,
            user_ids=user_ids,
            channel=str((row.payload or {}).get("channel") or "announcement"),
            title=row.title,
            body=row.body,
            data={"notification_id": str(row.id), **(row.payload or {})},
        )
        row.sent_at = datetime.now(UTC)
        row.delivered = result.delivered
        row.failed = result.failed
        await db.commit()
        return {"status": "sent", "delivered": result.delivered, "failed": result.failed}


async def _resolve_segment(db, segment: dict) -> list[uuid.UUID]:
    """Turn an admin segment into user ids. Unknown keys resolve to nobody, never to everybody."""
    from app.models.identity import User, UserStatus

    if segment.get("user_id"):
        return [uuid.UUID(str(segment["user_id"]))]
    if segment.get("all"):
        cutoff = datetime.now(UTC) - timedelta(days=MAX_IDLE_DAYS)
        rows = await db.scalars(
            select(User.id).where(
                User.status == UserStatus.active,
                User.last_seen_at.is_not(None),
                User.last_seen_at >= cutoff,
            )
        )
        return list(rows.all())
    if segment.get("locale"):
        rows = await db.scalars(
            select(User.id).where(User.status == UserStatus.active, User.locale == str(segment["locale"]))
        )
        return list(rows.all())
    log.warning("push.unknown_segment", segment=segment)
    return []


async def new_episode_alert(ctx: dict, episode_id: str) -> dict:
    """Tell the people watching a series that the next episode landed.

    Enqueued by the publish job. The audience is anyone who favourited the series or has watch progress in it,
    which is exactly the set for whom "episode 13 is out" is news rather than spam.
    """
    async with SessionLocal() as db:
        episode = await db.get(Episode, uuid.UUID(episode_id))
        if episode is None or episode.status != PublishStatus.published:
            return {"status": "skipped"}
        series = await db.get(Series, episode.series_id)
        if series is None:
            return {"status": "skipped"}
        await db.refresh(series, ["translations"])

        cutoff = datetime.now(UTC) - timedelta(days=MAX_IDLE_DAYS)
        favourites = await db.scalars(select(Favorite.user_id).where(Favorite.series_id == series.id))
        watchers = await db.scalars(
            select(distinct(WatchProgress.user_id)).where(
                WatchProgress.series_id == series.id, WatchProgress.updated_at >= cutoff
            )
        )
        user_ids = list({*favourites.all(), *watchers.all()})
        if not user_ids:
            return {"status": "no_audience"}

        title = _title_for(series)
        result = await push.deliver(
            db,
            user_ids=user_ids,
            channel="new_episode",
            title=f"Episode {episode.number} is out",
            body=f"The next episode of {title} is ready to watch.",
            data={"series_id": str(series.id), "slug": series.slug, "episode": episode.number},
        )
        await db.commit()
        return {"status": "sent", "delivered": result.delivered, "audience": len(user_ids)}


async def streak_reminder(ctx: dict) -> dict:
    """Nudge anyone with a live streak who has not checked in today.

    Loss framing is the whole mechanic: the message names the streak that is about to break, because "keep your
    6-day streak" outperforms "claim your coins" by a wide margin in this category.
    """
    async with SessionLocal() as db:
        from zoneinfo import ZoneInfo

        from app.core.config import get_settings

        tz = ZoneInfo(get_settings().reward_timezone)
        today = datetime.now(tz).date()
        yesterday = today - timedelta(days=1)

        # Everyone whose most recent check-in was yesterday: a streak that is still alive and lapses tonight.
        rows = await db.execute(
            select(CoinLedger.user_id, func.max(CoinLedger.created_at))
            .where(CoinLedger.kind == LedgerKind.checkin)
            .group_by(CoinLedger.user_id)
        )
        due = [uid for uid, last in rows.all() if last is not None and last.astimezone(tz).date() == yesterday]
        if not due:
            return {"status": "no_audience"}

        sent = 0
        for start in range(0, len(due), BATCH):
            result = await push.deliver(
                db,
                user_ids=due[start : start + BATCH],
                channel="streak",
                title="Your streak ends tonight",
                body="Check in now to keep it going and collect today's coins.",
                data={"route": "rewards"},
            )
            sent += result.delivered
        await db.commit()
        return {"status": "sent", "delivered": sent, "audience": len(due)}


async def resume_reminder(ctx: dict) -> dict:
    """Remind viewers about an episode they started and did not finish, one to three days ago."""
    async with SessionLocal() as db:
        now = datetime.now(UTC)
        rows = (
            await db.execute(
                select(WatchProgress.user_id, WatchProgress.series_id, func.max(WatchProgress.updated_at))
                .where(
                    WatchProgress.completed_at.is_(None),
                    WatchProgress.updated_at <= now - timedelta(days=1),
                    WatchProgress.updated_at >= now - timedelta(days=3),
                )
                .group_by(WatchProgress.user_id, WatchProgress.series_id)
            )
        ).all()
        if not rows:
            return {"status": "no_audience"}

        # One message per viewer, about their most recently abandoned series.
        latest: dict[uuid.UUID, tuple[uuid.UUID, datetime]] = {}
        for user_id, series_id, updated in rows:
            if user_id not in latest or updated > latest[user_id][1]:
                latest[user_id] = (series_id, updated)

        series_rows = {
            s.id: s
            for s in (
                await db.scalars(
                    select(Series).where(Series.id.in_({sid for sid, _ in latest.values()}))
                )
            ).all()
        }
        for s in series_rows.values():
            await db.refresh(s, ["translations"])

        sent = 0
        for user_id, (series_id, _) in latest.items():
            series = series_rows.get(series_id)
            if series is None or series.status != PublishStatus.published:
                continue
            result = await push.deliver(
                db,
                user_ids=[user_id],
                channel="resume",
                title="Still watching?",
                body=f"You left {_title_for(series)} part way through. Pick it up where you stopped.",
                data={"series_id": str(series.id), "slug": series.slug, "route": "series"},
            )
            sent += result.delivered
        await db.commit()
        return {"status": "sent", "delivered": sent, "audience": len(latest)}
