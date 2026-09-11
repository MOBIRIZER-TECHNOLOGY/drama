"""The catalogue and upload endpoints of the admin console, driven as requests against a real database.

`admin_catalog.py` and `uploads.py` are where an editor's mistake becomes the viewer's problem: a series is
published, an episode is renumbered, a genre is deleted, a transcode is retried. Most of the rules in them are
not expressible in a type — a paid unlock forbids a delete, a scheduled episode must not go live early, two
episodes may not share a number, a queue refusal must not be reported as success — so the only way to hold
them is to make the request and look at what the database holds afterwards.

Everything here therefore asserts an outcome: a status code and a code string, a row that survived, a row that
did not, an audit entry that names what happened. The queue and the object store are stubbed (there is no
redis or S3 in a test run) but nothing else is; the session is a real one and the handlers commit to it.

One thing this file documents rather than exercises: `POST /v1/admin/series` currently 500s before it can save
anything — see `test_creating_a_series_through_the_api_dies_before_it_saves`. Series that later tests need are
therefore inserted directly, and `_apply_series` is covered through `PUT`, which reaches it with the same body
and a series whose collections are loaded.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.api.routers.admin_catalog import slugify
from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.catalog import AssetStatus, Category, Episode, PublishStatus, Series, SeriesTranslation, Tag, VideoAsset
from app.models.identity import AdminRole, AdminUser, User
from app.models.ops import AuditLog
from app.models.wallet import EpisodeUnlock, UnlockMethod
from app.services import access, jobs, storage

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

YOUTUBE_EMBED = '<iframe src="https://www.youtube.com/embed/abc123" frameborder="0"></iframe>'


class Env:
    """The client, a session factory for reading rows back, and a switch for the acting admin's role."""

    def __init__(self, client: AsyncClient, maker, admins: dict, acting: list):
        self.client = client
        self.maker = maker
        self.admins = admins
        self._acting = acting

    @property
    def admin(self) -> AdminUser:
        return self._acting[0]

    def act_as(self, role: AdminRole) -> None:
        self._acting[0] = self.admins[role]


@pytest.fixture
async def env():
    """One admin per role, the app pointed at the test database, auth bypassed.

    The role switch is the point of holding three: `require_role` is a router-level dependency, so the only way
    to see it work is to answer `current_admin` with a different account and repeat the request.
    """
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    admins: dict[AdminRole, AdminUser] = {}
    async with maker() as s:
        for role in (AdminRole.owner, AdminRole.editor, AdminRole.support):
            admin = AdminUser(
                email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
                display_name=f"Test {role.value}",
                password_hash="x",
                role=role,
                is_active=True,
            )
            s.add(admin)
            admins[role] = admin
        await s.commit()
    acting = [admins[AdminRole.owner]]

    async def _session():
        async with maker() as inner:
            yield inner

    app.dependency_overrides[deps.current_admin] = lambda: acting[0]
    app.dependency_overrides[get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield Env(c, maker, admins, acting)
    app.dependency_overrides.pop(deps.current_admin, None)
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


# ---- helpers -------------------------------------------------------------------------------------------


def series_body(**over) -> dict:
    """A valid `SeriesIn`. The title is unique so title search and slug derivation stay exact per test."""
    body = {
        "original_language": "hi",
        "free_episodes": 2,
        "episode_price": 30,
        "status": "draft",
        "translations": [{"lang": "hi", "title": f"Katha Test {uuid.uuid4().hex[:10]}"}],
        "category_ids": [],
        "tags": [],
    }
    body.update(over)
    return body


async def seed_series(env: Env, *, title: str | None = None, slug: str | None = None, **fields) -> dict:
    """Insert a series with one translation, directly.

    Not a convenience: `POST /admin/series` cannot currently create one (see the test that pins that), and the
    rest of the module still has to be exercised against real rows.
    """
    title = title or f"Katha Test {uuid.uuid4().hex[:10]}"
    slug = slug or slugify(title)
    async with env.maker() as s:
        row = Series(slug=slug, original_language="hi", **fields)
        s.add(row)
        await s.flush()
        s.add(SeriesTranslation(series_id=row.id, lang="hi", title=title, source="human"))
        await s.commit()
        return {"id": str(row.id), "slug": slug, "title": title}


async def make_episode(env: Env, series_id: str, **over) -> dict:
    body = {"number": 1, "title": "Ep", "status": "draft"}
    body.update(over)
    r = await env.client.post(f"/v1/admin/series/{series_id}/episodes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def audit_actions(env: Env, target_id) -> list[str]:
    """Every audit action recorded against one target, oldest first."""
    async with env.maker() as s:
        rows = await s.execute(
            select(AuditLog.action).where(AuditLog.target_id == str(target_id)).order_by(AuditLog.created_at)
        )
        return [a for (a,) in rows.all()]


async def seed_unlock(env: Env, series_id: str, episode_id: str) -> uuid.UUID:
    """A viewer who paid coins for one episode — the receipt that forbids destroying the row."""
    async with env.maker() as s:
        user = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper())
        s.add(user)
        await s.flush()
        unlock = EpisodeUnlock(
            user_id=user.id,
            episode_id=uuid.UUID(episode_id),
            series_id=uuid.UUID(series_id),
            method=UnlockMethod.coins,
            created_at=datetime.now(UTC),
        )
        s.add(unlock)
        await s.commit()
        return unlock.id


async def make_asset(env: Env, *, status: AssetStatus = AssetStatus.ready, **over) -> VideoAsset:
    async with env.maker() as s:
        asset = VideoAsset(source_key=f"uploads/videos/{uuid.uuid4().hex}.mp4", status=status, **over)
        s.add(asset)
        await s.commit()
        return asset


# ---- series: create ------------------------------------------------------------------------------------


async def test_a_series_can_be_created_through_the_api(env):
    """The regression test for a route that 500'd on every body, so no series could be created at all.

    `create_series` flushes the bare row, which makes it persistent, and `_apply_series` then reads
    `s.translations` — a lazy load, which on an async session outside its greenlet raises MissingGreenlet.
    Nothing in the suite posted this route, so the console was broken while the tests stayed green. The fix is
    the explicit refresh `create_category` already used, and this asserts the whole round trip: the row lands,
    the translation lands with it, and the response describes what was saved.
    """
    body = series_body(slug=f"fresh-{uuid.uuid4().hex[:8]}")
    r = await env.client.post("/v1/admin/series", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["slug"] == body["slug"]
    assert [t["title"] for t in out["translations"]] == [body["translations"][0]["title"]]
    async with env.maker() as s:
        saved = await s.scalar(select(Series.id).where(Series.slug == body["slug"]))
        assert saved is not None, "the series was reported created but is not in the database"


async def test_a_series_needs_at_least_one_translation(env):
    """A title with no title is not a title: `translations` has min_length=1, and the slug is derived from it."""
    r = await env.client.post("/v1/admin/series", json=series_body(translations=[]))
    assert r.status_code == 422


async def test_a_duplicate_slug_is_refused(env):
    """Two series cannot share a slug; the pre-check refuses it and the unique index backs that up."""
    existing = await seed_series(env)
    again = await env.client.post("/v1/admin/series", json=series_body(slug=existing["slug"]))
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "slug_taken"


async def test_an_unknown_content_rating_is_refused_and_blank_means_unrated(env):
    """Ratings are an allowlist, and everything outside it is treated as adult — so nothing outside it is stored.

    `requires_age_gate` fails closed: an unrecognised rating and a missing one both gate. That is the safe
    reading, but it also means a typo in the dropdown silently hides a general-audience title behind the age
    gate, so the write side refuses anything that is not one of the five known ratings rather than storing it.
    """
    bad = await env.client.post("/v1/admin/series", json=series_body(content_rating="R18"))
    assert bad.status_code == 422

    # "" is what the console posts for an empty dropdown; that is unrated, not a rating named "".
    created = await seed_series(env, content_rating="UA13")
    cleared = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(content_rating=""))
    assert cleared.status_code == 200
    assert cleared.json()["content_rating"] is None

    kept = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(content_rating="A"))
    assert kept.json()["content_rating"] == "A"

    # The invariant the refusal above protects: neither an unknown rating nor a missing one counts as cleared.
    assert access.requires_age_gate(Series(content_rating="R18")) is True
    assert access.requires_age_gate(Series(content_rating=None)) is True
    assert access.requires_age_gate(Series(content_rating="U")) is False


