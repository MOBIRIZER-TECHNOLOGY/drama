import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.wallet import LedgerKind, PackKind
from app.schemas.common import ORMModel


class LedgerRow(ORMModel):
    id: uuid.UUID
    delta: int
    balance_after: int
    kind: LedgerKind
    ref_type: str | None
    ref_id: str | None
    note: str | None
    created_at: datetime


class WalletOut(BaseModel):
    coin_balance: int
    is_vip: bool
    vip_ends_at: datetime | None


class PackPriceOut(BaseModel):
    currency: str
    amount: float


class PackOut(BaseModel):
    id: uuid.UUID
    sku: str
    name: str
    description: str | None
    kind: PackKind
    coins: int
    bonus_coins: int
    duration_days: int | None
    badge: str | None
    price: PackPriceOut | None
    google_product_id: str | None
    apple_product_id: str | None
