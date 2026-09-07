import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.identity import Platform
from app.schemas.common import ORMModel


class ExchangeRequest(BaseModel):
    """Trade a Firebase ID token for Katha tokens."""

    firebase_id_token: str = Field(min_length=20)
    platform: Platform
    device_id: str | None = None
    device_name: str | None = None
    app_version: str | None = None
    locale: str = "en"
    referral_code: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    is_new_user: bool = False


class UserOut(ORMModel):
    id: uuid.UUID
    public_id: str
    display_name: str | None
    email: str | None
    phone: str | None
    avatar_url: str | None
    locale: str
    coin_balance: int
    is_vip: bool = False
    vip_ends_at: datetime | None = None
    referral_code: str | None
    age_confirmed_at: datetime | None = None
    notification_prefs: dict | None = None
    created_at: datetime


class UpdateMe(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    avatar_url: str | None = None
    locale: str | None = Field(default=None, max_length=10)
    age_confirmed: bool | None = None  # true once the viewer confirms they are an adult
    notification_prefs: dict[str, bool] | None = None


class PushTokenIn(BaseModel):
    """An Expo push token for the device this session belongs to."""

    token: str = Field(min_length=10, max_length=255)


class SessionOut(ORMModel):
    id: uuid.UUID
    platform: Platform
    device_name: str | None
    app_version: str | None
    last_seen_at: datetime | None
    created_at: datetime
    current: bool = False
