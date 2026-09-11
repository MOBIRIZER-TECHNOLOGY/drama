"""The catalogue router, exercised as requests against a real database.

`app/api/routers/catalog.py` is the public face of the product — home, browse, search, the series page, the
vertical feed, unlock and playback — and almost none of it was covered. The parts that were not covered are
exactly the parts that decide who sees what: the visibility predicate (archived, licensing window, territory,
language), the age gate, the free/locked split, and the fallbacks that keep a missing translation or a dead
cache from turning into a 500. Those rules are only real when a request goes through the whole stack, so this
file drives the ASGI app with the session pointed at a test database rather than calling handlers directly.

Every test seeds its own world under a `uuid4` tag — unique slugs, a unique embedding model name, its own
categories and users — and deletes it again afterwards, so the assertions are about this fixture's rows and
two runs against the same database do not collide. Where a response is global by nature (the home rails, the
shorts page), the assertion is scoped to the seeded ids rather than pinned to the whole catalogue.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import json
import os
import sys
import types
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Annotated

import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import deps
from app.api.routers import catalog
from app.core import db as app_db
from app.core.config import get_settings
from app.core.db import get_session
from app.core.ratelimit import limiter
from app.main import app
from app.models.catalog import (
    AssetStatus,
    Category,
    CategoryTranslation,
    Embedding,
    Episode,
    PublishStatus,
    Series,
    SeriesCategory,
    SeriesTranslation,
    Subtitle,
    VideoAsset,
)
from app.models.engagement import Favorite, Like, WatchProgress
from app.models.identity import User
from app.models.wallet import CoinLedger, EpisodeUnlock, UnlockMethod, VipMembership

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

NOW = datetime.now(UTC)
EMBEDDING_DIMS = 1024


def _vec(*head: float) -> list[float]:
    """A 1024-dimension vector whose interesting values are at the front; the rest is zero padding."""
    return list(head) + [0.0] * (EMBEDDING_DIMS - len(head))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_rate_limit_window():
    """`/v1/series` is capped at 60/minute and the limiter's memory storage outlives a single test.

    Without this the file's own request volume starts answering 429 partway through, which would be a test
    failure caused by the test suite rather than by the handler.
    """
    limiter.reset()
    yield
    limiter.reset()


class FakeRedis:
    """Just the two calls the home handler makes, so cache behaviour is assertable instead of ambient."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.fail = False
        self.fail_on_set = False  # reads fine, refuses writes: a full or read-only instance

    async def get(self, key: str):
        if self.fail:
            raise RuntimeError("redis is down")
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None):
        if self.fail or self.fail_on_set:
            raise RuntimeError("redis is down")
        self.store[key] = value


@pytest.fixture(autouse=True)
def cache(monkeypatch) -> FakeRedis:
    """A per-test cache. The real Redis is shared and keyed only by language and country, so a response
    cached by one test would be served to the next one."""
    fake = FakeRedis()

    async def _client():
        return fake

    monkeypatch.setattr(catalog, "redis_client", _client)
    monkeypatch.setattr(catalog, "cache_available", lambda: True)
    return fake


