import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.identity import User
from app.models.ops import Setting
from app.models.wallet import CoinPack, PackPrice, Purchase, RewardTask
from app.schemas.admin import (
    AdminPackOut,
    AdminRewardTaskOut,
    PackIn,
    PackPriceIn,
    PurchaseAdminOut,
    RewardTaskIn,
    SettingsIn,
)
from app.schemas.common import Ok
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


@router.get("/purchases", response_model=list[PurchaseAdminOut])
async def purchases(
    db: DB, status: str | None = None, limit: int = Query(100, le=500), offset: int = 0
) -> list[PurchaseAdminOut]:
    stmt = (
        select(Purchase, User.public_id, CoinPack.name)
        .join(User, User.id == Purchase.user_id)
        .join(CoinPack, CoinPack.id == Purchase.pack_id)
    )
    if status:
        stmt = stmt.where(Purchase.status == status)
    rows = await db.execute(stmt.order_by(Purchase.created_at.desc()).limit(limit).offset(offset))
    return [
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
        )
        for p, pub, name in rows.all()
    ]


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
    row.data = {**row.data, **body.data}
    row.updated_at = datetime.now(UTC)
    row.updated_by = admin.id
    await db.commit()
    return await config_svc.namespace(db, namespace)
