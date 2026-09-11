"""The admin console's operations and growth routers, exercised as requests rather than as imports.

`app/api/routers/admin_ops.py` and `app/api/routers/admin_growth.py` hold the levers that are hardest to undo —
deleting a language and every string in it, resolving a report, clearing an AI safety flag, flipping a
production kill switch, starting a price experiment, broadcasting to every install. The existing suite only
called the list endpoints, so every write, every refusal and every audit row in those two files was unproven.

What is asserted here is behaviour, not execution: that a delete records what it destroyed, that a moderation
decision leaves a trace naming the admin who made it, that a running experiment cannot have its arms renamed,
that a report's resolver is written to the row, that the funnel counts only people who reached the previous
step, and that one malformed analytics beacon does not blank the quality screen.

Two real faults are pinned here as the behaviour they currently have, with a comment at each:
`experiment_results` picks its control by JSONB key order rather than by declaration order, and `put_flag`
returns `updated_by: null` for the admin who just saved the flag.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import asyncio
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.api.routers import admin_ops
from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.catalog import Episode, PublishStatus, Series, SeriesTranslation
from app.models.engagement import AnalyticsEvent, ContactMessage, Report, ReportStatus
from app.models.identity import AdminRole, AdminUser, User
from app.models.ops import (
    AuditLog,
    CmsPage,
    Experiment,
    ExperimentAssignment,
    FeatureFlag,
    Language,
    Notification,
    UiTranslation,
)
from app.models.wallet import (
    CoinLedger,
    CoinPack,
    Coupon,
    EpisodeUnlock,
    LedgerKind,
    PackKind,
    Purchase,
    PurchaseStatus,
    UnlockMethod,
)

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


def _tok(n: int = 8) -> str:
    """A short unique token, so rows from parallel or repeated runs never collide."""
    return uuid.uuid4().hex[:n]


def _new_admin(role: AdminRole) -> AdminUser:
    return AdminUser(
        email=f"{_tok(10)}@katha-test.dev",
        display_name=f"Test {role.value}",
        password_hash="x",
        role=role,
        is_active=True,
    )


@dataclass
class Env:
    """The client, the sessionmaker for seeding, and a way to change who is making the request."""

    client: AsyncClient
    maker: Any
    owner: AdminUser
    acting: dict

    async def act_as(self, role: AdminRole) -> AdminUser:
        """Make subsequent requests as a fresh admin with `role`. Role checks read this admin's role."""
        admin = _new_admin(role)
        async with self.maker() as s:
            s.add(admin)
            await s.commit()
        self.acting["admin"] = admin
        return admin

    def act_as_owner(self) -> None:
        self.acting["admin"] = self.owner


