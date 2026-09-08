import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.catalog import AssetStatus, PublishStatus
from app.models.identity import AdminRole, Platform, UserStatus
from app.models.wallet import PackKind, PurchaseStatus, RewardFrequency, RewardTaskKind
from app.schemas.common import ORMModel

# ---- catalogue ----


class SeriesTranslationIn(BaseModel):
    lang: str = Field(max_length=10)
    title: str = Field(max_length=200)
    synopsis: str | None = None
    seo_title: str | None = Field(default=None, max_length=70)
    meta_description: str | None = Field(default=None, max_length=200)
    keywords: list[str] | None = None


class SeriesIn(BaseModel):
    slug: str | None = Field(default=None, max_length=160)
    cover_url: str | None = None
    banner_url: str | None = None
    original_language: str = "hi"
    free_episodes: int = Field(default=5, ge=0)
    episode_price: int | None = Field(default=None, ge=0)
    is_featured: bool = False
    is_premium: bool = False
    status: PublishStatus = PublishStatus.draft
    released_at: datetime | None = None
    content_rating: str | None = None
    sort_weight: int = 0
    visible_languages: list[str] | None = None  # None = visible in every language
    territories: list[str] | None = None  # None = every country
    window_starts_at: datetime | None = None
    window_ends_at: datetime | None = None
    moderation_flags: list[str] | None = None
    moderation_note: str | None = None
    category_ids: list[uuid.UUID] = []
    tags: list[str] = []
    translations: list[SeriesTranslationIn] = Field(min_length=1)


class SeriesTranslationOut(ORMModel):
    lang: str
    title: str
    synopsis: str | None
    seo_title: str | None
    meta_description: str | None
    keywords: list[str] | None
    source: str


class AdminEpisodeOut(ORMModel):
    id: uuid.UUID
    number: int
    title: str | None
    thumbnail_url: str | None
    duration_sec: int | None
    video_asset_id: uuid.UUID | None
    asset_status: AssetStatus | None = None
    embed_html: str | None
    price_override: int | None
    is_free_override: bool | None
    status: PublishStatus
    published_at: datetime | None
    scheduled_at: datetime | None = None


class AdminSeriesOut(ORMModel):
    id: uuid.UUID
    slug: str
    cover_url: str | None
    banner_url: str | None
    original_language: str
    free_episodes: int
    episode_price: int | None
    is_featured: bool
    is_premium: bool
    status: PublishStatus
    released_at: datetime | None
    content_rating: str | None
    sort_weight: int
    visible_languages: list[str] | None = None
    territories: list[str] | None = None
    window_starts_at: datetime | None = None
    window_ends_at: datetime | None = None
    moderation_flags: list[str] | None = None
    moderation_note: str | None = None
    view_count: int
    like_count: int
    created_at: datetime
    updated_at: datetime
    translations: list[SeriesTranslationOut]
    category_ids: list[uuid.UUID]
    tags: list[str]
    episode_count: int = 0
    episodes: list[AdminEpisodeOut] = []


class EpisodeIn(BaseModel):
    number: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=200)
    thumbnail_url: str | None = None
    video_asset_id: uuid.UUID | None = None
    embed_html: str | None = None
    price_override: int | None = Field(default=None, ge=0)
    is_free_override: bool | None = None
    status: PublishStatus = PublishStatus.draft
    scheduled_at: datetime | None = None  # drip release: the worker publishes it at this time


class CategoryIn(BaseModel):
    slug: str = Field(max_length=80)
    name: str = Field(max_length=80)
    show_on_home: bool = True
    sort_order: int = 0
    # lang -> name. Blank values delete that language's row, so clearing a field in the console clears it here.
    translations: dict[str, str] = Field(default_factory=dict)


class AdminCategoryOut(ORMModel):
    id: uuid.UUID
    slug: str
    name: str
    show_on_home: bool
    sort_order: int
    # How many series carry this genre. Deleting one detaches it from every series silently, and an empty
    # category still renders an empty rail on home — neither was visible from the list.
    series_count: int = 0
    translations: dict[str, str] = Field(default_factory=dict)


# ---- monetisation ----