# ---- series: read and list -----------------------------------------------------------------------------


async def test_the_series_list_filters_sorts_and_counts(env):
    """One series, found through every query shape the console sends, with a total counted over the table."""
    created = await seed_series(env, status=PublishStatus.draft)
    await make_episode(env, created["id"], number=1)
    await make_episode(env, created["id"], number=2)
    needle = created["title"].split()[-1]  # the unique half, so the search matches this series and nothing else

    plain = await env.client.get(f"/v1/admin/series?q={needle}")
    assert plain.status_code == 200
    page = plain.json()
    assert page["total"] == 1 and len(page["items"]) == 1
    assert page["items"][0]["id"] == created["id"]
    # The count comes from a grouped query over the episodes table, not from the serialised list.
    assert page["items"][0]["episode_count"] == 2
    assert page["items"][0]["episodes"] == [], "the list view does not carry every episode of every series"

    for query in (
        f"?q={needle}&sort=title&order=asc",
        f"?q={needle}&sort=episode_count&order=desc",
        f"?q={needle}&sort=view_count&order=asc",
        f"?q={needle}&status=draft",
    ):
        r = await env.client.get(f"/v1/admin/series{query}")
        assert r.status_code == 200, f"{query} -> {r.text[:200]}"
        assert [i["id"] for i in r.json()["items"]] == [created["id"]], query

    # A filter that excludes it excludes it from the total as well, not just from the page.
    archived = await env.client.get(f"/v1/admin/series?q={needle}&status=archived")
    assert archived.json() == {"items": [], "total": 0}

    # Paging is applied after the total, so the total still describes the whole result set.
    paged = await env.client.get("/v1/admin/series?limit=1&offset=0")
    assert len(paged.json()["items"]) == 1 and paged.json()["total"] >= 1