@pytest.fixture
async def env():
    """Auth is bypassed and the app points at the test database; these tests are about the handlers.

    `current_admin` is overridden through a mutable holder rather than a fixed lambda so a single test can
    switch roles and watch the same endpoint refuse it.
    """
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    owner = _new_admin(AdminRole.owner)
    async with maker() as s:
        s.add(owner)
        # Every UI string hangs off `languages.code`, and the endpoints below need English to exist as the
        # source language. It is shared, global data, so it is created only when absent.
        if await s.get(Language, "en") is None:
            s.add(Language(code="en", name="English", is_active=True, sort_order=0))
        await s.commit()

    acting = {"admin": owner}

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[deps.current_admin] = lambda: acting["admin"]
    app.dependency_overrides[get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield Env(client=c, maker=maker, owner=owner, acting=acting)
    app.dependency_overrides.pop(deps.current_admin, None)
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def _audit(env: Env, **params) -> dict:
    """The audit log as the owner sees it. Filtering to one target is what makes a single row assertable."""
    r = await env.client.get("/v1/admin/audit", params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def _count(env: Env, stmt) -> int:
    async with env.maker() as s:
        return int(await s.scalar(stmt) or 0)


# =====================================================================================================
# admin_ops: languages and UI translations
# =====================================================================================================


async def test_a_language_is_created_and_then_updated_in_place(env: Env):
    """PUT is an upsert keyed on the path code: the second call must not leave two rows behind."""
    code = f"t{_tok(6)}"
    created = await env.client.put(
        f"/v1/admin/languages/{code}",
        json={"code": code, "name": "Testish", "native_name": "Testisch", "is_active": True, "is_rtl": False},
    )
    assert created.status_code == 200, created.text
    assert created.json()["code"] == code
    assert created.json()["name"] == "Testish"

    updated = await env.client.put(
        f"/v1/admin/languages/{code}",
        json={"code": code, "name": "Renamed", "is_active": False, "is_rtl": True, "sort_order": 7},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert (body["name"], body["is_active"], body["is_rtl"], body["sort_order"]) == ("Renamed", False, True, 7)
    # The code in the payload is ignored — the path is the key — so a mismatched body cannot fork the row.
    assert body["native_name"] is None, "a field omitted from the payload is reset to its default, not kept"

    listed = await env.client.get("/v1/admin/languages")
    assert listed.status_code == 200
    mine = [row for row in listed.json() if row["code"] == code]
    assert len(mine) == 1 and mine[0]["name"] == "Renamed"


async def test_language_progress_counts_the_strings_and_pages_each_language_has(env: Env):
    """The completeness figures are the whole reason this list is not a plain SELECT.

    Asserted as deltas for the totals (English strings and CMS pages are shared, global data) and as exact
    values for the new language, which nothing else in the database can have touched.
    """
    code = f"t{_tok(6)}"
    await env.client.put(f"/v1/admin/languages/{code}", json={"code": code, "name": "Progress"})

    def _row(payload):
        return next(r for r in payload if r["code"] == code)

    before = _row((await env.client.get("/v1/admin/languages")).json())
    assert before["ui_translated"] == 0 and before["pages_translated"] == 0

    keys = {f"k_{_tok(6)}": word for word in ("One", "Two", "Three")}
    assert (await env.client.put("/v1/admin/translations/en", json={"messages": keys})).status_code == 200
    two = dict(list(keys.items())[:2])
    assert (await env.client.put(f"/v1/admin/translations/{code}", json={"messages": two})).status_code == 200

    page = await env.client.post(
        "/v1/admin/pages",
        json={
            "slug": f"p-{_tok(8)}",
            "translations": [{"lang": code, "title": "Localised", "body_html": "<p>Hi</p>"}],
        },
    )
    assert page.status_code == 201, page.text

    after = _row((await env.client.get("/v1/admin/languages")).json())
    assert after["ui_total"] == before["ui_total"] + 3, "the source total is every key English defines"
    assert after["ui_translated"] == 2
    assert after["pages_total"] == before["pages_total"] + 1
    assert after["pages_translated"] == 1


async def test_english_cannot_be_deleted_and_an_unknown_language_is_a_404(env: Env):
    refused = await env.client.delete("/v1/admin/languages/en")
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "cannot_delete_source"

    missing = await env.client.delete(f"/v1/admin/languages/{_tok(6)}")
    assert missing.status_code == 404


async def test_deleting_a_language_records_how_many_strings_it_destroyed(env: Env):
    """The cascade takes every UI string with it, which is a lot of work to lose to one click unrecorded."""
    code = f"t{_tok(6)}"
    await env.client.put(f"/v1/admin/languages/{code}", json={"code": code, "name": "Doomed"})
    await env.client.put(
        f"/v1/admin/translations/{code}",
        json={"messages": {f"k_{_tok(6)}": value for value in ("a", "b")}},
    )

    gone = await env.client.delete(f"/v1/admin/languages/{code}")
    assert gone.status_code == 200 and gone.json() == {"ok": True}

    assert not [r for r in (await env.client.get("/v1/admin/languages")).json() if r["code"] == code]
    assert await _count(env, select(func.count()).select_from(UiTranslation).where(UiTranslation.lang == code)) == 0

    log = await _audit(env, action="language.delete", target_id=code)
    assert log["total"] == 1
    row = log["items"][0]
    assert row["admin_email"] == env.owner.email
    assert row["before"] == {"name": "Doomed", "is_active": True, "ui_strings": 2}
    assert row["target_type"] == "language"


async def test_translations_expose_the_gap_and_accept_a_save(env: Env):
    code = f"t{_tok(6)}"
    await env.client.put(f"/v1/admin/languages/{code}", json={"code": code, "name": "Target"})
    k1, k2 = f"k_{_tok(6)}", f"k_{_tok(6)}"
    await env.client.put("/v1/admin/translations/en", json={"messages": {k1: "Play", k2: "Pause"}})

    empty = (await env.client.get(f"/v1/admin/translations/{code}")).json()
    assert empty["lang"] == code
    assert empty["source"][k1] == "Play" and empty["source"][k2] == "Pause"
    assert k1 not in empty["target"] and k2 not in empty["target"]
    assert k1 in empty["missing"] and k2 in empty["missing"]

    saved = await env.client.put(f"/v1/admin/translations/{code}", json={"messages": {k1: "Chalao"}})
    assert saved.status_code == 200
    half = (await env.client.get(f"/v1/admin/translations/{code}")).json()
    assert half["target"][k1] == {"value": "Chalao", "source": "human"}
    assert k1 not in half["missing"] and k2 in half["missing"]

    # A second save overwrites the existing row rather than inserting a duplicate, and carries the new source.
    again = await env.client.put(f"/v1/admin/translations/{code}", json={"messages": {k1: "Shuru"}, "source": "ai"})
    assert again.status_code == 200
    assert (await env.client.get(f"/v1/admin/translations/{code}")).json()["target"][k1] == {
        "value": "Shuru",
        "source": "ai",
    }
    assert await _count(env, select(func.count()).select_from(UiTranslation).where(UiTranslation.lang == code)) == 1

    assert (await env.client.put(f"/v1/admin/translations/{_tok(6)}", json={"messages": {}})).status_code == 404


async def test_ai_translation_refuses_english_and_queues_only_what_is_missing(env: Env, monkeypatch):
    """The job is the worker's; what this endpoint owes is the right key set and a refusal on the source."""
    source = await env.client.post("/v1/admin/translations/en/ai", json={})
    assert source.status_code == 409
    assert source.json()["detail"]["code"] == "cannot_translate_source"

    code = f"t{_tok(6)}"
    await env.client.put(f"/v1/admin/languages/{code}", json={"code": code, "name": "AI target"})
    k1, k2 = f"k_{_tok(6)}", f"k_{_tok(6)}"
    await env.client.put("/v1/admin/translations/en", json={"messages": {k1: "Play", k2: "Pause"}})

    calls: list[tuple] = []

    async def fake(name, *args, **kwargs):
        calls.append((name, args, kwargs))
        return "job-1"

    monkeypatch.setattr(admin_ops.jobs, "enqueue_or_raise", fake)

    en_keys = await _count(env, select(func.count()).select_from(UiTranslation).where(UiTranslation.lang == "en"))
    first = await env.client.post(f"/v1/admin/translations/{code}/ai", json={})
    assert first.status_code == 200
    # Nothing is translated yet, so every English key is missing and every one of them is queued.
    assert first.json() == {"queued": en_keys, "job_id": "job-1"}
    name, args, kwargs = calls[0]
    assert name == "run_translation" and args[0] == code
    assert args[1][k1] == "Play" and args[1][k2] == "Pause"
    assert kwargs["namespace"] == "ui" and kwargs["job_id"] == f"ui-translate:{code}"

    await env.client.put(f"/v1/admin/translations/{code}", json={"messages": {k1: "Chalao", k2: "Ruko"}})
    second = await env.client.post(f"/v1/admin/translations/{code}/ai", json={})
    assert second.json()["queued"] == en_keys - 2, "translated keys are not queued again"

    # An explicit key list overrides "missing", and a key English does not define is dropped rather than sent.
    explicit = await env.client.post(f"/v1/admin/translations/{code}/ai", json={"keys": [k1, f"no_{_tok(6)}"]})
    assert explicit.json()["queued"] == 1
    assert list(calls[-1][1][1]) == [k1]

    # With nothing left to send, no job is created at all — the count of calls is what proves it.
    await env.client.put("/v1/admin/translations/en", json={"messages": {}})
    before_calls = len(calls)
    nothing = await env.client.post(f"/v1/admin/translations/{code}/ai", json={"keys": [f"no_{_tok(6)}"]})
    assert nothing.json() == {"queued": 0}
    assert len(calls) == before_calls


# =====================================================================================================
# admin_ops: CMS pages
# =====================================================================================================


async def test_a_page_is_created_sanitised_and_read_back(env: Env):
    slug = f"p-{_tok(8)}"
    created = await env.client.post(
        "/v1/admin/pages",
        json={
            "slug": slug,
            "show_in_footer": True,
            "is_published": False,
            "translations": [{"lang": "en", "title": "Terms", "body_html": "<p>Hello</p><script>alert(1)</script>"}],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["slug"] == slug and body["show_in_footer"] is True and body["is_published"] is False
    html = body["translations"][0]["body_html"]
    # Editors are staff, not owners: stored HTML is cleaned on write, not on render.
    assert "<p>Hello</p>" in html
    assert "<script>" not in html and "alert(1)" not in html

    detail = await env.client.get(f"/v1/admin/pages/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["translations"] == body["translations"]

    clash = await env.client.post(
        "/v1/admin/pages",
        json={"slug": slug, "translations": [{"lang": "en", "title": "Again", "body_html": "<p>x</p>"}]},
    )
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "slug_taken"


async def test_the_page_list_searches_slug_and_title_and_omits_the_bodies(env: Env):
    """The list is a table of slugs; returning every body in every language made opening it a download."""
    token = _tok(10)
    by_slug = (
        await env.client.post(
            "/v1/admin/pages",
            json={
                "slug": f"slug{token}",
                "translations": [
                    {"lang": "en", "title": "English title", "body_html": "<p>a</p>"},
                    {"lang": "hi", "title": "Hindi title", "body_html": "<p>b</p>"},
                ],
            },
        )
    ).json()
    by_title = (
        await env.client.post(
            "/v1/admin/pages",
            json={
                "slug": f"p-{_tok(8)}",
                "translations": [{"lang": "hi", "title": f"Title {token}", "body_html": "<p>c</p>"}],
            },
        )
    ).json()

    hit = await env.client.get("/v1/admin/pages", params={"q": f"slug{token}"})
    assert hit.status_code == 200
    page = hit.json()
    assert page["total"] == 1 and len(page["items"]) == 1
    item = page["items"][0]
    assert item["id"] == by_slug["id"]
    assert item["languages"] == ["en", "hi"], "the gaps have to be visible from the list"
    assert item["title"] == "English title"
    assert "body_html" not in item and "translations" not in item

    # The same search term also matches a translated title, and that page has no English to fall back to.
    titled = (await env.client.get("/v1/admin/pages", params={"q": token})).json()
    ids = {i["id"] for i in titled["items"]}
    assert ids == {by_slug["id"], by_title["id"]} and titled["total"] == 2
    fallback = next(i for i in titled["items"] if i["id"] == by_title["id"])
    assert fallback["title"] == f"Title {token}" and fallback["languages"] == ["hi"]

    # Paging is over the matched set, not the page: the total stays put while the window moves.
    first = (await env.client.get("/v1/admin/pages", params={"q": token, "limit": 1})).json()
    second = (await env.client.get("/v1/admin/pages", params={"q": token, "limit": 1, "offset": 1})).json()
    assert first["total"] == second["total"] == 2
    assert {first["items"][0]["id"], second["items"][0]["id"]} == ids


async def test_updating_a_page_replaces_its_translations_and_refuses_a_taken_slug(env: Env):
    other = (
        await env.client.post(
            "/v1/admin/pages",
            json={"slug": f"p-{_tok(8)}", "translations": [{"lang": "en", "title": "Other", "body_html": "<p>o</p>"}]},
        )
    ).json()
    page = (
        await env.client.post(
            "/v1/admin/pages",
            json={
                "slug": f"p-{_tok(8)}",
                "translations": [
                    {"lang": "en", "title": "Before", "body_html": "<p>en</p>"},
                    {"lang": "hi", "title": "Pehle", "body_html": "<p>hi</p>"},
                ],
            },
        )
    ).json()

    # Renaming onto another page's slug used to reach the unique index and come back as a 500.
    clash = await env.client.put(
        f"/v1/admin/pages/{page['id']}",
        json={"slug": other["slug"], "translations": [{"lang": "en", "title": "x", "body_html": "<p>x</p>"}]},
    )
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "slug_taken"

    new_slug = f"p-{_tok(8)}"
    updated = await env.client.put(
        f"/v1/admin/pages/{page['id']}",
        json={
            "slug": new_slug,
            "show_in_footer": True,
            "is_published": False,
            "translations": [
                {"lang": "en", "title": "After", "body_html": "<p>en2</p><script>x</script>"},
                {"lang": "fr", "title": "Apres", "body_html": "<p>fr</p>"},
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["slug"] == new_slug and body["show_in_footer"] is True and body["is_published"] is False
    langs = {t["lang"]: t for t in body["translations"]}
    assert set(langs) == {"en", "fr"}, "a language dropped from the payload is deleted, not orphaned"
    assert langs["en"]["title"] == "After" and "<script>" not in langs["en"]["body_html"]

    # Keeping its own slug is not a clash with itself.
    same = await env.client.put(
        f"/v1/admin/pages/{page['id']}",
        json={"slug": new_slug, "translations": [{"lang": "en", "title": "After", "body_html": "<p>en2</p>"}]},
    )
    assert same.status_code == 200

    assert (await env.client.delete(f"/v1/admin/pages/{page['id']}")).status_code == 200
    assert (await env.client.get(f"/v1/admin/pages/{page['id']}")).status_code == 404
    assert (await env.client.delete(f"/v1/admin/pages/{other['id']}")).status_code == 200


async def test_a_slug_lost_in_a_race_is_a_conflict_rather_than_a_500(env: Env):
    """The `SELECT` before the insert is advisory; the unique index is the guard.

    The race is made real rather than simulated: a second connection inserts the slug and holds the
    transaction open, so the handler's own lookup cannot see the row (it is uncommitted) and its insert blocks
    on the index entry. Committing the other side while the request waits is exactly the lost race, and the
    savepoint around the flush is what turns it into a 409 instead of a dead transaction and a 500.
    """
    slug = f"p-{_tok(8)}"
    async with env.maker() as rival:
        rival.add(CmsPage(slug=slug))
        await rival.flush()
        request = asyncio.create_task(
            env.client.post(
                "/v1/admin/pages",
                json={"slug": slug, "translations": [{"lang": "en", "title": "T", "body_html": "<p>x</p>"}]},
            )
        )
        await asyncio.sleep(0.3)  # long enough for the handler to reach its blocking INSERT
        await rival.commit()
        res = await request

    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "slug_taken"
    # The winner is intact; the loser wrote nothing.
    assert await _count(env, select(func.count()).select_from(CmsPage).where(CmsPage.slug == slug)) == 1
    async with env.maker() as s:
        await s.execute(delete(CmsPage).where(CmsPage.slug == slug))
        await s.commit()


async def test_a_coupon_code_lost_in_a_race_is_a_conflict_rather_than_a_500(env: Env):
    """Same guard on the coupon table: a code is money, and two of them is worse than a refusal."""
    offer = (await env.client.post("/v1/admin/offers", json={"title": "Race", "kind": "coupon"})).json()
    code = f"RACE{_tok(6).upper()}"
    async with env.maker() as rival:
        rival.add(Coupon(code=code, offer_id=uuid.UUID(offer["id"])))
        await rival.flush()
        request = asyncio.create_task(env.client.post(f"/v1/admin/offers/{offer['id']}/coupons", json={"code": code}))
        await asyncio.sleep(0.3)
        await rival.commit()
        res = await request

    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "code_taken"
    assert await _count(env, select(func.count()).select_from(Coupon).where(Coupon.code == code)) == 1
    async with env.maker() as s:
        await s.execute(delete(Coupon).where(Coupon.code == code))
        await s.commit()


async def test_an_unknown_page_is_a_404_on_every_verb(env: Env):
    ghost = uuid.uuid4()
    payload = {"slug": f"p-{_tok(8)}", "translations": [{"lang": "en", "title": "t", "body_html": "<p>x</p>"}]}
    assert (await env.client.get(f"/v1/admin/pages/{ghost}")).status_code == 404
    assert (await env.client.put(f"/v1/admin/pages/{ghost}", json=payload)).status_code == 404
    assert (await env.client.delete(f"/v1/admin/pages/{ghost}")).status_code == 404
    # A page with no translation at all is refused: the list would have nothing to render for it.
    assert (await env.client.post("/v1/admin/pages", json={"slug": "x", "translations": []})).status_code == 422


# =====================================================================================================
# admin_ops: reports and inbox
# =====================================================================================================


async def _seed_report(
    env: Env, *, created_at: datetime, status: ReportStatus = ReportStatus.open, reason: str | None = None
) -> Report:
    async with env.maker() as s:
        reporter = User(public_id=_tok(12))
        s.add(reporter)
        await s.flush()
        r = Report(
            reporter_id=reporter.id,
            reason=reason or f"reason-{_tok(4)}",
            details="seeded",
            status=status,
            created_at=created_at,
        )
        s.add(r)
        await s.commit()
        return r


async def test_resolving_a_report_names_the_admin_and_is_audited(env: Env):
    """`resolved_by` sat on the row unwritten, so a dismissed complaint had nobody's name on it."""
    report = await _seed_report(env, created_at=datetime.now(UTC))

    done = await env.client.put(f"/v1/admin/reports/{report.id}", json={"status": "resolved"})
    assert done.status_code == 200 and done.json() == {"ok": True}
    async with env.maker() as s:
        row = await s.get(Report, report.id)
        assert row.status is ReportStatus.resolved
        assert row.resolved_by == env.owner.id

    log = await _audit(env, action="report.resolve", target_id=str(report.id))
    assert log["total"] == 1
    entry = log["items"][0]
    assert entry["admin_email"] == env.owner.email and entry["target_type"] == "report"
    assert entry["before"] == {"status": "open"}
    # Only the fields that actually changed are archived, so `series_id` (None either way) is not in `after`.
    assert entry["after"] == {"status": "resolved"}

    reopened = await env.client.put(f"/v1/admin/reports/{report.id}", json={"status": "open"})
    assert reopened.status_code == 200
    async with env.maker() as s:
        row = await s.get(Report, report.id)
        assert row.status is ReportStatus.open
        assert row.resolved_by is None, "reopening must not leave the previous resolver on the row"
    assert (await _audit(env, action="report.reopen", target_id=str(report.id)))["total"] == 1

    # Tidy up so the shared moderation queue does not grow by a row on every run.
    await env.client.put(f"/v1/admin/reports/{report.id}", json={"status": "dismissed"})


async def test_an_unknown_report_and_an_unknown_status_are_both_refused(env: Env):
    assert (await env.client.put(f"/v1/admin/reports/{uuid.uuid4()}", json={"status": "resolved"})).status_code == 404
    real = await _seed_report(env, created_at=datetime.now(UTC))
    bad = await env.client.put(f"/v1/admin/reports/{real.id}", json={"status": "ignored"})
    assert bad.status_code == 422
    await env.client.put(f"/v1/admin/reports/{real.id}", json={"status": "dismissed"})


async def test_the_report_queue_is_ordered_by_age_and_counted_over_the_whole_table(env: Env):
    """A queue sorted newest-first is the wrong order for an SLA, and the total must outlive the page."""
    # The test database is shared and never truncated, so these three are dated to 2001 to put them at a known
    # end of the queue. Nothing else in the product writes a report dated before 2002, so any open row that old
    # is this fixture's own litter from a run that was interrupted before its cleanup; it is closed first so
    # the positions below mean something.
    base = datetime(2001, 1, 1, tzinfo=UTC)
    async with env.maker() as s:
        await s.execute(
            update(Report)
            .where(Report.created_at < datetime(2002, 1, 1, tzinfo=UTC), Report.status == ReportStatus.open)
            .values(status=ReportStatus.dismissed)
        )
        await s.commit()

    sentinel = "coverage-order-fixture"
    oldest = await _seed_report(env, created_at=base, reason=sentinel)
    middle = await _seed_report(env, created_at=base + timedelta(minutes=1), reason=sentinel)
    newest = await _seed_report(env, created_at=base + timedelta(minutes=2), reason=sentinel)
    mine = [str(oldest.id), str(middle.id), str(newest.id)]

    def _positions(payload, ids):
        order = [i["id"] for i in payload["items"]]
        return [order.index(i) for i in ids]

    try:
        open_rows = await _count(
            env, select(func.count()).select_from(Report).where(Report.status == ReportStatus.open)
        )
        one = await env.client.get("/v1/admin/reports", params={"status": "open", "limit": 1})
        assert one.status_code == 200
        assert len(one.json()["items"]) == 1
        assert one.json()["total"] == open_rows, "the total counts the queue, not the page"

        # Oldest first, these three lead the queue: the report that has waited longest is the one that matters.
        ascending = (
            await env.client.get("/v1/admin/reports", params={"status": "open", "limit": 200, "oldest_first": "true"})
        ).json()
        assert _positions(ascending, mine) == [0, 1, 2]

        # Newest first they are the tail, which is also what proves `offset` walks the same ordered set.
        descending = (
            await env.client.get("/v1/admin/reports", params={"status": "open", "limit": 3, "offset": open_rows - 3})
        ).json()
        assert [i["id"] for i in descending["items"]] == list(reversed(mine))
        assert descending["total"] == open_rows

        row = ascending["items"][0]
        assert row["id"] == str(oldest.id)
        assert row["reporter_public_id"] is not None and row["status"] == "open"
        assert row["series_id"] is None and row["series_title"] is None

        # Resolving moves a report out of the open page and into the resolved one.
        await env.client.put(f"/v1/admin/reports/{oldest.id}", json={"status": "resolved"})
        still_open = (
            await env.client.get("/v1/admin/reports", params={"status": "open", "limit": 200, "oldest_first": "true"})
        ).json()
        assert str(oldest.id) not in {i["id"] for i in still_open["items"]}
        assert still_open["total"] == open_rows - 1
        resolved = (
            await env.client.get(
                "/v1/admin/reports", params={"status": "resolved", "limit": 200, "oldest_first": "true"}
            )
        ).json()
        assert resolved["items"][0]["id"] == str(oldest.id)
    finally:
        for report in (oldest, middle, newest):
            await env.client.put(f"/v1/admin/reports/{report.id}", json={"status": "dismissed"})


async def test_the_inbox_searches_every_field_and_counts_unread_over_the_whole_table(env: Env):
    token = _tok(10)
    async with env.maker() as s:
        read = ContactMessage(
            name="Asha", email="a@katha-test.dev", subject=f"Sub {token}", message="body", is_read=True
        )
        unread = ContactMessage(
            name=f"Name{token}", email="b@katha-test.dev", subject="Other", message="body", is_read=False
        )
        in_body = ContactMessage(
            name="Cee", email="c@katha-test.dev", subject="Third", message=f"deep {token} inside", is_read=True
        )
        s.add_all([read, unread, in_body])
        await s.commit()
        ids = {str(read.id), str(unread.id), str(in_body.id)}

    found = await env.client.get("/v1/admin/inbox", params={"q": token, "limit": 200})
    assert found.status_code == 200
    page = found.json()
    assert {i["id"] for i in page["items"]} == ids, "subject, name and message body are all searchable"
    assert page["total"] == 3

    unread_rows = await _count(
        env, select(func.count()).select_from(ContactMessage).where(ContactMessage.is_read.is_(False))
    )
    narrowed = (await env.client.get("/v1/admin/inbox", params={"q": token, "unread_only": "true"})).json()
    assert [i["id"] for i in narrowed["items"]] == [str(unread.id)]
    assert narrowed["total"] == 1
    assert narrowed["unread"] == unread_rows, "the header badge is the workload, not the filtered page"

    marked = await env.client.put(f"/v1/admin/inbox/{unread.id}/read")
    assert marked.status_code == 200
    assert (await env.client.get("/v1/admin/inbox", params={"q": token, "unread_only": "true"})).json()["items"] == []

    assert (await env.client.delete(f"/v1/admin/inbox/{in_body.id}")).status_code == 200
    left = (await env.client.get("/v1/admin/inbox", params={"q": token, "limit": 200})).json()
    assert {i["id"] for i in left["items"]} == ids - {str(in_body.id)} and left["total"] == 2

    assert (await env.client.put(f"/v1/admin/inbox/{uuid.uuid4()}/read")).status_code == 404
    assert (await env.client.delete(f"/v1/admin/inbox/{uuid.uuid4()}")).status_code == 404

    for message_id in (read.id, unread.id):
        await env.client.delete(f"/v1/admin/inbox/{message_id}")


# =====================================================================================================
# admin_ops: the moderation queue
# =====================================================================================================


async def _seed_flagged_series(env: Env, *, flags: list[str], note: str | None, status: PublishStatus) -> Series:
    stamp = datetime(2001, 1, 1, tzinfo=UTC)
    async with env.maker() as s:
        row = Series(
            slug=f"s-{_tok(12)}",
            status=status,
            moderation_flags=flags,
            moderation_note=note,
            created_at=stamp,
            updated_at=stamp,
        )
        s.add(row)
        await s.flush()
        s.add(SeriesTranslation(series_id=row.id, lang="en", title=f"Flagged {_tok(4)}"))
        await s.commit()
        return row


async def test_a_flagged_series_is_hydrated_into_the_queue_with_its_flags(env: Env):
    """The flagged half of the queue: the reason is the flag list, the detail is the model's note."""
    series = await _seed_flagged_series(
        env, flags=["self_harm", "graphic_violence"], note="metadata graph", status=PublishStatus.published
    )

    queue = await env.client.get("/v1/admin/moderation", params={"kind": "flagged_series", "limit": 200})
    assert queue.status_code == 200
    page = queue.json()
    item = next(i for i in page["items"] if i["id"] == str(series.id))
    assert item["kind"] == "flagged_series"
    assert item["series_id"] == str(series.id)
    assert item["series_status"] == "published"
    assert item["series_title"].startswith("Flagged ")
    assert item["reason"] == "self_harm, graphic_violence"
    assert item["details"] == "metadata graph"

    flagged_rows = await _count(
        env,
        select(func.count())
        .select_from(Series)
        .where(Series.moderation_flags.is_not(None), func.cardinality(Series.moderation_flags) > 0),
    )
    open_reports = await _count(env, select(func.count()).select_from(Report).where(Report.status == ReportStatus.open))
    # Filtering to one kind narrows the page and the total, but never the other kind's badge.
    assert page["flagged"] == flagged_rows and page["reports"] == open_reports
    assert page["total"] == flagged_rows
    reports_only = (await env.client.get("/v1/admin/moderation", params={"kind": "report"})).json()
    assert reports_only["total"] == open_reports
    assert reports_only["flagged"] == flagged_rows

    both = (await env.client.get("/v1/admin/moderation", params={"limit": 200})).json()
    assert both["total"] == flagged_rows + open_reports

    # Clearing the flags takes it back out of the queue — and keeps the shared queue from growing each run.
    cleared = await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "clear_flags"})
    assert cleared.status_code == 200
    after = (await env.client.get("/v1/admin/moderation", params={"kind": "flagged_series", "limit": 200})).json()
    assert str(series.id) not in {i["id"] for i in after["items"]}
    assert after["flagged"] == flagged_rows - 1


async def test_the_queue_pages_in_sql_rather_than_slicing_a_sample(env: Env):
    """Two windows of one must be two different items, both of which appear in a window of two."""
    a = await _seed_flagged_series(env, flags=["a"], note=None, status=PublishStatus.draft)
    b = await _seed_flagged_series(env, flags=["b"], note=None, status=PublishStatus.draft)

    first = (await env.client.get("/v1/admin/moderation", params={"kind": "flagged_series", "limit": 1})).json()
    second = (
        await env.client.get("/v1/admin/moderation", params={"kind": "flagged_series", "limit": 1, "offset": 1})
    ).json()
    pair = (await env.client.get("/v1/admin/moderation", params={"kind": "flagged_series", "limit": 2})).json()

    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert [i["id"] for i in pair["items"]] == [first["items"][0]["id"], second["items"][0]["id"]]

    for series in (a, b):
        await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "clear_flags"})


async def test_every_moderation_decision_leaves_a_trace_naming_who_made_it(env: Env):
    """A takedown, a rating change and a cleared safety flag are all decisions someone may have to defend."""
    series = await _seed_flagged_series(env, flags=["nudity"], note=None, status=PublishStatus.published)

    cleared = await env.client.post(
        f"/v1/admin/moderation/series/{series.id}", json={"action": "clear_flags", "note": "reviewed by hand"}
    )
    assert cleared.status_code == 200
    entry = (await _audit(env, action="moderation.clear_flags", target_id=str(series.id)))["items"][0]
    assert entry["admin_email"] == env.owner.email
    assert entry["note"] == "reviewed by hand"
    assert entry["before"]["moderation_flags"] == ["nudity"]
    assert entry["after"]["moderation_flags"] == []

    pulled = await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "unpublish"})
    assert pulled.status_code == 200
    entry = (await _audit(env, action="moderation.unpublish", target_id=str(series.id)))["items"][0]
    assert entry["before"]["status"] == "published" and entry["after"]["status"] == "review"

    rated = await env.client.post(
        f"/v1/admin/moderation/series/{series.id}", json={"action": "set_rating", "content_rating": "A"}
    )
    assert rated.status_code == 200
    entry = (await _audit(env, action="moderation.set_rating", target_id=str(series.id)))["items"][0]
    assert entry["before"]["content_rating"] is None and entry["after"]["content_rating"] == "A"

    async with env.maker() as s:
        row = await s.get(Series, series.id)
        assert row.moderation_flags == []
        assert row.status is PublishStatus.review
        assert row.content_rating == "A"
        assert row.moderation_note == "reviewed by hand"


async def test_a_moderation_action_must_be_one_of_the_three_and_a_rating_must_be_supplied(env: Env):
    series = await _seed_flagged_series(env, flags=["x"], note=None, status=PublishStatus.draft)

    assert (
        await env.client.post(f"/v1/admin/moderation/series/{uuid.uuid4()}", json={"action": "clear_flags"})
    ).status_code == 404
    assert (
        await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "delete"})
    ).status_code == 422
    # set_rating without a rating would silently write NULL over whatever the title already had.
    assert (
        await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "set_rating"})
    ).status_code == 422
    assert (
        await env.client.post(
            f"/v1/admin/moderation/series/{series.id}", json={"action": "set_rating", "content_rating": "X"}
        )
    ).status_code == 422
    assert (await env.client.get("/v1/admin/moderation", params={"kind": "everything"})).status_code == 422

    await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "clear_flags"})


