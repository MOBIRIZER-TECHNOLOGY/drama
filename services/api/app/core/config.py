from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from the environment (prefix KATHA_).

    Secrets never live in the database; only non-secret toggles do (see the settings table).
    """

    model_config = SettingsConfigDict(env_prefix="KATHA_", env_file=".env", extra="ignore")

    env: Literal["local", "test", "staging", "production"] = "local"
    app_name: str = "Katha API"
    api_version: str = "0.1.0"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://localhost:3001"])

    database_url: str = "postgresql+asyncpg://katha:katha@localhost:5432/katha"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "change-me-32-bytes-minimum-please-really"
    jwt_issuer: str = "katha"
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 30

    firebase_project_id: str | None = None
    firebase_service_account_file: str | None = None

    s3_endpoint: str | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str = "katha-media"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    cdn_base_url: str = "http://localhost:9000/katha-media"
    play_token_ttl_seconds: int = 900
    # How the edge validates playback URLs: none (dev only), hmac (nginx/verifier using media_signing_key),
    # cloudfront, bunny. Production refuses to boot with none.
    cdn_signing_mode: Literal["none", "hmac", "cloudfront", "bunny"] = "none"
    media_signing_key: str | None = None  # falls back to jwt_secret outside production

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None
    revenuecat_webhook_secret: str | None = None

    # Public client config served through /v1/config (safe to expose).
    firebase_web_api_key: str | None = None
    firebase_web_auth_domain: str | None = None
    firebase_web_app_id: str | None = None
    firebase_web_messaging_sender_id: str | None = None
    turnstile_site_key: str | None = None
    turnstile_secret_key: str | None = None

    # Product timezone for daily windows (check-in, daily tasks).
    reward_timezone: str = "Asia/Kolkata"

    # Transactional email (admin password reset). Mailpit locally.
    smtp_host: str | None = None
    smtp_port: int = 1025
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = False
    smtp_from: str = "Katha <no-reply@katha.app>"
    admin_base_url: str = "http://localhost:3001"
    site_base_url: str = "http://localhost:3000"

    # Telemetry destinations (optional)
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1
    otlp_endpoint: str | None = None

    # Content safety: ratings that need a confirmed adult viewer.
    adult_ratings: list[str] = Field(default_factory=lambda: ["A", "UA16"])
    # A series with no rating set is treated as adult. Fail closed: an editor who forgets a rating must not be
    # able to publish mature content ungated. Set false only for a catalogue that is entirely general-audience.
    unrated_is_adult: bool = True
    indexnow_key: str | None = None
    semantic_search_timeout_seconds: float = 2.0

    # Economy defaults. Admin can override the non-secret ones in the settings table.
    default_signup_bonus: int = 100
    default_episode_price: int = 50
    default_free_episodes: int = 5
    # A seven-day ladder that ends in a jackpot, so the last day is worth protecting a streak for.
    default_daily_rewards: list[int] = Field(default_factory=lambda: [10, 15, 20, 30, 40, 60, 150])
    default_ad_unlocks_per_day: int = 5
    # Both sides of a referral are paid, otherwise the referrer has nothing to offer when they ask.
    default_referral_reward_coins: int = 100
    default_referee_reward_coins: int = 100
    # Unlocking every remaining episode at once costs this much less than buying them one at a time.
    default_bundle_discount_pct: int = 30

    # Push delivery. Expo relays to FCM and APNs; the access token is only needed for accounts with
    # enhanced security enabled. Without it Expo still accepts sends for tokens issued to this project.
    expo_access_token: str | None = None
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"

    # Google Play Billing: purchases made in the Android app are verified against the Play Developer API
    # before any coins are granted, exactly like a gateway webhook.
    google_play_package_name: str | None = None
    google_play_service_account_file: str | None = None

    @model_validator(mode="after")
    def _production_guard(self) -> "Settings":
        if self.env in ("staging", "production"):
            problems = []
            if self.jwt_secret.startswith("change-me") or len(self.jwt_secret) < 32:
                problems.append("KATHA_JWT_SECRET must be a random value of at least 32 bytes")
            if self.cdn_signing_mode == "none":
                problems.append("KATHA_CDN_SIGNING_MODE must not be 'none'")
            if not self.media_signing_key:
                problems.append("KATHA_MEDIA_SIGNING_KEY must be set")
            if self.stripe_secret_key and not self.stripe_webhook_secret:
                problems.append("KATHA_STRIPE_WEBHOOK_SECRET is required when Stripe is enabled")
            if self.razorpay_key_id and not self.razorpay_webhook_secret:
                problems.append("KATHA_RAZORPAY_WEBHOOK_SECRET is required when Razorpay is enabled")
            if problems:
                raise ValueError("; ".join(problems))
        return self

    @property
    def signing_key(self) -> str:
        return self.media_signing_key or self.jwt_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