@pytest.fixture
async def world(monkeypatch):
    """One complete catalogue: visible series, invisible ones, episodes at every access state, and viewers.

    The invisible rows are the point of most of the assertions — an archived series, one whose licensing
    window has not opened, one whose window has closed, one licensed only to IN and one published only in
    Tamil all exist here so the endpoints can be asked to leave them out.
    """
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    w = SimpleNamespace(tag=tag, model=f"emb-{tag}")

    async with maker() as s:
        cat_a = Category(slug=f"romance-{tag}", name="Romance", show_on_home=True, sort_order=10)
        cat_b = Category(slug=f"thriller-{tag}", name="Thriller", show_on_home=False, sort_order=20)
        s.add_all([cat_a, cat_b])
        await s.flush()
        # Only cat_a is translated: the fallback to the admin's English name is a branch of its own.
        s.add(CategoryTranslation(category_id=cat_a.id, lang="hi", name="रोमांस"))

        plain = VideoAsset(
            source_key=f"src/{tag}/a1.mp4", status=AssetStatus.ready, hls_master_key="hls/a1/master.m3u8"
        )
        encrypted = VideoAsset(
            source_key=f"src/{tag}/a3.mp4",
            status=AssetStatus.ready,
            hls_master_key="hls/a3/master.m3u8",
            is_encrypted=True,
        )
        spare = VideoAsset(source_key=f"src/{tag}/x.mp4", status=AssetStatus.ready, hls_master_key="hls/x/master.m3u8")
        s.add_all([plain, encrypted, spare])
        await s.flush()

        def series(slug: str, **kw) -> Series:
            kw.setdefault("status", PublishStatus.published)
            kw.setdefault("original_language", "en")
            row = Series(slug=f"{slug}-{tag}", **kw)
            s.add(row)
            return row

        alpha = series(
            "alpha",
            is_featured=True,
            is_premium=True,
            free_episodes=2,
            episode_price=40,
            bundle_discount_pct=25,
            content_rating="U",
            completion_status="ongoing",
            release_note="New episodes Friday",
            cover_url="covers/alpha.jpg",
            banner_url="banners/alpha.jpg",
            view_count=900_001,
            like_count=7,
            sort_weight=9001,
            released_at=NOW - timedelta(days=1),
            updated_at=NOW - timedelta(days=3),
        )
        beta = series(
            "beta",
            free_episodes=1,
            content_rating="A",  # adult: everything behind it needs a confirmed age
            completion_status="completed",
            view_count=900_000,
            sort_weight=9000,
            released_at=NOW - timedelta(days=2),
            updated_at=NOW - timedelta(days=1),
        )
        catonly = series(
            "catonly",
            free_episodes=5,
            view_count=900_002,  # the most-viewed of the fixture, so `popular` and `featured` differ
            sort_weight=8000,
            released_at=None,
            updated_at=NOW - timedelta(days=2),
        )
        gamma = series(
            "gamma", original_language="hi", free_episodes=5, content_rating="U", view_count=899_999, sort_weight=8999
        )
        # Deliberately unrated: an omitted rating is the one the age gate has to treat as not yet cleared.
        notrans = series("notrans", free_episodes=5, view_count=899_998, sort_weight=8998)
        geo = series(
            "geo", free_episodes=5, content_rating="U", territories=["IN"], view_count=899_997, sort_weight=8997
        )
        tamil = series(
            "tamil",
            free_episodes=5,
            content_rating="U",
            visible_languages=["ta"],
            view_count=899_996,
            sort_weight=8996,
        )
        archived = series(
            "archived", status=PublishStatus.archived, content_rating="U", free_episodes=5, sort_weight=8995
        )
        future = series(
            "future",
            free_episodes=5,
            content_rating="U",
            window_starts_at=NOW + timedelta(days=7),
            sort_weight=8994,
        )
        expired = series(
            "expired",
            free_episodes=5,
            content_rating="U",
            window_ends_at=NOW - timedelta(days=1),
            sort_weight=8993,
        )
        # An embedding of its own under a model nothing else uses, so the neighbour query finds the series'
        # own vector and then no neighbours at all — a different outcome from having no vector.
        solo = series("solo", free_episodes=5, content_rating="U", view_count=899_980, sort_weight=8900)
        # Filler keeps the first shorts page full (8 series) and gives the Continue rail more series than it
        # is allowed to show, without depending on rows this file did not seed.
        fillers = [
            series(f"filler{i}", free_episodes=5, content_rating="U", view_count=899_990 - i, sort_weight=8990 - i)
            for i in range(6)
        ]
        await s.flush()

        # Written as association rows rather than by assigning `series.categories`: assigning a lazy
        # collection on an async session loads the old value first, which is IO outside its greenlet.
        s.add_all(
            [
                SeriesCategory(series_id=alpha.id, category_id=cat_a.id),
                SeriesCategory(series_id=beta.id, category_id=cat_a.id),
                SeriesCategory(series_id=beta.id, category_id=cat_b.id),
                SeriesCategory(series_id=catonly.id, category_id=cat_a.id),
                SeriesCategory(series_id=geo.id, category_id=cat_b.id),
                SeriesCategory(series_id=solo.id, category_id=cat_b.id),
                SeriesCategory(series_id=tamil.id, category_id=cat_b.id),
                # Filed under a category on purpose: the filter must still refuse to show them.
                SeriesCategory(series_id=archived.id, category_id=cat_a.id),
                SeriesCategory(series_id=future.id, category_id=cat_a.id),
                SeriesCategory(series_id=expired.id, category_id=cat_a.id),
            ]
        )

        s.add_all(
            [
                SeriesTranslation(
                    series_id=alpha.id,
                    lang="en",
                    title=f"Alpha {tag}",
                    synopsis="An alpha synopsis",
                    seo_title="Alpha, ranked",
                    meta_description="Everything about Alpha",
                ),
                SeriesTranslation(series_id=alpha.id, lang="hi", title=f"अल्फा {tag}"),
                SeriesTranslation(series_id=beta.id, lang="en", title=f"Beta {tag}"),
                SeriesTranslation(series_id=catonly.id, lang="en", title=f"Catonly {tag}"),
                # No English title at all: the fallback is to the series' own original language.
                SeriesTranslation(series_id=gamma.id, lang="hi", title=f"गामा {tag}"),
                SeriesTranslation(series_id=geo.id, lang="en", title=f"Geo {tag}"),
                SeriesTranslation(series_id=solo.id, lang="en", title=f"Solo {tag}"),
                SeriesTranslation(series_id=tamil.id, lang="en", title=f"Tamil {tag}"),
                SeriesTranslation(series_id=archived.id, lang="en", title=f"Archived {tag}"),
                SeriesTranslation(series_id=future.id, lang="en", title=f"Future {tag}"),
                SeriesTranslation(series_id=expired.id, lang="en", title=f"Expired {tag}"),
            ]
        )

        def episode(series_row: Series, number: int, **kw) -> Episode:
            row = Episode(series_id=series_row.id, number=number, status=PublishStatus.published, **kw)
            s.add(row)
            return row

        # Alpha's episodes cover the whole matrix: free with a plain asset, free with an embed, locked with an
        # encrypted asset, locked with nothing packaged yet, and one still in draft.
        a1 = episode(alpha, 1, title="A1", duration_sec=61, thumbnail_url="thumbs/a1.jpg", video_asset_id=plain.id)
        a2 = episode(alpha, 2, title="A2", duration_sec=62, embed_html="<iframe src='x'></iframe>")
        a3 = episode(alpha, 3, title="A3", duration_sec=63, video_asset_id=encrypted.id)
        a4 = episode(alpha, 4, title="A4", duration_sec=64)
        a5 = Episode(series_id=alpha.id, number=5, title="A5", status=PublishStatus.draft, video_asset_id=spare.id)
        s.add(a5)
        b1 = episode(beta, 1, title="B1", video_asset_id=spare.id)
        episode(beta, 2, title="B2")
        g1 = episode(gamma, 1, title="G1", video_asset_id=spare.id)
        n1 = episode(notrans, 1, title="N1", video_asset_id=spare.id)
        geo1 = episode(geo, 1, title="Geo1", video_asset_id=spare.id)
        arch1 = episode(archived, 1, title="Arch1", video_asset_id=spare.id)
        c1 = episode(catonly, 1, title="C1", video_asset_id=spare.id)
        s1 = episode(solo, 1, title="S1", video_asset_id=spare.id)
        filler_eps = [episode(f, 1, title="F1", video_asset_id=spare.id) for f in fillers]
        await s.flush()
        s.add(Subtitle(episode_id=a1.id, lang="en", vtt_key=f"subs/{tag}/a1.vtt"))

        # A private embedding model, so neighbour queries see this fixture's vectors and nothing else.
        s.add_all(
            [
                Embedding(series_id=alpha.id, model=w.model, vector=_vec(1.0, 0.0, 0.0), updated_at=NOW),
                Embedding(series_id=beta.id, model=w.model, vector=_vec(0.9, 0.1, 0.0), updated_at=NOW),
                Embedding(series_id=gamma.id, model=w.model, vector=_vec(0.0, 1.0, 0.0), updated_at=NOW),
                Embedding(series_id=geo.id, model=w.model, vector=_vec(0.1, 0.5, 0.5), updated_at=NOW),
                Embedding(series_id=solo.id, model=f"solo-{tag}", vector=_vec(1.0, 0.0, 0.0), updated_at=NOW),
            ]
        )

        def user(**kw) -> User:
            # The full width both columns allow. The shared test database holds tens of thousands of leftover
            # accounts, and an eight-character referral code collided with one of them often enough to error
            # a run roughly once in ten.
            row = User(public_id=uuid.uuid4().hex[:12], referral_code=uuid.uuid4().hex[:16].upper(), **kw)
            s.add(row)
            return row

        viewer = user(coin_balance=500)
        adult = user(coin_balance=500, age_confirmed_at=NOW)
        vip = user(coin_balance=500, age_confirmed_at=NOW)
        pauper = user(coin_balance=0)
        await s.flush()
        s.add(
            VipMembership(
                user_id=vip.id, starts_at=NOW - timedelta(days=1), ends_at=NOW + timedelta(days=30), source="admin"
            )
        )
        await s.commit()

        w.cat_a, w.cat_b = cat_a, cat_b
        w.alpha, w.beta, w.catonly, w.gamma, w.notrans = alpha, beta, catonly, gamma, notrans
        w.geo, w.tamil, w.archived, w.future, w.expired = geo, tamil, archived, future, expired
        w.solo, w.fillers, w.filler_eps = solo, fillers, filler_eps
        w.a1, w.a2, w.a3, w.a4, w.a5 = a1, a2, a3, a4, a5
        w.b1, w.g1, w.n1, w.geo1, w.arch1, w.c1, w.s1 = b1, g1, n1, geo1, arch1, c1, s1
        w.plain, w.encrypted = plain, encrypted
        w.viewer, w.adult, w.vip, w.pauper = viewer, adult, vip, pauper
        w.mine = {
            alpha.slug,
            beta.slug,
            catonly.slug,
            gamma.slug,
            notrans.slug,
            geo.slug,
            solo.slug,
            tamil.slug,
            archived.slug,
            future.slug,
            expired.slug,
            *(f.slug for f in fillers),
        }

        async def _session():
            async with maker() as inner:
                # Exact nearest-neighbour search for the duration of the request. `embeddings` carries an
                # HNSW index, which is approximate by design and loses recall as dead tuples build up — and
                # this file inserts and deletes a handful of vectors per test, so by the end of a run the
                # graph is mostly tombstones and a query can miss live rows entirely. The ranking these
                # tests assert on is the router's, not the index's; the index is a production performance
                # concern and has its own trade-off to make.
                await inner.execute(text("SET LOCAL enable_indexscan = off"))
                yield inner

        def sign_in(u: User) -> None:
            """Both the required and the optional dependency, resolved against the request's own session.

            `unlock` refreshes `ctx.user` on the handler's session, so the context cannot hand back a User
            loaded somewhere else. Depending on `get_session` here gets the overridden session, and FastAPI's
            per-request dependency cache makes it the same instance the handler is using.
            """

            async def _ctx(db: Annotated[AsyncSession, Depends(get_session)]):
                return deps.AuthContext(user=await db.get(User, u.id), session_id=None)

            app.dependency_overrides[deps.current_user] = _ctx
            app.dependency_overrides[deps.optional_user] = _ctx

        w.sign_in = sign_in
        w.session = maker
        app.dependency_overrides[get_session] = _session
        # Belt to the override's brace. `KATHA_DATABASE_URL` is not set for a test run, so `app.core.db`'s
        # own sessionmaker points at whatever database the developer works against day to day — and anything
        # that reaches it does not fail, it quietly answers from real data: an empty rail, a 404 for a series
        # that plainly exists. Pointing it at the test database as well means a request can only ever be
        # wrong in ways this file can see.
        monkeypatch.setattr(app_db, "SessionLocal", maker)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            w.client = c
            yield w
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(deps.current_user, None)
        app.dependency_overrides.pop(deps.optional_user, None)

    async with maker() as s:
        users = [viewer.id, adult.id, vip.id, pauper.id]
        # Unlocks reference ledger rows, so they go first: cascading both off the user in one statement would
        # have Postgres deleting a ledger row that an unlock still points at.
        await s.execute(delete(EpisodeUnlock).where(EpisodeUnlock.user_id.in_(users)))
        await s.execute(delete(WatchProgress).where(WatchProgress.user_id.in_(users)))
        await s.execute(delete(Favorite).where(Favorite.user_id.in_(users)))
        await s.execute(delete(Like).where(Like.user_id.in_(users)))
        await s.execute(delete(VipMembership).where(VipMembership.user_id.in_(users)))
        await s.execute(delete(CoinLedger).where(CoinLedger.user_id.in_(users)))
        await s.execute(delete(User).where(User.id.in_(users)))
        await s.execute(delete(Series).where(Series.slug.like(f"%-{tag}")))
        await s.execute(delete(Category).where(Category.id.in_([cat_a.id, cat_b.id])))
        await s.execute(delete(VideoAsset).where(VideoAsset.id.in_([plain.id, encrypted.id, spare.id])))
        await s.commit()
    await engine.dispose()


