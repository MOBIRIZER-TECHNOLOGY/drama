import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.identity import User
from app.models.ops import Setting
from app.models.wallet import CoinPack, PackPrice, Purchase, RewardTask
from app.schemas.admin import (
    AdminPackOut,
    AdminPurchasePage,
    AdminRewardTaskOut,
    PackIn,
    PackPriceIn,
    PurchaseAdminOut,
    RewardTaskIn,
    SettingsIn,
)
from app.schemas.common import Ok
from app.services import audit
from app.services import config as config_svc

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.finance, AdminRole.editor)])

EDITABLE_NAMESPACES = {"auth", "economy", "rewards", "mobile", "site", "seo", "ads", "payments"}


async def _pack_out(db, p: CoinPack) -> AdminPackOut:
    prices = (await db.scalars(select(PackPrice).where(PackPrice.pack_id == p.id))).all()
    out = AdminPackOut.model_validate(p)
    out.prices = [PackPriceIn(currency=x.currency, country=x.country, amount=float(x.amount)) for x in prices]
    return out


@router.get("/packs", response_model=list[AdminPackOut])
async def packs(db: DB) -> list[AdminPackOut]:
    rows = await db.scalars(select(CoinPack).order_by(CoinPack.sort_order))
    return [await _pack_out(db, p) for p in rows.all()]


async def _apply_prices(db, pack: CoinPack, prices: list[PackPriceIn]) -> None:
    existing = {
        (x.currency, x.country): x
        for x in (await db.scalars(select(PackPrice).where(PackPrice.pack_id == pack.id))).all()
    }
    keep = set()
    for pr in prices:
        key = (pr.currency.upper(), pr.country.upper())
        keep.add(key)
        row = existing.get(key)
        if row is None:
            db.add(PackPrice(pack_id=pack.id, currency=key[0], country=key[1], amount=pr.amount))
        else:
            row.amount = pr.amount
    for key, row in existing.items():
        if key not in keep:
            await db.delete(row)


@router.post("/packs", response_model=AdminPackOut, status_code=201)
async def create_pack(body: PackIn, db: DB) -> AdminPackOut:
    if await db.scalar(select(CoinPack.id).where(CoinPack.sku == body.sku)):
        raise Conflict("SKU already exists", code="sku_taken")
    p = CoinPack(**body.model_dump(exclude={"prices"}))
    db.add(p)
    await db.flush()
    await _apply_prices(db, p, body.prices)
    await db.commit()
    return await _pack_out(db, p)


@router.put("/packs/{pack_id}", response_model=AdminPackOut)
async def update_pack(pack_id: uuid.UUID, body: PackIn, db: DB) -> AdminPackOut:
    p = await db.get(CoinPack, pack_id)
    if p is None:
        raise NotFound("Pack")
    for k, v in body.model_dump(exclude={"prices"}).items():
        setattr(p, k, v)
    await _apply_prices(db, p, body.prices)
    await db.commit()
    return await _pack_out(db, p)


@router.delete("/packs/{pack_id}", response_model=Ok)
async def delete_pack(pack_id: uuid.UUID, db: DB) -> Ok:
    p = await db.get(CoinPack, pack_id)
    if p is None:
        raise NotFound("Pack")
    p.is_active = False  # purchases reference packs; never hard-delete
    await db.commit()
    return Ok()


