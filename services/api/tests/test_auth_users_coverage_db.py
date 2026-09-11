"""Sign-in, accounts, episode access and the admin user console — the rules, exercised end to end.

Four modules carry almost every access decision this service makes, and between them they were barely
executed by the suite: `app/api/routers/auth.py`, `app/services/users.py`, `app/api/routers/admin_users.py`
and `app/services/access.py`. What lives there is not plumbing — it is the sequential-unlock rule, the daily
ad cap, the age gate, refresh-token rotation with reuse detection, account deletion, and which admin role may
spend money or erase a person. Each of those is a sentence in a policy that only a request can check.

The rules asserted here, and why each one is worth a test:

  - A Firebase identity links to an existing account only on a *verified* email or a phone number. Linking on
    an address the person merely typed hands an existing account to whoever claims its email.
  - Refresh tokens rotate, and presenting a rotated one revokes the session — the theft signal.
  - The rate limiter keys on a token it can actually decode, never on the bytes after `Bearer `; otherwise a
    fresh random header buys a fresh budget and the limit is decoration.
  - Episodes unlock in order, free overrides and VIP short-circuit the paywall, and an archived series is not
    reachable by id even when the caller knows it.
  - On the admin side: support may not move coins, only an owner may delete an account, deletion scrubs the
    identities and the session rows' personal data, and a VIP grant stacks onto an active pass rather than
    overwriting it — with the drawer reporting the *new* expiry.

Firebase is faked at the boundary (`verify_id_token`, `delete_user`) and so is S3 presigning; nothing here
talks to an external service.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request

from app.api import deps
from app.api.routers import auth as auth_router
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import AgeGateRequired, Conflict, NotFound
from app.core.firebase import FirebaseIdentity
from app.core.ratelimit import _key as ratelimit_key
from app.core.ratelimit import limiter
from app.core.security import mint_token, verify_password
from app.main import app
from app.models.catalog import Episode, PublishStatus, Series
from app.models.identity import AdminRole, AdminUser, AuthIdentity, Platform, Session, User, UserStatus
from app.models.ops import AuditLog
from app.models.wallet import (
    AdEvent,
    CoinPack,
    EpisodeUnlock,
    LedgerKind,
    PackKind,
    Purchase,
    PurchaseStatus,
    Referral,
    UnlockMethod,
    VipMembership,
)
from app.services import access, ledger
from app.services import users as users_svc

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

TOKEN = "f" * 40  # ExchangeRequest only requires 20+ characters; the verifier is faked, so the value is inert


# --------------------------------------------------------------------------------------------------
# fixtures and seeding helpers
# --------------------------------------------------------------------------------------------------


@pytest.fixture
async def maker():
    """An engine of this suite's own, so assertions read committed rows rather than the request's session."""
    engine = create_async_engine(DB_URL)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(maker):
    """The app, pointed at the test database, with rate limits off.

    The limits themselves are asserted directly against the key function below; leaving them on here would
    only make a suite that signs in many times from one address flaky.
    """

    async def _session():
        async with maker() as s:
            yield s

    limiter.enabled = False
    app.dependency_overrides[get_session] = _session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        limiter.enabled = True
        app.dependency_overrides.pop(get_session, None)


@pytest.fixture
async def admin_as(client):
    """`admin_as(row)` points `current_admin` at that account; role checks then run for real."""

    def _set(admin: AdminUser) -> AsyncClient:
        app.dependency_overrides[deps.current_admin] = lambda: admin
        return client

    yield _set
    app.dependency_overrides.pop(deps.current_admin, None)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _identity(**kw) -> FirebaseIdentity:
    """A verified Firebase identity, with a unique uid unless one is given."""
    base = {
        "uid": f"uid-{uuid.uuid4().hex}",
        "email": None,
        "phone": None,
        "name": None,
        "picture": None,
        "provider": "password",
        "email_verified": False,
    }
    base.update(kw)
    return FirebaseIdentity(**base)


def _fake_firebase(monkeypatch, ident: FirebaseIdentity) -> None:
    """Stand in for Google's verifier. Nothing in this file may reach the network."""
    monkeypatch.setattr(auth_router, "verify_id_token", lambda _token: ident)


def _exchange_body(**kw) -> dict:
    body = {"firebase_id_token": TOKEN, "platform": "android", "device_id": "d1", "device_name": "Pixel"}
    body.update(kw)
    return body


def _new_user(**kw) -> User:
    return User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper(), **kw)


async def _credit(session, user_id: uuid.UUID, coins: int) -> None:
    """Coins to spend, through the ledger — nothing else is allowed to write a balance."""
    await ledger.post(
        session,
        user_id=user_id,
        delta=coins,
        kind=LedgerKind.admin_adjust,
        idempotency_key=f"test-credit:{uuid.uuid4().hex}",
        note="test float",
    )


async def _series_with_episodes(
    session,
    *,
    free_episodes: int = 2,
    episodes: int = 5,
    status: PublishStatus = PublishStatus.published,
    episode_status: PublishStatus = PublishStatus.published,
    rating: str | None = "U",
    episode_price: int | None = None,
    bundle_discount_pct: int | None = None,
) -> tuple[Series, list[Episode]]:
    series = Series(
        slug=f"test-{uuid.uuid4().hex[:16]}",
        free_episodes=free_episodes,
        status=status,
        content_rating=rating,
        episode_price=episode_price,
        bundle_discount_pct=bundle_discount_pct,
    )
    session.add(series)
    await session.flush()
    rows = [
        Episode(series_id=series.id, number=n, title=f"Episode {n}", status=episode_status)
        for n in range(1, episodes + 1)
    ]
    session.add_all(rows)
    await session.flush()
    return series, rows


async def _admin_row(session, role: AdminRole, **kw) -> AdminUser:
    fields = {
        "email": f"{uuid.uuid4().hex[:12]}@katha-test.dev",
        "display_name": "Test Admin",
        "password_hash": "not-a-real-hash",
        "is_active": True,
    }
    fields.update(kw)
    admin = AdminUser(role=role, **fields)
    session.add(admin)
    await session.flush()
    return admin


# --------------------------------------------------------------------------------------------------
# POST /auth/exchange — onboarding from a Firebase identity (auth.exchange + users.get_or_create_from_firebase)
# --------------------------------------------------------------------------------------------------


async def test_exchange_creates_the_account_pays_the_bonus_and_opens_a_session(client, maker, monkeypatch):
    ident = _identity(email=f"New.Person+{uuid.uuid4().hex[:8]}@katha-test.dev", email_verified=True, name="Asha")
    _fake_firebase(monkeypatch, ident)

    r = await client.post("/v1/auth/exchange", json=_exchange_body(app_version="1.2.3"))
    assert r.status_code == 200, r.text
    pair = r.json()
    assert pair["is_new_user"] is True
    assert pair["expires_in"] == get_settings().access_token_ttl_seconds
    assert pair["token_type"] == "bearer"

    me = await client.get("/v1/auth/me", headers=_auth(pair["access_token"]))
    assert me.status_code == 200
    body = me.json()
    assert body["display_name"] == "Asha"
    # Stored lower-cased: the address is an identity key and must match however the provider cased it.
    assert body["email"] == ident.email.lower()
    assert body["coin_balance"] == get_settings().default_signup_bonus
    assert body["is_vip"] is False
    assert body["ad_unlocks_remaining"] == get_settings().default_ad_unlocks_per_day

    # The session row carries what the device sent, which is what the "signed-in devices" screen shows.
    async with maker() as s:
        row = await s.scalar(select(Session).where(Session.user_id == uuid.UUID(body["id"])))
        assert row is not None
        assert row.platform == Platform.android
        assert row.device_name == "Pixel" and row.app_version == "1.2.3"
        assert row.revoked_at is None


async def test_signing_in_again_with_the_same_firebase_uid_reuses_the_account(client, monkeypatch):
    ident = _identity(email=f"repeat-{uuid.uuid4().hex[:8]}@katha-test.dev", email_verified=True)
    _fake_firebase(monkeypatch, ident)

    first = (await client.post("/v1/auth/exchange", json=_exchange_body())).json()
    second = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert second.status_code == 200
    assert second.json()["is_new_user"] is False

    ids = set()
    for pair in (first, second.json()):
        me = await client.get("/v1/auth/me", headers=_auth(pair["access_token"]))
        ids.add(me.json()["id"])
    assert len(ids) == 1, "a second sign-in minted a second account"
    # The signup bonus is idempotent on the user id, so signing in twice does not pay twice.
    assert me.json()["coin_balance"] == get_settings().default_signup_bonus


