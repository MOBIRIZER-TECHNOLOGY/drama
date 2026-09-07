"""Daily check-in streaks and reward tasks. Every grant is a ledger row.

"Today" is the product timezone (settings.reward_timezone, default Asia/Kolkata), not UTC.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound
from app.models.identity import Platform, User
from app.models.wallet import (
    AdEvent,
    Checkin,
    LedgerKind,
    RewardClaim,
    RewardFrequency,
    RewardTask,
    RewardTaskKind,
)
from app.services import config as config_svc
from app.services import ledger


def product_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().reward_timezone)


def today_local() -> date:
    return datetime.now(product_tz()).date()


def start_of_today_utc() -> datetime:
    local = datetime.now(product_tz()).replace(hour=0, minute=0, second=0, microsecond=0)
    return local.astimezone(UTC)


async def daily_rewards(session: AsyncSession) -> list[int]:
    rewards = await config_svc.namespace(session, "rewards")
    values = [int(v) for v in (rewards.get("daily_rewards") or []) if int(v) >= 0]
    return values or list(get_settings().default_daily_rewards)


async def checkin_status(session: AsyncSession, user_id: uuid.UUID, today: date | None = None) -> dict:
    today = today or today_local()
    rewards = await daily_rewards(session)
    cycle = len(rewards)
    last = await session.scalar(select(Checkin).where(Checkin.user_id == user_id).order_by(Checkin.day.desc()).limit(1))
    checked_today = last is not None and last.day == today
    continuing = last is not None and (checked_today or last.day == today - timedelta(days=1))
    if last is None or not continuing:
        next_day = 1
    else:
        next_day = (last.streak_day % cycle) + 1
    return {
        "checked_in_today": checked_today,
        "streak_day": last.streak_day if continuing else 0,
        "next_streak_day": next_day,
        "rewards": rewards,
    }


async def checkin(
    session: AsyncSession, user: User, today: date | None = None, *, variant_map: dict | None = None
) -> Checkin:
    today = today or today_local()
    existing = await session.get(Checkin, (user.id, today))
    if existing is not None:
        raise Conflict("Already checked in today", code="already_checked_in")
    status = await checkin_status(session, user.id, today)
    day = min(status["next_streak_day"], len(status["rewards"]))
    coins = status["rewards"][day - 1]
    row = await ledger.post(
        session,
        user_id=user.id,
        delta=coins,
        kind=LedgerKind.checkin,
        idempotency_key=f"checkin:{user.id}:{today.isoformat()}",
        ref_type="checkin",
        ref_id=today.isoformat(),
        note=f"Day {day} check-in",
        variant_map=variant_map,
    )
    ck = Checkin(user_id=user.id, day=today, streak_day=day, coins=coins, ledger_id=row.id)
    session.add(ck)
    await session.flush()
    return ck


async def tasks_for(session: AsyncSession, user_id: uuid.UUID, platform: Platform) -> list[dict]:
    tasks = list(
        (
            await session.scalars(
                select(RewardTask)
                .where(RewardTask.platform == platform, RewardTask.is_active.is_(True))
                .order_by(RewardTask.sort_order)
            )
        ).all()
    )
    if not tasks:
        return []
    since = start_of_today_utc()
    claims = (
        await session.scalars(
            select(RewardClaim).where(RewardClaim.user_id == user_id, RewardClaim.task_id.in_([t.id for t in tasks]))
        )
    ).all()
    claimed_once = {c.task_id for c in claims}
    claimed_today = {c.task_id for c in claims if c.created_at >= since}
    return [
        {
            "task": t,
            "claimed": (t.id in claimed_once) if t.frequency == RewardFrequency.once else (t.id in claimed_today),
        }
        for t in tasks
    ]


async def consume_ad_event(
    session: AsyncSession, user_id: uuid.UUID, ssv_transaction_id: str, *, purpose: str
) -> AdEvent:
    """A rewarded-ad completion is valid once, for the user and purpose the network reported (AdMob SSV, phase 2)."""
    event = await session.scalar(
        select(AdEvent)
        .where(AdEvent.ssv_transaction_id == ssv_transaction_id, AdEvent.user_id == user_id, AdEvent.purpose == purpose)
        .with_for_update()
    )
    if event is None or event.consumed_at is not None:
        raise Conflict("Ad event is missing or already used", code="ad_event_invalid")
    event.consumed_at = datetime.now(UTC)
    return event


async def claim(
    session: AsyncSession,
    user: User,
    task_id: uuid.UUID,
    *,
    ad_event_id: str | None = None,
    variant_map: dict | None = None,
) -> RewardClaim:
    task = await session.get(RewardTask, task_id)
    if task is None or not task.is_active:
        raise NotFound("Task")
    now = datetime.now(UTC)
    if task.frequency == RewardFrequency.once:
        window_key = "once"
        prior = await session.scalar(
            select(RewardClaim).where(RewardClaim.user_id == user.id, RewardClaim.task_id == task.id)
        )
    else:
        window_key = today_local().isoformat()
        prior = await session.scalar(
            select(RewardClaim).where(
                RewardClaim.user_id == user.id,
                RewardClaim.task_id == task.id,
                RewardClaim.created_at >= start_of_today_utc(),
            )
        )
    if prior is not None:
        raise Conflict("Task already claimed", code="already_claimed")

    if task.kind == RewardTaskKind.rewarded_ad:
        if not ad_event_id:
            raise Conflict("A verified ad event is required", code="ad_event_required")
        await consume_ad_event(session, user.id, ad_event_id, purpose="task")

    row = await ledger.post(
        session,
        user_id=user.id,
        delta=task.coins,
        kind=LedgerKind.task,
        idempotency_key=f"task:{user.id}:{task.id}:{window_key}",
        ref_type="reward_task",
        ref_id=str(task.id),
        note=task.title,
        variant_map=variant_map,
    )
    rc = RewardClaim(user_id=user.id, task_id=task.id, ledger_id=row.id, created_at=now)
    session.add(rc)
    await session.flush()
    return rc