@router.get("/purchases", response_model=AdminPurchasePage)
async def purchases(
    db: DB,
    status: str | None = None,
    q: Annotated[str | None, Query(max_length=160)] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
) -> AdminPurchasePage:
    """Purchases, searchable, with a count and a per-currency sum over the whole filtered set.

    Search and date filtering used to happen in the browser over one loaded page, which meant a dispute that
    arrived quoting an order id could only be found if that order happened to be on screen — and the "collected"
    figure beside it was a subtotal of whatever had loaded. Both now run in the database.

    `q` matches our own purchase id, either gateway identifier, and the buyer's public id or email, because a
    dispute arrives quoting whichever of those the other party happens to hold.
    """
    stmt = (
        select(Purchase, User.public_id, CoinPack.name, User.email)
        .join(User, User.id == Purchase.user_id)
        .join(CoinPack, CoinPack.id == Purchase.pack_id)
    )
    count_stmt = select(func.count()).select_from(Purchase).join(User, User.id == Purchase.user_id)
    sum_stmt = (
        select(Purchase.currency, func.sum(Purchase.amount))
        .join(User, User.id == Purchase.user_id)
        .group_by(Purchase.currency)
    )

    filters = []
    if status:
        filters.append(Purchase.status == status)
    if q:
        needle = f"%{q.strip()}%"
        matches = [
            Purchase.gateway_payment_id.ilike(needle),
            Purchase.external_id.ilike(needle),
            User.public_id.ilike(needle),
            User.email.ilike(needle),
            Purchase.coupon_code.ilike(needle),
        ]
        # An id pasted whole should match exactly rather than relying on a LIKE over a uuid cast.
        try:
            matches.append(Purchase.id == uuid.UUID(q.strip()))
        except ValueError:
            pass
        filters.append(or_(*matches))
    if date_from:
        filters.append(Purchase.created_at >= datetime.combine(date_from, time.min, tzinfo=UTC))
    if date_to:
        # Inclusive of the end date: an operator asking for "to the 5th" means through the 5th.
        filters.append(Purchase.created_at < datetime.combine(date_to, time.min, tzinfo=UTC) + timedelta(days=1))

    for f in filters:
        stmt = stmt.where(f)
        count_stmt = count_stmt.where(f)
        sum_stmt = sum_stmt.where(f)

    total = await db.scalar(count_stmt) or 0
    sums = {cur: float(amount or 0) for cur, amount in (await db.execute(sum_stmt)).all()}
    rows = await db.execute(stmt.order_by(Purchase.created_at.desc()).limit(limit).offset(offset))
    items = [
        PurchaseAdminOut(
            id=p.id,
            user_id=p.user_id,
            user_public_id=pub,
            pack_name=name,
            gateway=p.gateway,
            status=p.status.value,
            currency=p.currency,
            amount=float(p.amount),
            coins_granted=p.coins_granted,
            paid_at=p.paid_at,
            created_at=p.created_at,
            gateway_payment_id=p.gateway_payment_id,
            external_id=p.external_id,
            user_email=email,
        )
        for p, pub, name, email in rows.all()
    ]
    return AdminPurchasePage(items=items, total=total, totals_by_currency=sums)


@router.get("/reward-tasks", response_model=list[AdminRewardTaskOut])
async def reward_tasks(db: DB) -> list[AdminRewardTaskOut]:
    rows = await db.scalars(select(RewardTask).order_by(RewardTask.platform, RewardTask.sort_order))
    return [AdminRewardTaskOut.model_validate(t) for t in rows.all()]


@router.post("/reward-tasks", response_model=AdminRewardTaskOut, status_code=201)
async def create_reward_task(body: RewardTaskIn, db: DB) -> AdminRewardTaskOut:
    t = RewardTask(**body.model_dump())
    db.add(t)
    await db.commit()
    return AdminRewardTaskOut.model_validate(t)


@router.put("/reward-tasks/{task_id}", response_model=AdminRewardTaskOut)
async def update_reward_task(task_id: uuid.UUID, body: RewardTaskIn, db: DB) -> AdminRewardTaskOut:
    t = await db.get(RewardTask, task_id)
    if t is None:
        raise NotFound("Task")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    await db.commit()
    return AdminRewardTaskOut.model_validate(t)


@router.delete("/reward-tasks/{task_id}", response_model=Ok)
async def delete_reward_task(task_id: uuid.UUID, db: DB) -> Ok:
    t = await db.get(RewardTask, task_id)
    if t is None:
        raise NotFound("Task")
    await db.delete(t)
    await db.commit()
    return Ok()


@router.get("/settings/{namespace}")
async def get_settings_ns(namespace: str, db: DB) -> dict:
    if namespace not in EDITABLE_NAMESPACES:
        raise NotFound("Namespace")
    return await config_svc.namespace(db, namespace)


@router.put("/settings/{namespace}")
async def put_settings_ns(namespace: str, body: SettingsIn, db: DB, admin: CurrentAdmin) -> dict:
    if namespace not in EDITABLE_NAMESPACES:
        raise NotFound("Namespace")
    forbidden = [k for k in body.data if "secret" in k.lower() or "key" in k.lower() and "public" not in k.lower()]
    if forbidden:
        raise Conflict(f"Secrets belong in the environment, not settings: {forbidden}", code="secret_in_settings")
    row = await db.get(Setting, namespace)
    if row is None:
        row = Setting(namespace=namespace, data={})
        db.add(row)
    previous = dict(row.data)
    row.data = {**row.data, **body.data}
    row.updated_at = datetime.now(UTC)
    row.updated_by = admin.id
    # Economy settings move revenue directly. Without a record, a bad save has no "what was it before".
    audit.record(
        db,
        admin=admin,
        action="settings.save",
        target_type="setting",
        target_id=namespace,
        before=previous,
        after=dict(row.data),
    )
    await db.commit()
    return await config_svc.namespace(db, namespace)