# =====================================================================================================
# admin_ops: the audit log itself
# =====================================================================================================


async def test_the_audit_log_filters_by_action_and_target_and_pages_with_a_real_total(env: Env):
    """Show me every change to this flag — the question the log exists to answer."""
    key = f"f_{_tok(8)}"
    assert (await env.client.put(f"/v1/admin/flags/{key}", json={"enabled": True})).status_code == 200
    assert (await env.client.put(f"/v1/admin/flags/{key}", json={"enabled": False})).status_code == 200

    by_target = await _audit(env, target_type="flag", target_id=key)
    assert by_target["total"] == 2
    assert [i["action"] for i in by_target["items"]] == ["flag.set", "flag.set"]

    one = await _audit(env, target_type="flag", target_id=key, limit=1)
    assert one["total"] == 2 and len(one["items"]) == 1
    nxt = await _audit(env, target_type="flag", target_id=key, limit=1, offset=1)
    assert one["items"][0]["id"] != nxt["items"][0]["id"]

    # Most recent first, so the newest row carries the most recent change.
    assert by_target["items"][0]["after"] == {"enabled": False}

    assert (await _audit(env, action="flag.set", target_id=key))["total"] == 2
    assert (await _audit(env, action="flag.delete", target_id=key))["total"] == 0
    assert (await _audit(env, target_type="series", target_id=key))["total"] == 0

    await env.client.delete(f"/v1/admin/flags/{key}")


