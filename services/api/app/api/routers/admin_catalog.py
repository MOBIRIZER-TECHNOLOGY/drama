import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.catalog import (
    Category,
    CategoryTranslation,
    Episode,
    PublishStatus,
    Series,
    SeriesCategory,
    SeriesTranslation,
    Tag,
    VideoAsset,
)
from app.schemas.admin import (
    AdminCategoryOut,
    AdminEpisodeOut,
    AdminSeriesOut,
    AdminSeriesPage,
    CategoryIn,
    EpisodeIn,
    SeriesIn,
    SeriesTranslationOut,
)
from app.schemas.common import Ok
from app.services.html import validate_embed_html

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.editor)])

_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return _slug_re.sub("-", text.lower()).strip("-")[:150] or uuid.uuid4().hex[:8]


def _series_out(s: Series, episode_count: int, episodes: list[AdminEpisodeOut] | None = None) -> AdminSeriesOut:
    return AdminSeriesOut(
        id=s.id,
        slug=s.slug,
        cover_url=s.cover_url,
        banner_url=s.banner_url,
        original_language=s.original_language,
        free_episodes=s.free_episodes,
        episode_price=s.episode_price,
        is_featured=s.is_featured,
        is_premium=s.is_premium,
        status=s.status,
        released_at=s.released_at,
        content_rating=s.content_rating,
        sort_weight=s.sort_weight,
        visible_languages=s.visible_languages,
        territories=s.territories,
        window_starts_at=s.window_starts_at,
        window_ends_at=s.window_ends_at,
        moderation_flags=s.moderation_flags,
        moderation_note=s.moderation_note,
        view_count=s.view_count,
        like_count=s.like_count,
        created_at=s.created_at,
        updated_at=s.updated_at,
        translations=[SeriesTranslationOut.model_validate(t) for t in s.translations],
        category_ids=[c.id for c in s.categories],
        tags=[t.name for t in s.tags],
        episode_count=episode_count,
        episodes=episodes or [],
    )


def _series_query():
    return select(Series).options(
        selectinload(Series.translations), selectinload(Series.categories), selectinload(Series.tags)
    )


@router.get("/series", response_model=AdminSeriesPage)
async def list_series(
    db: DB, q: str | None = None, status: PublishStatus | None = None, limit: int = Query(50, le=200), offset: int = 0
) -> AdminSeriesPage:
    stmt = _series_query()
    count_stmt = select(func.count()).select_from(Series)
    if status:
        stmt = stmt.where(Series.status == status)
        count_stmt = count_stmt.where(Series.status == status)
    if q:
        stmt = stmt.join(Series.translations).where(SeriesTranslation.title.ilike(f"%{q}%")).distinct()
        count_stmt = count_stmt.where(
            Series.id.in_(select(SeriesTranslation.series_id).where(SeriesTranslation.title.ilike(f"%{q}%")))
        )
    total = await db.scalar(count_stmt) or 0
    rows = list((await db.scalars(stmt.order_by(Series.updated_at.desc()).limit(limit).offset(offset))).all())
    counts = dict(
        (
            await db.execute(
                select(Episode.series_id, func.count())
                .where(Episode.series_id.in_([s.id for s in rows]))
                .group_by(Episode.series_id)
            )
        ).all()
    )
    return AdminSeriesPage(items=[_series_out(s, counts.get(s.id, 0)) for s in rows], total=total)


async def _apply_series(db, s: Series, body: SeriesIn) -> None:
    for field in (
        "visible_languages",
        "territories",
        "window_starts_at",
        "window_ends_at",
        "moderation_flags",
        "moderation_note",
        "cover_url",
        "banner_url",
        "original_language",
        "free_episodes",
        "episode_price",
        "is_featured",
        "is_premium",
        "status",
        "released_at",
        "content_rating",
        "sort_weight",
    ):
        setattr(s, field, getattr(body, field))
    if body.status == PublishStatus.published and s.released_at is None:
        s.released_at = datetime.now(UTC)
    existing = {t.lang: t for t in s.translations}
    for tr in body.translations:
        row = existing.get(tr.lang)
        if row is None:
            row = SeriesTranslation(series_id=s.id, lang=tr.lang, title=tr.title, source="human")
            s.translations.append(row)
        for field in ("title", "synopsis", "seo_title", "meta_description", "keywords"):
            setattr(row, field, getattr(tr, field))
    keep = {t.lang for t in body.translations}
    for lang, row in existing.items():
        if lang not in keep:
            await db.delete(row)
    cats = (
        list((await db.scalars(select(Category).where(Category.id.in_(body.category_ids)))).all())
        if body.category_ids
        else []
    )
    s.categories = cats
    tags = []
    for name in dict.fromkeys(t.strip() for t in body.tags if t.strip()):
        slug = slugify(name)
        tag = await db.scalar(select(Tag).where(Tag.slug == slug))
        if tag is None:
            tag = Tag(slug=slug, name=name)
            db.add(tag)
            await db.flush()
        tags.append(tag)
    s.tags = tags