IN = {"cf-ipcountry": "IN"}
US = {"cf-ipcountry": "US"}


async def cards(world, query: str, **kw) -> list[dict]:
    r = await world.client.get(f"/v1/series?{query}", **kw)
    assert r.status_code == 200, r.text
    return r.json()


def slugs(rows: list[dict]) -> list[str]:
    return [row["slug"] for row in rows]


def rail(body: dict, key: str) -> dict | None:
    return next((r for r in body["rails"] if r["key"] == key), None)


def install_embedder(monkeypatch, model: str, vector: list[float], *, explode: bool = False) -> list[str]:
    """Stand `katha_ai.embeddings` up in `sys.modules` so the semantic branch of search can actually run.

    The package is an optional dependency and is absent here, which means `_semantic_ids` returns early and
    the whole vector path — the query cache, the distance ordering, the visibility filter applied to the hits
    — was unreachable from a test. The module is faked; the pgvector query underneath it is real.
    """
    calls: list[str] = []

    async def embed_query(q: str) -> list[float]:
        calls.append(q)
        if explode:
            raise RuntimeError("embedding provider is down")
        return vector

    mod = types.ModuleType("katha_ai.embeddings")
    mod.embed_query = embed_query
    mod.model_name = lambda: model
    pkg = types.ModuleType("katha_ai")
    pkg.embeddings = mod
    monkeypatch.setitem(sys.modules, "katha_ai", pkg)
    monkeypatch.setitem(sys.modules, "katha_ai.embeddings", mod)
    return calls


# ---------------------------------------------------------------------------
# GET /v1/series — filtering, ordering, paging
# ---------------------------------------------------------------------------


async def test_a_category_lists_only_the_series_a_viewer_may_see(world):
    """Archived, not-yet-licensed and expired series are all filed under this category on purpose."""
    rows = await cards(world, f"category={world.cat_a.slug}", headers=IN)
    assert slugs(rows) == [world.alpha.slug, world.beta.slug, world.catonly.slug]


async def test_an_unknown_category_returns_an_empty_list_not_an_error(world):
    r = await world.client.get(f"/v1/series?category=nope-{world.tag}")
    assert r.status_code == 200
    assert r.json() == []


async def test_the_default_order_is_the_operator_s_own_weighting(world):
    rows = await cards(world, f"category={world.cat_a.slug}&sort=featured")
    assert slugs(rows) == [world.alpha.slug, world.beta.slug, world.catonly.slug]


async def test_popular_orders_by_views_and_disagrees_with_the_editorial_order(world):
    rows = await cards(world, f"category={world.cat_a.slug}&sort=popular")
    assert slugs(rows) == [world.catonly.slug, world.alpha.slug, world.beta.slug]


async def test_newest_puts_a_series_with_no_release_date_last(world):
    """`nullslast` is the whole reason the clause is spelled out: unset must not sort as newest."""
    rows = await cards(world, f"category={world.cat_a.slug}&sort=newest")
    assert slugs(rows) == [world.alpha.slug, world.beta.slug, world.catonly.slug]


async def test_updated_orders_by_last_change(world):
    rows = await cards(world, f"category={world.cat_a.slug}&sort=updated")
    assert slugs(rows) == [world.beta.slug, world.catonly.slug, world.alpha.slug]


async def test_limit_and_offset_page_through_the_same_order(world):
    first = await cards(world, f"category={world.cat_a.slug}&limit=1")
    second = await cards(world, f"category={world.cat_a.slug}&limit=1&offset=1")
    assert slugs(first) == [world.alpha.slug]
    assert slugs(second) == [world.beta.slug]


@pytest.mark.parametrize(
    "query",
    [
        "sort=random",
        "status=cancelled",
        "length=enormous",
        "limit=0",
        "limit=101",
        "offset=-1",
        "offset=10001",
        "lang=12345678901",
        "category=" + "x" * 81,
        "q=" + "x" * 121,
    ],
)
async def test_a_parameter_outside_its_contract_is_rejected(world, query):
    assert (await world.client.get(f"/v1/series?{query}")).status_code == 422


async def test_the_card_counts_published_episodes_and_points_at_the_first_one(world):
    """Alpha has five episodes and one of them is a draft; the count and the deep link are both about four."""
    rows = await cards(world, f"category={world.cat_a.slug}&limit=1")
    assert rows[0]["episode_count"] == 4
    assert rows[0]["first_episode_id"] == str(world.a1.id)
    assert rows[0]["progress"] is None


async def test_the_card_carries_what_the_client_renders(world):
    cdn = get_settings().cdn_base_url.rstrip("/")
    row = (await cards(world, f"category={world.cat_a.slug}&limit=1"))[0]
    assert row["title"] == f"Alpha {world.tag}"
    assert row["synopsis"] == "An alpha synopsis"
    # Stored as keys, resolved against the CDN at response time.
    assert row["cover_url"] == f"{cdn}/covers/alpha.jpg"
    assert row["banner_url"] == f"{cdn}/banners/alpha.jpg"
    assert row["is_featured"] is True and row["is_premium"] is True
    assert row["free_episodes"] == 2 and row["like_count"] == 7
    assert row["completion_status"] == "ongoing" and row["release_note"] == "New episodes Friday"
    assert row["is_adult"] is False  # rated "U"
    assert [c["slug"] for c in row["categories"]] == [world.cat_a.slug]