async def test_a_verified_email_links_to_the_existing_account_instead_of_duplicating_it(client, maker, monkeypatch):
    """Phone first, Google later, same person — one account."""
    email = f"link-{uuid.uuid4().hex[:8]}@katha-test.dev"
    async with maker() as s:
        existing = _new_user(email=email, display_name="Original")
        s.add(existing)
        await s.commit()

    ident = _identity(email=email.upper(), email_verified=True, provider="google.com", name="Renamed")
    _fake_firebase(monkeypatch, ident)
    pair = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert pair.status_code == 200
    assert pair.json()["is_new_user"] is False

    me = await client.get("/v1/auth/me", headers=_auth(pair.json()["access_token"]))
    assert me.json()["id"] == str(existing.id)
    # Linking attaches an identity; it does not overwrite the profile the person already has.
    assert me.json()["display_name"] == "Original"

    async with maker() as s:
        linked = await s.scalar(select(AuthIdentity).where(AuthIdentity.provider_uid == ident.uid))
        assert linked is not None and linked.user_id == existing.id
        assert linked.raw == {"sign_in_provider": "google.com", "linked": True}


async def test_a_phone_number_links_even_though_no_verified_flag_rides_with_it(client, maker, monkeypatch):
    """Firebase verifies phone numbers itself before they reach the token, so there is no flag to check."""
    phone = f"+9199{uuid.uuid4().int % 100000000:08d}"
    async with maker() as s:
        existing = _new_user(phone=phone)
        s.add(existing)
        await s.commit()

    _fake_firebase(monkeypatch, _identity(phone=phone, provider="phone"))
    pair = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert pair.json()["is_new_user"] is False
    me = await client.get("/v1/auth/me", headers=_auth(pair.json()["access_token"]))
    assert me.json()["id"] == str(existing.id)


async def test_a_deleted_account_is_never_relinked_by_phone(client, maker, monkeypatch):
    """A deleted row that still holds a phone number must not be handed to whoever gets that number next.

    BUG (asserted as it behaves, not as it should): the linking query excludes deleted accounts, which is
    right, but the insert that follows still meets the unique index on `users.phone`. The signup dead-ends on
    a generic 409 — the number is unusable forever, and the client is told only "that change conflicts with
    existing data". `delete_me` scrubs the phone, so this is the row an older deletion path left behind.
    """
    phone = f"+9198{uuid.uuid4().int % 100000000:08d}"
    async with maker() as s:
        gone = _new_user(phone=phone, status=UserStatus.deleted)
        s.add(gone)
        await s.commit()

    _fake_firebase(monkeypatch, _identity(phone=phone, provider="phone"))
    r = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "conflict"
    async with maker() as s:
        assert (await s.get(User, gone.id)).status == UserStatus.deleted, "a deleted account was revived"


async def test_an_unverified_email_matching_an_existing_account_dead_ends_on_a_generic_conflict(
    client, maker, monkeypatch
):
    """BUG (asserted as it behaves, not as it should).

    Refusing to link on an unverified address is right — otherwise anyone who types someone else's email at a
    provider that does not verify it is handed their account. But the refusal falls through to inserting a new
    user with that same address, and `users.email` is unique, so the insert raises IntegrityError and the
    global handler turns it into a bare 409 "that change conflicts with existing data". The person cannot sign
    in, and neither the client nor support is told which field collided or what to do about it.
    """
    email = f"unverified-{uuid.uuid4().hex[:8]}@katha-test.dev"
    async with maker() as s:
        s.add(_new_user(email=email))
        await s.commit()

    _fake_firebase(monkeypatch, _identity(email=email, email_verified=False))
    r = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "conflict"


async def test_an_invalid_firebase_token_is_a_401_with_a_code_the_client_can_read(client, monkeypatch):
    """`verify_id_token` may raise ValueError from deep inside the SDK; a bare one would be a 500."""

    def boom(_token):
        raise ValueError("Token is not a valid Firebase ID token")

    monkeypatch.setattr(auth_router, "verify_id_token", boom)
    r = await client.post("/v1/auth/exchange", json=_exchange_body())
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_id_token"


async def test_a_referral_code_links_the_pair_and_pays_only_the_referee(client, maker, monkeypatch):
    """Both halves at signup would make throwaway accounts profitable; the referrer's half waits for a purchase."""
    async with maker() as s:
        referrer = _new_user(display_name="Inviter")
        s.add(referrer)
        await s.commit()

    _fake_firebase(monkeypatch, _identity())
    # Lower-cased and padded: the handler upper-cases and strips before matching.
    pair = await client.post(
        "/v1/auth/exchange", json=_exchange_body(referral_code=f" {referrer.referral_code.lower()} ")
    )
    assert pair.status_code == 200
    me = (await client.get("/v1/auth/me", headers=_auth(pair.json()["access_token"]))).json()

    s_settings = get_settings()
    assert me["coin_balance"] == s_settings.default_signup_bonus + s_settings.default_referee_reward_coins

    async with maker() as s:
        referee = await s.get(User, uuid.UUID(me["id"]))
        assert referee.referred_by_id == referrer.id
        link = await s.scalar(select(Referral).where(Referral.referee_id == referee.id))
        assert link is not None and link.referrer_id == referrer.id and link.code == referrer.referral_code
        # The referrer is not paid yet.
        refreshed = await s.get(User, referrer.id)
        assert refreshed.coin_balance == 0


async def test_an_unknown_referral_code_is_ignored_rather_than_refused(client, maker, monkeypatch):
    """A mistyped code must not block a signup; the account is simply created unattached."""
    _fake_firebase(monkeypatch, _identity())
    pair = await client.post("/v1/auth/exchange", json=_exchange_body(referral_code="NOSUCHCODE"))
    assert pair.status_code == 200
    me = (await client.get("/v1/auth/me", headers=_auth(pair.json()["access_token"]))).json()
    assert me["coin_balance"] == get_settings().default_signup_bonus
    async with maker() as s:
        assert (await s.get(User, uuid.UUID(me["id"]))).referred_by_id is None


async def test_a_public_id_collision_is_retried_inside_a_savepoint(maker, monkeypatch):
    """Eight random digits do collide. A collision must cost a retry, not a failed signup."""
    async with maker() as s:
        taken = _new_user()
        s.add(taken)
        await s.commit()

        real = users_svc._public_id
        attempts: list[str] = []

        def colliding() -> str:
            attempts.append("x")
            return taken.public_id if len(attempts) == 1 else real()

        monkeypatch.setattr(users_svc, "_public_id", colliding)
        user, created = await users_svc.get_or_create_from_firebase(s, _identity())
        await s.commit()

    assert created is True
    assert len(attempts) == 2, "the first, colliding id was not retried"
    assert user.public_id != taken.public_id


async def test_a_public_id_that_never_stops_colliding_gives_up_after_five_tries(maker, monkeypatch):
    """The retry is bounded: an exhausted loop re-raises the last IntegrityError rather than spinning."""
    async with maker() as s:
        taken = _new_user()
        s.add(taken)
        await s.commit()

        attempts: list[str] = []

        def always_colliding() -> str:
            attempts.append("x")
            return taken.public_id

        monkeypatch.setattr(users_svc, "_public_id", always_colliding)
        with pytest.raises(IntegrityError):
            await users_svc.get_or_create_from_firebase(s, _identity())
        await s.rollback()

    assert len(attempts) == users_svc._ID_ATTEMPTS


# --------------------------------------------------------------------------------------------------
# Refresh rotation (users.rotate_refresh) and /auth/refresh
# --------------------------------------------------------------------------------------------------


@pytest.fixture
async def session_env(maker):
    """One user with one live session, and the tokens it was issued."""
    async with maker() as s:
        user = _new_user(display_name="Viewer", locale="hi")
        s.add(user)
        await s.flush()
        akey, rkey, row = await users_svc.issue_session(
            s, user, platform=Platform.ios, device_id="dev-1", device_name="iPhone", app_version="2.0", ip="10.0.0.1"
        )
        await s.commit()
    return user, akey, rkey, row.id


async def test_refresh_rotates_the_token_and_extends_the_session(client, maker, session_env):
    user, _access, refresh, session_id = session_env
    async with maker() as s:
        before = await s.get(Session, session_id)
        old_expiry = before.expires_at

    r = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 200
    pair = r.json()
    assert pair["refresh_token"] != refresh
    assert pair["expires_in"] == get_settings().access_token_ttl_seconds
    # A refresh is not a sign-in, so it never claims to be one.
    assert pair["is_new_user"] is False

    async with maker() as s:
        row = await s.get(Session, session_id)
        assert row.previous_token_hash == users_svc.hash_refresh(refresh)
        assert row.refresh_token_hash == users_svc.hash_refresh(pair["refresh_token"])
        assert row.expires_at >= old_expiry

    # The new access token works on the same session.
    me = await client.get("/v1/auth/me", headers=_auth(pair["access_token"]))
    assert me.status_code == 200 and me.json()["id"] == str(user.id)


