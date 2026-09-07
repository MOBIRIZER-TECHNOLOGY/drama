import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey


class UserStatus(str, enum.Enum):
    active = "active"
    banned = "banned"
    deleted = "deleted"


class Platform(str, enum.Enum):
    web = "web"
    android = "android"
    ios = "ios"


class User(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "users"

    public_id: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    country: Mapped[str | None] = mapped_column(String(2))
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status"), default=UserStatus.active, nullable=False
    )
    # Cache of the ledger, maintained in the same transaction as each ledger row.
    coin_balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True)
    referred_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    age_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Per-channel opt-outs, e.g. {"new_episode": false}. Absent keys mean opted in; see services/push.py.
    notification_prefs: Mapped[dict | None] = mapped_column(JSONB)

    identities: Mapped[list["AuthIdentity"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AuthIdentity(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "provider_uid", name="uq_identity_provider_uid"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # firebase, google, apple, phone
    provider_uid: Mapped[str] = mapped_column(String(255), nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSONB)

    user: Mapped[User] = relationship(back_populates="identities")


class Session(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_active", "user_id", "revoked_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str | None] = mapped_column(String(128))
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform"), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(160))
    app_version: Mapped[str | None] = mapped_column(String(32))
    refresh_token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    previous_token_hash: Mapped[str | None] = mapped_column(String(128))  # reuse detection
    push_token: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class AdminRole(str, enum.Enum):
    owner = "owner"
    editor = "editor"
    support = "support"
    finance = "finance"


class AdminUser(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "admin_users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[AdminRole] = mapped_column(Enum(AdminRole, name="admin_role"), nullable=False)
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
