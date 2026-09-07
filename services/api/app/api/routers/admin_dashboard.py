from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import case, cast, func, select
from sqlalchemy.types import Date

from app.api.deps import DB, AdminRole, require_role
from app.models.catalog import Episode, PublishStatus, Series, SeriesTranslation
from app.models.identity import User
from app.models.wallet import CoinLedger, EpisodeUnlock, Purchase, PurchaseStatus
from app.schemas.admin import DashboardOut, DashboardPrevious

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.editor, AdminRole.support, AdminRole.finance)]
)


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(db: DB, days: int = Query(30, ge=1, le=365)) -> DashboardOut:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    # The window immediately before this one, of equal length, so deltas compare like with like.
    prev_since = since - timedelta(days=days)

    paid = select(Purchase).where(Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= since).subquery()
    revenue_rows = await db.execute(select(paid.c.currency, func.sum(paid.c.amount)).group_by(paid.c.currency))
    revenue = {cur: float(total or 0) for cur, total in revenue_rows.all()}
    purchases_paid = await db.scalar(select(func.count()).select_from(paid)) or 0
    paying_users = await db.scalar(select(func.count(func.distinct(paid.c.user_id)))) or 0

    new_users = await db.scalar(select(func.count()).where(User.created_at >= since)) or 0
    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    active_users = await db.scalar(select(func.count()).where(User.last_seen_at >= since)) or 0
    series_published = await db.scalar(select(func.count()).where(Series.status == PublishStatus.published)) or 0
    episodes_published = await db.scalar(select(func.count()).where(Episode.status == PublishStatus.published)) or 0

    unlock_rows = await db.execute(
        select(EpisodeUnlock.method, func.count())
        .where(EpisodeUnlock.created_at >= since)
        .group_by(EpisodeUnlock.method)
    )
    unlocks_by_method = {m.value: n for m, n in unlock_rows.all()}
    coins_spent = (
        await db.scalar(
            select(func.coalesce(func.sum(-CoinLedger.delta), 0)).where(
                CoinLedger.created_at >= since, CoinLedger.delta < 0
            )
        )
        or 0
    )
    coins_granted = (
        await db.scalar(
            select(func.coalesce(func.sum(CoinLedger.delta), 0)).where(
                CoinLedger.created_at >= since, CoinLedger.delta > 0
            )
        )
        or 0
    )

    day = cast(User.created_at, Date)
    reg_rows = await db.execute(select(day, func.count()).where(User.created_at >= since).group_by(day).order_by(day))
    pday = cast(Purchase.paid_at, Date)
    rev_rows = await db.execute(
        select(pday, func.count(), func.sum(Purchase.amount))
        .where(Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= since)
        .group_by(pday)
        .order_by(pday)
    )
    daily: dict[str, dict] = {}
    for d, n in reg_rows.all():
        daily.setdefault(str(d), {"date": str(d), "registrations": 0, "purchases": 0, "revenue": 0.0})[
            "registrations"
        ] = n
    for d, n, total in rev_rows.all():
        row = daily.setdefault(str(d), {"date": str(d), "registrations": 0, "purchases": 0, "revenue": 0.0})
        row["purchases"] = n
        row["revenue"] = float(total or 0)

    top_rows = await db.execute(
        select(Series.id, SeriesTranslation.title, Series.view_count, func.count(EpisodeUnlock.id))
        .join(
            SeriesTranslation,
            (SeriesTranslation.series_id == Series.id) & (SeriesTranslation.lang == "en"),
            isouter=True,
        )
        .join(EpisodeUnlock, (EpisodeUnlock.series_id == Series.id) & (EpisodeUnlock.created_at >= since), isouter=True)
        .where(Series.status == PublishStatus.published)
        .group_by(Series.id, SeriesTranslation.title, Series.view_count)
        .order_by(func.count(EpisodeUnlock.id).desc(), Series.view_count.desc())
        .limit(10)
    )
    top_series = [
        {"id": str(sid), "title": title or str(sid), "views": views, "unlocks": unlocks}
        for sid, title, views, unlocks in top_rows.all()
    ]

    previous = await _previous_window(db, prev_since, since)

    return DashboardOut(
        range_days=days,
        revenue=revenue,
        purchases_paid=purchases_paid,
        paying_users=paying_users,
        new_users=new_users,
        total_users=total_users,
        active_users=active_users,
        series_published=series_published,
        episodes_published=episodes_published,
        unlocks=sum(unlocks_by_method.values()),
        unlocks_by_method=unlocks_by_method,
        coins_spent=int(coins_spent),
        coins_granted=int(coins_granted),
        daily=sorted(daily.values(), key=lambda r: r["date"]),
        top_series=top_series,
        previous=previous,
        generated_at=now,
    )


_ = case  # keep import for future breakdowns


async def _previous_window(db, start: datetime, end: datetime) -> DashboardPrevious:
    """Totals for [start, end), the window immediately before the one on screen.

    Counted the same way as the current window so the two are comparable; `total_users` and the published
    catalogue counts are deliberately absent, because they are running totals rather than period figures and a
    delta on them would be meaningless.
    """
    paid = (
        select(Purchase)
        .where(Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= start, Purchase.paid_at < end)
        .subquery()
    )
    revenue_rows = await db.execute(select(paid.c.currency, func.sum(paid.c.amount)).group_by(paid.c.currency))
    return DashboardPrevious(
        revenue={cur: float(total or 0) for cur, total in revenue_rows.all()},
        purchases_paid=await db.scalar(select(func.count()).select_from(paid)) or 0,
        paying_users=await db.scalar(select(func.count(func.distinct(paid.c.user_id)))) or 0,
        new_users=await db.scalar(select(func.count()).where(User.created_at >= start, User.created_at < end)) or 0,
        active_users=await db.scalar(
            select(func.count()).where(User.last_seen_at >= start, User.last_seen_at < end)
        )
        or 0,
        unlocks=await db.scalar(
            select(func.count()).where(EpisodeUnlock.created_at >= start, EpisodeUnlock.created_at < end)
        )
        or 0,
        coins_spent=int(
            await db.scalar(
                select(func.coalesce(func.sum(-CoinLedger.delta), 0)).where(
                    CoinLedger.created_at >= start, CoinLedger.created_at < end, CoinLedger.delta < 0
                )
            )
            or 0
        ),
    )