async def test_a_series_with_no_cover_resolves_to_no_url(world):
    row = (await cards(world, f"category={world.cat_a.slug}&limit=1&offset=1"))[0]
    assert row["cover_url"] is None and row["banner_url"] is None


async def test_title_search_matches_the_translation(world):
    assert slugs(await cards(world, f"q=Alpha {world.tag}")) == [world.alpha.slug]


async def test_search_escapes_like_wildcards(world):
    """Unescaped, `%<tag>` would match every seeded title; escaped, it asks for a literal percent sign."""
    assert await cards(world, f"q=%25{world.tag}") == []


async def test_completed_and_ongoing_split_the_catalogue_including_the_unmarked(world):
    """Catonly has no completion status, and an unmarked series is far likelier still running than finished."""
    assert set(slugs(await cards(world, f"category={world.cat_a.slug}&status=completed"))) == {world.beta.slug}
    assert set(slugs(await cards(world, f"category={world.cat_a.slug}&status=ongoing"))) == {
        world.alpha.slug,
        world.catonly.slug,
    }


async def test_length_buckets_place_a_short_series_in_exactly_one_of_them(world):
    """Alpha has four published episodes, so it is short and must be absent from both other buckets."""
    assert world.alpha.slug in slugs(await cards(world, f"category={world.cat_a.slug}&length=short"))
    assert await cards(world, f"category={world.cat_a.slug}&length=medium") == []
    assert await cards(world, f"category={world.cat_a.slug}&length=long") == []


async def test_an_unknown_language_falls_back_to_the_series_original(world):
    rows = await cards(world, f"category={world.cat_a.slug}&lang=fr&limit=1")
    assert rows[0]["title"] == f"Alpha {world.tag}"  # original_language is "en"


async def test_a_hindi_viewer_gets_the_hindi_title_and_genre_name(world):
    rows = await cards(world, f"category={world.cat_a.slug}&lang=hi&limit=1")
    assert rows[0]["title"] == f"अल्फा {world.tag}"
    assert rows[0]["categories"][0]["name"] == "रोमांस"


async def test_an_english_request_for_a_hindi_only_series_falls_back_to_hindi(world):
    """Gamma was never translated into English, and its original language is Hindi."""
    rows = await cards(world, f"q=गामा {world.tag}")
    assert slugs(rows) == [world.gamma.slug]
    assert rows[0]["title"] == f"गामा {world.tag}"


async def test_a_territory_locked_series_is_invisible_outside_its_licence(world):
    assert world.geo.slug in slugs(await cards(world, f"category={world.cat_b.slug}", headers=IN))
    assert world.geo.slug not in slugs(await cards(world, f"category={world.cat_b.slug}", headers=US))


async def test_a_series_published_in_one_language_is_invisible_in_another(world):
    assert world.tamil.slug not in slugs(await cards(world, f"category={world.cat_b.slug}&lang=en"))
    assert world.tamil.slug in slugs(await cards(world, f"category={world.cat_b.slug}&lang=ta"))


async def test_an_unrecognised_country_header_is_treated_as_unknown(world):
    """`XX` is what the edge sends when it cannot place the client; it must not mean "the territory XX"."""
    assert world.geo.slug in slugs(await cards(world, f"category={world.cat_b.slug}", headers={"cf-ipcountry": "XX"}))


# ---------------------------------------------------------------------------
# Semantic search
# ---------------------------------------------------------------------------


async def test_semantic_search_orders_hits_by_vector_distance(world, monkeypatch):
    """With an embedder present, the free-text query is answered by the vector index, not by ILIKE.

    The query vector is gamma's, so the ranking is gamma, then geo (which shares a dimension with it), then
    beta, then alpha — an order no title match could produce.
    """
    calls = install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    rows = await cards(world, "q=heartbreak%20revenge", headers=IN)
    assert slugs(rows) == [world.gamma.slug, world.geo.slug, world.beta.slug, world.alpha.slug]
    assert calls == ["heartbreak revenge"]


async def test_a_semantic_hit_the_viewer_may_not_see_is_dropped(world, monkeypatch):
    """The vector query filters on publication only; the territory rule is applied by the caller's statement."""
    install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    rows = await cards(world, "q=heartbreak%20revenge", headers=US)
    assert slugs(rows) == [world.gamma.slug, world.beta.slug, world.alpha.slug]


async def test_the_query_vector_is_cached_so_a_repeat_search_does_not_re_embed(world, monkeypatch, cache):
    calls = install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    await cards(world, "q=Heartbreak%20%20Revenge", headers=IN)
    await cards(world, "q=heartbreak%20revenge", headers=IN)  # same query once normalised
    assert calls == ["heartbreak revenge"]
    assert [k for k in cache.store if k.startswith("semq:")]


async def test_search_still_answers_when_the_cache_is_dead(world, monkeypatch, cache):
    cache.fail = True
    install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    rows = await cards(world, "q=heartbreak%20revenge", headers=IN)
    assert slugs(rows)[0] == world.gamma.slug


async def test_search_still_answers_when_the_cache_refuses_to_be_written_to(world, monkeypatch, cache):
    """A full or read-only Redis fails on `set`, not on `get`; the query still has to be answered."""
    cache.fail_on_set = True
    install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    rows = await cards(world, "q=heartbreak revenge", headers=IN)
    assert slugs(rows)[0] == world.gamma.slug
    assert not [k for k in cache.store if k.startswith("semq:")]


async def test_a_broken_embedder_falls_back_to_title_search(world, monkeypatch):
    """A slow or dead provider must degrade to the text index, not fail the catalogue request."""
    install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0), explode=True)
    assert slugs(await cards(world, f"q=Alpha {world.tag}")) == [world.alpha.slug]


async def test_a_paged_search_uses_the_text_index(world, monkeypatch):
    """Vector results cannot be offset into, so page two of a search is answered by title match."""
    install_embedder(monkeypatch, world.model, _vec(0.0, 1.0, 0.0))
    rows = await cards(world, f"q={world.tag}&offset=1&limit=100")
    assert world.gamma.slug in slugs(rows)  # ordered editorially, not by distance
    assert slugs(rows)[0] != world.gamma.slug


# ---------------------------------------------------------------------------
# GET /v1/categories
# ---------------------------------------------------------------------------


async def test_categories_come_back_in_the_operator_s_order(world):
    r = await world.client.get("/v1/categories")
    assert r.status_code == 200
    listed = [c for c in r.json() if c["slug"] in {world.cat_a.slug, world.cat_b.slug}]
    assert [c["name"] for c in listed] == ["Romance", "Thriller"]


async def test_a_genre_name_is_translated_and_otherwise_kept_as_typed(world):
    r = await world.client.get("/v1/categories?lang=hi")
    by_slug = {c["slug"]: c["name"] for c in r.json()}
    assert by_slug[world.cat_a.slug] == "रोमांस"
    assert by_slug[world.cat_b.slug] == "Thriller"  # never translated; the English name is what there is


# ---------------------------------------------------------------------------
# GET /v1/browse
# ---------------------------------------------------------------------------


