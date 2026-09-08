"""Two-factor sign-in and session revocation, through the API.

The console holds every lever in the product behind one password and an eight-hour stateless token.
`admin_users.totp_secret` existed from the first migration and nothing wrote to it, and there was no way to
end a session short of disabling the account — which also removes the person's access when all you wanted was
to kill their tokens.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import asyncio
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import totp
from app.core.db import get_session
from app.core.ratelimit import limiter
from app.core.security import hash_password
from app.main import app
from app.models.identity import AdminRole, AdminUser

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

PASSWORD = "correct horse battery staple"


@pytest.fixture
async def env():
    """A real admin with a real password hash — these tests go through login, so nothing is stubbed."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        admin = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Owner",
            password_hash=await asyncio.to_thread(hash_password, PASSWORD),
            role=AdminRole.owner,
            is_active=True,
        )
        s.add(admin)
        await s.commit()

        async def _session():
            async with maker() as inner:
                yield inner

        # These tests sign in many times from one address, which is exactly what the 5/minute limit on
        # /login exists to stop. The limit itself is covered elsewhere; here it would only test itself.
        limiter.enabled = False
        app.dependency_overrides[get_session] = _session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                yield c, admin, maker
        finally:
            limiter.enabled = True
            app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def _login(client, admin, **extra):
    return await client.post("/v1/admin/auth/login", json={"email": admin.email, "password": PASSWORD, **extra})


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_login_without_2fa_still_works(env):
    client, admin, _ = env
    r = await _login(client, admin)
    assert r.status_code == 200
    me = await client.get("/v1/admin/auth/me", headers=_auth(r.json()["access_token"]))
    assert me.status_code == 200
    assert me.json()["totp_enabled"] is False


async def test_enrol_then_login_requires_the_code(env):
    client, admin, _ = env
    token = (await _login(client, admin)).json()["access_token"]

    setup = await client.post("/v1/admin/auth/totp/setup", headers=_auth(token))
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/")

    # Nothing is stored until a code proves the authenticator holds the secret.
    assert (await client.get("/v1/admin/auth/me", headers=_auth(token))).json()["totp_enabled"] is False

    bad = await client.post("/v1/admin/auth/totp/enable", json={"secret": secret, "code": "000000"}, headers=_auth(token))
    assert bad.status_code == 401
    assert (await client.get("/v1/admin/auth/me", headers=_auth(token))).json()["totp_enabled"] is False

    good = await client.post(
        "/v1/admin/auth/totp/enable", json={"secret": secret, "code": totp.generate(secret)}, headers=_auth(token)
    )
    assert good.status_code == 200 and good.json()["totp_enabled"] is True

    # Password alone is no longer enough, and the reason is distinguishable from a wrong password.
    missing = await _login(client, admin)
    assert missing.status_code == 401
    assert missing.json()["detail"]["code"] == "totp_required"

    wrong = await _login(client, admin, otp="000000")
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "totp_invalid"

    ok = await _login(client, admin, otp=totp.generate(secret))
    assert ok.status_code == 200


async def test_disabling_2fa_needs_both_factors(env):
    client, admin, _ = env
    token = (await _login(client, admin)).json()["access_token"]
    secret = (await client.post("/v1/admin/auth/totp/setup", headers=_auth(token))).json()["secret"]
    await client.post(
        "/v1/admin/auth/totp/enable", json={"secret": secret, "code": totp.generate(secret)}, headers=_auth(token)
    )

    # A stolen session must not be able to quietly disarm the second factor.
    no_password = await client.post(
        "/v1/admin/auth/totp/disable", json={"password": "wrong", "code": totp.generate(secret)}, headers=_auth(token)
    )
    assert no_password.status_code == 401

    no_code = await client.post(
        "/v1/admin/auth/totp/disable", json={"password": PASSWORD, "code": "000000"}, headers=_auth(token)
    )
    assert no_code.status_code == 401

    off = await client.post(
        "/v1/admin/auth/totp/disable",
        json={"password": PASSWORD, "code": totp.generate(secret)},
        headers=_auth(token),
    )
    assert off.status_code == 200 and off.json()["totp_enabled"] is False


async def test_sign_out_everywhere_kills_other_tokens_but_not_the_caller(env):
    client, admin, _ = env
    laptop = (await _login(client, admin)).json()["access_token"]
    desktop = (await _login(client, admin)).json()["access_token"]

    assert (await client.get("/v1/admin/auth/me", headers=_auth(laptop))).status_code == 200

    revoked = await client.post("/v1/admin/auth/sign-out-all", headers=_auth(desktop))
    assert revoked.status_code == 200
    fresh = revoked.json()["access_token"]

    stale = await client.get("/v1/admin/auth/me", headers=_auth(laptop))
    assert stale.status_code == 401
    assert stale.json()["detail"]["code"] == "session_revoked"

    # The operator who clicked it is not trying to sign themselves out of the tab they are looking at.
    assert (await client.get("/v1/admin/auth/me", headers=_auth(fresh))).status_code == 200


async def test_owner_can_revoke_another_accounts_sessions(env):
    client, admin, maker = env
    async with maker() as s:
        victim = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Support",
            password_hash=await asyncio.to_thread(hash_password, PASSWORD),
            role=AdminRole.support,
            is_active=True,
        )
        s.add(victim)
        await s.commit()

    victim_token = (await _login(client, victim)).json()["access_token"]
    assert (await client.get("/v1/admin/auth/me", headers=_auth(victim_token))).status_code == 200

    owner_token = (await _login(client, admin)).json()["access_token"]
    r = await client.post(f"/v1/admin/accounts/{victim.id}/revoke-sessions", headers=_auth(owner_token))
    assert r.status_code == 200

    after = await client.get("/v1/admin/auth/me", headers=_auth(victim_token))
    assert after.status_code == 401
    # Their access is intact — only the tokens died.
    assert (await _login(client, victim)).status_code == 200
