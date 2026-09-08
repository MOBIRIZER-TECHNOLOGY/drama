import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, OptionalUser
from app.api.routers.catalog import _card, _episode_counts
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.ratelimit import limiter
from app.core.redis import cache_available, note_cache_failure, note_cache_success, redis_client
from app.models.catalog import Episode, Series
from app.models.engagement import ContactMessage, Favorite, Report, WatchProgress
from app.models.wallet import CoinLedger, Purchase
from app.schemas.common import Ok
from app.schemas.engagement import ContactIn, HistoryItem, MyListOut, ProgressIn, ReportIn, ToggleOut
from app.services import engagement as eng
from app.services.captcha import verify_turnstile

router = APIRouter(tags=["engagement"])
Lang = Annotated[str, Query(max_length=10)]


@router.post("/series/{series_id}/favorite", response_model=ToggleOut)
async def favorite(series_id: uuid.UUID, ctx: CurrentUser, db: DB) -> ToggleOut:
    active = await eng.toggle_favorite(db, ctx.user.id, series_id)
    await db.commit()
    return ToggleOut(active=active)


@router.post("/series/{series_id}/like", response_model=ToggleOut)
async def like(series_id: uuid.UUID, ctx: CurrentUser, db: DB) -> ToggleOut:
    active, count = await eng.toggle_like(db, ctx.user.id, series_id)
    await db.commit()
    return ToggleOut(active=active, count=count)


@router.post("/series/{series_id}/view", response_model=Ok)
@limiter.limit("120/minute")
async def view(request: Request, series_id: uuid.UUID, db: DB, ctx: OptionalUser) -> Ok:
    """Counts one view per viewer per series per day (Redis set), so refreshes and bots do not inflate Top Picks."""
    viewer = str(ctx.user.id) if ctx else (request.client.host if request.client else "anon")
    key = f"view:{series_id}:{datetime.now(UTC).date().isoformat()}"
    # Skipped entirely while Redis is parked: this runs on every play, and paying a connect timeout per view
    # is how one dead dependency becomes a slow product.
    if cache_available():
        try:
            r = await redis_client()
            if not await r.sadd(key, viewer):
                note_cache_success()
                return Ok()
            await r.expire(key, 60 * 60 * 26)
            note_cache_success()
        except Exception:  # noqa: BLE001 - Redis down: count the view anyway
            note_cache_failure()
    await eng.record_view(db, series_id)
    await db.commit()
    return Ok()


@router.put("/episodes/{episode_id}/progress", response_model=Ok)
async def progress(episode_id: uuid.UUID, body: ProgressIn, ctx: CurrentUser, db: DB) -> Ok:
    await eng.update_progress(db, ctx.user.id, episode_id, body.position_sec, body.completed)
    await db.commit()
    return Ok()


@router.get("/me/list", response_model=MyListOut)
async def my_list(ctx: CurrentUser, db: DB, lang: Lang = "en") -> MyListOut:
    fav_ids = await eng.favorites(db, ctx.user.id)
    hist = await eng.history(db, ctx.user.id)
    ids = list(dict.fromkeys(fav_ids + [wp.series_id for wp, _ in hist]))
    series_rows = {}
    if ids:
        rows = await db.scalars(
            select(Series)
            .where(Series.id.in_(ids))
            .options(selectinload(Series.translations), selectinload(Series.categories))
        )
        series_rows = {s.id: s for s in rows.all()}
    counts = await _episode_counts(db, ids)
    cards = {sid: _card(s, lang, counts.get(sid, 0)) for sid, s in series_rows.items()}
    return MyListOut(
        favorites=[cards[i] for i in fav_ids if i in cards],
        history=[
            HistoryItem(
                series=cards[wp.series_id],
                episode_id=ep.id,
                episode_number=ep.number,
                position_sec=wp.position_sec,
                duration_sec=ep.duration_sec,
                completed=wp.completed_at is not None,
                updated_at=wp.updated_at,
            )
            for wp, ep in hist
            if wp.series_id in cards
        ],
    )


class ExportOut(BaseModel):
    """Everything this account holds, in one document.

    A viewer could delete their account and could not see what deleting it would remove — which is the wrong
    way round, and the wrong way round for India's DPDP Act and the Play policy alike. Deliberately built from
    the caller's own token: there is no user id parameter, so this endpoint cannot be pointed at anyone else.

    Money rows are included because they are the ones people actually dispute; nothing here is a secret the
    account does not already own.
    """

    generated_at: datetime
    profile: dict
    coin_ledger: list[dict]
    purchases: list[dict]
    watch_history: list[dict]
    favourites: list[dict]


