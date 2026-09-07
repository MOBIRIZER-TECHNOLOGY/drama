import uuid
from datetime import UTC, datetime
from typing import Annotated
from typing import Annotated as _A

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, OptionalUser, client_country
from app.models.wallet import CoinPack, PackPrice, VipMembership
from app.schemas.wallet import LedgerRow, PackOut, PackPriceOut, WalletOut
from app.services import ledger as ledger_svc
from app.services import offers as offers_svc

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("", response_model=WalletOut)
async def wallet(ctx: CurrentUser, db: DB) -> WalletOut:
    now = datetime.now(UTC)
    vip = await db.scalar(
        select(VipMembership)
        .where(VipMembership.user_id == ctx.user.id, VipMembership.starts_at <= now, VipMembership.ends_at > now)
        .order_by(VipMembership.ends_at.desc())
        .limit(1)
    )
    return WalletOut(
        coin_balance=ctx.user.coin_balance, is_vip=vip is not None, vip_ends_at=vip.ends_at if vip else None
    )


@router.get("/ledger", response_model=list[LedgerRow])
async def ledger(
    ctx: CurrentUser, db: DB, limit: Annotated[int, Query(le=100)] = 50, before: datetime | None = None
) -> list[LedgerRow]:
    rows = await ledger_svc.history(db, ctx.user.id, limit=limit, before=before)
    return [LedgerRow.model_validate(r) for r in rows]


@router.get("/packs", response_model=list[PackOut])
async def packs(db: DB, ctx: OptionalUser, currency: str = "INR", country: str = "*") -> list[PackOut]:
    """Active packs with the price for the caller's currency (country override wins over '*')."""
    pack_rows = list(
        (await db.scalars(select(CoinPack).where(CoinPack.is_active.is_(True)).order_by(CoinPack.sort_order))).all()
    )
    prices = (
        await db.scalars(
            select(PackPrice).where(
                PackPrice.pack_id.in_([p.id for p in pack_rows]), PackPrice.currency == currency.upper()
            )
        )
    ).all()
    by_pack: dict = {}
    for pr in prices:
        if pr.country == country.upper():
            by_pack[pr.pack_id] = pr
        elif pr.country == "*" and pr.pack_id not in by_pack:
            by_pack[pr.pack_id] = pr
    out = []
    for p in pack_rows:
        pr = by_pack.get(p.id)
        out.append(
            PackOut(
                id=p.id,
                sku=p.sku,
                name=p.name,
                description=p.description,
                kind=p.kind,
                coins=p.coins,
                bonus_coins=p.bonus_coins,
                duration_days=p.duration_days,
                badge=p.badge,
                price=PackPriceOut(currency=pr.currency, amount=float(pr.amount)) if pr else None,
                google_product_id=p.google_product_id,
                apple_product_id=p.apple_product_id,
            )
        )
    return out


class OfferOut(BaseModel):
    id: uuid.UUID
    title: str
    kind: str
    pack_id: uuid.UUID | None
    discount_pct: int | None
    ends_at: datetime | None


@router.get("/offers", response_model=list[OfferOut])
async def offers(
    request: Request, ctx: CurrentUser, db: DB, country: _A[str | None, Depends(client_country)]
) -> list[OfferOut]:
    """Offers the viewer is eligible for right now (first purchase, win-back, timed bundles)."""
    rows = await offers_svc.eligible(db, ctx.user, country=country)
    return [
        OfferOut(id=o.id, title=o.title, kind=o.kind, pack_id=o.pack_id, discount_pct=o.discount_pct, ends_at=o.ends_at)
        for o in rows
    ]
