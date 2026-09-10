import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.wallet import PurchaseStatus

# An ISO 4217 code and nothing else. Pricing looks the value up as-is against pack prices; a lowercase or
# padded spelling would miss every row and surface as "no price" rather than as the client's mistake.
CURRENCY = "^[A-Z]{3}$"


class CheckoutIn(BaseModel):
    """What the client may choose about a purchase.

    There is deliberately no `country`: regional prices exist because some markets pay less, so the country
    comes from the edge header the request arrived with (see `deps.client_country`), never from the body. A
    client that still sends one is ignored rather than refused.
    """

    pack_id: uuid.UUID
    gateway: str = Field(pattern="^(stripe|razorpay)$")
    currency: str = Field(default="INR", pattern=CURRENCY)
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
    """Same shape as a checkout minus the gateway; the country is edge-resolved here too."""

    pack_id: uuid.UUID
    currency: str = Field(default="INR", pattern=CURRENCY)
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


class PlayRedeemIn(BaseModel):
    """A completed Google Play purchase, handed over for verification.

    Only the token is trusted as an identifier; whether it was actually paid for, and how much, comes from
    Google. `product_id` selects which pack to grant and is checked against the token by the Play API.
    """

    product_id: str = Field(min_length=1, max_length=120)
    purchase_token: str = Field(min_length=10, max_length=1024)