async def test_one_series_reads_back_with_its_episodes(env):
    """The editor screen loads a series and its episode list in one call; the list view deliberately does not."""
    created = await seed_series(env)
    await make_episode(env, created["id"], number=1, title="First")
    await make_episode(env, created["id"], number=2, title="Second")

    r = await env.client.get(f"/v1/admin/series/{created['id']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == created["slug"]
    assert body["episode_count"] == 2
    assert [e["number"] for e in body["episodes"]] == [1, 2]
    assert [t["title"] for t in body["translations"]] == [created["title"]]


async def test_reading_a_missing_series_is_a_404(env):
    missing = uuid.uuid4()
    assert (await env.client.get(f"/v1/admin/series/{missing}")).status_code == 404
    assert (await env.client.put(f"/v1/admin/series/{missing}", json=series_body())).status_code == 404
    assert (await env.client.delete(f"/v1/admin/series/{missing}")).status_code == 404


# ---- series: update ------------------------------------------------------------------------------------


async def test_saving_a_series_stores_its_fields_categories_and_tags(env):
    """The console reads back what it just wrote, so the response has to be the stored row, not the request."""
    created = await seed_series(env)
    cat = await env.client.post(
        "/v1/admin/categories",
        json={"name": "Coverage", "slug": f"cov-{uuid.uuid4().hex[:8]}", "show_on_home": True, "sort_order": 3},
    )
    assert cat.status_code == 201, cat.text
    category_id = cat.json()["id"]
    tag_a, tag_b = f"Tag {uuid.uuid4().hex[:6]}", f"Tag {uuid.uuid4().hex[:6]}"

    saved = await env.client.put(
        f"/v1/admin/series/{created['id']}",
        json=series_body(
            translations=[{"lang": "hi", "title": created["title"], "synopsis": "A synopsis", "keywords": ["k1"]}],
            category_ids=[category_id],
            # Blanks and duplicates come straight from the tag input; both are dropped before any tag row is made.
            tags=[tag_a, f"  {tag_a}  ", "", tag_b],
            is_featured=True,
            is_premium=True,
            free_episodes=4,
            episode_price=99,
            sort_weight=7,
            visible_languages=["hi", "en"],
            territories=["IN"],
        ),
    )
    assert saved.status_code == 200, saved.text
    out = saved.json()
    assert out["category_ids"] == [category_id]
    assert out["tags"] == [tag_a, tag_b], "blank and duplicate tags must not reach the tag table"
    assert out["is_featured"] is True and out["is_premium"] is True
    assert out["free_episodes"] == 4 and out["episode_price"] == 99 and out["sort_weight"] == 7
    assert out["visible_languages"] == ["hi", "en"] and out["territories"] == ["IN"]
    assert out["translations"][0]["synopsis"] == "A synopsis"
    assert out["translations"][0]["keywords"] == ["k1"]
    # Still a draft, so no release date has been stamped.
    assert out["released_at"] is None

    # The genre now carries one title, which is what the categories list counts.
    listed = await env.client.get("/v1/admin/categories")
    row = next(c for c in listed.json() if c["id"] == category_id)
    assert row["series_count"] == 1

    # Clearing the genre detaches it without deleting it.
    cleared = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(category_ids=[]))
    assert cleared.json()["category_ids"] == []
    listed = await env.client.get("/v1/admin/categories")
    assert next(c for c in listed.json() if c["id"] == category_id)["series_count"] == 0


async def test_a_tag_used_twice_is_one_row(env):
    """Tags are looked up by slug before being created; two series sharing a tag must not duplicate it."""
    tag = f"Tag {uuid.uuid4().hex[:6]}"
    for _ in range(2):
        created = await seed_series(env)
        r = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(tags=[tag]))
        assert r.json()["tags"] == [tag]
    async with env.maker() as s:
        assert await s.scalar(select(func.count()).select_from(Tag).where(Tag.slug == slugify(tag))) == 1


async def test_updating_a_series_replaces_its_translations_and_can_move_its_slug(env):
    """Saving a translation set is a replacement: a language dropped in the console is deleted, not orphaned.

    The stored rows are right and the response is not: `update_series` deletes the dropped row, commits, and
    re-queries — but the session is `expire_on_commit=False`, so the re-query hands back the same identity-
    mapped `Series` whose `translations` collection still holds the row that was just deleted. Both are
    asserted below, the stale half marked as the bug it is.
    """
    created = await seed_series(env)
    both = await env.client.put(
        f"/v1/admin/series/{created['id']}",
        json=series_body(
            translations=[
                {"lang": "hi", "title": "Hindi title"},
                {"lang": "en", "title": "English title"},
            ]
        ),
    )
    assert both.status_code == 200
    assert sorted(t["lang"] for t in both.json()["translations"]) == ["en", "hi"]

    new_slug = f"moved-{uuid.uuid4().hex[:8]}"
    updated = await env.client.put(
        f"/v1/admin/series/{created['id']}",
        json=series_body(slug=new_slug, translations=[{"lang": "hi", "title": "Hindi title, corrected"}]),
    )
    assert updated.status_code == 200, updated.text
    out = updated.json()
    assert out["slug"] == new_slug
    assert {t["lang"]: t["title"] for t in out["translations"]}["hi"] == "Hindi title, corrected"

    # What was stored is correct: the dropped language is gone from the table.
    async with env.maker() as s:
        langs = await s.scalars(select(SeriesTranslation.lang).where(SeriesTranslation.series_id == created["id"]))
        assert list(langs.all()) == ["hi"], "the dropped translation row is deleted, not left behind"

    # BUG, pinned as-is: the save's own response still lists the language it just deleted, so the console shows
    # a translation that no longer exists until something reloads the page.
    assert sorted(t["lang"] for t in out["translations"]) == ["en", "hi"]

    # A fresh read — a new session, nothing cached — agrees with the table.
    fresh = await env.client.get(f"/v1/admin/series/{created['id']}")
    assert [t["lang"] for t in fresh.json()["translations"]] == ["hi"]


async def test_moving_a_slug_onto_another_series_is_refused(env):
    a = await seed_series(env)
    b = await seed_series(env)
    r = await env.client.put(f"/v1/admin/series/{b['id']}", json=series_body(slug=a["slug"]))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "slug_taken"
    # Saving a series under its own slug is not a conflict with itself.
    same = await env.client.put(f"/v1/admin/series/{b['id']}", json=series_body(slug=b["slug"]))
    assert same.status_code == 200 and same.json()["slug"] == b["slug"]


# ---- series: publish -----------------------------------------------------------------------------------


async def test_publishing_stamps_the_release_date_queues_ingestion_and_is_audited(env, monkeypatch):
    """Publish is the one series edit someone may have to account for later, and it starts the content factory."""
    calls: list[tuple] = []

    async def fake_enqueue(name, *args, **kwargs):
        calls.append((name, args))
        return "job-1"

    monkeypatch.setattr(jobs, "enqueue", fake_enqueue)
    created = await seed_series(env)

    live = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(status="published"))
    assert live.status_code == 200, live.text
    assert live.json()["status"] == "published"
    assert live.json()["released_at"] is not None, "a published series without a release date sorts to nowhere"
    assert [name for name, _ in calls] == ["run_ingestion", "indexnow_ping"]
    assert calls[0][1] == (created["id"],)
    assert calls[1][1] == ([f"series/{created['slug']}"],)
    assert await audit_actions(env, created["id"]) == ["series.publish"]

    # Re-saving a published series must not re-announce it. `released_at` is part of the body, so the console
    # keeps a date by sending back the one it read; a save that omits it is a save that cleared the field, and
    # a published series with no date gets stamped again.
    calls.clear()
    kept = await env.client.put(
        f"/v1/admin/series/{created['id']}",
        json=series_body(status="published", released_at=live.json()["released_at"]),
    )
    assert kept.status_code == 200
    assert kept.json()["released_at"] == live.json()["released_at"]
    assert calls == [], "ingestion only runs on the transition into published"
    assert await audit_actions(env, created["id"]) == ["series.publish"]

    restamped = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(status="published"))
    assert restamped.json()["released_at"] > live.json()["released_at"]

    # Taking it down is the other accountable edit, and it is named for what happened.
    down = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(status="draft"))
    assert down.status_code == 200 and down.json()["status"] == "draft"
    assert await audit_actions(env, created["id"]) == ["series.publish", "series.unpublish"]

    # Draft -> archived changes nothing about public visibility, so it is not one of the two audited moves.
    archived = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(status="archived"))
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    assert await audit_actions(env, created["id"]) == ["series.publish", "series.unpublish"]


