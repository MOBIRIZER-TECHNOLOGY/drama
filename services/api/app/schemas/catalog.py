import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.wallet import UnlockMethod


class CategoryOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str


class ContinueProgress(BaseModel):
    episode_id: uuid.UUID
    episode_number: int
    position_sec: int
    duration_sec: int | None


class SeriesCard(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    synopsis: str | None
    cover_url: str | None
    banner_url: str | None
    is_featured: bool
    is_premium: bool
    free_episodes: int
    episode_count: int
    view_count: int
    like_count: int
    categories: list[CategoryOut]
    released_at: datetime | None
    content_rating: str | None = None  # U | UA7 | UA13 | UA16 | A
    is_adult: bool = False  # rating needs a confirmed adult viewer; clients can pre-warn
    # "Ongoing" / "Completed", and the drip promise ("New episodes every Friday"). A dripping-series app lives on
    # the next-episode promise, so both belong on the card, not only the detail page.
    completion_status: str | None = None
    release_note: str | None = None
    updated_at: datetime | None = None  # drives the "new episode" badge on clients
    first_episode_id: uuid.UUID | None = None  # lowest published episode, for feeds
    progress: ContinueProgress | None = None  # only on the continue-watching rail


class EpisodeOut(BaseModel):
    id: uuid.UUID
    number: int
    title: str | None
    thumbnail_url: str | None
    duration_sec: int | None
    is_free: bool
    price: int
    # Access state for the calling user. Never carries a media URL; use /play for that.
    accessible: bool
    unlocked: bool


class SeriesDetail(SeriesCard):
    seo_title: str | None
    meta_description: str | None
    episodes: list[EpisodeOut]
    is_favorite: bool
    is_liked: bool
    continue_episode_number: int | None
    similar: list[SeriesCard]


class HomeRail(BaseModel):
    key: str  # featured | continue | top_picks | category:<slug> | newest
    title: str
    items: list[SeriesCard]


class HomeOut(BaseModel):
    rails: list[HomeRail]


class UnlockRequest(BaseModel):
    method: UnlockMethod
    ad_event_id: str | None = None


class UnlockOut(BaseModel):
    episode_id: uuid.UUID
    method: UnlockMethod
    coin_balance: int


class BundleQuoteOut(BaseModel):
    """What "unlock everything left" costs, so the paywall can price the offer before the viewer commits."""

    series_id: uuid.UUID
    episode_count: int
    list_price: int
    price: int
    discount_pct: int
    saving: int
    affordable: bool
    coin_balance: int


class BundleUnlockOut(BaseModel):
    series_id: uuid.UUID
    episode_ids: list[uuid.UUID]
    spent: int
    coin_balance: int


class SubtitleTrack(BaseModel):
    lang: str
    url: str


class PlayOut(BaseModel):
    """Short-lived playback grant. The URL is CDN-signed for this user and episode."""

    episode_id: uuid.UUID
    hls_url: str | None
    embed_html: str | None
    expires_at: datetime
    resume_position_sec: int
    next_episode_id: uuid.UUID | None
    subtitles: list[SubtitleTrack] = []