async def test_the_audit_log_is_owner_only(env: Env):
    """It names admins and the accounts they acted on, which is more than a support role needs."""
    await env.act_as(AdminRole.support)
    assert (await env.client.get("/v1/admin/audit")).status_code == 403
    await env.act_as(AdminRole.editor)
    assert (await env.client.get("/v1/admin/audit")).status_code == 403
    env.act_as_owner()
    assert (await env.client.get("/v1/admin/audit", params={"limit": 1})).status_code == 200


# =====================================================================================================
# admin_ops: broadcasts
# =====================================================================================================


async def test_a_broadcast_is_recorded_audited_and_queued_after_the_commit(env: Env, monkeypatch):
    queued: list[tuple] = []

    async def fake_enqueue(name, *args, **kwargs):
        queued.append((name, args, kwargs))
        return "job-1"

    monkeypatch.setattr(admin_ops.jobs, "enqueue", fake_enqueue)

    res = await env.client.post(
        "/v1/admin/notifications",
        json={"title": "  Tonight  ", "body": "  Three new episodes.  ", "segment": {"locale": "hi"}},
    )
    assert res.status_code == 201, res.text
    row = res.json()
    assert row["title"] == "Tonight" and row["body"] == "Three new episodes."
    assert row["segment"] == {"locale": "hi"}
    assert row["sent_at"] is None and row["delivered"] == 0 and row["failed"] == 0
    assert queued == [("send_push", (row["id"],), {"job_id": f"send-push:{row['id']}"})]

    async with env.maker() as s:
        stored = await s.get(Notification, uuid.UUID(row["id"]))
        assert stored is not None and stored.created_by == env.owner.id

    entry = (await _audit(env, action="notification.send", target_id=row["id"]))["items"][0]
    assert entry["after"] == {"title": "Tonight", "segment": {"locale": "hi"}}
    assert entry["admin_email"] == env.owner.email


