"""Typed remote config. Namespaces keep an open shape (admins add keys), but their known fields are declared."""

from pydantic import BaseModel, ConfigDict


class OpenModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class SiteConfig(OpenModel):
    name: str = "Katha"
    url: str | None = None
    captcha_site_key: str | None = None


class PaymentsConfig(BaseModel):
    gateways: list[str] = []  # configured and enabled, in display order


class FirebaseWebConfig(BaseModel):
    api_key: str
    auth_domain: str | None = None
    project_id: str | None = None
    app_id: str | None = None
    messaging_sender_id: str | None = None


class AuthConfig(OpenModel):
    email: bool = True
    google: bool = True
    apple: bool = True
    phone: bool = True
    facebook: bool = False


class EconomyConfig(OpenModel):
    coins_enabled: bool = True
    currency: str = "INR"
    currency_symbol: str = "₹"
    episode_price: int = 50
    free_episodes: int = 5
    ad_unlocks_per_day: int = 5
    bundle_discount_pct: int = 30


class RewardsConfig(OpenModel):
    enabled: bool = True
    daily_rewards: list[int] = [10, 15, 20, 30, 40, 60, 150]
    signup_bonus: int = 100


class ReferralConfig(OpenModel):
    enabled: bool = True
    referrer_coins: int = 100
    referee_coins: int = 100


class NotificationsConfig(BaseModel):
    channels: list[str] = []


class MobileConfig(OpenModel):
    min_version_code: int = 1
    force_update: bool = False
    update_url: str | None = None
    privacy_policy_url: str | None = None
    terms_url: str | None = None
    rate_us_url: str | None = None


class ConfigLanguage(BaseModel):
    code: str
    name: str
    native_name: str | None = None
    rtl: bool = False


class ConfigOut(BaseModel):
    platform: str
    site: SiteConfig
    payments: PaymentsConfig
    firebase: FirebaseWebConfig | None = None
    auth: AuthConfig
    economy: EconomyConfig
    rewards: RewardsConfig
    referral: ReferralConfig = ReferralConfig()
    notifications: NotificationsConfig = NotificationsConfig()
    mobile: MobileConfig
    languages: list[ConfigLanguage]
    flags: dict[str, bool]
    variants: dict[str, str]
