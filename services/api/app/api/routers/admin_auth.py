import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.api.deps import DB, CurrentAdmin
from app.core.errors import Unauthorized
from app.core.ratelimit import limiter
from app.core.security import decode_token, hash_password, mint_token, verify_password
from app.models.identity import AdminRole, AdminUser
from app.services import email as email_svc

router = APIRouter(prefix="/admin/auth", tags=["admin"])


class AdminLogin(BaseModel):
    email: EmailStr
    password: str


class AdminToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class AdminOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: AdminRole


@router.post("/login", response_model=AdminToken)
@limiter.limit("5/minute")
async def login(request: Request, body: AdminLogin, db: DB) -> AdminToken:
    admin = await db.scalar(select(AdminUser).where(AdminUser.email == body.email.lower()))
    ok = (
        admin is not None
        and admin.is_active
        and await asyncio.to_thread(verify_password, body.password, admin.password_hash)
    )
    if not ok:
        raise Unauthorized("Invalid credentials")
    admin.last_login_at = datetime.now(UTC)
    await db.commit()
    ttl = 60 * 60 * 8
    return AdminToken(
        access_token=mint_token(str(admin.id), "admin", ttl=ttl, extra={"role": admin.role.value}), expires_in=ttl
    )


@router.get("/me", response_model=AdminOut)
async def me(admin: CurrentAdmin) -> AdminOut:
    return AdminOut(id=str(admin.id), email=admin.email, display_name=admin.display_name, role=admin.role)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str


@router.post("/forgot", response_model=dict)
@limiter.limit("3/minute")
async def forgot(request: Request, body: ForgotIn, db: DB) -> dict:
    """Always 200. Sends a 30-minute reset link when the account exists."""
    from app.core.config import get_settings

    admin = await db.scalar(
        select(AdminUser).where(AdminUser.email == body.email.lower(), AdminUser.is_active.is_(True))
    )
    if admin is not None:
        token = mint_token(str(admin.id), "admin", ttl=1800, extra={"purpose": "reset"})
        link = f"{get_settings().admin_base_url}/reset?token={token}"
        body_text = "\n\n".join(
            [
                "Open this link within 30 minutes to choose a new password:",
                link,
                "If you did not ask for this, ignore it.",
            ]
        )
        await email_svc.send(admin.email, "Reset your Katha admin password", body_text)
    return {"ok": True}


@router.post("/reset", response_model=dict)
@limiter.limit("5/minute")
async def reset(request: Request, body: ResetIn, db: DB) -> dict:
    import uuid

    import jwt

    try:
        payload = decode_token(body.token, "admin")
    except jwt.PyJWTError as exc:
        raise Unauthorized("Reset link is invalid or expired") from exc
    if payload.get("purpose") != "reset":
        raise Unauthorized("Reset link is invalid")
    if len(body.password) < 10:
        raise Unauthorized("Password must be at least 10 characters")
    admin = await db.get(AdminUser, uuid.UUID(payload["sub"]))
    if admin is None or not admin.is_active:
        raise Unauthorized("Account not found")
    admin.password_hash = await asyncio.to_thread(hash_password, body.password)
    await db.commit()
    return {"ok": True}
