import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.api.deps import DB, CurrentAdmin
from app.core import totp
from app.core.errors import Conflict, Unauthorized
from app.core.ratelimit import limiter
from app.core.security import decode_token, hash_password, mint_token, verify_password
from app.models.identity import AdminRole, AdminUser
from app.services import audit
from app.services import email as email_svc

router = APIRouter(prefix="/admin/auth", tags=["admin"])


class AdminLogin(BaseModel):
    email: EmailStr
    password: str
    """Six digits from the authenticator, required once the account has enrolled."""
    otp: str | None = None


class AdminToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class AdminOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: AdminRole
    totp_enabled: bool = False


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
    assert admin is not None  # narrowed by `ok` above; mypy cannot see it through the boolean
    if admin.totp_secret:
        # A distinct code so the console can ask for the second factor rather than telling someone their
        # password was wrong, which is the fastest way to get a support ticket about a working password.
        if not body.otp:
            raise Unauthorized("Enter the code from your authenticator app", code="totp_required")
        if not totp.verify(admin.totp_secret, body.otp):
            raise Unauthorized("That code is not valid", code="totp_invalid")

    admin.last_login_at = datetime.now(UTC)
    await db.commit()
    return _mint(admin)


def _mint(admin: AdminUser) -> AdminToken:
    ttl = 60 * 60 * 8
    return AdminToken(
        access_token=mint_token(
            str(admin.id),
            "admin",
            ttl=ttl,
            extra={"role": admin.role.value, "tv": admin.token_version},
        ),
        expires_in=ttl,
    )


@router.get("/me", response_model=AdminOut)
async def me(admin: CurrentAdmin) -> AdminOut:
    return AdminOut(
        id=str(admin.id),
        email=admin.email,
        display_name=admin.display_name,
        role=admin.role,
        totp_enabled=bool(admin.totp_secret),
    )


class TotpSetupOut(BaseModel):
    """The secret, and the URI an authenticator app scans. Shown once and never stored until confirmed."""

    secret: str
    otpauth_uri: str


class TotpConfirmIn(BaseModel):
    code: str


class TotpDisableIn(BaseModel):
    password: str
    code: str


@router.post("/totp/setup", response_model=TotpSetupOut)
async def totp_setup(admin: CurrentAdmin) -> TotpSetupOut:
    """Hands back a candidate secret. Nothing is written until a code proves the app actually holds it.

    Deliberately stateless: an abandoned setup leaves no half-enrolled account behind, and re-running it simply
    supersedes the previous candidate.
    """
    if admin.totp_secret:
        raise Conflict("Two-factor authentication is already on for this account", code="totp_enabled")
    secret = totp.random_secret()
    return TotpSetupOut(
        secret=secret,
        otpauth_uri=totp.provisioning_uri(secret, account=admin.email, issuer="Katha Admin"),
    )


class TotpEnableIn(BaseModel):
    secret: str
    code: str


@router.post("/totp/enable", response_model=AdminOut)
async def totp_enable(body: TotpEnableIn, admin: CurrentAdmin, db: DB) -> AdminOut:
    if admin.totp_secret:
        raise Conflict("Two-factor authentication is already on for this account", code="totp_enabled")
    if not totp.verify(body.secret, body.code):
        raise Unauthorized("That code is not valid", code="totp_invalid")
    admin.totp_secret = body.secret
    audit.record(db, admin=admin, action="admin.totp_enable", target_type="admin", target_id=admin.id)
    await db.commit()
    return AdminOut(
        id=str(admin.id), email=admin.email, display_name=admin.display_name, role=admin.role, totp_enabled=True
    )


@router.post("/totp/disable", response_model=AdminOut)
@limiter.limit("5/minute")
async def totp_disable(request: Request, body: TotpDisableIn, admin: CurrentAdmin, db: DB) -> AdminOut:
    """Both factors are required to remove a factor; otherwise a stolen session could quietly disarm it."""
    if not admin.totp_secret:
        return AdminOut(
            id=str(admin.id),
            email=admin.email,
            display_name=admin.display_name,
            role=admin.role,
            totp_enabled=False,
        )
    if not await asyncio.to_thread(verify_password, body.password, admin.password_hash):
        raise Unauthorized("Invalid credentials")
    if not totp.verify(admin.totp_secret, body.code):
        raise Unauthorized("That code is not valid", code="totp_invalid")
    admin.totp_secret = None
    audit.record(db, admin=admin, action="admin.totp_disable", target_type="admin", target_id=admin.id)
    await db.commit()
    return AdminOut(
        id=str(admin.id), email=admin.email, display_name=admin.display_name, role=admin.role, totp_enabled=False
    )


@router.post("/sign-out-all", response_model=AdminToken)
async def sign_out_everywhere(admin: CurrentAdmin, db: DB) -> AdminToken:
    """Invalidates every token issued to this account, and returns a fresh one for the caller.

    Returning a new token rather than 204 is deliberate: the operator who clicked this is not trying to sign
    themselves out of the tab they are looking at.
    """
    admin.token_version += 1
    audit.record(db, admin=admin, action="admin.sessions_revoked", target_type="admin", target_id=admin.id)
    await db.commit()
    return _mint(admin)


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
