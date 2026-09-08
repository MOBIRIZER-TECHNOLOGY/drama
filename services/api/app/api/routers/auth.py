import asyncio
import uuid

from fastapi import APIRouter, Request
from firebase_admin import auth as fb_auth
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, client_ip
from app.core.config import get_settings
from app.core.errors import Conflict, Unauthorized
from app.core.firebase import verify_id_token
from app.core.ratelimit import limiter
from app.models.identity import Session
from app.schemas.auth import (
    ExchangeRequest,
    PushTokenIn,
    RefreshRequest,
    SessionOut,
    TokenPair,
    UpdateMe,
    UserOut,
)
from app.schemas.common import Ok
from app.services import push, storage
from app.services import users as users_svc
from app.services.access import ad_unlocks_remaining, is_vip

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/exchange", response_model=TokenPair)
@limiter.limit("20/minute")
async def exchange(request: Request, body: ExchangeRequest, db: DB) -> TokenPair:
    """Verify a Firebase ID token and issue Katha access + refresh tokens for this device."""
    try:
        ident = await asyncio.to_thread(verify_id_token, body.firebase_id_token)
    except (fb_auth.InvalidIdTokenError, fb_auth.ExpiredIdTokenError, ValueError) as exc:
        raise Unauthorized("Firebase token rejected") from exc

    user, created = await users_svc.get_or_create_from_firebase(
        db, ident, locale=body.locale, referral_code=body.referral_code
    )
    access, refresh, _ = await users_svc.issue_session(
        db,
        user,
        platform=body.platform,
        device_id=body.device_id,
        device_name=body.device_name,
        app_version=body.app_version,
        ip=client_ip(request),
    )
    await db.commit()
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=get_settings().access_token_ttl_seconds,
        is_new_user=created,
    )


@router.post("/refresh", response_model=TokenPair)
@limiter.limit("60/minute")
async def refresh(request: Request, body: RefreshRequest, db: DB) -> TokenPair:
    result = await users_svc.rotate_refresh(db, body.refresh_token)
    if result is None:
        raise Unauthorized("Refresh token rejected")
    access, new_refresh, _ = result
    await db.commit()
    return TokenPair(
        access_token=access,
        refresh_token=new_refresh,
        expires_in=get_settings().access_token_ttl_seconds,
    )


@router.post("/logout", response_model=Ok)
async def logout(ctx: CurrentUser, db: DB) -> Ok:
    if ctx.session_id is not None:
        await users_svc.revoke_session(db, ctx.session_id)
        await db.commit()
    return Ok()


async def _user_out(db, user) -> UserOut:
    out = UserOut.model_validate(user)
    out.is_vip = await is_vip(db, user.id)
    out.ad_unlocks_remaining = await ad_unlocks_remaining(db, user.id)
    return out


@router.get("/me", response_model=UserOut)
async def me(ctx: CurrentUser, db: DB) -> UserOut:
    return await _user_out(db, ctx.user)


@router.patch("/me", response_model=UserOut)
async def update_me(body: UpdateMe, ctx: CurrentUser, db: DB) -> UserOut:
    data = body.model_dump(exclude_unset=True)
    if data.pop("age_confirmed", None):
        from datetime import UTC, datetime

        ctx.user.age_confirmed_at = ctx.user.age_confirmed_at or datetime.now(UTC)
    for field, value in data.items():
        setattr(ctx.user, field, value)
    await db.commit()
    await db.refresh(ctx.user)
    return await _user_out(db, ctx.user)


@router.put("/me/push-token", response_model=Ok)
async def set_push_token(body: PushTokenIn, ctx: CurrentUser, db: DB) -> Ok:
    """Attach this device's push token to the current session.

    The token lives on the session, not the user, so signing out or revoking a device stops delivery to it with
    no extra bookkeeping. The same physical device re-registering on a new session simply writes a new row; the
    old one is either revoked or expires, and `push.tokens_for` de-duplicates whatever overlap remains.
    """
    if ctx.session_id is None:
        raise Unauthorized("This session cannot receive push")
    if not push.is_expo_token(body.token):
        raise Conflict("Not an Expo push token", code="bad_push_token")
    session_row = await db.get(Session, ctx.session_id)
    if session_row is None or session_row.revoked_at is not None:
        raise Unauthorized("This session cannot receive push")
    session_row.push_token = body.token
    await db.commit()
    return Ok()


@router.delete("/me/push-token", response_model=Ok)
async def clear_push_token(ctx: CurrentUser, db: DB) -> Ok:
    """Stop delivery to this device without signing out — what a notifications toggle in settings calls."""
    if ctx.session_id is not None:
        session_row = await db.get(Session, ctx.session_id)
        if session_row is not None:
            session_row.push_token = None
            await db.commit()
    return Ok()


class AvatarPresignIn(BaseModel):
    filename: str = Field(max_length=255)
    content_type: str = Field(pattern="^image/(jpeg|png|webp)$")


class AvatarPresignOut(BaseModel):
    upload_url: str
    public_url: str


@router.post("/me/avatar/presign", response_model=AvatarPresignOut)
async def avatar_presign(body: AvatarPresignIn, ctx: CurrentUser) -> AvatarPresignOut:
    """Presigned PUT for a user avatar; the client then PATCHes avatar_url with public_url."""
    key = storage.object_key(f"avatars/{ctx.user.id}", body.filename)
    url = await asyncio.to_thread(storage.presign_put, key, body.content_type)
    return AvatarPresignOut(upload_url=url, public_url=storage.public_url(key))


@router.get("/sessions", response_model=list[SessionOut])
async def sessions(ctx: CurrentUser, db: DB) -> list[SessionOut]:
    rows = await db.scalars(
        select(Session)
        .where(Session.user_id == ctx.user.id, Session.revoked_at.is_(None))
        .order_by(Session.last_seen_at.desc())
    )
    out = []
    for row in rows.all():
        item = SessionOut.model_validate(row)
        item.current = row.id == ctx.session_id
        out.append(item)
    return out


@router.delete("/sessions/{session_id}", response_model=Ok)
async def revoke(session_id: uuid.UUID, ctx: CurrentUser, db: DB) -> Ok:
    row = await db.get(Session, session_id)
    if row is not None and row.user_id == ctx.user.id:
        await users_svc.revoke_session(db, session_id)
        await db.commit()
    return Ok()


@router.delete("/me", response_model=Ok)
async def delete_me(ctx: CurrentUser, db: DB) -> Ok:
    """Account deletion (store policy requirement). Scrubs personal fields, revokes sessions, deletes the
    Firebase account. Ledger and purchases stay for finance under the anonymised user id."""
    from datetime import UTC, datetime

    from app.models.identity import AuthIdentity, UserStatus

    user = ctx.user
    identities = (await db.scalars(select(AuthIdentity).where(AuthIdentity.user_id == user.id))).all()
    for ident in identities:
        if ident.provider == "firebase":
            try:
                await asyncio.to_thread(fb_auth.delete_user, ident.provider_uid)
            except Exception:  # noqa: BLE001 - already gone or Firebase unreachable; local deletion proceeds
                pass
        await db.delete(ident)
    for row in (await db.scalars(select(Session).where(Session.user_id == user.id))).all():
        row.revoked_at = datetime.now(UTC)
    user.status = UserStatus.deleted
    user.email = None
    user.phone = None
    user.display_name = None
    user.avatar_url = None
    await db.commit()
    return Ok()
