"""User onboarding from a Firebase identity, referral linking, and session issuance with reuse detection."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.firebase import FirebaseIdentity
from app.core.security import mint_token, new_opaque_token
from app.models.identity import AuthIdentity, Platform, Session, User, UserStatus
from app.models.wallet import LedgerKind, Referral
from app.services import config as config_svc
from app.services import ledger

_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_ID_ATTEMPTS = 5


def _public_id() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(8))


def _referral_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _insert_user(session: AsyncSession, **fields) -> User:
    """Random public ids and referral codes can collide; retry inside a savepoint instead of failing the request."""
    last: IntegrityError | None = None
    for _ in range(_ID_ATTEMPTS):
        user = User(public_id=_public_id(), referral_code=_referral_code(), **fields)
        try:
            async with session.begin_nested():
                session.add(user)
                await session.flush()
            return user
        except IntegrityError as exc:
            last = exc
            if "public_id" not in str(exc.orig) and "referral_code" not in str(exc.orig):
                raise
    raise last  # type: ignore[misc]


async def get_or_create_from_firebase(
    session: AsyncSession, ident: FirebaseIdentity, *, locale: str = "en", referral_code: str | None = None
) -> tuple[User, bool]:
    identity = await session.scalar(
        select(AuthIdentity).where(AuthIdentity.provider == "firebase", AuthIdentity.provider_uid == ident.uid)
    )
    if identity is not None:
        user = await session.get(User, identity.user_id)
        assert user is not None
        return user, False

    # Same verified email or phone on an existing account (phone first, Google later): link, do not duplicate.
    existing = None
    if ident.email:
        existing = await session.scalar(
            select(User).where(User.email == ident.email.lower(), User.status != UserStatus.deleted)
        )
    if existing is None and ident.phone:
        existing = await session.scalar(
            select(User).where(User.phone == ident.phone, User.status != UserStatus.deleted)
        )
    if existing is not None:
        session.add(
            AuthIdentity(
                user_id=existing.id,
                provider="firebase",
                provider_uid=ident.uid,
                raw={"sign_in_provider": ident.provider, "linked": True},
            )
        )
        return existing, False

    user = await _insert_user(
        session,
        display_name=ident.name,
        email=ident.email.lower() if ident.email else None,
        phone=ident.phone,
        avatar_url=ident.picture,
        locale=locale,
    )
    session.add(
        AuthIdentity(
            user_id=user.id, provider="firebase", provider_uid=ident.uid, raw={"sign_in_provider": ident.provider}
        )
    )
    if referral_code:
        referrer = await session.scalar(
            select(User).where(User.referral_code == referral_code.strip().upper(), User.id != user.id)
        )
        if referrer is not None:
            user.referred_by_id = referrer.id
            session.add(
                Referral(
                    referrer_id=referrer.id,
                    referee_id=user.id,
                    code=referrer.referral_code or "",
                    created_at=datetime.now(UTC),
                )
            )
            # The referee is paid immediately. The referrer's half waits for a real purchase (see payments.py);
            # paying both sides at signup would make throwaway accounts profitable.
            welcome = await config_svc.referee_reward_coins(session)
            if welcome > 0:
                await ledger.post(
                    session,
                    user_id=user.id,
                    delta=welcome,
                    kind=LedgerKind.referral,
                    idempotency_key=f"referral-welcome:{user.id}",
                    ref_type="user",
                    ref_id=str(referrer.id),
                    note="Invited by a friend",
                )
    bonus = get_settings().default_signup_bonus
    if bonus > 0:
        await ledger.post(
            session,
            user_id=user.id,
            delta=bonus,
            kind=LedgerKind.signup_bonus,
            idempotency_key=f"signup:{user.id}",
            note="Welcome bonus",
        )
    return user, True


async def issue_session(
    session: AsyncSession,
    user: User,
    *,
    platform: Platform,
    device_id: str | None,
    device_name: str | None,
    app_version: str | None,
    ip: str | None,
) -> tuple[str, str, Session]:
    """Returns (access_token, refresh_token, session_row)."""
    s = get_settings()
    refresh = new_opaque_token()
    now = datetime.now(UTC)
    row = Session(
        user_id=user.id,
        device_id=device_id,
        platform=platform,
        device_name=device_name,
        app_version=app_version,
        refresh_token_hash=hash_refresh(refresh),
        ip=ip,
        last_seen_at=now,
        expires_at=now + timedelta(seconds=s.refresh_token_ttl_seconds),
    )
    session.add(row)
    user.last_seen_at = now
    await session.flush()
    access = mint_token(str(user.id), "access", session_id=str(row.id))
    return access, refresh, row


async def rotate_refresh(session: AsyncSession, refresh_token: str) -> tuple[str, str, Session] | None:
    """Rotate the refresh token. Presenting an already-rotated token revokes the whole session (theft signal)."""
    h = hash_refresh(refresh_token)
    now = datetime.now(UTC)
    reused = await session.scalar(select(Session).where(Session.previous_token_hash == h).with_for_update())
    if reused is not None:
        reused.revoked_at = now
        return None
    row = await session.scalar(select(Session).where(Session.refresh_token_hash == h).with_for_update())
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        return None
    user = await session.get(User, row.user_id)
    if user is None or user.status != UserStatus.active:
        return None
    new_refresh = new_opaque_token()
    row.previous_token_hash = row.refresh_token_hash
    row.refresh_token_hash = hash_refresh(new_refresh)
    row.last_seen_at = now
    row.expires_at = now + timedelta(seconds=get_settings().refresh_token_ttl_seconds)
    if user.last_seen_at is None or now - user.last_seen_at > timedelta(minutes=10):
        user.last_seen_at = now
    access = mint_token(str(user.id), "access", session_id=str(row.id))
    return access, new_refresh, row


async def revoke_session(session: AsyncSession, session_id: uuid.UUID) -> None:
    row = await session.get(Session, session_id)
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
