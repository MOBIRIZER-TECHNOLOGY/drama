import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import NotFound
from app.core.security import hash_password
from app.models.identity import AdminUser, Session, User, UserStatus
from app.models.wallet import LedgerKind, VipMembership
from app.schemas.admin import (
    AdminAccountOut,
    AdminAccountUpdateIn,
    AdminUserCreateIn,
    AdminUserOut,
    AdminUserPage,
    CoinAdjustIn,
    UserStatusIn,
    VipGrantIn,
)
from app.schemas.common import Ok
from app.schemas.wallet import LedgerRow
from app.services import audit
from app.services import config as config_svc
from app.services import ledger as ledger_svc

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.support, AdminRole.finance)])


@router.get("/users", response_model=AdminUserPage)
async def users(
    db: DB, q: str | None = None, status: UserStatus | None = None, limit: int = Query(50, le=200), offset: int = 0
) -> AdminUserPage:
    stmt = select(User)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(User.public_id == q, User.email.ilike(like), User.phone.ilike(like), User.display_name.ilike(like))
        )
    if status:
        stmt = stmt.where(User.status == status)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset))
    return AdminUserPage(items=[AdminUserOut.model_validate(u) for u in rows.all()], total=total or 0)


@router.get("/users/{user_id}", response_model=AdminUserOut)
async def get_user(user_id: uuid.UUID, db: DB) -> AdminUserOut:
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User")
    return AdminUserOut.model_validate(u)


@router.put("/users/{user_id}/status", response_model=AdminUserOut)
async def set_status(user_id: uuid.UUID, body: UserStatusIn, db: DB, admin: CurrentAdmin) -> AdminUserOut:
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User")
    previous = u.status
    u.status = body.status
    audit.record(
        db,
        admin=admin,
        action="user.status",
        target_type="user",
        target_id=u.id,
        before={"status": previous.value},
        after={"status": body.status.value},
    )
    if body.status != UserStatus.active:
        now = datetime.now(UTC)
        for s in (await db.scalars(select(Session).where(Session.user_id == u.id, Session.revoked_at.is_(None)))).all():
            s.revoked_at = now
    await db.commit()
    return AdminUserOut.model_validate(u)


@router.post("/users/{user_id}/coins", response_model=AdminUserOut, dependencies=[require_role(AdminRole.finance)])
async def adjust_coins(user_id: uuid.UUID, body: CoinAdjustIn, db: DB, admin: CurrentAdmin) -> AdminUserOut:
    await ledger_svc.post(
        db,
        user_id=user_id,
        delta=body.delta,
        kind=LedgerKind.admin_adjust,
        idempotency_key=f"admin:{admin.id}:{user_id}:{uuid.uuid4().hex}",
        note=body.note,
        created_by=str(admin.id),
        variant_map=(await config_svc.variant_map(db, user_id)) or None,
    )
    audit.record(
        db,
        admin=admin,
        action="user.coins",
        target_type="user",
        target_id=user_id,
        note=body.note,
        after={"delta": body.delta},
    )
    await db.commit()
    u = await db.get(User, user_id)
    return AdminUserOut.model_validate(u)


@router.post("/users/{user_id}/vip", response_model=Ok, dependencies=[require_role(AdminRole.finance)])
async def grant_vip(user_id: uuid.UUID, body: VipGrantIn, db: DB, admin: CurrentAdmin) -> Ok:
    if await db.get(User, user_id) is None:
        raise NotFound("User")
    now = datetime.now(UTC)
    current = await db.scalar(
        select(VipMembership)
        .where(VipMembership.user_id == user_id, VipMembership.ends_at > now)
        .order_by(VipMembership.ends_at.desc())
        .limit(1)
    )
    starts = current.ends_at if current else now
    db.add(VipMembership(user_id=user_id, starts_at=starts, ends_at=starts + timedelta(days=body.days), source="admin"))
    audit.record(
        db,
        admin=admin,
        action="user.vip_grant",
        target_type="user",
        target_id=user_id,
        after={"days": body.days, "ends_at": (starts + timedelta(days=body.days)).isoformat()},
    )
    await db.commit()
    return Ok()


@router.get("/users/{user_id}/ledger", response_model=list[LedgerRow])
async def user_ledger(user_id: uuid.UUID, db: DB, limit: int = Query(100, le=500)) -> list[LedgerRow]:
    rows = await ledger_svc.history(db, user_id, limit=limit)
    return [LedgerRow.model_validate(r) for r in rows]


@router.delete("/users/{user_id}", response_model=Ok, dependencies=[require_role(AdminRole.owner)])
async def delete_user(user_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User")
    audit.record(
        db,
        admin=admin,
        action="user.delete",
        target_type="user",
        target_id=u.id,
        before={"public_id": u.public_id, "email": u.email},
    )
    # Soft delete: keeps the ledger and purchases for finance; personal fields are scrubbed.
    u.status = UserStatus.deleted
    u.email = None
    u.phone = None
    u.display_name = None
    u.avatar_url = None
    for s in (await db.scalars(select(Session).where(Session.user_id == u.id))).all():
        s.revoked_at = datetime.now(UTC)
    await db.commit()
    return Ok()


# ---- admin accounts (owner only) ----


@router.get("/accounts", response_model=list[AdminAccountOut], dependencies=[require_role(AdminRole.owner)])
async def accounts(db: DB) -> list[AdminAccountOut]:
    rows = await db.scalars(select(AdminUser).order_by(AdminUser.created_at))
    return [AdminAccountOut.model_validate(a) for a in rows.all()]


@router.post("/accounts", response_model=AdminAccountOut, status_code=201, dependencies=[require_role(AdminRole.owner)])
async def create_account(body: AdminUserCreateIn, db: DB) -> AdminAccountOut:
    a = AdminUser(
        email=body.email.lower(),
        display_name=body.display_name,
        password_hash=await asyncio.to_thread(hash_password, body.password),
        role=body.role,
    )
    db.add(a)
    await db.commit()
    return AdminAccountOut.model_validate(a)


@router.put("/accounts/{account_id}", response_model=AdminAccountOut, dependencies=[require_role(AdminRole.owner)])
async def update_account(
    account_id: uuid.UUID, body: AdminAccountUpdateIn, db: DB, admin: CurrentAdmin
) -> AdminAccountOut:
    a = await db.get(AdminUser, account_id)
    if a is None:
        raise NotFound("Account")
    if body.display_name is not None:
        a.display_name = body.display_name
    if body.role is not None and a.id != admin.id:
        a.role = body.role
    if body.is_active is not None and a.id != admin.id:
        a.is_active = body.is_active
    if body.password:
        a.password_hash = await asyncio.to_thread(hash_password, body.password)
    await db.commit()
    return AdminAccountOut.model_validate(a)


@router.delete("/accounts/{account_id}", response_model=Ok, dependencies=[require_role(AdminRole.owner)])
async def disable_account(account_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    a = await db.get(AdminUser, account_id)
    if a is None or a.id == admin.id:
        raise NotFound("Account")
    a.is_active = False
    await db.commit()
    return Ok()
