import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.wallet import PurchaseStatus


class CheckoutIn(BaseModel):
    pack_id: uuid.UUID
    gateway: str = Field(pattern="^(stripe|razorpay)$")
    currency: str = Field(default="INR", min_length=3, max_length=3)
    country: str = Field(default="*", max_length=2)
    success_url: str
    cancel_url: str
    coupon_code: str | None = Field(default=None, max_length=32)
    offer_id: uuid.UUID | None = None


class CheckoutOut(BaseModel):
    purchase_id: uuid.UUID
    amount: float | None = None
    discount_pct: int | None = None
    gateway: str
    checkout_url: str | None = None  # stripe
    order_id: str | None = None  # razorpay (Checkout.js)
    key_id: str | None = None  # razorpay public key
    amount_minor: int | None = None
    currency: str


class PurchaseOut(BaseModel):
    id: uuid.UUID
    status: PurchaseStatus
    gateway: str
    currency: str
    amount: float
    coins_granted: int
    paid_at: datetime | None
    created_at: datetime


class QuoteIn(BaseModel):
    pack_id: uuid.UUID
    currency: str = Field(default="INR", min_length=3, max_length=3)
    country: str = Field(default="*", max_length=2)
    coupon_code: str | None = Field(default=None, max_length=32)
    offer_id: uuid.UUID | None = None


class QuoteOut(BaseModel):
    pack_id: uuid.UUID
    currency: str
    list_amount: float
    amount: float
    discount_pct: int | None
    coins: int
    offer_id: uuid.UUID | None = None
    offer_title: str | None = None
    coupon_code: str | None = None