async def test_a_send_already_on_the_queue_is_not_an_error(env: Env, monkeypatch):
    """arq refuses a duplicate job id. The row is committed and the id is fixed, so that is not a failure."""

    async def refuse(name, *args, **kwargs):
        return None

    monkeypatch.setattr(admin_ops.jobs, "enqueue", refuse)
    res = await env.client.post(
        "/v1/admin/notifications",
        json={"title": "Duplicate", "body": "Body", "segment": {"user_id": str(uuid.uuid4())}},
    )
    assert res.status_code == 201
    listed = await env.client.get("/v1/admin/notifications", params={"limit": 100})
    assert listed.status_code == 200
    assert res.json()["id"] in {n["id"] for n in listed.json()}


async def test_only_an_owner_may_broadcast_and_the_payload_is_validated(env: Env, monkeypatch):
    async def fake_enqueue(name, *args, **kwargs):
        return "job-1"

    monkeypatch.setattr(admin_ops.jobs, "enqueue", fake_enqueue)

    # A broadcast reaches every install at once and cannot be recalled.
    await env.act_as(AdminRole.editor)
    refused = await env.client.post("/v1/admin/notifications", json={"title": "T", "body": "B"})
    assert refused.status_code == 403
    # An editor can still read the list; only sending is owner-only.
    assert (await env.client.get("/v1/admin/notifications", params={"limit": 1})).status_code == 200

    env.act_as_owner()
    assert (await env.client.post("/v1/admin/notifications", json={"title": "", "body": "B"})).status_code == 422
    assert (await env.client.post("/v1/admin/notifications", json={"title": "T", "body": ""})).status_code == 422
    assert (
        await env.client.post("/v1/admin/notifications", json={"title": "T", "body": "B", "segment": {}})
    ).status_code == 422
    # The default segment is everybody, which is the only shape that may be left out.
    assert (await env.client.post("/v1/admin/notifications", json={"title": "T", "body": "B"})).status_code == 201


# =====================================================================================================
# admin_growth: experiments
# =====================================================================================================


def _experiment_body(key: str, **over) -> dict:
    body = {
        "key": key,
        "description": "price test",
        "variants": {"aa": {"price": 10}, "bb": {"price": 12}},
        "allocation": {"aa": 50, "bb": 50},
    }
    body.update(over)
    return body