@router.get("/me/export", response_model=ExportOut)
@limiter.limit("3/hour")
async def export_me(request: Request, ctx: CurrentUser, db: DB) -> ExportOut:
    """The caller's own data as JSON. Rate-limited because it is a wide read, not because it is sensitive."""
    user = ctx.user

    ledger = (
        await db.scalars(
            select(CoinLedger).where(CoinLedger.user_id == user.id).order_by(CoinLedger.created_at.desc())
        )
    ).all()
    purchases = (
        await db.scalars(select(Purchase).where(Purchase.user_id == user.id).order_by(Purchase.created_at.desc()))
    ).all()
    history = (
        await db.execute(
            select(WatchProgress, Series.slug)
            .join(Episode, Episode.id == WatchProgress.episode_id)
            .join(Series, Series.id == Episode.series_id)
            .where(WatchProgress.user_id == user.id)
            .order_by(WatchProgress.updated_at.desc())
        )
    ).all()
    favourites = (
        await db.execute(
            select(Favorite, Series.slug)
            .join(Series, Series.id == Favorite.series_id)
            .where(Favorite.user_id == user.id)
            .order_by(Favorite.created_at.desc())
        )
    ).all()

    return ExportOut(
        generated_at=datetime.now(UTC),
        profile={
            "public_id": user.public_id,
            "display_name": user.display_name,
            "email": user.email,
            "phone": user.phone,
            "locale": user.locale,
            "country": user.country,
            "coin_balance": user.coin_balance,
            "referral_code": user.referral_code,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        coin_ledger=[
            {
                "at": row.created_at.isoformat() if row.created_at else None,
                "kind": row.kind.value if hasattr(row.kind, "value") else str(row.kind),
                "delta": row.delta,
                "balance_after": row.balance_after,
                "note": row.note,
            }
            for row in ledger
        ],
        purchases=[
            {
                "at": row.created_at.isoformat() if row.created_at else None,
                "status": row.status.value if hasattr(row.status, "value") else str(row.status),
                "gateway": row.gateway,
                "currency": row.currency,
                "amount": float(row.amount),
                "coins_granted": row.coins_granted,
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in purchases
        ],
        watch_history=[
            {
                "series": slug,
                "position_sec": row.position_sec,
                "completed": bool(row.completed_at),
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row, slug in history
        ],
        favourites=[
            {"series": slug, "added_at": row.created_at.isoformat() if row.created_at else None}
            for row, slug in favourites
        ],
    )


@router.delete("/me/history", response_model=Ok)
async def clear_history(ctx: CurrentUser, db: DB, series_id: uuid.UUID | None = None) -> Ok:
    await eng.clear_history(db, ctx.user.id, series_id)
    await db.commit()
    return Ok()


@router.post("/reports", response_model=Ok)
@limiter.limit("10/minute")
async def report(request: Request, body: ReportIn, ctx: CurrentUser, db: DB) -> Ok:
    if body.series_id and await db.get(Series, body.series_id) is None:
        raise NotFound("Series")
    if body.episode_id and await db.get(Episode, body.episode_id) is None:
        raise NotFound("Episode")
    db.add(
        Report(
            reporter_id=ctx.user.id,
            series_id=body.series_id,
            episode_id=body.episode_id,
            reason=body.reason,
            details=body.details,
        )
    )
    await db.commit()
    return Ok()


class ContactOut(BaseModel):
    """A short reference the sender can quote.

    The form said "we got it" and gave the sender nothing to hold, so a follow-up email started with "I wrote
    to you last week about something". Eight characters of the message id is enough to find the row and short
    enough to read over the phone.
    """

    ok: bool = True
    reference: str


@router.post("/contact", response_model=ContactOut)
@limiter.limit("5/minute")
async def contact(request: Request, body: ContactIn, db: DB) -> ContactOut:
    s = get_settings()
    if s.turnstile_secret_key:
        ip = request.client.host if request.client else None
        if not body.captcha_token or not await verify_turnstile(body.captcha_token, s.turnstile_secret_key, ip):
            raise AppError("Captcha failed", status_code=400, code="captcha_failed")
    message = ContactMessage(name=body.name, email=body.email, subject=body.subject, message=body.message)
    db.add(message)
    await db.commit()
    return ContactOut(reference=message.id.hex[:8].upper())
