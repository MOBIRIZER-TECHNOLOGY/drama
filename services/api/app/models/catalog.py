import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey


class PublishStatus(str, enum.Enum):
    draft = "draft"
    review = "review"
    published = "published"
    archived = "archived"


class AssetStatus(str, enum.Enum):
    uploaded = "uploaded"
    queued = "queued"
    transcoding = "transcoding"
    ready = "ready"
    failed = "failed"


class Series(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "series"

    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    cover_url: Mapped[str | None] = mapped_column(Text)
    banner_url: Mapped[str | None] = mapped_column(Text)
    trailer_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("video_assets.id"))
    original_language: Mapped[str] = mapped_column(String(10), default="hi", nullable=False)
    free_episodes: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    episode_price: Mapped[int | None] = mapped_column(Integer)  # overrides the global price
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[PublishStatus] = mapped_column(
        Enum(PublishStatus, name="publish_status"), default=PublishStatus.draft, nullable=False
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_rating: Mapped[str | None] = mapped_column(String(8))
    # Territory and licensing windows: nullable now, enforced in phase 5.
    territories: Mapped[list[str] | None] = mapped_column(ARRAY(String(2)))
    window_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    window_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    view_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    like_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    sort_weight: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Content factory and safety
    visible_languages: Mapped[list[str] | None] = mapped_column(ARRAY(String(10)))  # None = every language
    moderation_flags: Mapped[list[str] | None] = mapped_column(ARRAY(String(40)))  # from the metadata graph
    moderation_note: Mapped[str | None] = mapped_column(Text)

    translations: Mapped[list["SeriesTranslation"]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )
    episodes: Mapped[list["Episode"]] = relationship(
        back_populates="series", cascade="all, delete-orphan", order_by="Episode.number"
    )
    categories: Mapped[list["Category"]] = relationship(secondary="series_categories", back_populates="series")
    tags: Mapped[list["Tag"]] = relationship(secondary="series_tags")


class SeriesTranslation(Base):
    __tablename__ = "series_translations"

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    lang: Mapped[str] = mapped_column(String(10), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    synopsis: Mapped[str | None] = mapped_column(Text)
    seo_title: Mapped[str | None] = mapped_column(String(70))
    meta_description: Mapped[str | None] = mapped_column(String(200))
    keywords: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))
    source: Mapped[str] = mapped_column(String(16), default="human", nullable=False)  # human | ai

    series: Mapped[Series] = relationship(back_populates="translations")


class VideoAsset(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "video_assets"

    source_key: Mapped[str] = mapped_column(Text, nullable=False)  # object key of the original
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus, name="asset_status"), default=AssetStatus.uploaded, nullable=False
    )
    hls_master_key: Mapped[str | None] = mapped_column(Text)
    renditions: Mapped[dict | None] = mapped_column(JSONB)  # {"1080p": {...}, "720p": {...}}
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    checksum: Mapped[str | None] = mapped_column(String(64))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)


class Episode(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "episodes"
    __table_args__ = (UniqueConstraint("series_id", "number", name="uq_episode_series_number"),)

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    thumbnail_url: Mapped[str | None] = mapped_column(Text)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    video_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("video_assets.id"))
    embed_html: Mapped[str | None] = mapped_column(Text)  # only for legacy iframe sources
    price_override: Mapped[int | None] = mapped_column(Integer)
    is_free_override: Mapped[bool | None] = mapped_column(Boolean)
    status: Mapped[PublishStatus] = mapped_column(
        Enum(PublishStatus, name="publish_status", create_type=False),
        default=PublishStatus.draft,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # drip release

    series: Mapped[Series] = relationship(back_populates="episodes")
    video_asset: Mapped[VideoAsset | None] = relationship()
    subtitles: Mapped[list["Subtitle"]] = relationship(cascade="all, delete-orphan")


class Subtitle(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "subtitles"
    __table_args__ = (UniqueConstraint("episode_id", "lang", name="uq_subtitle_episode_lang"),)

    episode_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False
    )
    lang: Mapped[str] = mapped_column(String(10), nullable=False)
    vtt_key: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="upload", nullable=False)  # upload | ai


class Category(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "categories"

    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    show_on_home: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    series: Mapped[list[Series]] = relationship(secondary="series_categories", back_populates="categories")


class SeriesCategory(Base):
    __tablename__ = "series_categories"

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )


class Tag(UUIDPrimaryKey, Base):
    __tablename__ = "tags"

    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)


class SeriesTag(Base):
    __tablename__ = "series_tags"

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Embedding(Base):
    __tablename__ = "embeddings"
    __table_args__ = (
        Index(
            "ix_embeddings_vector",
            "vector",
            postgresql_using="hnsw",
            postgresql_ops={"vector": "vector_cosine_ops"},
        ),
    )

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(80), primary_key=True)
    vector: Mapped[list[float]] = mapped_column(Vector(1024), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