async def test_an_experiment_runs_from_draft_to_ended_and_back(env: Env):
    key = f"exp_{_tok(8)}"
    created = await env.client.post("/v1/admin/experiments", json=_experiment_body(key))
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "draft"
    assert created.json()["started_at"] is None and created.json()["ended_at"] is None

    started = await env.client.post(f"/v1/admin/experiments/{key}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "running" and started.json()["started_at"] is not None

    stopped = await env.client.post(f"/v1/admin/experiments/{key}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "ended" and stopped.json()["ended_at"] is not None

    listed = (await env.client.get("/v1/admin/experiments")).json()
    assert next(e for e in listed if e["key"] == key)["status"] == "ended"

    # Restarting clears the end date, or the experiment would report itself as ended while it ran.
    restarted = await env.client.post(f"/v1/admin/experiments/{key}/start")
    assert restarted.json()["status"] == "running" and restarted.json()["ended_at"] is None

    for action in ("experiment.start", "experiment.stop"):
        log = await _audit(env, action=action, target_id=key)
        assert log["total"] >= 1
        assert log["items"][0]["admin_email"] == env.owner.email
    stop_entry = (await _audit(env, action="experiment.stop", target_id=key))["items"][0]
    assert stop_entry["before"]["ended_at"] is None and stop_entry["after"]["ended_at"] is not None


async def test_an_experiment_key_and_its_allocation_are_checked_before_anything_is_stored(env: Env):
    key = f"exp_{_tok(8)}"
    assert (await env.client.post("/v1/admin/experiments", json=_experiment_body(key))).status_code == 201

    dup = await env.client.post("/v1/admin/experiments", json=_experiment_body(key))
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "key_taken"

    mismatched = await env.client.post(
        "/v1/admin/experiments",
        json=_experiment_body(f"exp_{_tok(8)}", allocation={"aa": 50, "cc": 50}),
    )
    assert mismatched.status_code == 409
    assert mismatched.json()["detail"]["code"] == "bad_allocation"

    # A split that does not sum to 100 leaves part of the audience unassigned.
    assert (
        await env.client.post(
            "/v1/admin/experiments", json=_experiment_body(f"exp_{_tok(8)}", allocation={"aa": 50, "bb": 40})
        )
    ).status_code == 422
    # One arm is not a test.
    assert (
        await env.client.post(
            "/v1/admin/experiments",
            json=_experiment_body(f"exp_{_tok(8)}", variants={"aa": {}}, allocation={"aa": 100}),
        )
    ).status_code == 422
    assert (await env.client.post("/v1/admin/experiments", json=_experiment_body("AB"))).status_code == 422


async def test_a_running_experiment_cannot_have_its_arms_renamed(env: Env):
    """Renaming a variant mid-test orphans every row that recorded the old name."""
    key = f"exp_{_tok(8)}"
    await env.client.post("/v1/admin/experiments", json=_experiment_body(key))

    # While it is still a draft nothing has been assigned, so the arms are free to change.
    redrafted = await env.client.put(
        f"/v1/admin/experiments/{key}",
        json=_experiment_body(key, variants={"aa": {}, "cc": {}}, allocation={"aa": 30, "cc": 70}),
    )
    assert redrafted.status_code == 200
    assert set(redrafted.json()["variants"]) == {"aa", "cc"}

    await env.client.post(f"/v1/admin/experiments/{key}/start")
    renamed = await env.client.put(
        f"/v1/admin/experiments/{key}",
        json=_experiment_body(key, variants={"aa": {}, "dd": {}}, allocation={"aa": 50, "dd": 50}),
    )
    assert renamed.status_code == 409 and renamed.json()["detail"]["code"] == "running"

    # Reallocating between the existing arms is allowed, and is exactly what has to be attributable.
    reweighted = await env.client.put(
        f"/v1/admin/experiments/{key}",
        json=_experiment_body(
            key, description="new split", variants={"aa": {}, "cc": {}}, allocation={"aa": 10, "cc": 90}
        ),
    )
    assert reweighted.status_code == 200
    assert reweighted.json()["allocation"] == {"aa": 10, "cc": 90}
    entry = (await _audit(env, action="experiment.update", target_id=key))["items"][0]
    assert entry["before"]["allocation"] == {"aa": 30, "cc": 70}
    assert entry["after"]["allocation"] == {"aa": 10, "cc": 90}


async def test_an_unknown_experiment_is_a_404_everywhere(env: Env):
    key = f"exp_{_tok(8)}"
    assert (await env.client.put(f"/v1/admin/experiments/{key}", json=_experiment_body(key))).status_code == 404
    assert (await env.client.post(f"/v1/admin/experiments/{key}/start")).status_code == 404
    assert (await env.client.post(f"/v1/admin/experiments/{key}/stop")).status_code == 404
    assert (await env.client.get(f"/v1/admin/experiments/{key}/results")).status_code == 404


async def _seed_catalog(env: Env, episodes: int = 1) -> tuple[Series, list[Episode], CoinPack]:
    async with env.maker() as s:
        series = Series(slug=f"s-{_tok(12)}", status=PublishStatus.published)
        pack = CoinPack(sku=f"sku-{_tok(10)}", name="Pack", kind=PackKind.coins, coins=100)
        s.add_all([series, pack])
        await s.flush()
        eps = [Episode(series_id=series.id, number=n + 1) for n in range(episodes)]
        s.add_all(eps)
        await s.commit()
        return series, eps, pack


async def test_results_report_zero_for_an_arm_nothing_happened_in(env: Env):
    """A draft experiment measures from the beginning of time, and an untouched arm reports zeroes."""
    key = f"exp_{_tok(8)}"
    # Declared control-first. Postgres returns JSONB keys in its own order, which is what the control is
    # actually picked from — see the assertion below.
    await env.client.post(
        "/v1/admin/experiments",
        json=_experiment_body(
            key, variants={"control": {"p": 10}, "b": {"p": 12}}, allocation={"control": 50, "b": 50}
        ),
    )
    series, eps, pack = await _seed_catalog(env)
    now = datetime.now(UTC)

    async with env.maker() as s:
        users = [User(public_id=_tok(12)) for _ in range(5)]
        s.add_all(users)
        await s.flush()
        for i, u in enumerate(users):
            s.add(
                ExperimentAssignment(
                    user_id=u.id, experiment_key=key, variant="control" if i < 3 else "b", assigned_at=now
                )
            )
        s.add(
            EpisodeUnlock(
                user_id=users[0].id,
                episode_id=eps[0].id,
                series_id=series.id,
                method=UnlockMethod.coins,
                variant_map={key: "control"},
                created_at=now,
            )
        )
        s.add(
            Purchase(
                user_id=users[0].id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(16),
                status=PurchaseStatus.paid,
                currency="INR",
                amount=250.50,
                variant_map={key: "control"},
                paid_at=now,
            )
        )
        s.add_all(
            [
                CoinLedger(
                    user_id=users[0].id,
                    delta=-40,
                    balance_after=0,
                    kind=LedgerKind.unlock,
                    idempotency_key=_tok(24),
                    variant_map={key: "control"},
                    created_at=now,
                ),
                # A credit must not count as spend.
                CoinLedger(
                    user_id=users[0].id,
                    delta=100,
                    balance_after=100,
                    kind=LedgerKind.purchase,
                    idempotency_key=_tok(24),
                    variant_map={key: "control"},
                    created_at=now,
                ),
            ]
        )
        await s.commit()

    res = await env.client.get(f"/v1/admin/experiments/{key}/results")
    assert res.status_code == 200, res.text
    rows = {r["variant"]: r for r in res.json()}
    assert set(rows) == {"control", "b"}

    control = rows["control"]
    assert control["users"] == 3
    assert control["unlocks"] == 1 and control["unlock_rate"] == pytest.approx(1 / 3)
    assert control["purchasers"] == 1 and control["purchases"] == 1
    assert control["revenue"] == {"INR": 250.5}
    assert control["coins_spent"] == 40, "only negative ledger rows are spend"
    assert control["conversion"] == pytest.approx(1 / 3)

    empty = rows["b"]
    assert empty["users"] == 2
    assert (empty["unlocks"], empty["purchasers"], empty["purchases"], empty["coins_spent"]) == (0, 0, 0, 0)
    assert empty["unlock_rate"] == 0.0 and empty["conversion"] == 0.0 and empty["revenue"] == {}

    # The regression this pins: the baseline used to be "whatever key Postgres returned first", and JSONB
    # returns them shortest-first, so "b" was the baseline and "control" was measured against it — every lift
    # and p-value inverted on the screen that exists to decide which arm won. The arm named "control" is the
    # baseline now, whatever order the column comes back in.
    assert [r["variant"] for r in res.json()] == ["b", "control"], "JSONB key order is still not declaration order"
    assert control["is_control"] is True and empty["is_control"] is False
    # Below the minimum sample there is no verdict, only the reason there isn't one. It is the non-control arm
    # that carries the verdict fields, because the control is what everything else is compared against.
    assert empty["lift_pct"] is None and empty["p_value"] is None and empty["significant"] is False
    assert empty["note"] == "Needs at least 100 users per variant before this means anything."
    assert control["note"] is None


async def test_results_call_a_winner_once_both_arms_are_large_enough(env: Env):
    """The point of computing significance server-side: two clients must not disagree about who won."""
    key = f"exp_{_tok(8)}"
    await env.client.post("/v1/admin/experiments", json=_experiment_body(key))
    start = await env.client.post(f"/v1/admin/experiments/{key}/start")
    assert start.status_code == 200
    series, eps, pack = await _seed_catalog(env, episodes=1)
    now = datetime.now(UTC)

    async with env.maker() as s:
        arms: dict[str, list[User]] = {"aa": [], "bb": []}
        for variant in arms:
            for _ in range(100):
                u = User(public_id=_tok(12))
                arms[variant].append(u)
                s.add(u)
        await s.flush()
        for variant, users in arms.items():
            for u in users:
                s.add(ExperimentAssignment(user_id=u.id, experiment_key=key, variant=variant, assigned_at=now))
        # 10% of the control arm buys against 30% of the variant arm; the unlock rates differ too.
        for variant, buyers in (("aa", 10), ("bb", 30)):
            for u in arms[variant][:buyers]:
                s.add(
                    Purchase(
                        user_id=u.id,
                        pack_id=pack.id,
                        gateway="stripe",
                        external_id=_tok(16),
                        status=PurchaseStatus.paid,
                        currency="INR",
                        amount=100,
                        variant_map={key: variant},
                        paid_at=now,
                    )
                )
        # One buyer who also paid in another currency: revenue splits by currency, buyers do not.
        s.add(
            Purchase(
                user_id=arms["bb"][0].id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(16),
                status=PurchaseStatus.paid,
                currency="USD",
                amount=5,
                variant_map={key: "bb"},
                paid_at=now,
            )
        )
        # A pending purchase is not revenue.
        s.add(
            Purchase(
                user_id=arms["aa"][0].id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(16),
                status=PurchaseStatus.pending,
                currency="INR",
                amount=999,
                variant_map={key: "aa"},
            )
        )
        for variant, unlockers in (("aa", 25), ("bb", 50)):
            for u in arms[variant][:unlockers]:
                s.add(
                    EpisodeUnlock(
                        user_id=u.id,
                        episode_id=eps[0].id,
                        series_id=series.id,
                        method=UnlockMethod.coins,
                        variant_map={key: variant},
                        created_at=now,
                    )
                )
        await s.commit()

    rows = {r["variant"]: r for r in (await env.client.get(f"/v1/admin/experiments/{key}/results")).json()}
    control, variant = rows["aa"], rows["bb"]

    assert control["users"] == variant["users"] == 100
    assert control["unlocks"] == 25 and control["unlock_rate"] == pytest.approx(0.25)
    assert variant["unlocks"] == 50 and variant["unlock_rate"] == pytest.approx(0.5)
    assert control["purchasers"] == 10 and control["purchases"] == 10
    assert control["revenue"] == {"INR": 1000.0}, "a pending purchase is not revenue"
    assert variant["purchasers"] == 30, "distinct buyers are counted per variant, not per currency"
    assert variant["purchases"] == 31
    assert variant["revenue"] == {"INR": 3000.0, "USD": 5.0}
    assert control["conversion"] == pytest.approx(0.1) and variant["conversion"] == pytest.approx(0.3)

    assert control["is_control"] is True and control["note"] is None
    assert variant["lift_pct"] == pytest.approx(200.0), "lift is relative, the way the result gets repeated"
    assert variant["p_value"] is not None and variant["p_value"] < 0.05
    assert variant["significant"] is True and variant["note"] is None


# =====================================================================================================
# admin_growth: feature flags
# =====================================================================================================


async def test_a_flag_carries_the_admin_who_last_set_it(env: Env):
    """After an incident, "who turned this on" has to be answerable without opening the audit log."""
    key = f"f_{_tok(8)}"
    rules = {"platforms": ["android"], "percentage": 50}
    created = await env.client.put(f"/v1/admin/flags/{key}", json={"enabled": True, "rules": rules})
    assert created.status_code == 200, created.text
    assert created.json()["enabled"] is True and created.json()["rules"] == rules
    # BUG (asserted as it is): the save response never carries `updated_by`, so the row the console just wrote
    # shows an empty "last changed by" until the list is fetched again.
    assert created.json()["updated_by"] is None

    listed = {f["key"]: f for f in (await env.client.get("/v1/admin/flags")).json()}
    assert listed[key]["updated_by"] == env.owner.email
    assert listed[key]["enabled"] is True and listed[key]["rules"] == rules

    # The most recent setter wins, which is what makes the column worth anything.
    second = await env.act_as(AdminRole.editor)
    off = await env.client.put(f"/v1/admin/flags/{key}", json={"enabled": False, "rules": None})
    assert off.status_code == 200 and off.json()["enabled"] is False and off.json()["rules"] is None
    listed = {f["key"]: f for f in (await env.client.get("/v1/admin/flags")).json()}
    assert listed[key]["updated_by"] == second.email

    env.act_as_owner()
    log = await _audit(env, action="flag.set", target_id=key)
    assert log["total"] == 2
    assert log["items"][1]["before"] is None, "the first save has nothing to compare against"
    assert log["items"][1]["after"] == {"enabled": True, "rules": rules}
    assert log["items"][0]["before"] == {"enabled": True, "rules": rules}
    assert log["items"][0]["after"] == {"enabled": False, "rules": None}

    removed = await env.client.delete(f"/v1/admin/flags/{key}")
    assert removed.status_code == 200
    assert key not in {f["key"] for f in (await env.client.get("/v1/admin/flags")).json()}
    assert (await env.client.delete(f"/v1/admin/flags/{key}")).status_code == 404
    gone = await _audit(env, action="flag.delete", target_id=key)
    assert gone["total"] == 1 and gone["items"][0]["before"] == {"enabled": False}
    assert await _count(env, select(func.count()).select_from(FeatureFlag).where(FeatureFlag.key == key)) == 0


# =====================================================================================================
# admin_growth: offers and coupons
# =====================================================================================================


async def test_an_offer_and_its_coupon_are_audited_from_creation_to_removal(env: Env):
    """A 90% coupon that existed for an afternoon is exactly what finance asks about afterwards."""
    created = await env.client.post(
        "/v1/admin/offers",
        json={
            "title": "Winback",
            "kind": "winback",
            "discount_pct": 40,
            "eligibility": {"inactive_days": 14},
            "starts_at": "2030-01-01T00:00:00",
            "is_active": True,
        },
    )
    assert created.status_code == 201, created.text
    offer = created.json()
    assert offer["coupons"] == []
    # A naive timestamp from a date picker is taken as UTC rather than refused by the driver.
    assert offer["starts_at"] == "2030-01-01T00:00:00Z"

    entry = (await _audit(env, action="offer.create", target_id=offer["id"]))["items"][0]
    assert entry["after"]["title"] == "Winback" and entry["after"]["discount_pct"] == 40
    assert entry["before"] is None

    changed = await env.client.put(
        f"/v1/admin/offers/{offer['id']}",
        json={"title": "Winback v2", "kind": "winback", "discount_pct": 60, "is_active": False},
    )
    assert changed.status_code == 200
    assert changed.json()["discount_pct"] == 60 and changed.json()["is_active"] is False
    entry = (await _audit(env, action="offer.update", target_id=offer["id"]))["items"][0]
    assert entry["before"]["discount_pct"] == 40 and entry["after"]["discount_pct"] == 60
    assert entry["before"]["is_active"] is True and entry["after"]["is_active"] is False

    code = f"SAVE{_tok(6).upper()}"
    coupon = await env.client.post(f"/v1/admin/offers/{offer['id']}/coupons", json={"code": code, "max_uses": 5})
    assert coupon.status_code == 201, coupon.text
    assert coupon.json()["code"] == code and coupon.json()["max_uses"] == 5 and coupon.json()["used"] == 0
    entry = (await _audit(env, action="coupon.create", target_id=coupon.json()["id"]))["items"][0]
    assert entry["after"] == {"code": code, "offer_id": offer["id"], "max_uses": 5}

    listed = next(o for o in (await env.client.get("/v1/admin/offers")).json() if o["id"] == offer["id"])
    assert [c["code"] for c in listed["coupons"]] == [code]
    assert listed["title"] == "Winback v2"

    dupe = await env.client.post(f"/v1/admin/offers/{offer['id']}/coupons", json={"code": code})
    assert dupe.status_code == 409 and dupe.json()["detail"]["code"] == "code_taken"

    removed = await env.client.delete(f"/v1/admin/coupons/{coupon.json()['id']}")
    assert removed.status_code == 200
    entry = (await _audit(env, action="coupon.delete", target_id=coupon.json()["id"]))["items"][0]
    assert entry["before"] == {"code": code, "offer_id": offer["id"], "max_uses": 5, "used": 0}
    assert (await env.client.delete(f"/v1/admin/coupons/{coupon.json()['id']}")).status_code == 404

    after = next(o for o in (await env.client.get("/v1/admin/offers")).json() if o["id"] == offer["id"])
    assert after["coupons"] == []


async def test_an_offer_that_makes_no_sense_is_refused_before_it_reaches_the_table(env: Env):
    ghost = uuid.uuid4()
    body = {"title": "T", "kind": "coupon"}
    assert (await env.client.put(f"/v1/admin/offers/{ghost}", json=body)).status_code == 404
    assert (await env.client.post(f"/v1/admin/offers/{ghost}/coupons", json={"code": "ABCD"})).status_code == 404

    assert (await env.client.post("/v1/admin/offers", json={"title": "T", "kind": "mystery"})).status_code == 422
    # A 0% discount is not an offer and a 100% one gives the catalogue away.
    assert (
        await env.client.post("/v1/admin/offers", json={"title": "T", "kind": "coupon", "discount_pct": 0})
    ).status_code == 422
    assert (
        await env.client.post("/v1/admin/offers", json={"title": "T", "kind": "coupon", "discount_pct": 91})
    ).status_code == 422

    offer = (await env.client.post("/v1/admin/offers", json={"title": "T", "kind": "coupon"})).json()
    # Codes are typed in by hand off a poster: uppercase and digits only.
    assert (await env.client.post(f"/v1/admin/offers/{offer['id']}/coupons", json={"code": "lower"})).status_code == 422
    assert (await env.client.post(f"/v1/admin/offers/{offer['id']}/coupons", json={"code": "AB"})).status_code == 422


# =====================================================================================================
# admin_growth: analytics
# =====================================================================================================


async def test_quality_metrics_survive_a_client_that_sends_nonsense(env: Env):
    """One beacon with `ttff_ms: "fast"` used to raise for the whole query and blank the screen."""
    platform = f"p{_tok(8)}"
    now = datetime.now(UTC)
    stale = now - timedelta(days=40)
    tz = ZoneInfo(get_settings().reward_timezone)

    async with env.maker() as s:
        for value in ("100", "200", "300", "400", "fast"):
            s.add(
                AnalyticsEvent(
                    platform=platform, name="first_frame", props={"ttff_ms": value}, ts=now, session_id=uuid.uuid4()
                )
            )
        s.add(AnalyticsEvent(platform=platform, name="rebuffer", ts=now, session_id=uuid.uuid4()))
        for _ in range(2):
            s.add(AnalyticsEvent(platform=platform, name="play_error", ts=now, session_id=uuid.uuid4()))
        s.add(
            AnalyticsEvent(
                platform=platform, name="first_frame", props={"ttff_ms": "slow"}, ts=stale, session_id=uuid.uuid4()
            )
        )
        await s.commit()

    fortnight = await env.client.get("/v1/admin/analytics/qoe", params={"days": 14})
    assert fortnight.status_code == 200
    rows = [r for r in fortnight.json() if r["platform"] == platform]
    assert len(rows) == 1, "the 40-day-old event is outside a fourteen-day window"
    row = rows[0]
    assert row["date"] == now.astimezone(tz).date().isoformat(), "days are local, not UTC"
    assert row["plays"] == 5, "a bad beacon is still a play"
    assert row["p50_start_ms"] == pytest.approx(250.0)
    assert row["p95_start_ms"] == pytest.approx(385.0)
    assert row["rebuffer_ratio"] == pytest.approx(0.2)
    assert row["error_rate"] == pytest.approx(0.4)

    quarter = await env.client.get("/v1/admin/analytics/qoe", params={"days": 90})
    rows = {r["date"]: r for r in quarter.json() if r["platform"] == platform}
    assert set(rows) == {now.astimezone(tz).date().isoformat(), stale.astimezone(tz).date().isoformat()}
    old = rows[stale.astimezone(tz).date().isoformat()]
    assert old["plays"] == 1
    assert old["p50_start_ms"] is None and old["p95_start_ms"] is None, "no numeric sample, no percentile"
    assert old["rebuffer_ratio"] == 0.0 and old["error_rate"] == 0.0

    assert (await env.client.get("/v1/admin/analytics/qoe", params={"days": 0})).status_code == 422
    assert (await env.client.get("/v1/admin/analytics/qoe", params={"days": 91})).status_code == 422


async def test_the_funnel_only_counts_people_who_reached_the_previous_step(env: Env):
    """Counting each step independently let a viewer appear at `unlock` without ever appearing at `app_open`.

    Asserted as deltas against the funnel taken a moment earlier, because these events are shared, global data.
    """
    before = (await env.client.get("/v1/admin/analytics/funnel", params={"days": 30})).json()
    assert [s["name"] for s in before["steps"]] == [
        "app_open",
        "series_view",
        "play_start",
        "paywall_view",
        "unlock",
        "paid",
    ]
    assert before["range_days"] == 30
    baseline = {s["name"]: s["users"] for s in before["steps"]}

    now = datetime.now(UTC)
    _, _, pack = await _seed_catalog(env)
    async with env.maker() as s:
        buyer = User(public_id=_tok(12))
        s.add(buyer)
        await s.flush()
        # One viewer who went the whole way, identified by user id.
        for name in ("app_open", "series_view", "play_start", "paywall_view", "unlock"):
            s.add(AnalyticsEvent(user_id=buyer.id, name=name, ts=now, platform="android"))
        s.add(
            Purchase(
                user_id=buyer.id,
                pack_id=pack.id,
                gateway="stripe",
                external_id=_tok(16),
                status=PurchaseStatus.paid,
                currency="INR",
                amount=100,
                paid_at=now,
            )
        )
        # A guest who dropped out after browsing, identified by session id.
        browser = uuid.uuid4()
        for name in ("app_open", "series_view"):
            s.add(AnalyticsEvent(session_id=browser, name=name, ts=now, platform="web"))
        # An impossible actor: an unlock with no journey behind it must not be counted anywhere.
        s.add(AnalyticsEvent(session_id=uuid.uuid4(), name="unlock", ts=now, platform="web"))
        await s.commit()

    after = {s["name"]: s["users"] for s in (await env.client.get("/v1/admin/analytics/funnel")).json()["steps"]}
    assert after["app_open"] - baseline["app_open"] == 2
    assert after["series_view"] - baseline["series_view"] == 2
    assert after["play_start"] - baseline["play_start"] == 1
    assert after["paywall_view"] - baseline["paywall_view"] == 1
    assert after["unlock"] - baseline["unlock"] == 1, "the orphan unlock is not in the funnel"
    assert after["paid"] - baseline["paid"] == 1

    narrow = await env.client.get("/v1/admin/analytics/funnel", params={"days": 1})
    assert narrow.status_code == 200 and narrow.json()["range_days"] == 1
    assert (await env.client.get("/v1/admin/analytics/funnel", params={"days": 0})).status_code == 422
    assert (await env.client.get("/v1/admin/analytics/funnel", params={"days": 366})).status_code == 422


# =====================================================================================================
# Both routers: who is allowed in at all
# =====================================================================================================


@pytest.mark.parametrize(
    ("role", "ops_status", "growth_status"),
    [
        # Operations is the content and support side; growth is the money and experiment side.
        (AdminRole.editor, 200, 200),
        (AdminRole.support, 200, 403),
        (AdminRole.finance, 403, 200),
        (AdminRole.owner, 200, 200),
    ],
)
async def test_each_router_admits_only_the_roles_it_is_for(env: Env, role, ops_status, growth_status):
    await env.act_as(role)
    assert (await env.client.get("/v1/admin/moderation", params={"limit": 1})).status_code == ops_status
    assert (await env.client.get("/v1/admin/flags")).status_code == growth_status


@pytest.mark.parametrize(
    "path",
    [
        "/v1/admin/pages?limit=0",
        "/v1/admin/pages?limit=201",
        "/v1/admin/pages?offset=-1",
        "/v1/admin/reports?limit=0",
        "/v1/admin/inbox?limit=201",
        "/v1/admin/moderation?limit=0",
        "/v1/admin/moderation?offset=-1",
        "/v1/admin/audit?limit=201",
        "/v1/admin/notifications?limit=0",
        "/v1/admin/notifications?limit=101",
    ],
)
async def test_out_of_range_paging_is_refused_rather_than_clamped(env: Env, path):
    """A limit of 0 or 500 is a caller bug; answering it quietly hides the bug and the cost."""
    assert (await env.client.get(path)).status_code == 422


async def test_the_audit_log_is_written_in_the_same_transaction_as_the_action(env: Env):
    """A ban that commits without its audit row is exactly the case the record exists for.

    A moderation decision that fails leaves no row at all — the 404 below is rejected before any write — and a
    decision that succeeds has its row in the same commit, so the two counts move together.
    """
    before = await _count(
        env, select(func.count()).select_from(AuditLog).where(AuditLog.action == "moderation.unpublish")
    )
    assert (
        await env.client.post(f"/v1/admin/moderation/series/{uuid.uuid4()}", json={"action": "unpublish"})
    ).status_code == 404
    assert (
        await _count(env, select(func.count()).select_from(AuditLog).where(AuditLog.action == "moderation.unpublish"))
        == before
    )

    series = await _seed_flagged_series(env, flags=["x"], note=None, status=PublishStatus.published)
    assert (
        await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "unpublish"})
    ).status_code == 200
    assert (
        await _count(env, select(func.count()).select_from(AuditLog).where(AuditLog.action == "moderation.unpublish"))
        == before + 1
    )
    await env.client.post(f"/v1/admin/moderation/series/{series.id}", json={"action": "clear_flags"})


