"""Ad placements end to end.

The console screen for this shipped before the API did and ran on an in-memory stub, so nothing an operator set
survived a refresh. These cover the two rules the API enforces on the way in — a placement must name at least
one platform, and a reward value only survives on a slot that can pay one out — plus the thing that makes the
screen mean anything: an active placement reaching a client through /v1/config, filtered by platform.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.core.db import get_session
from app.main import app
from app.models.identity import AdminRole, AdminUser
from app.models.ops import AdPlacement

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

REWARDED = {
    "name": "Rewarded unlock",
    "slot": "unlock_rewarded",
    "provider": "admob",
    "unit_id": "ca-app-pub-0000000000000000/1111111111",
    "platforms": ["android"],
    "reward_coins": 10,
    "frequency_cap_sec": 300,
    "is_active": True,
    "sort_order": 0,
}


@pytest.fixture
async def env():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        # A shared cluster: start from a known empty table so the config assertions are about this test's rows.
        await s.execute(delete(AdPlacement))
        admin = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Ads Owner",
            password_hash="x",
            role=AdminRole.owner,
            is_active=True,
        )
        s.add(admin)
        await s.commit()

        async def _session():
            async with maker() as inner:
                yield inner

        app.dependency_overrides[deps.current_admin] = lambda: admin
        app.dependency_overrides[get_session] = _session
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
        app.dependency_overrides.pop(deps.current_admin, None)
        app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def test_create_list_update_delete(env):
    created = await env.post("/v1/admin/ad-placements", json=REWARDED)
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["reward_coins"] == 10
    assert row["platforms"] == ["android"]

    listed = await env.get("/v1/admin/ad-placements")
    assert listed.status_code == 200
    page = listed.json()
    assert page["total"] == 1 and page["active"] == 1
    assert [p["id"] for p in page["items"]] == [row["id"]]

    off = await env.put(f"/v1/admin/ad-placements/{row['id']}", json={**REWARDED, "is_active": False})
    assert off.status_code == 200
    assert off.json()["is_active"] is False
    assert (await env.get("/v1/admin/ad-placements")).json()["active"] == 0

    gone = await env.delete(f"/v1/admin/ad-placements/{row['id']}")
    assert gone.status_code == 200
    assert (await env.get("/v1/admin/ad-placements")).json()["total"] == 0


async def test_placement_must_name_a_platform(env):
    r = await env.post("/v1/admin/ad-placements", json={**REWARDED, "platforms": []})
    assert r.status_code == 422, "a placement no client can render should not be storable"


async def test_unknown_platform_is_refused(env):
    r = await env.post("/v1/admin/ad-placements", json={**REWARDED, "platforms": ["android", "tizen"]})
    assert r.status_code == 422


async def test_reward_is_dropped_on_a_slot_that_cannot_pay_it(env):
    """Changing the slot in the form used to leave a stale payout attached to a banner."""
    r = await env.post(
        "/v1/admin/ad-placements",
        json={**REWARDED, "slot": "home_rail", "unit_id": "ca-app-pub-0/2", "reward_coins": 25},
    )
    assert r.status_code == 201
    assert r.json()["reward_coins"] is None


async def test_duplicate_unit_in_the_same_slot_is_a_conflict(env):
    assert (await env.post("/v1/admin/ad-placements", json=REWARDED)).status_code == 201
    dup = await env.post("/v1/admin/ad-placements", json={**REWARDED, "name": "Same unit again"})
    assert dup.status_code == 409
    assert dup.json()["detail"]["code"] == "placement_exists"


async def test_active_placement_reaches_the_client_for_its_platform_only(env):
    assert (await env.post("/v1/admin/ad-placements", json=REWARDED)).status_code == 201

    android = await env.get("/v1/config", headers={"X-Katha-Platform": "android"})
    assert android.status_code == 200
    ads = android.json()["ads"]
    assert ads["enabled"] is True
    assert [p["slot"] for p in ads["placements"]] == ["unlock_rewarded"]
    assert ads["placements"][0]["reward_coins"] == 10

    web = await env.get("/v1/config", headers={"X-Katha-Platform": "web"})
    assert web.json()["ads"] == {"enabled": False, "placements": []}


async def test_inactive_placement_never_reaches_a_client(env):
    assert (await env.post("/v1/admin/ad-placements", json={**REWARDED, "is_active": False})).status_code == 201
    ads = (await env.get("/v1/config", headers={"X-Katha-Platform": "android"})).json()["ads"]
    assert ads["enabled"] is False and ads["placements"] == []
