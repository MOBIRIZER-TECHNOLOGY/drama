"""Refresh rotation and session revocation, through the API.

Presenting an already-rotated refresh token is the theft signal the rotation scheme exists to catch, and the
response to it is to revoke the whole session. That revocation was written to the row and then thrown away with
the request, because the handler raised before committing — so the alarm rang and nothing happened. The second
half is that a revoked session's last access token stayed valid until it expired, which is the exact window a
stolen refresh token wants.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import get_session
from app.core.ratelimit import limiter
from app.main import app
from app.models.identity import Platform, Session, User
from app.services import users as users_svc

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


@pytest.fixture
async def env():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        user = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper())
        s.add(user)
        await s.flush()
        access, refresh, row = await users_svc.issue_session(
            s, user, platform=Platform.android, device_id="d1", device_name="Pixel", app_version="1.0", ip=None
        )
        await s.commit()

        async def _session():
            async with maker() as inner:
                yield inner

        limiter.enabled = False
        app.dependency_overrides[get_session] = _session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                yield c, maker, access, refresh, row.id
        finally:
            limiter.enabled = True
            app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_replaying_a_rotated_refresh_token_revokes_the_session_for_good(env):
    client, maker, access, refresh, session_id = env

    rotated = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert rotated.status_code == 200
    fresh = rotated.json()

    # The old token again: refused, and the refusal has to survive the request.
    replay = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert replay.status_code == 401
    async with maker() as s:
        row = await s.get(Session, session_id)
        assert row is not None and row.revoked_at is not None, "the revocation was rolled back with the 401"

    # Everything the session had is dead: the new refresh token and the new access token alike.
    assert (await client.post("/v1/auth/refresh", json={"refresh_token": fresh["refresh_token"]})).status_code == 401
    me = await client.get("/v1/auth/me", headers=_auth(fresh["access_token"]))
    assert me.status_code == 401
    assert me.json()["detail"]["code"] == "session_revoked"


async def test_a_revoked_sessions_access_token_stops_working_at_once(env):
    """An access token is short-lived, but "sign out this device" means now, not in fifteen minutes."""
    client, maker, access, _, session_id = env
    assert (await client.get("/v1/auth/me", headers=_auth(access))).status_code == 200

    async with maker() as s:
        await users_svc.revoke_session(s, session_id)
        await s.commit()

    after = await client.get("/v1/auth/me", headers=_auth(access))
    assert after.status_code == 401
    assert after.json()["detail"]["code"] == "session_revoked"
