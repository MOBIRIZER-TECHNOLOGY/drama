"""Every admin list endpoint, actually called.

These exist because a refactor that changed `reports()` from returning a list to returning a page left
`/v1/admin/moderation` iterating the Pydantic model itself — which yields `(field, value)` pairs rather than
raising, so the queue 500'd in production while every other test stayed green. Type checks do not cover a
router calling another router, so the coverage has to be a request.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.core.db import get_session
from app.main import app
from app.models.engagement import ContactMessage, Report, ReportStatus
from app.models.identity import AdminRole, AdminUser, User

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

# Read-only list endpoints, with the query shapes the console actually sends.
LIST_ENDPOINTS = [
    "/v1/admin/moderation",
    "/v1/admin/moderation?kind=report&limit=5",
    "/v1/admin/reports?status=open&limit=5",
    "/v1/admin/reports?status=open&limit=5&oldest_first=true",
    "/v1/admin/inbox?limit=5",
    "/v1/admin/inbox?limit=5&q=test&unread_only=true",
    "/v1/admin/uploads/videos?limit=5",
    "/v1/admin/uploads/videos?limit=5&status=failed",
    "/v1/admin/categories",
    "/v1/admin/languages",
    "/v1/admin/pages",
    "/v1/admin/packs",
    "/v1/admin/offers",
    "/v1/admin/flags",
    "/v1/admin/experiments",
    "/v1/admin/reward-tasks",
    "/v1/admin/accounts",
    "/v1/admin/audit?limit=5",
    "/v1/admin/purchases?limit=5",
    "/v1/admin/series?limit=5",
    "/v1/admin/users?limit=5",
    "/v1/admin/notifications?limit=5",
]


@pytest.fixture
async def seeded():
    """One admin, one report and one message, so the list endpoints have a row to render."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        admin = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Test Owner",
            password_hash="x",
            role=AdminRole.owner,
            is_active=True,
        )
        reporter = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper())
        s.add_all([admin, reporter])
        await s.flush()
        s.add_all(
            [
                Report(
                    reporter_id=reporter.id,
                    reason="other",
                    details="regression fixture",
                    status=ReportStatus.open,
                    created_at=datetime.now(UTC) - timedelta(minutes=5),
                ),
                ContactMessage(name="Test", email="t@katha-test.dev", subject="Hi", message="Hello", is_read=False),
            ]
        )
        await s.commit()
        yield admin
    await engine.dispose()


@pytest.fixture
async def admin_client(seeded):
    """Bypasses auth and points the app at the test database; this suite is about the handlers."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[deps.current_admin] = lambda: seeded
    app.dependency_overrides[get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(deps.current_admin, None)
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


@pytest.mark.parametrize("path", LIST_ENDPOINTS)
async def test_admin_list_endpoint_responds(admin_client, path):
    r = await admin_client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    body = r.json()
    # Either a bare list or a page; a page must carry its own total, which is the whole point of having one.
    if isinstance(body, dict):
        assert "items" in body and isinstance(body["items"], list), path
        assert isinstance(body.get("total"), int), f"{path} page has no integer total"
    else:
        assert isinstance(body, list), path


async def test_moderation_queue_returns_open_reports(admin_client):
    """The exact shape the regression broke: report rows, with their own fields readable."""
    r = await admin_client.get("/v1/admin/moderation")
    assert r.status_code == 200
    page = r.json()
    reports = [row for row in page["items"] if row["kind"] == "report"]
    assert reports, "seeded open report is missing from the moderation queue"
    assert all(row.get("id") and row.get("reason") for row in reports)
    # The counts are what the tab badges read, and they are counted over the table, not the page.
    assert page["reports"] >= len(reports)
    assert page["total"] == page["reports"] + page["flagged"]


async def test_moderation_kind_filter_narrows_the_page_not_the_counts(admin_client):
    """Filtering to one kind must not make the other kind's badge disappear."""
    both = (await admin_client.get("/v1/admin/moderation")).json()
    only = (await admin_client.get("/v1/admin/moderation?kind=report")).json()
    assert {row["kind"] for row in only["items"]} <= {"report"}
    assert only["reports"] == both["reports"]
    assert only["flagged"] == both["flagged"]


