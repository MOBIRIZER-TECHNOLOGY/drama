"""For You, version one: nearest neighbours of the viewer's recent series, blended with popularity."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Embedding, PublishStatus, Series
from app.models.engagement import WatchProgress


async def for_you_ids(session: AsyncSession, user_id: uuid.UUID, *, limit: int = 12) -> list[uuid.UUID]:
    recent = list(
        (
            await session.scalars(
                select(WatchProgress.series_id)
                .where(WatchProgress.user_id == user_id)
                .order_by(WatchProgress.updated_at.desc())
                .limit(12)
            )
        ).all()
    )
    watched = list(dict.fromkeys(recent))
    if not watched:
        return []
    vectors = (await session.scalars(select(Embedding).where(Embedding.series_id.in_(watched[:6])))).all()
    if not vectors:
        return []
    model = vectors[0].model
    dims = len(vectors[0].vector)
    centroid = [0.0] * dims
    for e in vectors:
        if e.model != model:
            continue
        for i, v in enumerate(e.vector):
            centroid[i] += float(v)
    n = sum(1 for e in vectors if e.model == model)
    centroid = [c / n for c in centroid]
    now = datetime.now(UTC)
    rows = await session.scalars(
        select(Embedding.series_id)
        .join(Series, Series.id == Embedding.series_id)
        .where(
            Embedding.model == model,
            Series.status == PublishStatus.published,
            Embedding.series_id.not_in(watched),
            (Series.window_starts_at.is_(None)) | (Series.window_starts_at <= now),
            (Series.window_ends_at.is_(None)) | (Series.window_ends_at > now),
        )
        .order_by(Embedding.vector.cosine_distance(centroid))
        .limit(limit)
    )
    return list(rows.all())
