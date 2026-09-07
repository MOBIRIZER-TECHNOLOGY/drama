"""Favourites, likes, watch progress, reports, contact."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models.catalog import Episode, PublishStatus, Series
from app.models.engagement import Favorite, Like, WatchProgress


async def toggle_favorite(session: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID) -> bool:
    row = await session.get(Favorite, (user_id, series_id))
    if row is not None:
        await session.delete(row)
        return False
    if await session.get(Series, series_id) is None:
        raise NotFound("Series")
    session.add(Favorite(user_id=user_id, series_id=series_id, created_at=datetime.now(UTC)))
    return True


async def toggle_like(session: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID) -> tuple[bool, int]:
    series = await session.get(Series, series_id, with_for_update=True)
    if series is None:
        raise NotFound("Series")
    row = await session.get(Like, (user_id, series_id))
    if row is not None:
        await session.delete(row)
        series.like_count = max(0, series.like_count - 1)
        return False, series.like_count
    session.add(Like(user_id=user_id, series_id=series_id, created_at=datetime.now(UTC)))
    series.like_count += 1
    return True, series.like_count


async def update_progress(
    session: AsyncSession, user_id: uuid.UUID, episode_id: uuid.UUID, position_sec: int, completed: bool
) -> WatchProgress:
    episode = await session.get(Episode, episode_id)
    if episode is None:
        raise NotFound("Episode")
    now = datetime.now(UTC)
    row = await session.get(WatchProgress, (user_id, episode_id))
    if row is None:
        row = WatchProgress(
            user_id=user_id, episode_id=episode_id, series_id=episode.series_id, position_sec=0, updated_at=now
        )
        session.add(row)
    row.position_sec = max(0, position_sec)
    row.updated_at = now
    if completed and row.completed_at is None:
        row.completed_at = now
    return row


async def record_view(session: AsyncSession, series_id: uuid.UUID) -> None:
    await session.execute(update(Series).where(Series.id == series_id).values(view_count=Series.view_count + 1))


async def favorites(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(Favorite.series_id).where(Favorite.user_id == user_id).order_by(Favorite.created_at.desc())
    )
    return list(rows.all())


async def history(session: AsyncSession, user_id: uuid.UUID, limit: int = 50) -> list[tuple[WatchProgress, Episode]]:
    """Most recent progress row per series, with its episode."""
    rows = await session.execute(
        select(WatchProgress, Episode)
        .join(Episode, Episode.id == WatchProgress.episode_id)
        .where(WatchProgress.user_id == user_id, Episode.status == PublishStatus.published)
        .order_by(WatchProgress.updated_at.desc())
        .limit(limit * 3)
    )
    seen: set[uuid.UUID] = set()
    out: list[tuple[WatchProgress, Episode]] = []
    for wp, ep in rows.all():
        if wp.series_id in seen:
            continue
        seen.add(wp.series_id)
        out.append((wp, ep))
        if len(out) >= limit:
            break
    return out


async def clear_history(session: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID | None = None) -> None:
    stmt = delete(WatchProgress).where(WatchProgress.user_id == user_id)
    if series_id is not None:
        stmt = stmt.where(WatchProgress.series_id == series_id)
    await session.execute(stmt)
