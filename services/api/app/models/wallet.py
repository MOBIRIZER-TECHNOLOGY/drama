import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.identity import Platform


class LedgerKind(str, enum.Enum):
    signup_bonus = "signup_bonus"
    purchase = "purchase"
    unlock = "unlock"
    ad_unlock = "ad_unlock"
    checkin = "checkin"
    task = "task"
    referral = "referral"
    admin_adjust = "admin_adjust"
    refund = "refund"


class CoinLedger(UUIDPrimaryKey, Base):
    """Append-only. users.coin_balance is derived from SUM(delta) in the same transaction."""

    __tablename__ = "coin_ledger"
    __table_args__ = (Index("ix_ledger_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[LedgerKind] = mapped_column(Enum(LedgerKind, name="ledger_kind"), nullable=False)
    ref_type: Mapped[str | None] = mapped_column(String(32))
    ref_id: Mapped[str | None] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    variant_map: Mapped[dict | None] = mapped_column(JSONB)  # experiment variants at the time
    created_by: Mapped[str | None] = mapped_column(String(64))  # admin id for adjustments
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class VipMembership(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "vip_memberships"
    __table_args__ = (Index("ix_vip_user_ends", "user_id", "ends_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # purchase | admin | promo
    purchase_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("purchases.id"))


class UnlockMethod(str, enum.Enum):
    coins = "coins"
    ad = "ad"
    vip = "vip"
    free = "free"
    admin = "admin"


class EpisodeUnlock(UUIDPrimaryKey, Base):
    __tablename__ = "episode_unlocks"
    __table_args__ = (UniqueConstraint("user_id", "episode_id", name="uq_unlock_user_episode"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    episode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    method: Mapped[UnlockMethod] = mapped_column(Enum(UnlockMethod, name="unlock_method"), nullable=False)
    ledger_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coin_ledger.id"))
    variant_map: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PackKind(str, enum.Enum):
    coins = "coins"
    vip = "vip"


class CoinPack(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "coin_packs"

    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[PackKind] = mapped_column(Enum(PackKind, name="pack_kind"), nullable=False)
    coins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bonus_coins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_days: Mapped[int | None] = mapped_column(Integer)
    google_product_id: Mapped[str | None] = mapped_column(String(120))
    apple_product_id: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    badge: Mapped[str | None] = mapped_column(String(32))  # popular, best_value


class PackPrice(Base):
    """Regional pricing from day one: one row per pack and currency, optional country override."""

    __tablename__ = "pack_prices"
    __table_args__ = (UniqueConstraint("pack_id", "currency", "country", name="uq_pack_price"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coin_packs.id", ondelete="CASCADE"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="*", nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)


class PurchaseStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    failed = "failed"
    refunded = "refunded"


class Purchase(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "purchases"
    __table_args__ = (
        UniqueConstraint("gateway", "external_id", name="uq_purchase_gateway_external"),
        Index("ix_purchases_gateway_payment", "gateway", "gateway_payment_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    pack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coin_packs.id"), nullable=False)
    gateway: Mapped[str] = mapped_column(String(32), nullable=False)  # stripe | razorpay | revenuecat
    external_id: Mapped[str | None] = mapped_column(String(160))  # checkout session / order id
    gateway_payment_id: Mapped[str | None] = mapped_column(String(160))  # payment intent / payment id (refund key)
    status: Mapped[PurchaseStatus] = mapped_column(
        Enum(PurchaseStatus, name="purchase_status"), default=PurchaseStatus.pending, nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    coins_granted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    offer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("offers.id"))
    coupon_code: Mapped[str | None] = mapped_column(String(32))
    discount_pct: Mapped[int | None] = mapped_column(Integer)
    variant_map: Mapped[dict | None] = mapped_column(JSONB)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Checkin(Base):
    __tablename__ = "checkins"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    streak_day: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..7
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    ledger_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coin_ledger.id"), nullable=False)


class RewardTaskKind(str, enum.Enum):
    link = "link"
    rewarded_ad = "rewarded_ad"
    share = "share"
    follow = "follow"


class RewardFrequency(str, enum.Enum):
    once = "once"
    daily = "daily"


class RewardTask(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "reward_tasks"

    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform", create_type=False), nullable=False)
    kind: Mapped[RewardTaskKind] = mapped_column(Enum(RewardTaskKind, name="reward_task_kind"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    coins: Mapped[int] = mapped_column(Integer, nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    timer_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    frequency: Mapped[RewardFrequency] = mapped_column(Enum(RewardFrequency, name="reward_frequency"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class RewardClaim(UUIDPrimaryKey, Base):
    __tablename__ = "reward_claims"
    __table_args__ = (Index("ix_reward_claims_user_task", "user_id", "task_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reward_tasks.id", ondelete="CASCADE"), nullable=False
    )
    ledger_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coin_ledger.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AdEvent(UUIDPrimaryKey, Base):
    """Rewarded-ad completions verified by the network's server-side callback (AdMob SSV)."""

    __tablename__ = "ad_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    network: Mapped[str] = mapped_column(String(32), nullable=False)
    ssv_transaction_id: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    ad_unit_id: Mapped[str | None] = mapped_column(String(160))
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)  # unlock | task
    ref_id: Mapped[str | None] = mapped_column(String(64))
    reward_coins: Mapped[int | None] = mapped_column(Integer)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Referral(UUIDPrimaryKey, Base):
    __tablename__ = "referrals"

    referrer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    referee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    rewarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Offer(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "offers"

    title: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # first_purchase | bundle | winback | coupon
    pack_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coin_packs.id"))
    discount_pct: Mapped[int | None] = mapped_column(Integer)
    eligibility: Mapped[dict | None] = mapped_column(JSONB)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Coupon(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "coupon_codes"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    offer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("offers.id", ondelete="CASCADE"), nullable=False
    )
    max_uses: Mapped[int | None] = mapped_column(Integer)
    used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class WebhookEvent(UUIDPrimaryKey, Base):
    """Inbox for gateway webhooks: one row per (gateway, event id), written before the event is applied."""

    __tablename__ = "webhook_events"
    __table_args__ = (UniqueConstraint("gateway", "event_id", name="uq_webhook_event"),)

    gateway: Mapped[str] = mapped_column(String(32), nullable=False)
    event_id: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(80))
    payload: Mapped[dict | None] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[str | None] = mapped_column(String(32))
    error: Mapped[str | None] = mapped_column(Text)