class PackPriceIn(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    country: str = Field(default="*", max_length=2)
    amount: float = Field(ge=0)


class PackIn(BaseModel):
    sku: str = Field(max_length=64)
    name: str = Field(max_length=120)
    description: str | None = None
    kind: PackKind
    coins: int = Field(default=0, ge=0)
    bonus_coins: int = Field(default=0, ge=0)
    duration_days: int | None = None
    google_product_id: str | None = None
    apple_product_id: str | None = None
    is_active: bool = True
    sort_order: int = 0
    badge: str | None = None
    prices: list[PackPriceIn] = []


class AdminPackOut(ORMModel):
    id: uuid.UUID
    sku: str
    name: str
    description: str | None
    kind: PackKind
    coins: int
    bonus_coins: int
    duration_days: int | None
    google_product_id: str | None
    apple_product_id: str | None
    is_active: bool
    sort_order: int
    badge: str | None
    prices: list[PackPriceIn] = []


class RewardTaskIn(BaseModel):
    platform: Platform
    kind: RewardTaskKind
    title: str = Field(max_length=160)
    description: str | None = None
    coins: int = Field(ge=1)
    url: str | None = None
    timer_seconds: int = Field(default=0, ge=0)
    frequency: RewardFrequency
    is_active: bool = True
    sort_order: int = 0


class AdminRewardTaskOut(ORMModel):
    id: uuid.UUID
    platform: Platform
    kind: RewardTaskKind
    title: str
    description: str | None
    coins: int
    url: str | None
    timer_seconds: int
    frequency: RewardFrequency
    is_active: bool
    sort_order: int


class SettingsIn(BaseModel):
    data: dict


class PurchaseAdminOut(BaseModel):
    # Surfaced so a dispute that arrives quoting the gateway's own id can be matched without opening the row.
    gateway_payment_id: str | None = None
    external_id: str | None = None
    user_email: str | None = None
    id: uuid.UUID
    user_id: uuid.UUID
    user_public_id: str | None
    pack_name: str
    gateway: str
    status: str
    currency: str
    amount: float
    coins_granted: int
    paid_at: datetime | None
    created_at: datetime


# ---- users ----


class AdminUserOut(ORMModel):
    id: uuid.UUID
    public_id: str
    display_name: str | None
    email: str | None
    phone: str | None
    avatar_url: str | None
    locale: str
    country: str | None
    status: UserStatus
    coin_balance: int
    referral_code: str | None
    created_at: datetime
    last_seen_at: datetime | None


class AdminUserPage(BaseModel):
    items: list[AdminUserOut]
    total: int


class AdminSeriesPage(BaseModel):
    """The catalogue list, with the number of series in it.

    Without a total the console could only say "showing 1-20" — an operator could not tell whether the library
    held 40 series or 4,000, and the pager could not offer page numbers, so reaching the end of a large
    catalogue meant clicking Next until it stopped.
    """

    items: list["AdminSeriesOut"]
    total: int


class AdminPurchasePage(BaseModel):
    """Purchases, with the total and the money in the filtered set.

    Finance reconciles against a number; a page of rows with no count and no sum is not something you can
    reconcile against, and exporting the visible page silently exported a sample.
    """

    items: list["PurchaseAdminOut"]
    total: int
    totals_by_currency: dict[str, float]


class AdminReportPage(BaseModel):
    """Reports with a real total.

    The screen used to take the first N rows and say nothing about the rest, so a review-bomb produced silent
    truncation on exactly the day the page mattered — an operator working a spike had no way to know they were
    seeing a fraction of it.
    """

    items: list["AdminReportOut"]
    total: int


class AdminContactPage(BaseModel):
    items: list["AdminContactOut"]
    total: int
    unread: int


class UserStatusIn(BaseModel):
    status: UserStatus


class CoinAdjustIn(BaseModel):
    delta: int
    note: str = Field(min_length=3, max_length=500)

    @field_validator("delta")
    @classmethod
    def _nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("delta must not be zero")
        return v


class VipGrantIn(BaseModel):
    days: int = Field(ge=1, le=3650)
    note: str | None = None


# ---- ops ----


class LanguageIn(BaseModel):
    code: str = Field(max_length=10)
    name: str = Field(max_length=80)
    native_name: str | None = None
    is_active: bool = True
    is_rtl: bool = False
    sort_order: int = 0


class AdminLanguageOut(ORMModel):
    code: str
    name: str
    native_name: str | None
    is_active: bool
    is_rtl: bool
    sort_order: int
    # How much of the English source this language actually covers. Without it nobody could tell a finished
    # language from one that is 12% done — and a half-translated language shipped as active shows English on
    # the rails that matter, which reads to a viewer as a broken app rather than a missing translation.
    ui_translated: int = 0
    ui_total: int = 0
    pages_translated: int = 0
    pages_total: int = 0


class TranslationsIn(BaseModel):
    messages: dict[str, str]
    source: str = "human"


class TranslateJobIn(BaseModel):
    keys: list[str] | None = None  # None = all keys missing in the target language


class CmsPageIn(BaseModel):
    slug: str = Field(max_length=80)
    show_in_footer: bool = False
    is_published: bool = True
    translations: list["CmsTranslationIn"] = Field(min_length=1)


class CmsTranslationIn(BaseModel):
    lang: str = Field(max_length=10)
    title: str = Field(max_length=200)
    body_html: str


class AdminCmsPageOut(BaseModel):
    id: uuid.UUID
    slug: str
    show_in_footer: bool
    is_published: bool
    translations: list[CmsTranslationIn]


class AdminCmsPageSummary(BaseModel):
    """A row in the pages list, without the bodies.

    The list used to return every page with the full `body_html` of every translation — a query per page on top
    of it — so opening the screen downloaded the entire CMS corpus, in every language, to render a table of
    slugs. A help centre of forty pages in six languages is several megabytes of HTML nobody looks at.
    """

    id: uuid.UUID
    slug: str
    show_in_footer: bool
    is_published: bool
    """Language codes this page has a translation for, so the gaps are visible from the list."""
    languages: list[str]
    """Title in the default language, falling back to any translation there is."""
    title: str | None = None


class AdminCmsPagePage(BaseModel):
    items: list[AdminCmsPageSummary]
    total: int


class AdminReportOut(BaseModel):
    id: uuid.UUID
    reporter_public_id: str | None
    series_id: uuid.UUID | None
    series_title: str | None
    episode_id: uuid.UUID | None
    reason: str
    details: str | None
    status: str
    created_at: datetime


class ReportStatusIn(BaseModel):
    status: str = Field(pattern="^(open|resolved|dismissed)$")


class AdminContactOut(ORMModel):
    id: uuid.UUID
    name: str
    email: str
    subject: str | None
    message: str
    is_read: bool
    replied_at: datetime | None
    created_at: datetime


class AdminUserCreateIn(BaseModel):
    email: str
    display_name: str = Field(max_length=120)
    password: str = Field(min_length=10)
    role: AdminRole


class AdminAccountUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    role: AdminRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10)


