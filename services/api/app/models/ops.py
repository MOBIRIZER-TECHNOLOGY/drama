import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey


class Setting(Base):
    """Non-secret, admin-editable configuration, one JSON document per namespace."""

    __tablename__ = "settings"

    namespace: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))


class AuditLog(UUIDPrimaryKey, Base):
    """Who did what, to what, and why.

    Nothing in the console recorded a privilege change, a ban, a cleared moderation flag, a price edit or a
    settings save — so after an incident nobody could say who flipped `rewarded_ads`, and a takedown dispute had
    no record of the decision. The coin ledger was the only thing in the product that remembered anything.

    Append-only by convention: rows are written, never updated. `before`/`after` hold only the fields that
    changed, so a settings save does not archive the whole namespace on every keystroke.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_created", "created_at"),
        Index("ix_audit_target", "target_type", "target_id"),
    )

    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))
    # Denormalised so the row still reads after the account is deleted, which is exactly when it matters.
    admin_email: Mapped[str | None] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(64), nullable=False)  # user.ban | flag.toggle | settings.save
    target_type: Mapped[str | None] = mapped_column(String(40))  # user | series | flag | setting | offer
    target_id: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)  # the operator's own reason, where the action asks for one
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Language(Base):
    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    native_name: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_rtl: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class UiTranslation(Base):
    __tablename__ = "ui_translations"

    lang: Mapped[str] = mapped_column(String(10), ForeignKey("languages.code", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="human", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CmsPage(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "cms_pages"

    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    show_in_footer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class CmsPageTranslation(Base):
    __tablename__ = "cms_page_translations"

    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cms_pages.id", ondelete="CASCADE"), primary_key=True
    )
    lang: Mapped[str] = mapped_column(String(10), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="human", nullable=False)


class AdPlacement(UUIDPrimaryKey, TimestampMixin, Base):
    """Where an ad may run, and what a rewarded view is worth.

    The original shape was one row per (platform, slot, network), which forced the same AdMob unit to be entered
    once per platform and had nowhere to record a reward value or a frequency cap — the two numbers that decide
    whether rewarded ads strangle coin revenue. A placement now spans the platforms it applies to and carries
    both.

    Unit ids here are the provider's *public* identifiers (an AdMob ad unit is embedded in every shipped APK);
    no secret belongs in this table, which is why it can be served to clients through /v1/config.
    """

    __tablename__ = "ad_placements"
    __table_args__ = (UniqueConstraint("slot", "provider", "unit_id", name="uq_ad_placement"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slot: Mapped[str] = mapped_column(String(32), nullable=False)  # home_rail | player_pre | unlock_rewarded | …
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # admob | meta | house
    unit_id: Mapped[str] = mapped_column(String(160), nullable=False)
    # Which clients may request it. Empty means none, which is why the API rejects an empty list.
    platforms: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list, nullable=False)
    # Coins for a completed rewarded view; meaningless (and stored as NULL) on non-rewarded slots.
    reward_coins: Mapped[int | None] = mapped_column(Integer)
    # Seconds one viewer must wait between two impressions of this placement.
    frequency_cap_sec: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Notification(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "notifications"

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    segment: Mapped[dict | None] = mapped_column(JSONB)  # {"all": true} | {"user_id": ...}
    payload: Mapped[dict | None] = mapped_column(JSONB)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rules: Mapped[dict | None] = mapped_column(JSONB)  # platform, country, app_version, percentage
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Experiment(Base):
    __tablename__ = "experiments"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str | None] = mapped_column(Text)
    variants: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {"control": {...}, "b": {...}}
    allocation: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {"control": 50, "b": 50}
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExperimentAssignment(Base):
    """Sticky per user. The config endpoint returns the map; ledger, unlocks and events store it."""

    __tablename__ = "experiment_assignments"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    experiment_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("experiments.key", ondelete="CASCADE"), primary_key=True
    )
    variant: Mapped[str] = mapped_column(String(32), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
