import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.core.security import hash_password
from app.models.identity import AdminUser, AuthIdentity, Session, User, UserStatus
from app.models.wallet import CoinPack, LedgerKind, Purchase, VipMembership
from app.schemas.admin import (
    AdminAccountOut,
    AdminAccountUpdateIn,
    AdminUserCreateIn,
    AdminUserDetail,
    AdminUserOut,
    AdminUserPage,
    AdminUserPurchase,
    CoinAdjustIn,
    UserStatusIn,
    VipGrantIn,
)
from app.schemas.common import Ok
from app.schemas.wallet import LedgerRow
from app.services import audit
from app.services import config as config_svc
from app.services import ledger as ledger_svc
from app.services.search import LIKE_ESCAPE, like_pattern

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.support, AdminRole.finance)])

UserSort = Literal["display_name", "status", "coin_balance", "created_at", "last_seen_at"]
SortOrder = Literal["asc", "desc"]


@router.get("/users", response_model=AdminUserPage)
async def users(
    db: DB,
    q: Annotated[str | None, Query(max_length=120)] = None,
    status: UserStatus | None = None,
    sort: UserSort | None = None,
    order: SortOrder = "desc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUserPage:
    """The accounts list. Sorting happens here, over the whole table: the console used to sort the page it
    had, which put the richest account on page one only if it happened to be among the newest fifty."""
    stmt = select(User)
    if q:
        like = like_pattern(q)
        stmt = stmt.where(
            or_(
                User.public_id == q.strip(),
                User.email.ilike(like, escape=LIKE_ESCAPE),
                User.phone.ilike(like, escape=LIKE_ESCAPE),
                User.display_name.ilike(like, escape=LIKE_ESCAPE),
            )
        )
    if status:
        stmt = stmt.where(User.status == status)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    if sort is None:
        ordering = User.created_at.desc()
    else:
        # Names compare case-insensitively; everything else is a number, an enum or a timestamp already.
        column = func.lower(User.display_name) if sort == "display_name" else getattr(User, sort)
        # Nulls last in either direction: an account with no name or that has never been seen belongs at
        # the end of the list whichever way it is sorted, not at the top of a descending one.
        ordering = (column.desc() if order == "desc" else column.asc()).nulls_last()
    # The id tiebreak makes the order total, so paging never shows a row twice or skips one across equal keys.
    rows = await db.scalars(stmt.order_by(ordering, User.id).limit(limit).offset(offset))
    return AdminUserPage(items=[AdminUserOut.model_validate(u) for u in rows.all()], total=total or 0)


@router.put("/users/{user_id}/status", response_model=AdminUserOut)
async def set_status(user_id: uuid.UUID, body: UserStatusIn, db: DB, admin: CurrentAdmin) -> AdminUserOut:
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User")
    previous = u.status
    # Deletion scrubs personal data and is owner-only; setting the status by hand would leave the PII behind
    # and skip that check. And a deleted account cannot be brought back: its email, phone and identities are
    # gone, so "reactivating" it produces a shell that can never sign in.
    if body.status == UserStatus.deleted:
        raise Conflict("Delete the account through DELETE /admin/users/{id}", code="use_delete")
    if previous == UserStatus.deleted:
        raise Conflict("A deleted account cannot be reactivated", code="user_deleted")
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


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def user_detail(user_id: uuid.UUID, db: DB) -> AdminUserDetail:
    """One call for the support drawer: the account, its VIP state and its purchases.

    VIP was never shown, so a support agent granting it worked blind and could stack a second month onto an
    already-active pass; and answering "I paid and got no coins" meant leaving for Purchases and searching by
    hand for a user id.
    """
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User")

    now = datetime.now(UTC)
    vip = await db.scalar(
        select(VipMembership)
        .where(VipMembership.user_id == user_id, VipMembership.ends_at > now)
        .order_by(VipMembership.ends_at.desc())
        .limit(1)
    )
    rows = (
        await db.execute(
            select(Purchase, CoinPack.name)
            .join(CoinPack, CoinPack.id == Purchase.pack_id, isouter=True)
            .where(Purchase.user_id == user_id)
            .order_by(Purchase.created_at.desc())
            .limit(20)
        )
    ).all()
    active_sessions = (
        await db.scalar(
            select(func.count()).where(
                Session.user_id == user_id, Session.revoked_at.is_(None), Session.expires_at > now
            )
        )
        or 0
    )

    # Built from the base model's fields rather than `AdminUserDetail.model_validate(u)`. The detail model
    # adds a `sessions` count, and `User` already has a `sessions` relationship: validating from attributes
    # reads that relationship, which lazy-loads, which is IO on an async session outside its greenlet — the
    # request fails with MissingGreenlet before any of this runs. The field names collide on purpose (the
    # console wants "how many sessions"), so the fix is to stop reading the extras off the ORM object.
    detail = AdminUserDetail(
        **AdminUserOut.model_validate(u).model_dump(),
        is_vip=vip is not None,
        vip_ends_at=vip.ends_at if vip else None,
        sessions=active_sessions,
        purchases=[],
    )
    detail.purchases = [
        AdminUserPurchase(
            id=p.id,
            gateway=p.gateway,
            status=p.status,
            currency=p.currency,
            amount=float(p.amount),
            coins_granted=p.coins_granted,
            pack_name=pack_name,
            gateway_payment_id=p.gateway_payment_id,
            created_at=p.created_at,
            paid_at=p.paid_at,
        )
        for p, pack_name in rows
    ]
    return detail


@router.get("/users/{user_id}/ledger", response_model=list[LedgerRow])
async def user_ledger(user_id: uuid.UUID, db: DB, limit: Annotated[int, Query(ge=1, le=500)] = 100) -> list[LedgerRow]:
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
    # Soft delete: keeps the ledger and purchases for finance; everything personal is scrubbed. That means
    # the provider identities too — a Firebase uid left behind is a link back to the person — and the session
    # rows' addresses, device names and push tokens, which are personal data a "deleted" account must not
    # still hold. The referral code goes because it is a handle someone may have shared publicly.
    u.status = UserStatus.deleted
    u.email = None
    u.phone = None
    u.display_name = None
    u.avatar_url = None
    u.referral_code = None
    u.notification_prefs = None
    await db.execute(delete(AuthIdentity).where(AuthIdentity.user_id == u.id))
    await db.execute(
        update(Session)
        .where(Session.user_id == u.id)
        .values(
            revoked_at=func.coalesce(Session.revoked_at, datetime.now(UTC)),
            ip=None,
            push_token=None,
            device_name=None,
            device_id=None,
        )
    )
    await db.commit()
    return Ok()


# ---- admin accounts (owner only) ----


def _account_out(a: AdminUser) -> AdminAccountOut:
    out = AdminAccountOut.model_validate(a)
    out.totp_enabled = bool(a.totp_secret)
    return out


@router.get("/accounts", response_model=list[AdminAccountOut], dependencies=[require_role(AdminRole.owner)])
async def accounts(db: DB) -> list[AdminAccountOut]:
    rows = await db.scalars(select(AdminUser).order_by(AdminUser.created_at))
    return [_account_out(a) for a in rows.all()]


@router.post(
    "/accounts/{account_id}/revoke-sessions",
    response_model=AdminAccountOut,
    dependencies=[require_role(AdminRole.owner)],
)
async def revoke_sessions(account_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> AdminAccountOut:
    """Ends every session for one account.

    Disabling an account already blocks it, but leaves the reason on the record; this is the lighter action for
    a lost laptop or a shared password, where the person keeps their access and only their tokens die.
    """
    a = await db.get(AdminUser, account_id)
    if a is None:
        raise NotFound("Account")
    a.token_version += 1
    audit.record(db, admin=admin, action="admin.sessions_revoked", target_type="admin", target_id=a.id, note=a.email)
    await db.commit()
    return _account_out(a)


@router.post("/accounts", response_model=AdminAccountOut, status_code=201, dependencies=[require_role(AdminRole.owner)])
async def create_account(body: AdminUserCreateIn, db: DB, admin: CurrentAdmin) -> AdminAccountOut:
    a = AdminUser(
        email=body.email.lower(),
        display_name=body.display_name,
        password_hash=await asyncio.to_thread(hash_password, body.password),
        role=body.role,
    )
    # The unique index on `email` is the guard; the savepoint turns its failure into a 409 instead of a 500.
    try:
        async with db.begin_nested():
            db.add(a)
            await db.flush()
    except IntegrityError:
        raise Conflict("An account with that email already exists", code="email_taken") from None
    audit.record(
        db,
        admin=admin,
        action="admin.create",
        target_type="admin",
        target_id=a.id,
        note=a.email,
        after={"role": a.role.value, "is_active": a.is_active},
    )
    await db.commit()
    return _account_out(a)


@router.put("/accounts/{account_id}", response_model=AdminAccountOut, dependencies=[require_role(AdminRole.owner)])
async def update_account(
    account_id: uuid.UUID, body: AdminAccountUpdateIn, db: DB, admin: CurrentAdmin
) -> AdminAccountOut:
    a = await db.get(AdminUser, account_id)
    if a is None:
        raise NotFound("Account")
    if body.display_name is not None:
        a.display_name = body.display_name
    # A privilege change is the one edit an audit log exists for. Recorded per field, so "who made X an
    # owner" and "who disabled Y" are each one row rather than a diff to reconstruct.
    if body.role is not None and a.id != admin.id and body.role != a.role:
        audit.record(
            db,
            admin=admin,
            action="admin.role",
            target_type="admin",
            target_id=a.id,
            note=a.email,
            before={"role": a.role.value},
            after={"role": body.role.value},
        )
        a.role = body.role
    if body.is_active is not None and a.id != admin.id and body.is_active != a.is_active:
        audit.record(
            db,
            admin=admin,
            action="admin.activate" if body.is_active else "admin.deactivate",
            target_type="admin",
            target_id=a.id,
            note=a.email,
            before={"is_active": a.is_active},
            after={"is_active": body.is_active},
        )
        a.is_active = body.is_active
    if body.password:
        a.password_hash = await asyncio.to_thread(hash_password, body.password)
        # A password is changed because the old one may be known. Every token minted under it dies with it.
        a.token_version += 1
        audit.record(db, admin=admin, action="admin.password_reset", target_type="admin", target_id=a.id, note=a.email)
    await db.commit()
    return _account_out(a)


@router.delete("/accounts/{account_id}", response_model=Ok, dependencies=[require_role(AdminRole.owner)])
async def disable_account(account_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    a = await db.get(AdminUser, account_id)
    if a is None or a.id == admin.id:
        raise NotFound("Account")
    audit.record(
        db,
        admin=admin,
        action="admin.deactivate",
        target_type="admin",
        target_id=a.id,
        note=a.email,
        before={"is_active": a.is_active},
        after={"is_active": False},
    )
    a.is_active = False
    await db.commit()
    return Ok()