async def test_presenting_a_rotated_token_revokes_the_session_and_the_revocation_is_committed(
    client, maker, session_env
):
    """The theft signal. A refusal that carries a write must commit that write before it raises.

    Rotation means a refresh token is used once. Seeing an old one again says the token was copied, and the
    only safe answer is to end the session — for the thief and the owner alike, because there is no telling
    which of them is holding the current token.
    """
    _user, _access, refresh, session_id = session_env
    rotated = (await client.post("/v1/auth/refresh", json={"refresh_token": refresh})).json()

    replay = await client.post("/v1/auth/refresh", json={"refresh_token": refresh})
    assert replay.status_code == 401
    async with maker() as s:
        assert (await s.get(Session, session_id)).revoked_at is not None, "the alarm rang and nothing happened"

    # The token that rotation had just handed out dies with the session it belonged to.
    assert (await client.post("/v1/auth/refresh", json={"refresh_token": rotated["refresh_token"]})).status_code == 401
    after = await client.get("/v1/auth/me", headers=_auth(rotated["access_token"]))
    assert after.status_code == 401 and after.json()["detail"]["code"] == "session_revoked"


async def test_an_unknown_refresh_token_is_refused_without_touching_anything(client, maker, session_env):
    _user, _access, _refresh, session_id = session_env
    r = await client.post("/v1/auth/refresh", json={"refresh_token": "not-a-token-anyone-issued"})
    assert r.status_code == 401
    async with maker() as s:
        assert (await s.get(Session, session_id)).revoked_at is None, "a stranger's guess revoked a live session"


async def test_rotation_refuses_an_expired_session_without_revoking_it(maker, session_env):
    """Expiry is not theft. The row is simply past its date, and the answer is "sign in again"."""
    _user, _access, refresh, session_id = session_env
    async with maker() as s:
        row = await s.get(Session, session_id)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await s.commit()

        assert await users_svc.rotate_refresh(s, refresh) is None
        await s.commit()
        assert (await s.get(Session, session_id)).revoked_at is None


async def test_rotation_refuses_a_revoked_session(maker, session_env):
    _user, _access, refresh, session_id = session_env
    async with maker() as s:
        await users_svc.revoke_session(s, session_id)
        await s.commit()
        assert await users_svc.rotate_refresh(s, refresh) is None


async def test_revoking_a_session_twice_keeps_the_first_timestamp(maker, session_env):
    """The revocation time is evidence; a second call must not move it."""
    _user, _access, _refresh, session_id = session_env
    async with maker() as s:
        await users_svc.revoke_session(s, session_id)
        await s.commit()
        first = (await s.get(Session, session_id)).revoked_at
        await users_svc.revoke_session(s, session_id)
        await s.commit()
        assert (await s.get(Session, session_id)).revoked_at == first
        # A session id that does not exist is a no-op, not a crash.
        await users_svc.revoke_session(s, uuid.uuid4())


async def test_a_banned_user_cannot_refresh(maker, session_env):
    """The ban has to bite at rotation too, or a banned account keeps itself signed in for another month."""
    user, _access, refresh, _session_id = session_env
    async with maker() as s:
        row = await s.get(User, user.id)
        row.status = UserStatus.banned
        await s.commit()
        assert await users_svc.rotate_refresh(s, refresh) is None


async def test_rotation_moves_last_seen_only_when_it_is_stale(maker, session_env):
    """`last_seen_at` drives retention reporting; writing it on every refresh would be a write per 15 minutes."""
    user, _access, refresh, _session_id = session_env
    long_ago = datetime.now(UTC) - timedelta(hours=3)
    async with maker() as s:
        row = await s.get(User, user.id)
        row.last_seen_at = long_ago
        await s.commit()

        result = await users_svc.rotate_refresh(s, refresh)
        assert result is not None
        await s.commit()
        moved = (await s.get(User, user.id)).last_seen_at
        assert moved > long_ago

        # Straight away again: still fresh, so it is left alone.
        second = await users_svc.rotate_refresh(s, result[1])
        assert second is not None
        await s.commit()
        assert (await s.get(User, user.id)).last_seen_at == moved


# --------------------------------------------------------------------------------------------------
# The rate-limit key (core/ratelimit) — what auth's decorators actually bucket on
# --------------------------------------------------------------------------------------------------


def _request(authorization: str | None = None) -> Request:
    headers = [(b"authorization", authorization.encode())] if authorization else []
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/auth/exchange",
            "headers": headers,
            "client": ("203.0.113.7", 51234),
        }
    )


def test_anonymous_traffic_is_bucketed_by_address():
    assert ratelimit_key(_request()) == "ip:203.0.113.7"


def test_a_random_bearer_token_does_not_buy_a_fresh_bucket():
    """The earlier key was the tail of whatever followed `Bearer `, so a new random header meant a new budget.

    That turned every per-address limit into a suggestion: send junk, get your own bucket, repeat.
    """
    assert ratelimit_key(_request("Bearer " + uuid.uuid4().hex)) == "ip:203.0.113.7"
    assert ratelimit_key(_request("Bearer " + uuid.uuid4().hex)) == "ip:203.0.113.7"


def test_a_token_this_service_issued_gets_its_own_bucket():
    subject = str(uuid.uuid4())
    assert ratelimit_key(_request("Bearer " + mint_token(subject, "access"))) == f"user:{subject}"
    assert ratelimit_key(_request("Bearer " + mint_token(subject, "admin"))) == f"user:{subject}"


def test_a_refresh_token_is_not_an_identity_for_the_limiter():
    """Only the kinds that authenticate a request count; anything else is charged to the address."""
    assert ratelimit_key(_request("Bearer " + mint_token(str(uuid.uuid4()), "refresh"))) == "ip:203.0.113.7"
    # A well-formed access token with no subject cannot name an account either.
    assert ratelimit_key(_request("Bearer " + mint_token("", "access"))) == "ip:203.0.113.7"


# --------------------------------------------------------------------------------------------------
# /auth/me, sessions, push tokens, avatar presign, account deletion
# --------------------------------------------------------------------------------------------------


async def test_me_reports_vip_from_the_membership_window(client, maker, session_env):
    user, access_token, _refresh, _session_id = session_env
    now = datetime.now(UTC)
    async with maker() as s:
        s.add(
            VipMembership(
                user_id=user.id, starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=29), source="admin"
            )
        )
        await s.commit()

    me = await client.get("/v1/auth/me", headers=_auth(access_token))
    assert me.status_code == 200 and me.json()["is_vip"] is True


async def test_patching_me_changes_the_display_name_and_confirms_age_exactly_once(client, maker, session_env):
    """The age confirmation is a consent record, so a later PATCH must not restamp it."""
    user, access_token, _refresh, _session_id = session_env
    first = await client.patch(
        "/v1/auth/me",
        json={"display_name": "Meera", "locale": "ta", "age_confirmed": True},
        headers=_auth(access_token),
    )
    assert first.status_code == 200
    assert first.json()["display_name"] == "Meera" and first.json()["locale"] == "ta"
    confirmed_at = first.json()["age_confirmed_at"]
    assert confirmed_at is not None

    second = await client.patch(
        "/v1/auth/me",
        json={"age_confirmed": True, "notification_prefs": {"new_episode": False}},
        headers=_auth(access_token),
    )
    assert second.status_code == 200
    assert second.json()["age_confirmed_at"] == confirmed_at, "the consent timestamp was overwritten"
    assert second.json()["notification_prefs"] == {"new_episode": False}
    # Fields the request did not mention are untouched (`exclude_unset`).
    assert second.json()["display_name"] == "Meera"

    async with maker() as s:
        assert (await s.get(User, user.id)).display_name == "Meera"


async def test_age_confirmed_false_neither_sets_nor_clears_the_stamp(client, session_env):
    """`age_confirmed` is a one-way switch; sending false is not an un-confirmation."""
    _user, access_token, _refresh, _session_id = session_env
    off = await client.patch("/v1/auth/me", json={"age_confirmed": False}, headers=_auth(access_token))
    assert off.status_code == 200 and off.json()["age_confirmed_at"] is None

    await client.patch("/v1/auth/me", json={"age_confirmed": True}, headers=_auth(access_token))
    again = await client.patch("/v1/auth/me", json={"age_confirmed": False}, headers=_auth(access_token))
    assert again.json()["age_confirmed_at"] is not None


async def test_logout_ends_this_session_and_its_access_token_with_it(client, maker, session_env):
    _user, access_token, _refresh, session_id = session_env
    out = await client.post("/v1/auth/logout", headers=_auth(access_token))
    assert out.status_code == 200 and out.json() == {"ok": True}

    async with maker() as s:
        assert (await s.get(Session, session_id)).revoked_at is not None

    after = await client.get("/v1/auth/me", headers=_auth(access_token))
    assert after.status_code == 401 and after.json()["detail"]["code"] == "session_revoked"


async def test_a_token_with_no_session_can_still_read_and_sign_out(client, maker, session_env):
    """Not every access token names a session row; the handlers must not assume one."""
    user, _access, _refresh, _session_id = session_env
    sessionless = mint_token(str(user.id), "access")

    assert (await client.get("/v1/auth/me", headers=_auth(sessionless))).status_code == 200
    assert (await client.post("/v1/auth/logout", headers=_auth(sessionless))).status_code == 200
    # Nothing to attach a push token to, and that is an error rather than a silent no-op.
    push = await client.put(
        "/v1/auth/me/push-token", json={"token": "ExponentPushToken[abcdef]"}, headers=_auth(sessionless)
    )
    assert push.status_code == 401
    # Clearing, by contrast, is a no-op: the caller asked for no delivery and there is none.
    assert (await client.delete("/v1/auth/me/push-token", headers=_auth(sessionless))).status_code == 200


