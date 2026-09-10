import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_token
from app.models.identity import AdminRole, AdminUser, Session, User, UserStatus

DB = Annotated[AsyncSession, Depends(get_session)]
_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    session_id: uuid.UUID | None


async def _resolve_user(db: AsyncSession, creds: HTTPAuthorizationCredentials | None) -> AuthContext | None:
    if creds is None:
        return None
    try:
        payload = decode_token(creds.credentials, "access")
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid or expired token") from exc
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise Unauthorized("Unknown user")
    if user.status != UserStatus.active:
        raise Forbidden("Account is not active")
    sid = payload.get("sid")
    session_id = uuid.UUID(sid) if sid else None
    if session_id is not None:
        # Access tokens are short-lived and stateless, but "sign out this device" and the refresh-reuse alarm
        # both work by revoking the session row. Without this check a revoked session keeps its last access
        # token for the rest of that token's life, which is exactly the window a stolen refresh token wants.
        session_row = await db.get(Session, session_id)
        if session_row is None or session_row.revoked_at is not None or session_row.expires_at <= datetime.now(UTC):
            raise Unauthorized("Session was revoked. Sign in again.", code="session_revoked")
    return AuthContext(user=user, session_id=session_id)


async def current_user(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> AuthContext:
    ctx = await _resolve_user(db, creds)
    if ctx is None:
        raise Unauthorized()
    return ctx


async def optional_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> AuthContext | None:
    return await _resolve_user(db, creds)


CurrentUser = Annotated[AuthContext, Depends(current_user)]
OptionalUser = Annotated[AuthContext | None, Depends(optional_user)]


async def current_admin(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> AdminUser:
    if creds is None:
        raise Unauthorized()
    try:
        payload = decode_token(creds.credentials, "admin")
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid or expired admin token") from exc
    # Password-reset links are minted as their own kind, so `decode_token` already refuses them. This is the
    # belt to that brace: if a future token ever carries a purpose claim on an admin kind, it is not a session.
    if payload.get("purpose") is not None:
        raise Unauthorized("Invalid or expired admin token")
    admin = await db.get(AdminUser, uuid.UUID(payload["sub"]))
    if admin is None or not admin.is_active:
        raise Unauthorized("Unknown admin")
    # A token minted before the account's sessions were revoked is refused, which is what makes
    # "sign out everywhere" mean anything against a stateless eight-hour token.
    if int(payload.get("tv", 0)) != admin.token_version:
        raise Unauthorized("Session was revoked. Sign in again.", code="session_revoked")
    return admin


CurrentAdmin = Annotated[AdminUser, Depends(current_admin)]


def require_role(*roles: AdminRole):
    async def _check(admin: CurrentAdmin) -> AdminUser:
        if admin.role != AdminRole.owner and admin.role not in roles:
            raise Forbidden("Insufficient role")
        return admin

    return Depends(_check)


def client_platform(
    x_katha_platform: Annotated[str | None, Header()] = None,
) -> str:
    return (x_katha_platform or "web").lower()


def client_country(request: Request) -> str | None:
    """Two-letter country from the edge (Cloudflare, CloudFront) or the app's own header; None when unknown."""
    for h in ("cf-ipcountry", "cloudfront-viewer-country", "x-katha-country"):
        v = request.headers.get(h)
        if v and len(v) == 2 and v.upper() != "XX":
            return v.upper()
    return None


def client_ip(request: Request) -> str | None:
    """The peer address as uvicorn sees it.

    The proxy chain is resolved by uvicorn, not here: with `--proxy-headers` and `--forwarded-allow-ips` set to
    the load balancer, it rewrites `request.client` from X-Forwarded-For only when the connecting peer is one
    of those trusted proxies. Reading the raw header again in application code would undo that trust decision
    and take the first hop's word for it — which is whatever the client chose to put there.
    """
    return request.client.host if request.client else None
