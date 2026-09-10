"""For You, version one: nearest neighbours of the viewer's recent series, blended with popularity."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Embedding, Series
from app.models.engagement import WatchProgress
from app.services.visibility import published_series_predicates


async def for_you_ids(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    limit: int = 12,
    lang: str | None = None,
    country: str | None = None,
) -> list[uuid.UUID]:
    """Series ids nearest the centroid of what the viewer watched recently.

    Filtered by language and territory like every other rail: a recommendation the viewer cannot open on the
    page it links to is a broken card, and a geo-blocked title on the home screen is a licensing breach.
    """
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
    rows = await session.scalars(
        select(Embedding.series_id)
        .join(Series, Series.id == Embedding.series_id)
        .where(
            Embedding.model == model,
            Embedding.series_id.not_in(watched),
            *published_series_predicates(lang, country),
        )
        .order_by(Embedding.vector.cosine_distance(centroid))
        .limit(limit)
    )
    return list(rows.all())