@router.post("/series", response_model=AdminSeriesOut, status_code=201)
async def create_series(body: SeriesIn, db: DB, admin: CurrentAdmin) -> AdminSeriesOut:
    slug = body.slug or slugify(body.translations[0].title)
    if await db.scalar(select(Series.id).where(Series.slug == slug)):
        raise Conflict("Slug already exists", code="slug_taken")
    s = Series(slug=slug)
    db.add(s)
    await db.flush()
    await _apply_series(db, s, body)
    await db.commit()
    if s.status == PublishStatus.published:
        await _on_publish(s)
    s = await db.scalar(_series_query().where(Series.id == s.id))
    return _series_out(s, 0)


@router.get("/series/{series_id}", response_model=AdminSeriesOut)
async def get_series(series_id: uuid.UUID, db: DB) -> AdminSeriesOut:
    s = await db.scalar(
        _series_query()
        .where(Series.id == series_id)
        .options(selectinload(Series.episodes).selectinload(Episode.video_asset))
    )
    if s is None:
        raise NotFound("Series")
    eps = [_episode_out(e) for e in s.episodes]
    return _series_out(s, len(eps), eps)


@router.put("/series/{series_id}", response_model=AdminSeriesOut)
async def update_series(series_id: uuid.UUID, body: SeriesIn, db: DB) -> AdminSeriesOut:
    s = await db.scalar(_series_query().where(Series.id == series_id))
    if s is None:
        raise NotFound("Series")
    if body.slug and body.slug != s.slug:
        if await db.scalar(select(Series.id).where(Series.slug == body.slug, Series.id != s.id)):
            raise Conflict("Slug already exists", code="slug_taken")
        s.slug = body.slug
    was_published = s.status == PublishStatus.published
    await _apply_series(db, s, body)
    await db.commit()
    if s.status == PublishStatus.published and not was_published:
        await _on_publish(s)
    s = await db.scalar(
        _series_query()
        .where(Series.id == series_id)
        .options(selectinload(Series.episodes).selectinload(Episode.video_asset))
    )
    eps = [_episode_out(e) for e in s.episodes]
    return _series_out(s, len(eps), eps)


@router.delete("/series/{series_id}", response_model=Ok)
async def delete_series(series_id: uuid.UUID, db: DB) -> Ok:
    s = await db.get(Series, series_id)
    if s is None:
        raise NotFound("Series")
    from app.models.wallet import EpisodeUnlock

    if await db.scalar(select(EpisodeUnlock.id).where(EpisodeUnlock.series_id == series_id).limit(1)):
        s.status = PublishStatus.archived  # paid unlocks reference it: archive, never destroy the evidence
        await db.commit()
        return Ok()
    await db.delete(s)
    await db.commit()
    return Ok()


async def _on_publish(s: Series) -> None:
    """Content factory hooks: embeddings + translations, and a search-engine ping. Never fails the request."""
    from app.services import jobs

    try:
        await jobs.enqueue("run_ingestion", str(s.id), job_id=f"ingest:{s.id}")
        await jobs.enqueue("indexnow_ping", [f"series/{s.slug}"], job_id=f"indexnow:{s.slug}")
    except Exception:  # noqa: BLE001 - queue down; a sweeper can re-run ingestion
        pass


def _episode_out(e: Episode) -> AdminEpisodeOut:
    out = AdminEpisodeOut.model_validate(e)
    out.asset_status = e.video_asset.status if e.video_asset else None
    return out


@router.post("/series/{series_id}/episodes", response_model=AdminEpisodeOut, status_code=201)
async def create_episode(series_id: uuid.UUID, body: EpisodeIn, db: DB) -> AdminEpisodeOut:
    if await db.get(Series, series_id) is None:
        raise NotFound("Series")
    if await db.scalar(select(Episode.id).where(Episode.series_id == series_id, Episode.number == body.number)):
        raise Conflict(f"Episode {body.number} already exists", code="episode_exists")
    e = Episode(series_id=series_id, **body.model_dump())
    e.embed_html = validate_embed_html(e.embed_html)
    await _sync_asset(db, e)
    db.add(e)
    await db.commit()
    e = await db.scalar(select(Episode).where(Episode.id == e.id).options(selectinload(Episode.video_asset)))
    return _episode_out(e)


