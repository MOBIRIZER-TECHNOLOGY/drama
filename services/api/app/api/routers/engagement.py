import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, OptionalUser
from app.api.routers.catalog import _card, _episode_counts
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.ratelimit import limiter
from app.core.redis import redis_client
from app.models.catalog import Episode, Series
from app.models.engagement import ContactMessage, Report
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
    try:
        r = await redis_client()
        if not await r.sadd(key, viewer):
            return Ok()
        await r.expire(key, 60 * 60 * 26)
    except Exception:  # noqa: BLE001 - Redis down: count the view anyway
        pass
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


@router.post("/contact", response_model=Ok)
@limiter.limit("5/minute")
async def contact(request: Request, body: ContactIn, db: DB) -> Ok:
    s = get_settings()
    if s.turnstile_secret_key:
        ip = request.client.host if request.client else None
        if not body.captcha_token or not await verify_turnstile(body.captcha_token, s.turnstile_secret_key, ip):
            raise AppError("Captcha failed", status_code=400, code="captcha_failed")
    db.add(ContactMessage(name=body.name, email=body.email, subject=body.subject, message=body.message))
    await db.commit()
    return Ok()