async def test_browse_groups_every_category_including_the_ones_home_hides(world):
    r = await world.client.get("/v1/browse", headers=IN)
    assert r.status_code == 200
    body = r.json()
    a = rail(body, f"category:{world.cat_a.slug}")
    b = rail(body, f"category:{world.cat_b.slug}")
    assert a and slugs(a["items"]) == [world.alpha.slug, world.beta.slug, world.catonly.slug]
    assert a["title"] == "Romance"
    # cat_b is show_on_home=False, which browse ignores — it is the page that shows everything.
    assert b and slugs(b["items"]) == [world.beta.slug, world.geo.slug, world.solo.slug]


async def test_browse_caps_each_rail(world):
    body = (await world.client.get("/v1/browse?per_category=1", headers=IN)).json()
    assert slugs(rail(body, f"category:{world.cat_a.slug}")["items"]) == [world.alpha.slug]


async def test_browse_gives_uncategorised_series_a_rail_of_their_own(world):
    """Nothing in the catalogue should be unreachable just because nobody filed it."""
    body = (await world.client.get("/v1/browse", headers=IN)).json()
    loose = rail(body, "uncategorised")
    assert loose and loose["title"] == "More on Katha"
    assert {world.gamma.slug, world.notrans.slug} <= set(slugs(loose["items"]))


@pytest.mark.parametrize("value", ["0", "41", "abc"])
async def test_browse_rejects_an_impossible_page_size(world, value):
    assert (await world.client.get(f"/v1/browse?per_category={value}")).status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/home
# ---------------------------------------------------------------------------


async def test_home_serves_the_editorial_rails_to_a_guest(world):
    body = (await world.client.get("/v1/home", headers=IN)).json()
    keys = [r["key"] for r in body["rails"]]
    assert "featured" in keys and "top_picks" in keys and "newest" in keys
    assert f"category:{world.cat_a.slug}" in keys
    # Personalised rails need a viewer; a guest must not get an empty one.
    assert "continue" not in keys and "for_you" not in keys
    # show_on_home is False for cat_b, which is the only thing keeping it off the front page.
    assert f"category:{world.cat_b.slug}" not in keys


async def test_the_featured_rail_holds_only_featured_series(world):
    body = (await world.client.get("/v1/home", headers=IN)).json()
    featured = slugs(rail(body, "featured")["items"])
    assert world.alpha.slug in featured
    assert world.beta.slug not in featured


async def test_top_picks_is_ordered_by_views(world):
    body = (await world.client.get("/v1/home", headers=IN)).json()
    ours = [s for s in slugs(rail(body, "top_picks")["items"]) if s in world.mine]
    assert ours[:4] == [world.catonly.slug, world.alpha.slug, world.beta.slug, world.gamma.slug]


async def test_home_never_shows_a_series_the_viewer_cannot_open(world):
    body = (await world.client.get("/v1/home", headers=US)).json()
    everywhere = {s for r in body["rails"] for s in slugs(r["items"])}
    assert world.archived.slug not in everywhere
    assert world.future.slug not in everywhere
    assert world.expired.slug not in everywhere
    assert world.geo.slug not in everywhere  # licensed to IN only, and this request is from US


async def test_continue_watching_carries_the_position_to_resume_from(world):
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.a2.id,
                series_id=world.alpha.id,
                position_sec=37,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    cont = rail(body, "continue")
    assert cont and slugs(cont["items"]) == [world.alpha.slug]
    assert cont["items"][0]["progress"] == {
        "episode_id": str(world.a2.id),
        "episode_number": 2,
        "position_sec": 37,
        "duration_sec": 62,
    }


async def test_a_finished_episode_is_not_offered_as_something_to_continue(world):
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.a1.id,
                series_id=world.alpha.id,
                position_sec=61,
                completed_at=NOW,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert rail(body, "continue") is None


async def test_continue_drops_a_series_that_stopped_being_visible(world):
    """Progress survives an unpublish; the rail must not link to a page that now 404s."""
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.arch1.id,
                series_id=world.archived.id,
                position_sec=5,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert rail(body, "continue") is None