async def test_the_push_token_lives_on_the_session_and_only_a_real_expo_token_is_taken(client, maker, session_env):
    _user, access_token, _refresh, session_id = session_env
    bad = await client.put(
        "/v1/auth/me/push-token", json={"token": "fcm:not-an-expo-token"}, headers=_auth(access_token)
    )
    assert bad.status_code == 409 and bad.json()["detail"]["code"] == "bad_push_token"

    good = await client.put(
        "/v1/auth/me/push-token",
        json={"token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"},
        headers=_auth(access_token),
    )
    assert good.status_code == 200
    async with maker() as s:
        assert (await s.get(Session, session_id)).push_token == "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"

    cleared = await client.delete("/v1/auth/me/push-token", headers=_auth(access_token))
    assert cleared.status_code == 200
    async with maker() as s:
        assert (await s.get(Session, session_id)).push_token is None


async def test_avatar_presign_names_the_user_in_the_key_and_hands_back_the_public_url(client, session_env, monkeypatch):
    """S3 is faked: what matters is the key it would be written under and the URL the client stores."""
    user, access_token, _refresh, _session_id = session_env
    seen: list[tuple[str, str]] = []

    def fake_presign(key: str, content_type: str, **_kw) -> str:
        seen.append((key, content_type))
        return f"https://s3.example/put/{key}?signed=1"

    monkeypatch.setattr(auth_router.storage, "presign_put", fake_presign)

    r = await client.post(
        "/v1/auth/me/avatar/presign",
        json={"filename": "selfie.png", "content_type": "image/png"},
        headers=_auth(access_token),
    )
    assert r.status_code == 200
    key, content_type = seen[0]
    assert key.startswith(f"avatars/{user.id}/") and key.endswith(".png")
    assert content_type == "image/png"
    assert r.json()["upload_url"] == f"https://s3.example/put/{key}?signed=1"
    assert r.json()["public_url"] == f"{get_settings().cdn_base_url.rstrip('/')}/{key}"


async def test_avatar_presign_refuses_a_content_type_that_is_not_an_image(client, session_env):
    _user, access_token, _refresh, _session_id = session_env
    r = await client.post(
        "/v1/auth/me/avatar/presign",
        json={"filename": "payload.svg", "content_type": "image/svg+xml"},
        headers=_auth(access_token),
    )
    assert r.status_code == 422


async def test_the_sessions_list_shows_live_devices_and_marks_the_current_one(client, maker, session_env):
    user, access_token, _refresh, session_id = session_env
    async with maker() as s:
        me = await s.get(User, user.id)
        _a, _r, other = await users_svc.issue_session(
            s, me, platform=Platform.web, device_id="d2", device_name="Chrome", app_version=None, ip=None
        )
        _a2, _r2, dead = await users_svc.issue_session(
            s, me, platform=Platform.android, device_id="d3", device_name="Old Phone", app_version=None, ip=None
        )
        dead.revoked_at = datetime.now(UTC)
        await s.commit()
        other_id, dead_id = other.id, dead.id

    r = await client.get("/v1/auth/sessions", headers=_auth(access_token))
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert str(dead_id) not in rows, "a revoked device is still listed as signed in"
    assert rows[str(session_id)]["current"] is True
    assert rows[str(other_id)]["current"] is False
    assert rows[str(other_id)]["device_name"] == "Chrome"


async def test_revoking_another_of_my_devices_signs_it_out(client, maker, session_env):
    user, access_token, _refresh, _session_id = session_env
    async with maker() as s:
        me = await s.get(User, user.id)
        other_access, _r, other = await users_svc.issue_session(
            s, me, platform=Platform.web, device_id="d2", device_name="Chrome", app_version=None, ip=None
        )
        await s.commit()
        other_id = other.id

    r = await client.delete(f"/v1/auth/sessions/{other_id}", headers=_auth(access_token))
    assert r.status_code == 200
    gone = await client.get("/v1/auth/me", headers=_auth(other_access))
    assert gone.status_code == 401 and gone.json()["detail"]["code"] == "session_revoked"


async def test_i_cannot_revoke_a_session_that_is_not_mine(client, maker, session_env):
    """Session ids are opaque, but ownership is still checked rather than assumed."""
    _user, access_token, _refresh, _session_id = session_env
    async with maker() as s:
        stranger = _new_user()
        s.add(stranger)
        await s.flush()
        stranger_access, _r, row = await users_svc.issue_session(
            s, stranger, platform=Platform.web, device_id="s1", device_name="Someone else", app_version=None, ip=None
        )
        await s.commit()
        stranger_session_id = row.id

    r = await client.delete(f"/v1/auth/sessions/{stranger_session_id}", headers=_auth(access_token))
    assert r.status_code == 200  # deliberately not a 404: the caller learns nothing about other people's ids
    assert (await client.get("/v1/auth/me", headers=_auth(stranger_access))).status_code == 200
    # A session id that exists nowhere is the same answer.
    assert (await client.delete(f"/v1/auth/sessions/{uuid.uuid4()}", headers=_auth(access_token))).status_code == 200


async def test_deleting_my_account_scrubs_it_signs_it_out_and_removes_the_firebase_record(client, maker, monkeypatch):
    """Store policy: the personal fields go, the identities go, every device is signed out.

    The ledger and purchases stay under the anonymised id — finance still has to reconcile them.
    """
    deleted_uids: list[str] = []
    monkeypatch.setattr(auth_router, "delete_firebase_user", lambda uid: deleted_uids.append(uid) or True)

    async with maker() as s:
        user = _new_user(
            display_name="To Be Erased",
            email=f"erase-{uuid.uuid4().hex[:8]}@katha-test.dev",
            phone=f"+9197{uuid.uuid4().int % 100000000:08d}",
            avatar_url="https://cdn.example/a.png",
        )
        s.add(user)
        await s.flush()
        s.add_all(
            [
                AuthIdentity(user_id=user.id, provider="firebase", provider_uid=f"fb-{uuid.uuid4().hex}"),
                AuthIdentity(user_id=user.id, provider="apple", provider_uid=f"ap-{uuid.uuid4().hex}"),
            ]
        )
        access_token, _r, row = await users_svc.issue_session(
            s, user, platform=Platform.ios, device_id="d1", device_name="iPhone", app_version=None, ip="10.0.0.9"
        )
        await _credit(s, user.id, 500)
        await s.commit()
        firebase_uid = (
            await s.scalars(
                select(AuthIdentity.provider_uid).where(
                    AuthIdentity.user_id == user.id, AuthIdentity.provider == "firebase"
                )
            )
        ).one()
        session_id = row.id

    r = await client.delete("/v1/auth/me", headers=_auth(access_token))
    assert r.status_code == 200 and r.json() == {"ok": True}
    # Only the Firebase identity is Firebase's to delete; the other is simply dropped locally.
    assert deleted_uids == [firebase_uid]

    async with maker() as s:
        row = await s.get(User, user.id)
        assert row.status == UserStatus.deleted
        assert (row.email, row.phone, row.display_name, row.avatar_url) == (None, None, None, None)
        assert row.coin_balance == 500, "the ledger balance is finance's record and must survive"
        assert (await s.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user.id))).all() == []
        assert (await s.get(Session, session_id)).revoked_at is not None

    # The token dies with the account: deps refuses a non-active user.
    after = await client.get("/v1/auth/me", headers=_auth(access_token))
    assert after.status_code == 403


# --------------------------------------------------------------------------------------------------
# services/access — pricing, the age gate, the sequential rule, the daily ad cap
# --------------------------------------------------------------------------------------------------


def test_an_unrated_or_unrecognised_series_counts_as_adult():
    """ "Not in the adult list" is not the same as "cleared"; forgetting a dropdown must not ship ungated."""
    assert access.requires_age_gate(Series(content_rating=None)) is True
    assert access.requires_age_gate(Series(content_rating="   ")) is True
    assert access.requires_age_gate(Series(content_rating="A")) is True
    # A scheme from another market, or a typo: unknown, therefore gated.
    assert access.requires_age_gate(Series(content_rating="R-18")) is True
    assert access.requires_age_gate(Series(content_rating="U")) is False
    assert access.requires_age_gate(Series(content_rating="UA13")) is False


def test_the_episode_price_falls_back_from_episode_to_series_to_the_global_default():
    series = Series(episode_price=40)
    assert access.episode_price(series, Episode(price_override=7)) == 7
    assert access.episode_price(series, Episode(price_override=None)) == 40
    assert access.episode_price(Series(episode_price=None), Episode(price_override=None)) == (
        get_settings().default_episode_price
    )
    # Zero is a real price, not a missing one.
    assert access.episode_price(series, Episode(price_override=0)) == 0