@router.put("/episodes/{episode_id}", response_model=AdminEpisodeOut)
async def update_episode(episode_id: uuid.UUID, body: EpisodeIn, db: DB) -> AdminEpisodeOut:
    e = await db.scalar(select(Episode).where(Episode.id == episode_id).options(selectinload(Episode.video_asset)))
    if e is None:
        raise NotFound("Episode")
    if body.number != e.number and await db.scalar(
        select(Episode.id).where(Episode.series_id == e.series_id, Episode.number == body.number)
    ):
        raise Conflict(f"Episode {body.number} already exists", code="episode_exists")
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    e.embed_html = validate_embed_html(e.embed_html)
    await _sync_asset(db, e)
    await db.commit()
    e = await db.scalar(select(Episode).where(Episode.id == episode_id).options(selectinload(Episode.video_asset)))
    return _episode_out(e)


async def _sync_asset(db, e: Episode) -> None:
    if e.scheduled_at and e.scheduled_at > datetime.now(UTC) and e.status == PublishStatus.published:
        e.status = PublishStatus.review  # the worker publishes it at scheduled_at
    if e.status == PublishStatus.published and e.published_at is None:
        e.published_at = datetime.now(UTC)
    if e.video_asset_id:
        asset = await db.get(VideoAsset, e.video_asset_id)
        if asset is None:
            raise NotFound("Video asset")
        if asset.duration_sec and not e.duration_sec:
            e.duration_sec = asset.duration_sec


@router.delete("/episodes/{episode_id}", response_model=Ok)
async def delete_episode(episode_id: uuid.UUID, db: DB) -> Ok:
    e = await db.get(Episode, episode_id)
    if e is None:
        raise NotFound("Episode")
    await db.delete(e)
    await db.commit()
    return Ok()


def _category_out(c: Category, series_count: int = 0) -> AdminCategoryOut:
    return AdminCategoryOut(
        id=c.id,
        slug=c.slug,
        name=c.name,
        show_on_home=c.show_on_home,
        sort_order=c.sort_order,
        series_count=series_count,
        translations={t.lang: t.name for t in c.translations},
    )


def _apply_translations(c: Category, translations: dict[str, str]) -> None:
    """Replaces the translation set, dropping blanks so clearing a field removes the row."""
    wanted = {lang: name.strip() for lang, name in translations.items() if name.strip()}
    for tr in list(c.translations):
        if tr.lang in wanted:
            tr.name = wanted.pop(tr.lang)
        else:
            c.translations.remove(tr)
    for lang, name in wanted.items():
        c.translations.append(CategoryTranslation(lang=lang, name=name))


@router.get("/categories", response_model=list[AdminCategoryOut])
async def categories(db: DB) -> list[AdminCategoryOut]:
    rows = await db.scalars(select(Category).order_by(Category.sort_order, Category.name))
    cats = rows.all()
    tally = await db.execute(
        select(SeriesCategory.category_id, func.count()).group_by(SeriesCategory.category_id)
    )
    counts = dict(tally.all())
    return [_category_out(c, counts.get(c.id, 0)) for c in cats]


@router.post("/categories", response_model=AdminCategoryOut, status_code=201)
async def create_category(body: CategoryIn, db: DB) -> AdminCategoryOut:
    if await db.scalar(select(Category.id).where(Category.slug == body.slug)):
        raise Conflict("Slug already exists", code="slug_taken")
    fields = body.model_dump()
    translations = fields.pop("translations", {})
    c = Category(**fields)
    _apply_translations(c, translations)
    db.add(c)
    await db.commit()
    return _category_out(c)


@router.put("/categories/{category_id}", response_model=AdminCategoryOut)
async def update_category(category_id: uuid.UUID, body: CategoryIn, db: DB) -> AdminCategoryOut:
    c = await db.get(Category, category_id)
    if c is None:
        raise NotFound("Category")
    fields = body.model_dump()
    translations = fields.pop("translations", {})
    for k, v in fields.items():
        setattr(c, k, v)
    _apply_translations(c, translations)
    await db.commit()
    count = await db.scalar(
        select(func.count()).select_from(SeriesCategory).where(SeriesCategory.category_id == c.id)
    )
    return _category_out(c, count or 0)


@router.delete("/categories/{category_id}", response_model=Ok)
async def delete_category(category_id: uuid.UUID, db: DB) -> Ok:
    c = await db.get(Category, category_id)
    if c is None:
        raise NotFound("Category")
    await db.delete(c)
    await db.commit()
    return Ok()