async def test_an_experiment_that_never_started_still_lists_and_reports(env: Env):
    """The draft/running/ended label is computed, not stored, so a list of drafts must not mislabel them."""
    key = f"exp_{_tok(8)}"
    await env.client.post("/v1/admin/experiments", json=_experiment_body(key, description=None))
    listed = next(e for e in (await env.client.get("/v1/admin/experiments")).json() if e["key"] == key)
    assert listed["status"] == "draft" and listed["description"] is None
    assert listed["variants"] == {"aa": {"price": 10}, "bb": {"price": 12}}

    # An end date in the past reads as ended even though the row was never stopped through the API.
    async with env.maker() as s:
        row = await s.get(Experiment, key)
        row.started_at = datetime.now(UTC) - timedelta(days=2)
        row.ended_at = datetime.now(UTC) - timedelta(days=1)
        await s.commit()
    listed = next(e for e in (await env.client.get("/v1/admin/experiments")).json() if e["key"] == key)
    assert listed["status"] == "ended"

    # An end date in the future is still running.
    async with env.maker() as s:
        row = await s.get(Experiment, key)
        row.ended_at = datetime.now(UTC) + timedelta(days=1)
        await s.commit()
    listed = next(e for e in (await env.client.get("/v1/admin/experiments")).json() if e["key"] == key)
    assert listed["status"] == "running"