def test_the_free_window_is_a_default_that_an_episode_override_wins_against():
    series = Series(free_episodes=3)
    assert access.episode_is_free(series, Episode(number=3, is_free_override=None)) is True
    assert access.episode_is_free(series, Episode(number=4, is_free_override=None)) is False
    assert access.episode_is_free(series, Episode(number=9, is_free_override=True)) is True
    assert access.episode_is_free(series, Episode(number=1, is_free_override=False)) is False


async def test_vip_is_read_from_the_window_not_from_the_row_existing(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        now = datetime.now(UTC)
        assert await access.is_vip(s, user.id) is False

        expired = VipMembership(
            user_id=user.id, starts_at=now - timedelta(days=40), ends_at=now - timedelta(days=1), source="purchase"
        )
        future = VipMembership(
            user_id=user.id, starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=31), source="admin"
        )
        s.add_all([expired, future])
        await s.flush()
        assert await access.is_vip(s, user.id) is False, "a lapsed or not-yet-started pass counted as VIP"

        s.add(
            VipMembership(
                user_id=user.id, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=29), source="admin"
            )
        )
        await s.flush()
        assert await access.is_vip(s, user.id) is True
        await s.rollback()


async def test_the_daily_ad_allowance_counts_down_from_the_ledger(maker):
    """The cap is published to every client; this is the number the server itself keeps."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()

        cap = await access.ad_unlocks_remaining(s, user.id)
        assert cap == get_settings().default_ad_unlocks_per_day
        assert await access.ad_unlocks_used_today(s, user.id) == 0

        await ledger.post(
            s, user_id=user.id, delta=0, kind=LedgerKind.ad_unlock, idempotency_key=f"ad:{uuid.uuid4().hex}"
        )
        assert await access.ad_unlocks_used_today(s, user.id) == 1
        assert await access.ad_unlocks_remaining(s, user.id) == cap - 1

        # Spent past the cap, the answer is zero rather than a negative number the client would have to clamp.
        for _ in range(cap + 2):
            await ledger.post(
                s, user_id=user.id, delta=0, kind=LedgerKind.ad_unlock, idempotency_key=f"ad:{uuid.uuid4().hex}"
            )
        assert await access.ad_unlocks_remaining(s, user.id) == 0
        await s.rollback()


async def test_the_highest_watchable_episode_follows_free_windows_overrides_and_unlocks(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        series, eps = await _series_with_episodes(s, free_episodes=2, episodes=5)
        await s.flush()
        assert await access.highest_accessible_number(s, user.id, series) == 2
        assert await access.unlocked_episode_ids(s, user.id, series.id) == set()

        s.add(
            EpisodeUnlock(
                user_id=user.id,
                episode_id=eps[2].id,
                series_id=series.id,
                method=UnlockMethod.coins,
                created_at=datetime.now(UTC),
            )
        )
        await s.flush()
        assert await access.unlocked_episode_ids(s, user.id, series.id) == {eps[2].id}
        assert await access.highest_accessible_number(s, user.id, series) == 3

        # A free override on the last episode raises the ceiling without anything in between being unlocked.
        eps[4].is_free_override = True
        await s.flush()
        assert await access.highest_accessible_number(s, user.id, series) == 5
        await s.rollback()


async def test_a_bundle_quote_prices_only_what_is_left_and_rounds_the_discount_down(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        series, eps = await _series_with_episodes(
            s, free_episodes=2, episodes=5, episode_price=33, bundle_discount_pct=30
        )
        await s.flush()

        quote = await access.quote_series_bundle(s, user=user, series=series)
        assert quote.count == 3 and [e.number for e in quote.episodes] == [3, 4, 5]
        assert quote.list_price == 99
        assert quote.price == 69  # 99 * 70 // 100 — rounded down, never above the advertised discount
        assert quote.saving == 30
        assert quote.discount_pct == 30

        # Already-unlocked episodes drop out of the quote.
        s.add(
            EpisodeUnlock(
                user_id=user.id,
                episode_id=eps[2].id,
                series_id=series.id,
                method=UnlockMethod.coins,
                created_at=datetime.now(UTC),
            )
        )
        await s.flush()
        assert (await access.quote_series_bundle(s, user=user, series=series)).count == 2
        await s.rollback()


async def test_a_bundle_discount_outside_the_sane_range_is_clamped(maker):
    """An operator typing 500 must not make the bundle pay the viewer."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        greedy, _ = await _series_with_episodes(
            s, free_episodes=0, episodes=2, episode_price=100, bundle_discount_pct=500
        )
        negative, _ = await _series_with_episodes(
            s, free_episodes=0, episodes=2, episode_price=100, bundle_discount_pct=-20
        )
        default, _ = await _series_with_episodes(
            s, free_episodes=0, episodes=2, episode_price=100, bundle_discount_pct=None
        )
        await s.flush()

        assert (await access.quote_series_bundle(s, user=user, series=greedy)).discount_pct == 90
        assert (await access.quote_series_bundle(s, user=user, series=negative)).discount_pct == 0
        assert (await access.quote_series_bundle(s, user=user, series=default)).discount_pct == (
            get_settings().default_bundle_discount_pct
        )
        await s.rollback()


async def test_episodes_unlock_in_order(maker):
    """Skipping ahead is refused, and the error names the episode to buy instead."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(s, free_episodes=2, episodes=5, episode_price=50)
        await s.commit()

        with pytest.raises(Conflict) as skipped:
            await access.unlock_episode(s, user=user, episode_id=eps[4].id, method=UnlockMethod.coins)
        assert skipped.value.detail["code"] == "sequential_unlock_required"
        assert "episode 3" in skipped.value.detail["message"]

        unlocked = await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        await s.commit()
        assert unlocked.method == UnlockMethod.coins and unlocked.series_id == series.id
        assert (await s.get(User, user.id)).coin_balance == 950

        # With 3 in hand, 4 is now the next one — and 5 is still out of reach.
        with pytest.raises(Conflict):
            await access.unlock_episode(s, user=user, episode_id=eps[4].id, method=UnlockMethod.coins)
        fourth = await access.unlock_episode(s, user=user, episode_id=eps[3].id, method=UnlockMethod.coins)
        await s.commit()
        assert fourth.episode_id == eps[3].id


async def test_unlocking_the_same_episode_twice_charges_once(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        _series, eps = await _series_with_episodes(s, free_episodes=2, episodes=4, episode_price=50)
        await s.commit()

        first = await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        await s.commit()
        second = await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        await s.commit()
        assert second.id == first.id
        assert (await s.get(User, user.id)).coin_balance == 950


async def test_what_is_already_watchable_cannot_be_bought(maker):
    """A free episode and a VIP's whole catalogue are both "already accessible", and both refuse the sale."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        _series, eps = await _series_with_episodes(s, free_episodes=2, episodes=4)
        await s.commit()

        with pytest.raises(Conflict) as free:
            await access.unlock_episode(s, user=user, episode_id=eps[0].id, method=UnlockMethod.coins)
        assert free.value.detail["code"] == "already_accessible"

        now = datetime.now(UTC)
        s.add(
            VipMembership(
                user_id=user.id, starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(days=30), source="admin"
            )
        )
        await s.commit()
        with pytest.raises(Conflict) as vip:
            await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        assert vip.value.detail["code"] == "already_accessible"
        assert (await s.get(User, user.id)).coin_balance == 1000


async def test_an_adult_series_will_not_unlock_before_the_age_gate(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(s, free_episodes=2, episodes=4, rating="A")
        await s.commit()

        with pytest.raises(AgeGateRequired):
            await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        with pytest.raises(AgeGateRequired):
            await access.unlock_series_bundle(s, user=user, series_id=series.id)

        user.age_confirmed_at = datetime.now(UTC)
        await s.commit()
        assert await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.coins)
        await s.commit()