class AdminAccountOut(ORMModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: AdminRole
    is_active: bool
    last_login_at: datetime | None
    """Whether this account has a second factor. An owner cannot enrol on someone's behalf, but can see who has."""
    totp_enabled: bool = False


# ---- dashboard ----


class DashboardOut(BaseModel):
    range_days: int
    revenue: dict[str, float]  # by currency
    # The same figures for the preceding window of equal length. Without a comparison a revenue number is
    # decoration: an operator cannot tell whether today is good or bad, which is the whole point of the screen.
    previous: "DashboardPrevious | None" = None
    generated_at: datetime
    purchases_paid: int
    paying_users: int
    new_users: int
    total_users: int
    active_users: int
    series_published: int
    episodes_published: int
    unlocks: int
    unlocks_by_method: dict[str, int]
    coins_spent: int
    coins_granted: int
    daily: list[dict]
    top_series: list[dict]


class DashboardPrevious(BaseModel):
    """Totals for the window immediately before this one, for period-over-period deltas."""

    revenue: dict[str, float]
    purchases_paid: int
    paying_users: int
    new_users: int
    active_users: int
    unlocks: int
    coins_spent: int


class AdminUserPurchase(BaseModel):
    """One purchase, as support needs to read it: what was bought, whether it settled, and what it granted."""

    id: uuid.UUID
    gateway: str
    status: PurchaseStatus
    currency: str
    amount: float
    coins_granted: int
    pack_name: str | None
    gateway_payment_id: str | None
    created_at: datetime
    paid_at: datetime | None


class AdminUserDetail(AdminUserOut):
    """Everything the drawer needs in one call.

    "I paid and got no coins" is the most common support ticket and could not be answered without leaving for
    the Purchases screen and searching by hand — and VIP could be granted blind, because current membership was
    never shown, so a second grant could silently stack on an active pass.
    """

    is_vip: bool = False
    vip_ends_at: datetime | None = None
    purchases: list[AdminUserPurchase] = []
    sessions: int = 0
