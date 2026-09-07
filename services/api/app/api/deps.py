import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_token
from app.models.identity import AdminRole, AdminUser, User, UserStatus

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
    return AuthContext(user=user, session_id=uuid.UUID(sid) if sid else None)


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
    admin = await db.get(AdminUser, uuid.UUID(payload["sub"]))
    if admin is None or not admin.is_active:
        raise Unauthorized("Unknown admin")
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
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None