async def test_an_archived_series_is_not_reachable_even_by_id(maker):
    """Pulling a title has to mean pulled. Knowing an episode id is not a licence."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(s, free_episodes=0, episodes=3, status=PublishStatus.archived)
        await s.commit()

        with pytest.raises(NotFound) as one:
            await access.unlock_episode(s, user=user, episode_id=eps[0].id, method=UnlockMethod.coins)
        assert one.value.detail["message"] == "Series not found"

        with pytest.raises(NotFound):
            await access.unlock_series_bundle(s, user=user, series_id=series.id)
        with pytest.raises(NotFound):
            await access.unlock_series_bundle(s, user=user, series_id=uuid.uuid4())


async def test_an_unpublished_episode_is_not_an_episode(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        _series, eps = await _series_with_episodes(s, free_episodes=0, episodes=2, episode_status=PublishStatus.draft)
        await s.commit()

        with pytest.raises(NotFound) as missing:
            await access.unlock_episode(s, user=user, episode_id=eps[0].id, method=UnlockMethod.coins)
        assert missing.value.detail["message"] == "Episode not found"
        with pytest.raises(NotFound):
            await access.unlock_episode(s, user=user, episode_id=uuid.uuid4(), method=UnlockMethod.coins)


async def test_an_ad_unlock_needs_a_verified_completion_and_respects_the_daily_cap(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        _series, eps = await _series_with_episodes(s, free_episodes=2, episodes=5)
        await s.commit()

        # No event id at all: the client is asking to unlock for nothing.
        with pytest.raises(Conflict) as bare:
            await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.ad)
        assert bare.value.detail["code"] == "ad_event_required"

        # An id the ad network never reported.
        with pytest.raises(Conflict) as unknown:
            await access.unlock_episode(
                s, user=user, episode_id=eps[2].id, method=UnlockMethod.ad, ad_event_id="never-happened"
            )
        assert unknown.value.detail["code"] == "ad_event_invalid"

        # A real server-side-verified completion does unlock, once.
        txn = f"ssv-{uuid.uuid4().hex}"
        s.add(
            AdEvent(
                user_id=user.id, network="admob", ssv_transaction_id=txn, purpose="unlock", created_at=datetime.now(UTC)
            )
        )
        await s.commit()
        unlock = await access.unlock_episode(
            s, user=user, episode_id=eps[2].id, method=UnlockMethod.ad, ad_event_id=txn
        )
        await s.commit()
        assert unlock.method == UnlockMethod.ad
        event = await s.scalar(select(AdEvent).where(AdEvent.ssv_transaction_id == txn))
        assert event.consumed_at is not None, "the completion was not spent and could be replayed"
        assert (await s.get(User, user.id)).coin_balance == 0  # ad unlocks cost no coins


async def test_the_daily_ad_cap_is_enforced_and_not_merely_published(maker):
    """An uncapped ad unlock gives away the catalogue to anyone willing to watch adverts."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        _series, eps = await _series_with_episodes(s, free_episodes=2, episodes=5)
        for _ in range(await access.ad_unlocks_remaining(s, user.id)):
            await ledger.post(
                s, user_id=user.id, delta=0, kind=LedgerKind.ad_unlock, idempotency_key=f"ad:{uuid.uuid4().hex}"
            )
        await s.commit()

        txn = f"ssv-{uuid.uuid4().hex}"
        s.add(
            AdEvent(
                user_id=user.id, network="admob", ssv_transaction_id=txn, purpose="unlock", created_at=datetime.now(UTC)
            )
        )
        await s.commit()

        with pytest.raises(Conflict) as capped:
            await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.ad, ad_event_id=txn)
        assert capped.value.detail["code"] == "ad_unlock_limit_reached"
        # The cap is checked before the completion is spent, so the viewer keeps it for tomorrow.
        await s.rollback()
        event = await s.scalar(select(AdEvent).where(AdEvent.ssv_transaction_id == txn))
        assert event.consumed_at is None


async def test_an_unsupported_unlock_method_is_refused(maker):
    """`vip`, `free` and `admin` describe how an unlock came about; none of them is something to ask for."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        _series, eps = await _series_with_episodes(s, free_episodes=2, episodes=4)
        await s.commit()

        with pytest.raises(Conflict) as bad:
            await access.unlock_episode(s, user=user, episode_id=eps[2].id, method=UnlockMethod.vip)
        assert bad.value.detail["code"] == "bad_method"


async def test_the_bundle_buys_the_rest_of_the_series_and_ignores_the_sequential_rule(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(
            s, free_episodes=1, episodes=5, episode_price=100, bundle_discount_pct=30
        )
        await s.commit()

        unlocks = await access.unlock_series_bundle(s, user=user, series_id=series.id)
        await s.commit()
        assert {u.episode_id for u in unlocks} == {e.id for e in eps[1:]}
        # 4 x 100, less 30%: one charge, not four.
        assert (await s.get(User, user.id)).coin_balance == 720
        assert await access.highest_accessible_number(s, user.id, series) == 5

        # Nothing left to sell.
        with pytest.raises(Conflict) as done:
            await access.unlock_series_bundle(s, user=user, series_id=series.id)
        assert done.value.detail["code"] == "already_accessible"


async def test_a_vip_is_not_sold_a_bundle_they_already_have(maker):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, _eps = await _series_with_episodes(s, free_episodes=1, episodes=4, episode_price=100)
        now = datetime.now(UTC)
        s.add(
            VipMembership(
                user_id=user.id,
                starts_at=now - timedelta(minutes=1),
                ends_at=now + timedelta(days=30),
                source="purchase",
            )
        )
        await s.commit()

        with pytest.raises(Conflict) as vip:
            await access.unlock_series_bundle(s, user=user, series_id=series.id)
        assert vip.value.detail["code"] == "already_accessible"
        assert (await s.get(User, user.id)).coin_balance == 1000


async def test_a_double_tap_on_unlock_returns_the_row_the_other_request_wrote(maker, monkeypatch):
    """Two taps race past the `existing` check; the second meets the unique index and must not 500.

    The race is produced deterministically by having the (real) ledger post be followed by a second
    connection inserting the same unlock and committing — which is exactly where the losing request sits when
    it flushes. Idempotent means the second tap gets the first tap's answer, not a conflict.
    """
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(s, free_episodes=2, episodes=4, episode_price=50)
        await s.commit()
        target = eps[2]

        real_post = access.ledger.post

        async def post_then_race(session, **kw):
            row = await real_post(session, **kw)
            async with maker() as other:
                other.add(
                    EpisodeUnlock(
                        user_id=user.id,
                        episode_id=target.id,
                        series_id=series.id,
                        method=UnlockMethod.admin,
                        created_at=datetime.now(UTC),
                    )
                )
                await other.commit()
            return row

        monkeypatch.setattr(access.ledger, "post", post_then_race)
        unlock = await access.unlock_episode(s, user=user, episode_id=target.id, method=UnlockMethod.coins)
        await s.commit()

    # The winner's row is handed back — the losing request's own insert never landed.
    assert unlock.episode_id == target.id
    assert unlock.method == UnlockMethod.admin


async def test_a_double_tap_on_the_bundle_returns_the_winners_unlocks(maker, monkeypatch):
    """Same race, one transaction larger: the ledger charge was idempotent, so the viewer paid once."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        await _credit(s, user.id, 1000)
        series, eps = await _series_with_episodes(
            s, free_episodes=1, episodes=4, episode_price=100, bundle_discount_pct=0
        )
        await s.commit()

        real_post = access.ledger.post

        async def post_then_race(session, **kw):
            row = await real_post(session, **kw)
            async with maker() as other:
                other.add_all(
                    [
                        EpisodeUnlock(
                            user_id=user.id,
                            episode_id=ep.id,
                            series_id=series.id,
                            method=UnlockMethod.admin,
                            created_at=datetime.now(UTC),
                        )
                        for ep in eps[1:]
                    ]
                )
                await other.commit()
            return row

        monkeypatch.setattr(access.ledger, "post", post_then_race)
        unlocks = await access.unlock_series_bundle(s, user=user, series_id=series.id)
        await s.commit()
        balance = (await s.get(User, user.id)).coin_balance

    assert {u.episode_id for u in unlocks} == {e.id for e in eps[1:]}
    assert all(u.method == UnlockMethod.admin for u in unlocks)
    assert balance == 700, "the bundle was charged twice for one set of episodes"


# --------------------------------------------------------------------------------------------------
# /v1/admin/users — the support console
# --------------------------------------------------------------------------------------------------


@pytest.fixture
async def admins(maker):
    """One account per role that matters to these routes."""
    async with maker() as s:
        rows = {
            "owner": await _admin_row(s, AdminRole.owner),
            "support": await _admin_row(s, AdminRole.support),
            "finance": await _admin_row(s, AdminRole.finance),
            "editor": await _admin_row(s, AdminRole.editor),
        }
        await s.commit()
    return rows


async def test_the_accounts_list_searches_and_counts_the_whole_match_not_the_page(admin_as, maker, admins):
    tag = uuid.uuid4().hex[:10]
    async with maker() as s:
        a = _new_user(display_name=f"Zoya {tag}", email=f"a-{tag}@katha-test.dev")
        b = _new_user(display_name=f"Anil {tag}", email=f"b-{tag}@katha-test.dev", status=UserStatus.banned)
        s.add_all([a, b])
        await s.commit()

    client = admin_as(admins["support"])
    hit = await client.get(f"/v1/admin/users?q={tag}")
    assert hit.status_code == 200
    page = hit.json()
    assert page["total"] == 2
    assert {row["id"] for row in page["items"]} == {str(a.id), str(b.id)}

    # The public id is matched exactly, not as a substring.
    by_id = await client.get(f"/v1/admin/users?q={a.public_id}")
    assert [row["id"] for row in by_id.json()["items"]] == [str(a.id)]

    banned = await client.get(f"/v1/admin/users?q={tag}&status=banned")
    assert [row["id"] for row in banned.json()["items"]] == [str(b.id)]

    # `limit` bounds the page; `total` still describes the match.
    paged = await client.get(f"/v1/admin/users?q={tag}&limit=1")
    assert len(paged.json()["items"]) == 1 and paged.json()["total"] == 2