async def test_composing_a_notification_records_it_and_queues_the_send(admin_client, monkeypatch):
    """The table and the worker job both existed with nothing able to create a row between them.

    Delivery is the worker's job and is not exercised here; what matters is that the row is written, the send
    is queued with that row's id, and the queueing happens after the commit — a job that starts before the
    transaction lands reads a notification that does not exist yet.
    """
    from app.api.routers import admin_ops

    queued: list[tuple] = []

    async def fake_enqueue(name: str, *args, **kwargs):
        queued.append((name, args))
        return "job-1"

    monkeypatch.setattr(admin_ops.jobs, "enqueue", fake_enqueue)

    res = await admin_client.post(
        "/v1/admin/notifications",
        json={"title": "New episodes tonight", "body": "Three new episodes at 8pm.", "segment": {"all": True}},
    )
    assert res.status_code == 201, res.text
    row = res.json()
    assert row["title"] == "New episodes tonight"
    assert row["sent_at"] is None and row["delivered"] == 0
    assert queued == [("send_push", (row["id"],))]

    listed = await admin_client.get("/v1/admin/notifications?limit=5")
    assert listed.status_code == 200
    assert any(n["id"] == row["id"] for n in listed.json())


async def test_an_unknown_segment_is_refused_rather_than_sent_to_everyone(admin_client):
    """The worker resolves an unrecognised segment to nobody. A typo should fail loudly, not send silently."""
    res = await admin_client.post(
        "/v1/admin/notifications",
        json={"title": "Oops", "body": "Body", "segment": {"contry": "IN"}},
    )
    assert res.status_code == 422


async def test_the_user_drawer_endpoint_returns_everything_it_promises(admin_client, seeded):
    """`GET /admin/users/{id}` — the one call the support drawer makes.

    It was broken twice over, and each fault hid the other. An older handler for the same path was registered
    first and served a plain account, so the extra fields never appeared; and the newer handler, once it
    could run at all, raised `MissingGreenlet` — `AdminUserDetail.model_validate(user)` reads a `sessions`
    attribute, `User.sessions` is a lazy relationship, and touching it is IO on an async session outside its
    greenlet. The console read `purchases.length` of undefined and showed "Couldn't load" for every account.

    Asserting on the fields is what catches both: a shadowing route drops them, and the greenlet fault turns
    the whole call into a 400.
    """
    listing = await admin_client.get("/v1/admin/users?limit=1")
    assert listing.status_code == 200
    items = listing.json()["items"]
    if not items:
        pytest.skip("no users in the test database")

    r = await admin_client.get(f"/v1/admin/users/{items[0]['id']}")
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    body = r.json()
    assert isinstance(body.get("purchases"), list), "the drawer renders purchases and crashes without them"
    assert isinstance(body.get("sessions"), int), "the drawer shows a signed-in device count"
    assert isinstance(body.get("is_vip"), bool), "granting VIP blind is what this field exists to prevent"


async def test_a_category_can_be_created_without_translations(admin_client):
    """Creating a category with an empty translation map used to 500.

    `Category.translations` is `lazy="selectin"`, which loads eagerly for objects that came out of a query —
    and a freshly inserted one never did. Serialising the response touched the collection, that became a lazy
    load on an async session outside its greenlet, and the request died with MissingGreenlet.

    It only happened with *no* translations: supply one and the applier fills the collection in memory on the
    way past, so creating a category by hand looked fine. The console's form posts `{}` by default, so every
    category created through the UI hit it.
    """
    created = await admin_client.post(
        "/v1/admin/categories",
        json={"name": "Regression", "slug": f"regression-{uuid.uuid4().hex[:8]}", "show_on_home": False,
              "sort_order": 0, "translations": {}},
    )
    assert created.status_code == 201, f"{created.status_code}: {created.text[:300]}"
    body = created.json()
    assert body["translations"] == {}

    cleanup = await admin_client.delete(f"/v1/admin/categories/{body['id']}")
    assert cleanup.status_code == 200