async def test_a_queue_that_refuses_or_is_down_does_not_fail_the_save(env, monkeypatch):
    """The editor's save has already committed by then; a queue problem is for a sweeper, not for the editor."""

    async def deduplicated(name, *args, **kwargs):
        return None  # arq refused: a run with this id is already live

    monkeypatch.setattr(jobs, "enqueue", deduplicated)
    one = await seed_series(env)
    r = await env.client.put(f"/v1/admin/series/{one['id']}", json=series_body(status="published"))
    assert r.status_code == 200 and r.json()["status"] == "published"

    async def queue_down(name, *args, **kwargs):
        raise RuntimeError("redis is down")

    monkeypatch.setattr(jobs, "enqueue", queue_down)
    two = await seed_series(env)
    r = await env.client.put(f"/v1/admin/series/{two['id']}", json=series_body(status="published"))
    assert r.status_code == 200 and r.json()["status"] == "published"
    async with env.maker() as s:
        assert (await s.get(Series, uuid.UUID(two["id"]))).status == PublishStatus.published


# ---- series: delete ------------------------------------------------------------------------------------


async def test_deleting_a_series_nobody_paid_for_removes_it(env):
    created = await seed_series(env)
    r = await env.client.delete(f"/v1/admin/series/{created['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    async with env.maker() as s:
        assert await s.get(Series, uuid.UUID(created["id"])) is None
    assert await audit_actions(env, created["id"]) == ["series.delete"]


async def test_a_series_with_paid_unlocks_is_archived_instead_of_deleted(env):
    """Deleting it would cascade away the record of what a viewer paid for; the receipt outranks the request."""
    created = await seed_series(env, status=PublishStatus.published)
    episode = await make_episode(env, created["id"])
    unlock_id = await seed_unlock(env, created["id"], episode["id"])

    r = await env.client.delete(f"/v1/admin/series/{created['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    async with env.maker() as s:
        row = await s.get(Series, uuid.UUID(created["id"]))
        assert row is not None, "the series must survive a delete that would destroy paid unlocks"
        assert row.status == PublishStatus.archived
        assert await s.get(EpisodeUnlock, unlock_id) is not None
    # The row says a delete was asked for and why it became an archive, which "series.delete" would not.
    assert await audit_actions(env, created["id"]) == ["series.archive"]
    async with env.maker() as s:
        note = await s.scalar(
            select(AuditLog.note).where(AuditLog.target_id == created["id"], AuditLog.action == "series.archive")
        )
    assert "paid unlocks" in note


# ---- episodes ------------------------------------------------------------------------------------------


async def test_creating_an_episode_under_a_missing_series_is_a_404(env):
    r = await env.client.post(f"/v1/admin/series/{uuid.uuid4()}/episodes", json={"number": 1})
    assert r.status_code == 404


async def test_two_episodes_cannot_share_a_number(env):
    """Episode order is the viewer's place in the story; a duplicate number makes "next" ambiguous."""
    created = await seed_series(env)
    await make_episode(env, created["id"], number=1)
    clash = await env.client.post(f"/v1/admin/series/{created['id']}/episodes", json={"number": 1})
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "episode_exists"
    assert "Episode 1" in clash.json()["detail"]["message"]

    # The same number under a different series is fine — the constraint is per series.
    other = await seed_series(env)
    assert (await env.client.post(f"/v1/admin/series/{other['id']}/episodes", json={"number": 1})).status_code == 201


async def test_two_editors_adding_the_same_episode_number_at_once_produce_one_episode(env):
    """The pre-check is advisory; `uq_episode_series_number` is the guard, and its failure must read as a 409.

    Which of the two refusals fires depends on how the requests interleave. What must not depend on that is the
    outcome: one episode, one caller told why, and never a 500 from a raw IntegrityError.
    """
    created = await seed_series(env)
    first, second = await asyncio.gather(
        env.client.post(f"/v1/admin/series/{created['id']}/episodes", json={"number": 1}),
        env.client.post(f"/v1/admin/series/{created['id']}/episodes", json={"number": 1}),
    )
    assert sorted([first.status_code, second.status_code]) == [201, 409], f"{first.text[:200]} {second.text[:200]}"
    loser = first if first.status_code == 409 else second
    assert loser.json()["detail"]["code"] == "episode_exists"
    async with env.maker() as s:
        n = await s.scalar(
            select(func.count()).select_from(Episode).where(Episode.series_id == uuid.UUID(created["id"]))
        )
    assert n == 1


async def test_renumbering_onto_a_taken_number_is_refused_and_onto_a_free_one_is_not(env):
    created = await seed_series(env)
    one = await make_episode(env, created["id"], number=1)
    two = await make_episode(env, created["id"], number=2)

    clash = await env.client.put(f"/v1/admin/episodes/{two['id']}", json={"number": 1})
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "episode_exists"

    moved = await env.client.put(f"/v1/admin/episodes/{two['id']}", json={"number": 7, "title": "Renamed"})
    assert moved.status_code == 200
    assert moved.json()["number"] == 7 and moved.json()["title"] == "Renamed"

    # Saving an episode without changing its number is not a clash with itself.
    same = await env.client.put(f"/v1/admin/episodes/{one['id']}", json={"number": 1})
    assert same.status_code == 200 and same.json()["number"] == 1


async def test_updating_a_missing_episode_is_a_404(env):
    assert (await env.client.put(f"/v1/admin/episodes/{uuid.uuid4()}", json={"number": 1})).status_code == 404
    assert (await env.client.delete(f"/v1/admin/episodes/{uuid.uuid4()}")).status_code == 404


async def test_an_episode_takes_its_duration_from_the_asset_and_surfaces_the_transcode_status(env):
    """The console shows whether an episode's video is ready; the duration is the transcoder's, not typed in."""
    asset = await make_asset(env, status=AssetStatus.ready, duration_sec=137)
    created = await seed_series(env)
    episode = await make_episode(env, created["id"], video_asset_id=str(asset.id))
    assert episode["duration_sec"] == 137
    assert episode["asset_status"] == "ready"

    # A second save must not overwrite a duration that is already known.
    again = await env.client.put(
        f"/v1/admin/episodes/{episode['id']}", json={"number": 1, "video_asset_id": str(asset.id)}
    )
    assert again.status_code == 200 and again.json()["duration_sec"] == 137

    # Detaching the asset clears the reference.
    detached = await env.client.put(f"/v1/admin/episodes/{episode['id']}", json={"number": 1})
    assert detached.status_code == 200
    assert detached.json()["video_asset_id"] is None
    # BUG, pinned as-is: the same response still reports the old asset's status, because the post-commit
    # re-query returns the identity-mapped episode whose `video_asset` relationship was never expired. The
    # console therefore shows "ready" against an episode that now has no video at all.
    assert detached.json()["asset_status"] == "ready"

    # A fresh read has no such cache and reports the truth.
    fresh = await env.client.get(f"/v1/admin/series/{created['id']}")
    assert fresh.json()["episodes"][0]["asset_status"] is None


async def test_pointing_an_episode_at_an_asset_that_does_not_exist_is_a_404(env):
    created = await seed_series(env)
    r = await env.client.post(
        f"/v1/admin/series/{created['id']}/episodes", json={"number": 1, "video_asset_id": str(uuid.uuid4())}
    )
    assert r.status_code == 404
    assert "Video asset" in r.json()["detail"]["message"]


async def test_publishing_an_episode_stamps_published_at_and_is_audited(env):
    created = await seed_series(env)
    episode = await make_episode(env, created["id"], status="published")
    assert episode["status"] == "published" and episode["published_at"] is not None
    assert await audit_actions(env, episode["id"]) == ["episode.publish"]

    down = await env.client.put(f"/v1/admin/episodes/{episode['id']}", json={"number": 1, "status": "draft"})
    assert down.status_code == 200 and down.json()["status"] == "draft"
    assert await audit_actions(env, episode["id"]) == ["episode.publish", "episode.unpublish"]


async def test_an_episode_scheduled_for_later_is_held_back_rather_than_published_now(env):
    """Drip release: the editor sets "published" plus a future date, and the worker flips it at that date."""
    created = await seed_series(env)
    later = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    episode = await make_episode(env, created["id"], status="published", scheduled_at=later)
    assert episode["status"] == "review", "a scheduled episode must not be live before its date"
    assert episode["published_at"] is None
    # Nothing became public, so there is nothing to account for.
    assert await audit_actions(env, episode["id"]) == []

    # A date in the past is not a schedule; it publishes immediately.
    earlier = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    now_live = await env.client.put(
        f"/v1/admin/episodes/{episode['id']}", json={"number": 1, "status": "published", "scheduled_at": earlier}
    )
    assert now_live.status_code == 200
    assert now_live.json()["status"] == "published" and now_live.json()["published_at"] is not None


async def test_an_embed_must_be_one_iframe_from_a_known_player(env):
    """Stored HTML is rendered in the viewer's page, so it is an allowlist, not a sanitiser's best effort."""
    created = await seed_series(env)
    hostile = await env.client.post(
        f"/v1/admin/series/{created['id']}/episodes",
        json={"number": 1, "embed_html": '<iframe src="https://evil.example/player"></iframe>'},
    )
    assert hostile.status_code == 400
    assert hostile.json()["detail"]["code"] == "bad_embed"

    ok = await make_episode(env, created["id"], number=1, embed_html=YOUTUBE_EMBED)
    assert ok["embed_html"].startswith('<iframe src="https://www.youtube.com/embed/abc123"')
    assert "sandbox=" in ok["embed_html"], "the stored embed is the normalised tag, not what was pasted"

    # The same allowlist applies on update, not only on create.
    bad_update = await env.client.put(
        f"/v1/admin/episodes/{ok['id']}", json={"number": 1, "embed_html": "<script>alert(1)</script>"}
    )
    assert bad_update.status_code == 400 and bad_update.json()["detail"]["code"] == "bad_embed"


async def test_deleting_an_episode_nobody_paid_for_removes_it(env):
    created = await seed_series(env)
    episode = await make_episode(env, created["id"])
    r = await env.client.delete(f"/v1/admin/episodes/{episode['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    async with env.maker() as s:
        assert await s.get(Episode, uuid.UUID(episode["id"])) is None
    assert await audit_actions(env, episode["id"]) == ["episode.delete"]


async def test_an_episode_with_paid_unlocks_is_archived_so_the_receipts_survive(env):
    """`episode_unlocks` cascades on delete: removing the episode would remove the proof someone bought it."""
    created = await seed_series(env, status=PublishStatus.published)
    episode = await make_episode(env, created["id"], status="published")
    unlock_id = await seed_unlock(env, created["id"], episode["id"])

    r = await env.client.delete(f"/v1/admin/episodes/{episode['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    async with env.maker() as s:
        row = await s.get(Episode, uuid.UUID(episode["id"]))
        assert row is not None and row.status == PublishStatus.archived
        assert await s.get(EpisodeUnlock, unlock_id) is not None, "the unlock is the receipt and must survive"
    # The publish row is from creating it live; the archive row is the refused delete.
    assert await audit_actions(env, episode["id"]) == ["episode.publish", "episode.archive"]


# ---- categories ----------------------------------------------------------------------------------------


async def test_a_category_round_trips_through_create_update_and_delete(env):
    slug = f"cov-{uuid.uuid4().hex[:8]}"
    created = await env.client.post(
        "/v1/admin/categories",
        json={"name": "Thriller", "slug": slug, "show_on_home": True, "sort_order": 2, "translations": {"hi": "रोमांच"}},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["translations"] == {"hi": "रोमांच"} and body["series_count"] == 0

    # A blank value is how the console clears a language, so it removes the row rather than storing "".
    updated = await env.client.put(
        f"/v1/admin/categories/{body['id']}",
        json={
            "name": "Thrillers",
            "slug": slug,
            "show_on_home": False,
            "sort_order": 9,
            "translations": {"hi": "  ", "ta": "த்ரில்லர்"},
        },
    )
    assert updated.status_code == 200, updated.text
    out = updated.json()
    assert out["name"] == "Thrillers" and out["show_on_home"] is False and out["sort_order"] == 9
    assert out["translations"] == {"ta": "த்ரில்லர்"}

    # Renaming an existing language updates that row in place instead of adding a second one.
    renamed = await env.client.put(
        f"/v1/admin/categories/{body['id']}",
        json={"name": "Thrillers", "slug": slug, "translations": {"ta": "திரில்லர்"}},
    )
    assert renamed.json()["translations"] == {"ta": "திரில்லர்"}

    gone = await env.client.delete(f"/v1/admin/categories/{body['id']}")
    assert gone.status_code == 200 and gone.json() == {"ok": True}
    async with env.maker() as s:
        assert await s.get(Category, uuid.UUID(body["id"])) is None
    assert await audit_actions(env, body["id"]) == ["category.delete"]


async def test_deleting_a_category_records_how_many_series_it_was_on(env):
    """Deleting a genre detaches it from every series and drops a rail from home; the count is the damage."""
    cat = await env.client.post(
        "/v1/admin/categories", json={"name": "Attached", "slug": f"cov-{uuid.uuid4().hex[:8]}"}
    )
    category_id = cat.json()["id"]
    for _ in range(2):
        created = await seed_series(env)
        r = await env.client.put(f"/v1/admin/series/{created['id']}", json=series_body(category_ids=[category_id]))
        assert r.status_code == 200

    assert (await env.client.delete(f"/v1/admin/categories/{category_id}")).status_code == 200
    async with env.maker() as s:
        before = await s.scalar(
            select(AuditLog.before).where(AuditLog.target_id == category_id, AuditLog.action == "category.delete")
        )
    assert before["series_count"] == 2


async def test_a_duplicate_category_slug_is_refused_and_a_missing_one_is_a_404(env):
    slug = f"cov-{uuid.uuid4().hex[:8]}"
    first = await env.client.post("/v1/admin/categories", json={"name": "One", "slug": slug})
    assert first.status_code == 201
    again = await env.client.post("/v1/admin/categories", json={"name": "Two", "slug": slug})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "slug_taken"

    missing = uuid.uuid4()
    assert (await env.client.put(f"/v1/admin/categories/{missing}", json={"name": "x", "slug": "y"})).status_code == 404
    assert (await env.client.delete(f"/v1/admin/categories/{missing}")).status_code == 404


async def test_two_admins_creating_the_same_category_at_once_produce_one_category(env):
    """Same shape as the episode race: the unique index decides, and its failure is a 409, not a 500."""
    slug = f"cov-{uuid.uuid4().hex[:8]}"
    first, second = await asyncio.gather(
        env.client.post("/v1/admin/categories", json={"name": "One", "slug": slug}),
        env.client.post("/v1/admin/categories", json={"name": "Two", "slug": slug}),
    )
    assert sorted([first.status_code, second.status_code]) == [201, 409], f"{first.text[:200]} {second.text[:200]}"
    loser = first if first.status_code == 409 else second
    assert loser.json()["detail"]["code"] == "slug_taken"
    async with env.maker() as s:
        assert await s.scalar(select(func.count()).select_from(Category).where(Category.slug == slug)) == 1


# ---- roles ---------------------------------------------------------------------------------------------


async def test_the_catalogue_is_closed_to_admins_who_are_not_editors(env):
    """`require_role(editor)` sits on the router, so it guards reads as well as writes. Owners bypass it."""
    env.act_as(AdminRole.support)
    assert (await env.client.get("/v1/admin/series?limit=1")).status_code == 403
    assert (await env.client.post("/v1/admin/series", json=series_body())).status_code == 403
    assert (await env.client.get("/v1/admin/categories")).status_code == 403

    env.act_as(AdminRole.editor)
    assert (await env.client.get("/v1/admin/series?limit=1")).status_code == 200
    made = await env.client.post("/v1/admin/categories", json={"name": "Editor", "slug": f"cov-{uuid.uuid4().hex[:8]}"})
    assert made.status_code == 201

    env.act_as(AdminRole.owner)
    assert (await env.client.get("/v1/admin/series?limit=1")).status_code == 200


async def test_uploads_require_the_same_role_as_the_catalogue(env, monkeypatch):
    """These routes are the catalogue by another door, so they are gated like it.

    They mint presigned writes into the bucket and register, retry and delete video assets. The router carried
    no role at all, so support and finance — who cannot edit an episode — could replace or destroy the video
    behind one. Editor and above, matching `admin_catalog`.
    """
    monkeypatch.setattr(storage, "presign_put", lambda key, ct, **kw: f"https://bucket.test/{key}?sig=x")
    body = {"kind": "image", "filename": "poster.png", "content_type": "image/png"}

    # Support is the role this fixture carries below editor; finance sits at the same level in `require_role`.
    env.act_as(AdminRole.support)
    refused = await env.client.post("/v1/admin/uploads/presign", json=body)
    assert refused.status_code == 403, "support should not be able to write to the bucket"

    for role in (AdminRole.editor, AdminRole.owner):
        env.act_as(role)
        allowed = await env.client.post("/v1/admin/uploads/presign", json=body)
        assert allowed.status_code == 200, f"{role.value} should be able to upload: {allowed.text}"


# ---- uploads: presign ----------------------------------------------------------------------------------


@pytest.fixture
def fake_presign(monkeypatch):
    """There is no bucket in a test run; the URL the handler returns is boto's, not the handler's."""
    seen: list[tuple[str, str]] = []

    def presign_put(key: str, content_type: str, **kwargs) -> str:
        seen.append((key, content_type))
        return f"https://bucket.test/{key}?sig=x"

    monkeypatch.setattr(storage, "presign_put", presign_put)
    return seen


async def test_presign_routes_each_kind_to_its_own_prefix(env, fake_presign):
    """The prefix is what the transcoder and the CDN rules key off, so it is part of the contract, not cosmetic."""
    image = await env.client.post(
        "/v1/admin/uploads/presign",
        json={"kind": "image", "filename": "poster.png", "content_type": "image/png"},
    )
    assert image.status_code == 200, image.text
    body = image.json()
    assert body["key"].startswith("images/") and body["key"].endswith(".png")
    assert body["upload_url"] == f"https://bucket.test/{body['key']}?sig=x"
    assert body["public_url"] == f"{get_settings().cdn_base_url.rstrip('/')}/{body['key']}"

    video = await env.client.post(
        "/v1/admin/uploads/presign",
        json={"kind": "video", "filename": "clip.mp4", "content_type": "video/mp4"},
    )
    assert video.status_code == 200
    assert video.json()["key"].startswith("uploads/videos/")
    # A raw upload is never served to viewers — only its HLS renditions are — so there is no public URL.
    assert video.json()["public_url"] is None

    subtitle = await env.client.post(
        "/v1/admin/uploads/presign",
        json={"kind": "subtitle", "filename": "hi.vtt", "content_type": "text/vtt"},
    )
    assert subtitle.status_code == 200
    assert subtitle.json()["key"].startswith("subtitles/")
    assert subtitle.json()["public_url"] is not None

    # The content type reaches boto, because a presigned PUT is only valid for the type it was signed for.
    assert [ct for _, ct in fake_presign] == ["image/png", "video/mp4", "text/vtt"]


async def test_presign_refuses_a_type_that_does_not_belong_to_the_kind(env, fake_presign):
    """A video signed as an image would land in the image prefix and never be transcoded."""
    r = await env.client.post(
        "/v1/admin/uploads/presign",
        json={"kind": "image", "filename": "clip.mp4", "content_type": "video/mp4"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "bad_content_type"
    assert fake_presign == [], "nothing is signed for a refused type"

    assert (
        await env.client.post(
            "/v1/admin/uploads/presign",
            json={"kind": "attachment", "filename": "x.zip", "content_type": "application/zip"},
        )
    ).status_code == 422


# ---- uploads: register, list, retry, delete ------------------------------------------------------------


async def test_registering_a_video_queues_the_transcode(env, monkeypatch):
    calls: list[tuple] = []

    async def fake_enqueue(name, *args, **kwargs):
        calls.append((name, args, kwargs.get("job_id")))
        return "job-1"

    monkeypatch.setattr(jobs, "enqueue", fake_enqueue)
    key = f"uploads/videos/{uuid.uuid4().hex}.mp4"
    r = await env.client.post("/v1/admin/uploads/videos", json={"key": key, "size_bytes": 1234})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "queued" and out["source_key"] == key and out["size_bytes"] == 1234
    assert out["error"] is None and out["hls_master_key"] is None
    assert calls == [("transcode_asset", (out["id"],), f"transcode:{out['id']}")]
    async with env.maker() as s:
        row = await s.get(VideoAsset, uuid.UUID(out["id"]))
        assert row is not None and row.status == AssetStatus.queued


async def test_a_registered_video_the_queue_never_took_says_so_on_the_row(env, monkeypatch):
    """A "queued" asset no worker will ever pick up is the worst outcome, so the failure is written down."""

    async def queue_down(name, *args, **kwargs):
        raise RuntimeError("redis is down")

    monkeypatch.setattr(jobs, "enqueue", queue_down)
    down = await env.client.post("/v1/admin/uploads/videos", json={"key": f"uploads/videos/{uuid.uuid4().hex}.mp4"})
    assert down.status_code == 200
    assert down.json()["error"] == "enqueue failed: redis is down"
    async with env.maker() as s:
        assert (await s.get(VideoAsset, uuid.UUID(down.json()["id"]))).error == "enqueue failed: redis is down"

    async def refused(name, *args, **kwargs):
        return None

    monkeypatch.setattr(jobs, "enqueue", refused)
    dupe = await env.client.post("/v1/admin/uploads/videos", json={"key": f"uploads/videos/{uuid.uuid4().hex}.mp4"})
    assert dupe.status_code == 200
    assert dupe.json()["error"] == "enqueue refused: a job with this id is already queued"


async def test_the_asset_list_pages_searches_and_tallies_every_status(env):
    """The tally is deliberately unfiltered: it is what tells an operator whether a filter is worth applying."""
    stamp = uuid.uuid4().hex[:10]
    now = datetime.now(UTC)
    async with env.maker() as s:
        for i, status in enumerate((AssetStatus.ready, AssetStatus.failed, AssetStatus.queued)):
            s.add(
                VideoAsset(
                    source_key=f"uploads/videos/{stamp}-{i}.mp4",
                    status=status,
                    created_at=now - timedelta(minutes=i),
                    updated_at=now,
                )
            )
        await s.commit()

    page = await env.client.get(f"/v1/admin/uploads/videos?q={stamp}")
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 3
    # Newest first, which is the order an operator watching an upload land expects.
    assert [i["source_key"] for i in body["items"]] == [f"uploads/videos/{stamp}-{n}.mp4" for n in (0, 1, 2)]
    for status in ("ready", "failed", "queued"):
        assert body["counts"][status] >= 1

    filtered = await env.client.get(f"/v1/admin/uploads/videos?q={stamp}&status=failed")
    assert filtered.json()["total"] == 1
    assert [i["status"] for i in filtered.json()["items"]] == ["failed"]
    # The filter narrows the page and the total, never the tally: the statuses filtered out are still counted,
    # which is what tells an operator looking at failures that there is anything else. Compared loosely on
    # purpose — the tally covers the whole table, which other rows in a shared test database also live in.
    assert {"ready", "failed", "queued"} <= filtered.json()["counts"].keys()
    assert filtered.json()["counts"]["ready"] >= 1 and filtered.json()["counts"]["queued"] >= 1

    paged = await env.client.get(f"/v1/admin/uploads/videos?q={stamp}&limit=1&offset=1")
    assert paged.json()["total"] == 3
    assert [i["source_key"] for i in paged.json()["items"]] == [f"uploads/videos/{stamp}-1.mp4"]


async def test_one_asset_can_be_polled_and_a_missing_one_is_a_404(env):
    asset = await make_asset(env, status=AssetStatus.failed, error="ffmpeg exited 1", duration_sec=12)
    r = await env.client.get(f"/v1/admin/uploads/videos/{asset.id}")
    assert r.status_code == 200
    assert r.json()["status"] == "failed" and r.json()["error"] == "ffmpeg exited 1"
    assert r.json()["duration_sec"] == 12

    missing = await env.client.get(f"/v1/admin/uploads/videos/{uuid.uuid4()}")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "not_found"


async def test_retrying_a_failed_transcode_requeues_it_and_clears_the_error(env, monkeypatch):
    calls: list[tuple] = []

    async def fake_enqueue(name, *args, **kwargs):
        calls.append((name, kwargs.get("retry")))
        return "job-1"

    monkeypatch.setattr(jobs, "enqueue", fake_enqueue)
    asset = await make_asset(env, status=AssetStatus.failed, error="ffmpeg exited 1")
    r = await env.client.post(f"/v1/admin/uploads/videos/{asset.id}/retry")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued" and r.json()["error"] is None
    # `retry=True` drops the stale result key; without it arq refuses a re-run of a job that already finished.
    assert calls == [("transcode_asset", True)]
    async with env.maker() as s:
        row = await s.get(VideoAsset, asset.id)
        assert row.status == AssetStatus.queued and row.error is None

    assert (await env.client.post(f"/v1/admin/uploads/videos/{uuid.uuid4()}/retry")).status_code == 404


async def test_a_retry_the_queue_refuses_leaves_the_row_alone(env, monkeypatch):
    """The queue is asked first for exactly this reason: a refused retry must not leave a stranded "queued" row."""

    async def refused(name, *args, **kwargs):
        return None  # a run with this id is still live

    monkeypatch.setattr(jobs, "enqueue", refused)
    asset = await make_asset(env, status=AssetStatus.failed, error="ffmpeg exited 1")
    r = await env.client.post(f"/v1/admin/uploads/videos/{asset.id}/retry")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "job_in_progress"
    async with env.maker() as s:
        row = await s.get(VideoAsset, asset.id)
        assert row.status == AssetStatus.failed and row.error == "ffmpeg exited 1"


async def test_deleting_an_asset_removes_the_row_and_the_object(env, monkeypatch):
    deleted: list[str] = []
    monkeypatch.setattr(storage, "delete_object", lambda key: deleted.append(key))
    asset = await make_asset(env)

    r = await env.client.delete(f"/v1/admin/uploads/videos/{asset.id}")
    assert r.status_code == 200
    assert r.json()["ok"] is True and "sweeper" in r.json()["note"]
    assert deleted == [asset.source_key]
    async with env.maker() as s:
        assert await s.get(VideoAsset, asset.id) is None

    assert (await env.client.delete(f"/v1/admin/uploads/videos/{uuid.uuid4()}")).status_code == 404


async def test_an_object_that_is_already_gone_does_not_fail_the_delete(env, monkeypatch):
    """The row is what the console is trying to get rid of; a missing object is not a reason to keep it."""

    def boom(key):
        raise RuntimeError("NoSuchKey")

    monkeypatch.setattr(storage, "delete_object", boom)
    asset = await make_asset(env)
    r = await env.client.delete(f"/v1/admin/uploads/videos/{asset.id}")
    assert r.status_code == 200
    async with env.maker() as s:
        assert await s.get(VideoAsset, asset.id) is None


async def test_an_asset_still_in_use_cannot_be_deleted(env, monkeypatch):
    """Deleting it would leave an episode pointing at a row that is gone and a player with nothing to fetch."""
    monkeypatch.setattr(storage, "delete_object", lambda key: None)
    asset = await make_asset(env)
    created = await seed_series(env)
    await make_episode(env, created["id"], video_asset_id=str(asset.id))

    r = await env.client.delete(f"/v1/admin/uploads/videos/{asset.id}")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "asset_in_use"
    async with env.maker() as s:
        assert await s.get(VideoAsset, asset.id) is not None


async def test_an_asset_used_as_a_series_trailer_cannot_be_deleted_either(env, monkeypatch):
    """A trailer reference is not an episode reference, and only checking episodes would miss it."""
    monkeypatch.setattr(storage, "delete_object", lambda key: None)
    asset = await make_asset(env)
    created = await seed_series(env)
    async with env.maker() as s:
        row = await s.get(Series, uuid.UUID(created["id"]))
        row.trailer_asset_id = asset.id
        await s.commit()

    r = await env.client.delete(f"/v1/admin/uploads/videos/{asset.id}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "asset_in_use"