async def test_sorting_is_case_insensitive_and_puts_nameless_accounts_last_either_way(admin_as, maker, admins):
    """An account with no name belongs at the end of the list whichever way it is sorted."""
    tag = uuid.uuid4().hex[:10]
    async with maker() as s:
        alpha = _new_user(display_name=f"alpha {tag}", email=f"1-{tag}@katha-test.dev")
        beta = _new_user(display_name=f"Beta {tag}", email=f"2-{tag}@katha-test.dev")
        nameless = _new_user(email=f"3-{tag}@katha-test.dev")
        s.add_all([alpha, beta, nameless])
        await s.commit()

    client = admin_as(admins["owner"])
    asc = await client.get(f"/v1/admin/users?q={tag}&sort=display_name&order=asc")
    assert [row["id"] for row in asc.json()["items"]] == [str(alpha.id), str(beta.id), str(nameless.id)]

    desc = await client.get(f"/v1/admin/users?q={tag}&sort=display_name&order=desc")
    assert [row["id"] for row in desc.json()["items"]] == [str(beta.id), str(alpha.id), str(nameless.id)]


async def test_a_wildcard_in_the_search_box_is_read_literally(admin_as, maker, admins):
    """`%` used to match every row, which is a way to turn a bounded search into a full scan on demand."""
    tag = uuid.uuid4().hex[:10]
    async with maker() as s:
        literal = _new_user(display_name=f"100% {tag}")
        plain = _new_user(display_name=f"ordinary {tag}")
        s.add_all([literal, plain])
        await s.commit()

    client = admin_as(admins["support"])
    hit = await client.get(f"/v1/admin/users?q=100%25 {tag}")
    assert [row["id"] for row in hit.json()["items"]] == [str(literal.id)]


async def test_an_editor_has_no_business_in_the_accounts_console(admin_as, admins):
    """The router is gated on support or finance; owner passes everything, editor passes nothing here."""
    r = await admin_as(admins["editor"]).get("/v1/admin/users?limit=1")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


async def test_banning_an_account_signs_every_device_out(admin_as, maker, admins):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.flush()
        token, _r, row = await users_svc.issue_session(
            s, user, platform=Platform.android, device_id="d1", device_name="Pixel", app_version=None, ip=None
        )
        await s.commit()
        session_id = row.id

    client = admin_as(admins["support"])
    banned = await client.put(f"/v1/admin/users/{user.id}/status", json={"status": "banned"})
    assert banned.status_code == 200 and banned.json()["status"] == "banned"
    async with maker() as s:
        assert (await s.get(Session, session_id)).revoked_at is not None
        logged = await s.scalar(
            select(AuditLog).where(AuditLog.action == "user.status", AuditLog.target_id == str(user.id))
        )
        assert logged is not None and logged.after == {"status": "banned"}

    # The token dies with the ban.
    assert (await client.get("/v1/auth/me", headers=_auth(token))).status_code == 403

    # Unbanning restores the account but not the devices — signing back in is the point.
    restored = await client.put(f"/v1/admin/users/{user.id}/status", json={"status": "active"})
    assert restored.status_code == 200 and restored.json()["status"] == "active"
    async with maker() as s:
        assert (await s.get(Session, session_id)).revoked_at is not None


async def test_status_is_not_a_back_door_into_deletion_or_out_of_it(admin_as, maker, admins):
    """Deleting by hand would leave the PII behind, and a deleted account cannot sign in again anyway."""
    async with maker() as s:
        alive = _new_user()
        gone = _new_user(status=UserStatus.deleted)
        s.add_all([alive, gone])
        await s.commit()

    client = admin_as(admins["support"])
    by_hand = await client.put(f"/v1/admin/users/{alive.id}/status", json={"status": "deleted"})
    assert by_hand.status_code == 409 and by_hand.json()["detail"]["code"] == "use_delete"

    revive = await client.put(f"/v1/admin/users/{gone.id}/status", json={"status": "active"})
    assert revive.status_code == 409 and revive.json()["detail"]["code"] == "user_deleted"

    assert (await client.put(f"/v1/admin/users/{uuid.uuid4()}/status", json={"status": "banned"})).status_code == 404


async def test_only_finance_moves_coins_and_the_move_is_recorded(admin_as, maker, admins):
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.commit()

    refused = await admin_as(admins["support"]).post(
        f"/v1/admin/users/{user.id}/coins", json={"delta": 100, "note": "goodwill"}
    )
    assert refused.status_code == 403

    client = admin_as(admins["finance"])
    credited = await client.post(f"/v1/admin/users/{user.id}/coins", json={"delta": 250, "note": "goodwill credit"})
    assert credited.status_code == 200 and credited.json()["coin_balance"] == 250

    debited = await client.post(f"/v1/admin/users/{user.id}/coins", json={"delta": -50, "note": "reversal"})
    assert debited.json()["coin_balance"] == 200

    # Zero is not an adjustment, and a note is required: an unexplained balance change is not auditable.
    assert (
        await client.post(f"/v1/admin/users/{user.id}/coins", json={"delta": 0, "note": "nothing"})
    ).status_code == 422
    assert (await client.post(f"/v1/admin/users/{user.id}/coins", json={"delta": 5, "note": "x"})).status_code == 422

    ledger_rows = await client.get(f"/v1/admin/users/{user.id}/ledger?limit=10")
    assert ledger_rows.status_code == 200
    kinds = [row["kind"] for row in ledger_rows.json()]
    assert kinds == ["admin_adjust", "admin_adjust"]
    assert ledger_rows.json()[0]["balance_after"] == 200

    async with maker() as s:
        recorded = (
            await s.scalars(select(AuditLog).where(AuditLog.action == "user.coins", AuditLog.target_id == str(user.id)))
        ).all()
        assert len(recorded) == 2
        assert {r.note for r in recorded} == {"goodwill credit", "reversal"}


async def test_a_second_vip_grant_stacks_onto_the_active_pass_and_the_drawer_shows_the_new_end(admin_as, maker, admins):
    """Granting blind is what the drawer's VIP field exists to prevent; the number it shows must be the new one."""
    async with maker() as s:
        user = _new_user()
        s.add(user)
        await s.commit()

    refused = await admin_as(admins["support"]).post(f"/v1/admin/users/{user.id}/vip", json={"days": 30})
    assert refused.status_code == 403

    client = admin_as(admins["finance"])
    assert (await client.post(f"/v1/admin/users/{uuid.uuid4()}/vip", json={"days": 30})).status_code == 404

    before = datetime.now(UTC)
    assert (await client.post(f"/v1/admin/users/{user.id}/vip", json={"days": 30})).status_code == 200
    first = await admin_as(admins["owner"]).get(f"/v1/admin/users/{user.id}")
    assert first.json()["is_vip"] is True
    ends_after_one = datetime.fromisoformat(first.json()["vip_ends_at"])
    assert timedelta(days=29, hours=23) < ends_after_one - before < timedelta(days=30, minutes=5)

    assert (await client.post(f"/v1/admin/users/{user.id}/vip", json={"days": 15})).status_code == 200
    second = await admin_as(admins["owner"]).get(f"/v1/admin/users/{user.id}")
    ends_after_two = datetime.fromisoformat(second.json()["vip_ends_at"])
    assert ends_after_two - ends_after_one == timedelta(days=15), (
        "the second grant replaced the pass instead of extending it"
    )

    async with maker() as s:
        rows = (await s.scalars(select(VipMembership).where(VipMembership.user_id == user.id))).all()
        assert len(rows) == 2 and all(r.source == "admin" for r in rows)
        # The stacked grant starts where the live one ends, so the two never overlap.
        assert sorted(r.starts_at for r in rows)[1] == sorted(r.ends_at for r in rows)[0]