async def test_continue_shows_a_series_once_however_many_episodes_are_part_watched(world):
    async with world.session() as s:
        s.add_all(
            [
                WatchProgress(
                    user_id=world.viewer.id,
                    episode_id=world.a2.id,
                    series_id=world.alpha.id,
                    position_sec=10,
                    updated_at=NOW,
                ),
                WatchProgress(
                    user_id=world.viewer.id,
                    episode_id=world.a1.id,
                    series_id=world.alpha.id,
                    position_sec=20,
                    updated_at=NOW - timedelta(minutes=5),
                ),
            ]
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    items = rail(body, "continue")["items"]
    assert slugs(items) == [world.alpha.slug]
    assert items[0]["progress"]["episode_id"] == str(world.a2.id)  # the most recently touched one


async def test_continue_watching_is_capped_at_one_rail(world):
    """Thirteen series part-watched, twelve slots. The rail is a rail, not the viewer's whole history."""
    watched = [
        (world.alpha, world.a1),
        (world.beta, world.b1),
        (world.catonly, world.c1),
        (world.gamma, world.g1),
        (world.notrans, world.n1),
        (world.geo, world.geo1),
        (world.solo, world.s1),
        *zip(world.fillers, world.filler_eps, strict=True),
    ]
    assert len(watched) == 13
    async with world.session() as s:
        for i, (series_row, ep) in enumerate(watched):
            s.add(
                WatchProgress(
                    user_id=world.viewer.id,
                    episode_id=ep.id,
                    series_id=series_row.id,
                    position_sec=5,
                    updated_at=NOW - timedelta(minutes=i),  # the first pair is the most recently touched
                )
            )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    items = slugs(rail(body, "continue")["items"])
    assert len(items) == catalog.HOME_RAIL_SIZE == 12
    assert items[0] == world.alpha.slug
    assert watched[-1][0].slug not in items  # the oldest is what falls off the end


async def test_for_you_recommends_the_nearest_unwatched_series(world):
    """The rail is built from embeddings: having watched alpha, the neighbours ranked by distance follow."""
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.a1.id,
                series_id=world.alpha.id,
                position_sec=5,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    picks = rail(body, "for_you")
    assert picks and slugs(picks["items"]) == [world.beta.slug, world.geo.slug, world.gamma.slug]


async def test_a_guest_home_is_served_from_the_cache(world, cache):
    """Proven with a payload no query could have produced, so a cache miss cannot pass this test."""
    cache.store["home:en:IN"] = json.dumps({"rails": [{"key": "sentinel", "title": "Sentinel", "items": []}]})
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert [r["key"] for r in body["rails"]] == ["sentinel"]


async def test_a_guest_home_is_written_to_the_cache(world, cache):
    await world.client.get("/v1/home?lang=hi", headers=IN)
    assert "home:hi:IN" in cache.store
    assert json.loads(cache.store["home:hi:IN"])["rails"]


async def test_a_signed_in_home_is_neither_read_from_nor_written_to_the_cache(world, cache):
    """The rails are personal; serving one viewer's Continue list to the next one would be the bug."""
    cache.store["home:en:IN"] = json.dumps({"rails": [{"key": "sentinel", "title": "Sentinel", "items": []}]})
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert "sentinel" not in [r["key"] for r in body["rails"]]
    assert cache.store["home:en:IN"] == json.dumps({"rails": [{"key": "sentinel", "title": "Sentinel", "items": []}]})


async def test_home_is_still_served_when_the_cache_is_dead(world, cache):
    cache.fail = True
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert "top_picks" in [r["key"] for r in body["rails"]]


async def test_home_skips_the_cache_entirely_once_redis_has_been_parked(world, cache, monkeypatch):
    """`cache_available()` is what keeps a dead Redis from costing a timeout on every single request."""
    monkeypatch.setattr(catalog, "cache_available", lambda: False)
    cache.store["home:en:IN"] = json.dumps({"rails": [{"key": "sentinel", "title": "Sentinel", "items": []}]})
    body = (await world.client.get("/v1/home", headers=IN)).json()
    assert "sentinel" not in [r["key"] for r in body["rails"]]
    assert len(cache.store) == 1  # nothing written either


# ---------------------------------------------------------------------------
# GET /v1/series/{id_or_slug}
# ---------------------------------------------------------------------------


async def test_a_series_can_be_fetched_by_slug_or_by_id(world):
    by_slug = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    by_id = (await world.client.get(f"/v1/series/{world.alpha.id}", headers=IN)).json()
    assert by_slug["id"] == by_id["id"] == str(world.alpha.id)


@pytest.mark.parametrize("target", ["unknown-slug", "00000000-0000-0000-0000-000000000001"])
async def test_a_series_that_does_not_exist_is_a_404(world, target):
    r = await world.client.get(f"/v1/series/{target}")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "not_found"


@pytest.mark.parametrize("which", ["archived", "future", "expired"])
async def test_a_series_outside_its_publication_rules_is_a_404(world, which):
    r = await world.client.get(f"/v1/series/{getattr(world, which).slug}")
    assert r.status_code == 404


async def test_a_territory_locked_series_page_is_a_404_elsewhere(world):
    assert (await world.client.get(f"/v1/series/{world.geo.slug}", headers=US)).status_code == 404
    assert (await world.client.get(f"/v1/series/{world.geo.slug}", headers=IN)).status_code == 200


async def test_the_episode_list_is_published_only_and_priced(world):
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    eps = body["episodes"]
    assert [e["number"] for e in eps] == [1, 2, 3, 4]  # the draft fifth is not offered
    assert all(e["price"] == 40 for e in eps)  # the series override, not the global default
    assert [e["is_free"] for e in eps] == [True, True, False, False]
    # No session, so nothing beyond the free run is accessible and nothing is owned.
    assert [e["accessible"] for e in eps] == [True, True, False, False]
    assert all(e["unlocked"] is False for e in eps)
    assert eps[0]["thumbnail_url"] == f"{get_settings().cdn_base_url.rstrip('/')}/thumbs/a1.jpg"


async def test_the_detail_page_carries_the_seo_fields_from_the_chosen_translation(world):
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    assert body["seo_title"] == "Alpha, ranked"
    assert body["meta_description"] == "Everything about Alpha"


async def test_a_series_with_no_translation_has_no_seo_fields(world):
    body = (await world.client.get(f"/v1/series/{world.notrans.slug}", headers=IN)).json()
    assert body["title"] == world.notrans.slug
    assert body["seo_title"] is None and body["meta_description"] is None


async def test_the_detail_page_reflects_what_the_viewer_has_done_with_the_series(world):
    async with world.session() as s:
        s.add_all(
            [
                Favorite(user_id=world.viewer.id, series_id=world.alpha.id, created_at=NOW),
                Like(user_id=world.viewer.id, series_id=world.alpha.id, created_at=NOW),
                WatchProgress(
                    user_id=world.viewer.id,
                    episode_id=world.a2.id,
                    series_id=world.alpha.id,
                    position_sec=12,
                    updated_at=NOW,
                ),
            ]
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    assert body["is_favorite"] is True and body["is_liked"] is True
    assert body["continue_episode_number"] == 2


async def test_progress_on_an_episode_that_is_no_longer_published_leaves_no_resume_point(world):
    """The draft fifth episode: `continue_episode_number` has to survive it, not KeyError on it."""
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.a5.id,
                series_id=world.alpha.id,
                position_sec=3,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    assert body["continue_episode_number"] is None


async def test_a_vip_can_reach_every_episode_without_owning_any(world):
    world.sign_in(world.vip)
    eps = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()["episodes"]
    assert all(e["accessible"] for e in eps)
    assert all(e["unlocked"] is False for e in eps)  # accessible by membership, not by purchase


async def test_an_unlocked_episode_is_marked_owned(world):
    async with world.session() as s:
        s.add(
            EpisodeUnlock(
                user_id=world.viewer.id,
                episode_id=world.a3.id,
                series_id=world.alpha.id,
                method=UnlockMethod.coins,
                created_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    eps = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()["episodes"]
    by_number = {e["number"]: e for e in eps}
    assert by_number[3]["unlocked"] is True and by_number[3]["accessible"] is True
    assert by_number[4]["unlocked"] is False and by_number[4]["accessible"] is False


async def test_similar_comes_from_the_embedding_neighbours_when_there_are_any(world):
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()
    assert slugs(body["similar"]) == [world.beta.slug, world.geo.slug, world.gamma.slug]


async def test_a_neighbour_outside_the_viewer_s_territory_is_not_recommended(world):
    """A geo-blocked recommendation is a licensing breach dressed up as a suggestion."""
    body = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=US)).json()
    assert slugs(body["similar"]) == [world.beta.slug, world.gamma.slug]


async def test_similar_falls_back_to_the_shared_category_without_an_embedding(world):
    """Catonly has no vector, so the strip is built from what it shares a genre with."""
    body = (await world.client.get(f"/v1/series/{world.catonly.slug}", headers=IN)).json()
    assert set(slugs(body["similar"])) == {world.alpha.slug, world.beta.slug}


async def test_similar_is_empty_when_there_is_neither_a_vector_nor_a_category(world):
    body = (await world.client.get(f"/v1/series/{world.notrans.slug}", headers=IN)).json()
    assert body["similar"] == []


async def test_a_vector_with_no_neighbours_still_gets_the_category_fallback(world):
    """Solo's embedding is under a model nothing else uses, so the neighbour query comes back empty.

    "No neighbours" has to behave like "no vector" — the strip falls through to the shared genre — rather
    than leaving the series page with an empty recommendation slot.
    """
    body = (await world.client.get(f"/v1/series/{world.solo.slug}", headers=IN)).json()
    assert set(slugs(body["similar"])) == {world.beta.slug, world.geo.slug}


async def test_a_database_failure_in_the_recommendation_strip_does_not_take_the_page_down(world, monkeypatch):
    """The production fault: `relation "embeddings" does not exist` propagated out of the handler and the
    whole series page answered 500 — synopsis, episode list and play button included.

    The failure is injected as a genuine database error, which is the shape pgvector's absence arrives in.
    What the assertions are really about is the savepoint: containing the error is not enough on its own, it
    has to leave the session usable, because the very next thing the handler does is read this series'
    categories to build the fallback strip.
    """
    monkeypatch.setattr(catalog, "published_series_predicates", lambda *a, **k: [text("series.no_such_column = 1")])
    r = await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [e["number"] for e in body["episodes"]] == [1, 2, 3, 4]
    assert set(slugs(body["similar"])) == {world.beta.slug, world.catonly.slug}  # the category fallback


# ---------------------------------------------------------------------------
# GET /v1/shorts
# ---------------------------------------------------------------------------


async def test_the_feed_runs_the_free_episodes_then_stops_on_the_first_lock(world):
    """Swipe, swipe, cliffhanger, offer — the run ends one past the free episodes, never further."""
    body = (await world.client.get("/v1/shorts?limit=40", headers=IN)).json()
    run = [i for i in body["items"] if i["series_id"] == str(world.alpha.id)]
    assert [i["episode_number"] for i in run] == [1, 2, 3]
    assert [i["is_free"] for i in run] == [True, True, False]
    assert [i["accessible"] for i in run] == [True, True, False]
    assert [i["starts_series"] for i in run] == [True, False, False]
    assert run[0]["episode_count"] == 4 and run[0]["title"] == f"Alpha {world.tag}"
    assert run[2]["price"] == 40


async def test_the_feed_hides_what_the_catalogue_hides(world):
    body = (await world.client.get("/v1/shorts?limit=40", headers=US)).json()
    shown = {i["slug"] for i in body["items"]}
    assert world.archived.slug not in shown
    assert world.geo.slug not in shown


async def test_the_feed_tells_a_viewer_what_they_have_already_saved(world):
    """The clients used to seed both flags false, so a tap silently un-saved a series someone had saved."""
    async with world.session() as s:
        s.add_all(
            [
                Favorite(user_id=world.viewer.id, series_id=world.alpha.id, created_at=NOW),
                Like(user_id=world.viewer.id, series_id=world.alpha.id, created_at=NOW),
            ]
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/shorts?limit=40", headers=IN)).json()
    alpha_items = [i for i in body["items"] if i["series_id"] == str(world.alpha.id)]
    assert all(i["is_favorite"] and i["is_liked"] for i in alpha_items)
    other = next(i for i in body["items"] if i["series_id"] == str(world.beta.id))
    assert other["is_favorite"] is False and other["is_liked"] is False


async def test_a_vip_meets_no_paywall_in_the_feed(world):
    world.sign_in(world.vip)
    body = (await world.client.get("/v1/shorts?limit=40", headers=IN)).json()
    run = [i for i in body["items"] if i["series_id"] == str(world.alpha.id)]
    assert [i["accessible"] for i in run] == [True, True, True]
    assert run[2]["is_free"] is False  # accessible, but still not free — the client shows the VIP badge


async def test_an_unlocked_episode_is_accessible_in_the_feed(world):
    async with world.session() as s:
        s.add(
            EpisodeUnlock(
                user_id=world.viewer.id,
                episode_id=world.a3.id,
                series_id=world.alpha.id,
                method=UnlockMethod.coins,
                created_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.get("/v1/shorts?limit=40", headers=IN)).json()
    third = next(i for i in body["items"] if i["episode_id"] == str(world.a3.id))
    assert third["accessible"] is True and third["is_free"] is False


async def test_the_cursor_only_advances_past_series_the_page_actually_emitted(world):
    """Advancing by the page size instead would skip every series the item limit cut short."""
    body = (await world.client.get("/v1/shorts?limit=1", headers=IN)).json()
    assert body["next_cursor"] == "1"
    assert len({i["series_id"] for i in body["items"]}) == 1


async def test_a_cursor_past_the_end_of_the_catalogue_ends_the_feed(world):
    body = (await world.client.get("/v1/shorts?cursor=9999999", headers=IN)).json()
    assert body == {"items": [], "next_cursor": None}


async def test_a_cursor_that_is_not_a_number_starts_at_the_beginning(world):
    """The cursor is opaque to clients, so a corrupted one restarts the feed rather than failing it."""
    first = (await world.client.get("/v1/shorts?limit=2", headers=IN)).json()
    junk = (await world.client.get("/v1/shorts?limit=2&cursor=not-a-number", headers=IN)).json()
    assert junk["items"] == first["items"]


@pytest.mark.parametrize("value", ["0", "41"])
async def test_the_feed_rejects_an_impossible_page_size(world, value):
    assert (await world.client.get(f"/v1/shorts?limit={value}")).status_code == 422


# ---------------------------------------------------------------------------
# POST /v1/episodes/{id}/unlock
# ---------------------------------------------------------------------------


async def test_unlocking_the_next_episode_spends_coins(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.a3.id}/unlock", json={"method": "coins"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["episode_id"] == str(world.a3.id)
    assert body["method"] == "coins"
    assert body["coin_balance"] == 460  # 500 less the series' own 40-coin price


async def test_unlocking_out_of_order_is_refused(world):
    """Episode four while three is still locked: the offer is always the next one, not any one."""
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.a4.id}/unlock", json={"method": "coins"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "sequential_unlock_required"


async def test_unlocking_something_already_free_is_refused(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.a1.id}/unlock", json={"method": "coins"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "already_accessible"


async def test_unlocking_an_unknown_episode_is_a_404(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{uuid.uuid4()}/unlock", json={"method": "coins"})
    assert r.status_code == 404


async def test_unlocking_needs_a_session(world):
    r = await world.client.post(f"/v1/episodes/{world.a3.id}/unlock", json={"method": "coins"})
    assert r.status_code == 401


async def test_an_unlock_body_without_a_method_is_rejected(world):
    world.sign_in(world.viewer)
    assert (await world.client.post(f"/v1/episodes/{world.a3.id}/unlock", json={})).status_code == 422


# ---------------------------------------------------------------------------
# GET/POST /v1/series/{id}/bundle
# ---------------------------------------------------------------------------


async def test_the_bundle_quote_prices_only_what_is_still_locked(world):
    world.sign_in(world.viewer)
    r = await world.client.get(f"/v1/series/{world.alpha.id}/bundle")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "series_id": str(world.alpha.id),
        "episode_count": 2,  # episodes three and four; one and two are free and five is a draft
        "list_price": 80,
        "price": 60,  # the series' own 25% bundle discount
        "discount_pct": 25,
        "saving": 20,
        "affordable": True,
        "coin_balance": 500,
    }


async def test_the_quote_says_when_the_viewer_cannot_afford_it(world):
    world.sign_in(world.pauper)
    body = (await world.client.get(f"/v1/series/{world.alpha.id}/bundle")).json()
    assert body["affordable"] is False and body["coin_balance"] == 0


async def test_a_quote_creates_nothing(world):
    """The paywall asks for this before the viewer has agreed to anything."""
    world.sign_in(world.viewer)
    await world.client.get(f"/v1/series/{world.alpha.id}/bundle")
    async with world.session() as s:
        assert (await s.get(User, world.viewer.id)).coin_balance == 500
        assert (
            await s.scalar(
                select(func.count()).select_from(EpisodeUnlock).where(EpisodeUnlock.user_id == world.viewer.id)
            )
            == 0
        )


@pytest.mark.parametrize("which", ["missing", "archived"])
async def test_a_bundle_for_a_series_that_is_not_on_sale_is_a_404(world, which):
    world.sign_in(world.viewer)
    series_id = uuid.uuid4() if which == "missing" else world.archived.id
    assert (await world.client.get(f"/v1/series/{series_id}/bundle")).status_code == 404


async def test_the_bundle_quote_needs_a_session(world):
    assert (await world.client.get(f"/v1/series/{world.alpha.id}/bundle")).status_code == 401


async def test_buying_the_bundle_unlocks_the_rest_at_the_discount(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/series/{world.alpha.id}/bundle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["episode_ids"]) == {str(world.a3.id), str(world.a4.id)}
    assert body["spent"] == 60 and body["coin_balance"] == 440

    # Nothing left to sell, and the whole series now plays.
    quote = (await world.client.get(f"/v1/series/{world.alpha.id}/bundle")).json()
    assert quote["episode_count"] == 0 and quote["price"] == 0
    eps = (await world.client.get(f"/v1/series/{world.alpha.slug}", headers=IN)).json()["episodes"]
    assert all(e["accessible"] for e in eps)


async def test_buying_the_bundle_twice_is_a_conflict_not_a_second_charge(world):
    world.sign_in(world.viewer)
    await world.client.post(f"/v1/series/{world.alpha.id}/bundle")
    again = await world.client.post(f"/v1/series/{world.alpha.id}/bundle")
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_accessible"
    async with world.session() as s:
        assert (await s.get(User, world.viewer.id)).coin_balance == 440


async def test_a_bundle_that_cannot_be_paid_for_is_refused(world):
    world.sign_in(world.pauper)
    r = await world.client.post(f"/v1/series/{world.alpha.id}/bundle")
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "insufficient_coins"


async def test_a_vip_is_told_the_bundle_is_pointless_rather_than_sold_it(world):
    world.sign_in(world.vip)
    r = await world.client.post(f"/v1/series/{world.alpha.id}/bundle")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "already_accessible"


async def test_buying_the_bundle_of_an_adult_series_needs_a_confirmed_age(world):
    world.sign_in(world.viewer)  # age_confirmed_at is None
    r = await world.client.post(f"/v1/series/{world.beta.id}/bundle")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "age_gate_required"


# ---------------------------------------------------------------------------
# POST /v1/episodes/{id}/play
# ---------------------------------------------------------------------------


async def test_a_guest_may_play_a_free_episode_and_gets_a_signed_url(world):
    """The hook before sign-up. The URL is signed for the guest identity, not left unsigned."""
    r = await world.client.post(f"/v1/episodes/{world.a1.id}/play", headers=IN)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hls_url"].startswith(f"{get_settings().cdn_base_url.rstrip('/')}/hls/a1/master.m3u8?")
    assert f"uid={catalog.GUEST_ID}" in body["hls_url"]
    assert body["embed_html"] is None
    assert body["resume_position_sec"] == 0
    assert body["next_episode_id"] == str(world.a2.id)
    assert body["subtitles"] == [
        {"lang": "en", "url": f"{get_settings().cdn_base_url.rstrip('/')}/subs/{world.tag}/a1.vtt"}
    ]


async def test_the_grant_expires(world):
    r = await world.client.post(f"/v1/episodes/{world.a1.id}/play", headers=IN)
    expires = datetime.fromisoformat(r.json()["expires_at"])
    ttl = get_settings().play_token_ttl_seconds
    assert timedelta(seconds=ttl - 60) < expires - datetime.now(UTC) <= timedelta(seconds=ttl)


async def test_playback_resumes_where_the_viewer_stopped(world):
    async with world.session() as s:
        s.add(
            WatchProgress(
                user_id=world.viewer.id,
                episode_id=world.a1.id,
                series_id=world.alpha.id,
                position_sec=42,
                updated_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    body = (await world.client.post(f"/v1/episodes/{world.a1.id}/play", headers=IN)).json()
    assert body["resume_position_sec"] == 42


async def test_a_guest_cannot_play_a_locked_episode(world):
    r = await world.client.post(f"/v1/episodes/{world.a3.id}/play", headers=IN)
    assert r.status_code == 401
    assert r.json()["detail"]["message"] == "Sign in to watch this episode"


async def test_a_signed_in_viewer_without_the_episode_is_forbidden_not_asked_to_sign_in(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.a3.id}/play", headers=IN)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


async def test_an_encrypted_asset_is_played_through_the_api_not_off_the_cdn(world):
    """The key URL inside the manifest is minted per viewer, which a static file on a CDN cannot be."""
    world.sign_in(world.vip)
    body = (await world.client.post(f"/v1/episodes/{world.a3.id}/play", headers=IN)).json()
    base = get_settings().api_base_url.rstrip("/")
    assert body["hls_url"].startswith(f"{base}/v1/stream/{world.encrypted.id}/master.m3u8?")
    assert f"uid={world.vip.id}" in body["hls_url"]


async def test_an_unlocked_episode_plays_for_its_owner(world):
    async with world.session() as s:
        s.add(
            EpisodeUnlock(
                user_id=world.viewer.id,
                episode_id=world.a3.id,
                series_id=world.alpha.id,
                method=UnlockMethod.coins,
                created_at=NOW,
            )
        )
        await s.commit()
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.a3.id}/play", headers=IN)
    assert r.status_code == 200
    assert f"uid={world.viewer.id}" in r.json()["hls_url"]


async def test_a_legacy_embed_episode_returns_markup_and_no_url(world):
    body = (await world.client.post(f"/v1/episodes/{world.a2.id}/play", headers=IN)).json()
    assert body["hls_url"] is None
    assert body["embed_html"] == "<iframe src='x'></iframe>"
    assert body["next_episode_id"] == str(world.a3.id)


async def test_an_episode_with_nothing_packaged_yet_is_a_conflict_not_a_broken_player(world):
    world.sign_in(world.vip)
    r = await world.client.post(f"/v1/episodes/{world.a4.id}/play", headers=IN)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "asset_not_ready"


async def test_the_last_episode_has_no_next_one(world):
    r = await world.client.post(f"/v1/episodes/{world.g1.id}/play", headers=IN)
    assert r.status_code == 200
    assert r.json()["next_episode_id"] is None


@pytest.mark.parametrize("which", ["missing", "draft", "archived"])
async def test_an_episode_that_should_not_be_reachable_is_a_404(world, which):
    """Archived is the one that mattered: an episode of an unpublished series stayed playable to anyone
    holding its id, which made unpublishing a title cosmetic."""
    episode_id = {"missing": uuid.uuid4(), "draft": world.a5.id, "archived": world.arch1.id}[which]
    r = await world.client.post(f"/v1/episodes/{episode_id}/play", headers=IN)
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "not_found"


async def test_an_episode_outside_its_territory_will_not_play(world):
    assert (await world.client.post(f"/v1/episodes/{world.geo1.id}/play", headers=US)).status_code == 404
    assert (await world.client.post(f"/v1/episodes/{world.geo1.id}/play", headers=IN)).status_code == 200


async def test_an_adult_series_will_not_play_for_a_guest_even_when_the_episode_is_free(world):
    r = await world.client.post(f"/v1/episodes/{world.b1.id}/play", headers=IN)
    assert r.status_code == 401


async def test_an_adult_series_needs_a_confirmed_age(world):
    world.sign_in(world.viewer)
    r = await world.client.post(f"/v1/episodes/{world.b1.id}/play", headers=IN)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "age_gate_required"


async def test_a_confirmed_adult_can_play_it(world):
    world.sign_in(world.adult)
    r = await world.client.post(f"/v1/episodes/{world.b1.id}/play", headers=IN)
    assert r.status_code == 200
    assert r.json()["hls_url"] is not None


async def test_an_unrated_series_is_treated_as_adult(world):
    """A missing rating is an editorial omission, and the safe reading of one is "not yet cleared"."""
    assert get_settings().unrated_is_adult is True
    card = (await world.client.get(f"/v1/series/{world.notrans.slug}", headers=IN)).json()
    assert card["content_rating"] is None and card["is_adult"] is True
    # Free episode, and still refused: the gate is checked before the free/locked question.
    assert (await world.client.post(f"/v1/episodes/{world.n1.id}/play", headers=IN)).status_code == 401
