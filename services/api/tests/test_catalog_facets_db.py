"""Catalogue facets: status, length and ordering.

"Is it finished so I can binge it" and "how much am I committing to" are the two questions this audience asks
of a short-drama catalogue, and neither could be asked at all. These check the boundaries, because a length
bucket is only useful if a 20-episode series lands in exactly one of them.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import get_session
from app.main import app
from app.models.catalog import Episode, PublishStatus, Series, SeriesTranslation

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


async def _series(session, *, slug: str, title: str, episodes: int, completion: str | None, views: int = 0):
    s = Series(
        slug=slug,
        status=PublishStatus.published,
        completion_status=completion,
        free_episodes=3,
        view_count=views,
        original_language="en",
    )
    session.add(s)
    await session.flush()
    session.add(SeriesTranslation(series_id=s.id, lang="en", title=title))
    for n in range(1, episodes + 1):
        session.add(Episode(series_id=s.id, number=n, status=PublishStatus.published))
    return s


@pytest.fixture
async def client():
    """One series in each length bucket, straddling the boundaries on purpose."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    async with maker() as s:
        # A shared cluster: the assertions below are about this fixture's rows only.
        await s.execute(delete(Episode))
        await s.execute(delete(SeriesTranslation))
        await s.execute(delete(Series))
        await _series(s, slug=f"tiny-{tag}", title="Tiny", episodes=8, completion="completed", views=10)
        await _series(s, slug=f"edge-{tag}", title="Edge", episodes=20, completion="ongoing", views=50)
        await _series(s, slug=f"mid-{tag}", title="Middle", episodes=40, completion=None, views=30)
        await _series(s, slug=f"epic-{tag}", title="Epic", episodes=60, completion="completed", views=90)
        await s.commit()

        async def _session():
            async with maker() as inner:
                yield inner

        app.dependency_overrides[get_session] = _session
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
        app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def titles(client, query: str) -> set[str]:
    r = await client.get(f"/v1/series?{query}")
    assert r.status_code == 200, r.text
    return {s["title"] for s in r.json()}


async def test_short_is_under_twenty(client):
    assert await titles(client, "length=short") == {"Tiny"}


async def test_twenty_episodes_is_medium_not_short(client):
    """The boundary a bucket lives or dies on: 20 belongs to exactly one side."""
    assert await titles(client, "length=medium") == {"Edge", "Middle"}


async def test_sixty_episodes_is_long(client):
    assert await titles(client, "length=long") == {"Epic"}


async def test_completed_means_completed(client):
    assert await titles(client, "status=completed") == {"Tiny", "Epic"}


async def test_an_unmarked_series_counts_as_ongoing(client):
    """NULL means the operator never said. Calling it finished promises an ending that may not exist."""
    assert await titles(client, "status=ongoing") == {"Edge", "Middle"}


async def test_facets_combine(client):
    assert await titles(client, "status=completed&length=long") == {"Epic"}


async def test_popular_orders_by_views(client):
    r = await client.get("/v1/series?sort=popular")
    assert [s["title"] for s in r.json()] == ["Epic", "Edge", "Middle", "Tiny"]


async def test_no_facets_returns_everything(client):
    assert await titles(client, "limit=50") == {"Tiny", "Edge", "Middle", "Epic"}