async def test_the_support_drawer_answers_i_paid_and_got_no_coins_in_one_call(admin_as, maker, admins):
    async with maker() as s:
        user = _new_user(display_name="Payer")
        pack = CoinPack(sku=f"pack-{uuid.uuid4().hex[:10]}", name="Mega Pack", kind=PackKind.coins, coins=500)
        s.add_all([user, pack])
        await s.flush()
        s.add(
            Purchase(
                user_id=user.id,
                pack_id=pack.id,
                gateway="razorpay",
                status=PurchaseStatus.paid,
                currency="INR",
                amount=499.00,
                coins_granted=500,
                gateway_payment_id="pay_test_1",
                paid_at=datetime.now(UTC),
            )
        )
        # One live device, one signed out, one expired: only the first counts.
        await users_svc.issue_session(
            s, user, platform=Platform.android, device_id="d1", device_name="Live", app_version=None, ip=None
        )
        _a, _r, dead = await users_svc.issue_session(
            s, user, platform=Platform.web, device_id="d2", device_name="Signed out", app_version=None, ip=None
        )
        dead.revoked_at = datetime.now(UTC)
        _a2, _r2, stale = await users_svc.issue_session(
            s, user, platform=Platform.ios, device_id="d3", device_name="Expired", app_version=None, ip=None
        )
        stale.expires_at = datetime.now(UTC) - timedelta(days=1)
        await s.commit()

    client = admin_as(admins["support"])
    r = await client.get(f"/v1/admin/users/{user.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Payer"
    assert body["sessions"] == 1
    assert body["is_vip"] is False and body["vip_ends_at"] is None
    assert len(body["purchases"]) == 1
    purchase = body["purchases"][0]
    assert purchase["pack_name"] == "Mega Pack"
    assert purchase["status"] == "paid" and purchase["coins_granted"] == 500
    assert purchase["amount"] == 499.0 and purchase["gateway_payment_id"] == "pay_test_1"

    assert (await client.get(f"/v1/admin/users/{uuid.uuid4()}")).status_code == 404


async def test_only_an_owner_may_erase_a_person_and_erasing_leaves_nothing_personal_behind(admin_as, maker, admins):
    async with maker() as s:
        user = _new_user(
            display_name="Erase Me",
            email=f"del-{uuid.uuid4().hex[:8]}@katha-test.dev",
            avatar_url="https://cdn.example/x.png",
            notification_prefs={"new_episode": True},
        )
        s.add(user)
        await s.flush()
        s.add(AuthIdentity(user_id=user.id, provider="firebase", provider_uid=f"fb-{uuid.uuid4().hex}"))
        _a, _r, row = await users_svc.issue_session(
            s,
            user,
            platform=Platform.android,
            device_id="dev-9",
            device_name="Pixel 8",
            app_version="1.0",
            ip="10.0.0.4",
        )
        row.push_token = "ExponentPushToken[zzzzzzzzzzzz]"
        await _credit(s, user.id, 300)
        await s.commit()
        session_id = row.id

    refused = await admin_as(admins["finance"]).delete(f"/v1/admin/users/{user.id}")
    assert refused.status_code == 403

    client = admin_as(admins["owner"])
    assert (await client.delete(f"/v1/admin/users/{uuid.uuid4()}")).status_code == 404
    assert (await client.delete(f"/v1/admin/users/{user.id}")).status_code == 200

    async with maker() as s:
        row = await s.get(User, user.id)
        assert row.status == UserStatus.deleted
        assert (row.email, row.display_name, row.avatar_url, row.notification_prefs) == (None, None, None, None)
        # The referral code is a handle that may have been shared publicly, so it goes too.
        assert row.referral_code is None
        assert row.coin_balance == 300, "finance still needs the ledger to reconcile"
        assert (await s.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user.id))).all() == []
        device = await s.get(Session, session_id)
        assert device.revoked_at is not None
        assert (device.ip, device.push_token, device.device_name, device.device_id) == (None, None, None, None)
        assert (
            await s.scalar(select(AuditLog).where(AuditLog.action == "user.delete", AuditLog.target_id == str(user.id)))
            is not None
        )


# --------------------------------------------------------------------------------------------------
# /v1/admin/accounts — admin accounts, owner only
# --------------------------------------------------------------------------------------------------


async def test_the_admin_account_list_is_owner_only_and_shows_who_has_a_second_factor(admin_as, maker, admins):
    async with maker() as s:
        enrolled = await _admin_row(s, AdminRole.editor, totp_secret="JBSWY3DPEHPK3PXP")
        await s.commit()

    assert (await admin_as(admins["support"]).get("/v1/admin/accounts")).status_code == 403

    r = await admin_as(admins["owner"]).get("/v1/admin/accounts")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[str(enrolled.id)]["totp_enabled"] is True
    assert rows[str(admins["support"].id)]["totp_enabled"] is False
    # The secret itself is never in the response.
    assert "totp_secret" not in rows[str(enrolled.id)]


async def test_creating_an_admin_hashes_the_password_and_refuses_a_duplicate_email(admin_as, maker, admins):
    email = f"new-{uuid.uuid4().hex[:10]}@katha-test.dev"
    body = {
        "email": email.upper(),
        "display_name": "New Editor",
        "password": "a-long-enough-password",
        "role": "editor",
    }

    assert (await admin_as(admins["finance"]).post("/v1/admin/accounts", json=body)).status_code == 403

    client = admin_as(admins["owner"])
    created = await client.post("/v1/admin/accounts", json=body)
    assert created.status_code == 201
    assert created.json()["email"] == email.lower()  # the address is an identity key, stored one way
    assert created.json()["role"] == "editor" and created.json()["is_active"] is True

    async with maker() as s:
        row = await s.get(AdminUser, uuid.UUID(created.json()["id"]))
        assert row.password_hash != "a-long-enough-password"
        assert await asyncio.to_thread(verify_password, "a-long-enough-password", row.password_hash)

    dup = await client.post("/v1/admin/accounts", json={**body, "email": email})
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "email_taken"

    # A short password is refused before it ever reaches the database.
    assert (
        await client.post("/v1/admin/accounts", json={**body, "email": f"x-{email}", "password": "short"})
    ).status_code == 422


async def test_revoking_an_accounts_sessions_bumps_its_token_version(admin_as, maker, admins):
    """Admin tokens are stateless and last eight hours; the version is the only way to end one early."""
    async with maker() as s:
        victim = await _admin_row(s, AdminRole.support)
        await s.commit()
        before = victim.token_version

    client = admin_as(admins["owner"])
    r = await client.post(f"/v1/admin/accounts/{victim.id}/revoke-sessions")
    assert r.status_code == 200 and r.json()["id"] == str(victim.id)
    async with maker() as s:
        assert (await s.get(AdminUser, victim.id)).token_version == before + 1

    assert (await client.post(f"/v1/admin/accounts/{uuid.uuid4()}/revoke-sessions")).status_code == 404
    assert (
        await admin_as(admins["support"]).post(f"/v1/admin/accounts/{victim.id}/revoke-sessions")
    ).status_code == 403


async def test_editing_an_account_records_the_privilege_change_and_a_password_ends_its_sessions(
    admin_as, maker, admins
):
    async with maker() as s:
        target = await _admin_row(s, AdminRole.support, display_name="Before")
        await s.commit()
        version = target.token_version

    client = admin_as(admins["owner"])
    renamed = await client.put(f"/v1/admin/accounts/{target.id}", json={"display_name": "After"})
    assert renamed.status_code == 200 and renamed.json()["display_name"] == "After"

    promoted = await client.put(f"/v1/admin/accounts/{target.id}", json={"role": "finance", "is_active": False})
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "finance" and promoted.json()["is_active"] is False

    # Re-sending the same role is not a change and must not fabricate an audit row.
    assert (await client.put(f"/v1/admin/accounts/{target.id}", json={"role": "finance"})).status_code == 200

    changed = await client.put(f"/v1/admin/accounts/{target.id}", json={"password": "a-brand-new-password"})
    assert changed.status_code == 200
    async with maker() as s:
        row = await s.get(AdminUser, target.id)
        assert await asyncio.to_thread(verify_password, "a-brand-new-password", row.password_hash)
        assert row.token_version == version + 1, "a changed password left every existing token alive"
        actions = [
            a.action
            for a in (
                await s.scalars(
                    select(AuditLog).where(AuditLog.target_id == str(target.id)).order_by(AuditLog.created_at)
                )
            ).all()
        ]
    assert actions.count("admin.role") == 1
    assert actions.count("admin.deactivate") == 1
    assert actions.count("admin.password_reset") == 1

    assert (await client.put(f"/v1/admin/accounts/{uuid.uuid4()}", json={"display_name": "x"})).status_code == 404


async def test_an_owner_cannot_demote_or_disable_themselves(admin_as, maker, admins):
    """The last owner locking themselves out of the console is not a recoverable mistake."""
    owner = admins["owner"]
    client = admin_as(owner)

    r = await client.put(
        f"/v1/admin/accounts/{owner.id}",
        json={"role": "support", "is_active": False, "display_name": "Still The Owner"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "owner" and r.json()["is_active"] is True
    assert r.json()["display_name"] == "Still The Owner"  # the harmless part of the edit still applies

    assert (await client.delete(f"/v1/admin/accounts/{owner.id}")).status_code == 404
    async with maker() as s:
        assert (await s.get(AdminUser, owner.id)).is_active is True


async def test_disabling_an_account_is_a_soft_delete_that_keeps_the_record(admin_as, maker, admins):
    async with maker() as s:
        target = await _admin_row(s, AdminRole.editor)
        await s.commit()

    client = admin_as(admins["owner"])
    assert (await client.delete(f"/v1/admin/accounts/{uuid.uuid4()}")).status_code == 404
    r = await client.delete(f"/v1/admin/accounts/{target.id}")
    assert r.status_code == 200 and r.json() == {"ok": True}

    async with maker() as s:
        row = await s.get(AdminUser, target.id)
        assert row is not None and row.is_active is False
        assert (
            await s.scalar(
                select(AuditLog).where(AuditLog.action == "admin.deactivate", AuditLog.target_id == str(target.id))
            )
            is not None
        )

    listed = await client.get("/v1/admin/accounts")
    assert any(row["id"] == str(target.id) and row["is_active"] is False for row in listed.json())
