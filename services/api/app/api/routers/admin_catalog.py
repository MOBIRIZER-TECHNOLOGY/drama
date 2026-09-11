import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

import structlog
from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
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
from app.models.wallet import EpisodeUnlock
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
from app.services import audit
from app.services.html import validate_embed_html
from app.services.search import LIKE_ESCAPE, like_pattern

log = structlog.get_logger()
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.editor)])

_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return _slug_re.sub("-", text.lower()).strip("-")[:150] or uuid.uuid4().hex[:8]


def _series_out(s: Series, episode_count: int, episodes: list[AdminEpisodeOut] | None = None) -> AdminSeriesOut:
    return AdminSeriesOut(
        id=s.id,
        slug=s.slug,
        # Deliberately unresolved. The console edits these fields and saves them straight back, so what it
        # reads has to be what it writes; resolving here would turn every save into an absolute URL again.
        # It composes its own preview URL from NEXT_PUBLIC_MEDIA_BASE.
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


SeriesSort = Literal["title", "status", "episode_count", "view_count", "like_count", "updated_at", "created_at"]
SortOrder = Literal["asc", "desc"]


def _series_sort_column(sort: SeriesSort):
    """The expression a sort key orders by.

    `title` is the title in the series' own language — the one editors recognise a show by — falling back to
    the slug for a series that has no translation in it yet, so nothing sorts to a null hole. `episode_count`
    is counted in the database rather than from the per-page tally below: the console sorts across the whole
    catalogue, and a count taken after the page was cut would only reorder that page.
    """
    if sort == "title":
        original = (
            select(SeriesTranslation.title)
            .where(SeriesTranslation.series_id == Series.id, SeriesTranslation.lang == Series.original_language)
            .scalar_subquery()
        )
        return func.lower(func.coalesce(original, Series.slug))
    if sort == "episode_count":
        return select(func.count()).where(Episode.series_id == Series.id).scalar_subquery()
    return getattr(Series, sort)


@router.get("/series", response_model=AdminSeriesPage)
async def list_series(
    db: DB,
    q: Annotated[str | None, Query(max_length=120)] = None,
    status: PublishStatus | None = None,
    sort: SeriesSort | None = None,
    order: SortOrder = "desc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminSeriesPage:
    stmt = _series_query()
    count_stmt = select(func.count()).select_from(Series)
    if status:
        stmt = stmt.where(Series.status == status)
        count_stmt = count_stmt.where(Series.status == status)
    if q:
        # Filtered with a semi-join rather than a JOIN ... DISTINCT: a series with two matching translations
        # must appear once, and DISTINCT would refuse to order by anything not in the select list — which the
        # title and episode-count sorts are.
        title_match = SeriesTranslation.title.ilike(like_pattern(q), escape=LIKE_ESCAPE)
        matching = Series.id.in_(select(SeriesTranslation.series_id).where(title_match))
        stmt = stmt.where(matching)
        count_stmt = count_stmt.where(matching)
    total = await db.scalar(count_stmt) or 0
    if sort is None:
        ordering = Series.updated_at.desc()
    else:
        column = _series_sort_column(sort)
        ordering = (column.desc() if order == "desc" else column.asc()).nulls_last()
    # The id tiebreak makes the order total, so paging never shows a row twice or skips one across equal keys.
    rows = list((await db.scalars(stmt.order_by(ordering, Series.id).limit(limit).offset(offset))).all())
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


def _audit_status_change(
    db, admin: CurrentAdmin, *, target_type: str, target_id: uuid.UUID, before: PublishStatus, after: PublishStatus
) -> None:
    """One row when a title's public visibility changes, named for what happened rather than "saved".

    Publishing and unpublishing are the two edits someone may have to account for later — a takedown, a
    licensing complaint, a title that went live early — and a generic "series.update" row would bury them
    among every synopsis correction.
    """
    if before == after:
        return
    if after == PublishStatus.published:
        action = f"{target_type}.publish"
    elif before == PublishStatus.published:
        action = f"{target_type}.unpublish"
    else:
        return
    audit.record(
        db,
        admin=admin,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before={"status": before.value},
        after={"status": after.value},
    )


@router.post("/series", response_model=AdminSeriesOut, status_code=201)
async def create_series(body: SeriesIn, db: DB, admin: CurrentAdmin) -> AdminSeriesOut:
    slug = body.slug or slugify(body.translations[0].title)
    if await db.scalar(select(Series.id).where(Series.slug == slug)):
        raise Conflict("Slug already exists", code="slug_taken")
    s = Series(slug=slug)
    # The check above is advisory; two editors saving the same slug at once both pass it. The unique index is
    # the real guard, and the savepoint turns its failure into the same 409 instead of a 500.
    try:
        async with db.begin_nested():
            db.add(s)
            await db.flush()
    except IntegrityError:
        raise Conflict("Slug already exists", code="slug_taken") from None
    # The flush makes `s` persistent, so every collection `_apply_series` touches becomes a lazy load — and a
    # lazy load on an async session runs outside its greenlet and kills the request with MissingGreenlet.
    # Assigning `s.categories` is enough on its own, because assignment loads the old value first. Every POST
    # to this route 500'd for that reason, and nothing caught it because nothing in the suite created a series
    # through the API. Loading the (empty) collections up front is what `create_category` already does.
    await db.refresh(s, ["translations", "categories", "tags"])
    await _apply_series(db, s, body)
    _audit_status_change(db, admin, target_type="series", target_id=s.id, before=PublishStatus.draft, after=s.status)
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
async def update_series(series_id: uuid.UUID, body: SeriesIn, db: DB, admin: CurrentAdmin) -> AdminSeriesOut:
    s = await db.scalar(_series_query().where(Series.id == series_id))
    if s is None:
        raise NotFound("Series")
    if body.slug and body.slug != s.slug:
        if await db.scalar(select(Series.id).where(Series.slug == body.slug, Series.id != s.id)):
            raise Conflict("Slug already exists", code="slug_taken")
        s.slug = body.slug
    previous_status = s.status
    was_published = previous_status == PublishStatus.published
    await _apply_series(db, s, body)
    _audit_status_change(db, admin, target_type="series", target_id=s.id, before=previous_status, after=s.status)
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
async def delete_series(series_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    s = await db.get(Series, series_id)
    if s is None:
        raise NotFound("Series")
    if await db.scalar(select(EpisodeUnlock.id).where(EpisodeUnlock.series_id == series_id).limit(1)):
        # Paid unlocks reference it: archive, never destroy the evidence of what someone paid for.
        audit.record(
            db,
            admin=admin,
            action="series.archive",
            target_type="series",
            target_id=s.id,
            note="delete requested; archived because paid unlocks reference it",
            before={"status": s.status.value, "slug": s.slug},
            after={"status": PublishStatus.archived.value, "slug": s.slug},
        )
        s.status = PublishStatus.archived
        await db.commit()
        return Ok()
    audit.record(db, admin=admin, action="series.delete", target_type="series", target_id=s.id, before={"slug": s.slug})
    await db.delete(s)
    await db.commit()
    return Ok()


async def _on_publish(s: Series) -> None:
    """Content factory hooks: embeddings + translations, and a search-engine ping. Never fails the request."""
    from app.services import jobs

    try:
        # `retry=True`: re-publishing after an edit must re-run ingestion even if the last run's result is
        # still being kept; a run in flight is deduplicated, which is what a None here means.
        if await jobs.enqueue("run_ingestion", str(s.id), job_id=f"ingest:{s.id}", retry=True) is None:
            log.info("ingest.already_queued", series_id=str(s.id))
        await jobs.enqueue("indexnow_ping", [f"series/{s.slug}"], job_id=f"indexnow:{s.slug}", retry=True)
    except Exception:  # noqa: BLE001 - queue down; a sweeper can re-run ingestion
        log.warning("ingest.enqueue_failed", series_id=str(s.id), exc_info=True)


def _episode_out(e: Episode) -> AdminEpisodeOut:
    out = AdminEpisodeOut.model_validate(e)
    out.asset_status = e.video_asset.status if e.video_asset else None
    return out


@router.post("/series/{series_id}/episodes", response_model=AdminEpisodeOut, status_code=201)
async def create_episode(series_id: uuid.UUID, body: EpisodeIn, db: DB, admin: CurrentAdmin) -> AdminEpisodeOut:
    if await db.get(Series, series_id) is None:
        raise NotFound("Series")
    if await db.scalar(select(Episode.id).where(Episode.series_id == series_id, Episode.number == body.number)):
        raise Conflict(f"Episode {body.number} already exists", code="episode_exists")
    e = Episode(series_id=series_id, **body.model_dump())
    e.embed_html = validate_embed_html(e.embed_html)
    await _sync_asset(db, e)
    try:
        async with db.begin_nested():
            db.add(e)
            await db.flush()
    except IntegrityError:
        raise Conflict(f"Episode {body.number} already exists", code="episode_exists") from None
    _audit_status_change(db, admin, target_type="episode", target_id=e.id, before=PublishStatus.draft, after=e.status)
    await db.commit()
    e = await db.scalar(select(Episode).where(Episode.id == e.id).options(selectinload(Episode.video_asset)))
    return _episode_out(e)


@router.put("/episodes/{episode_id}", response_model=AdminEpisodeOut)
async def update_episode(episode_id: uuid.UUID, body: EpisodeIn, db: DB, admin: CurrentAdmin) -> AdminEpisodeOut:
    e = await db.scalar(select(Episode).where(Episode.id == episode_id).options(selectinload(Episode.video_asset)))
    if e is None:
        raise NotFound("Episode")
    if body.number != e.number and await db.scalar(
        select(Episode.id).where(Episode.series_id == e.series_id, Episode.number == body.number)
    ):
        raise Conflict(f"Episode {body.number} already exists", code="episode_exists")
    previous_status = e.status
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    e.embed_html = validate_embed_html(e.embed_html)
    await _sync_asset(db, e)
    _audit_status_change(db, admin, target_type="episode", target_id=e.id, before=previous_status, after=e.status)
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
async def delete_episode(episode_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    """Delete an episode, unless someone has paid for it — then archive it, as `delete_series` does.

    `episode_unlocks` cascades on episode delete, so removing an episode used to remove the record that a
    viewer spent coins on it, with the ledger row left pointing at nothing. The unlock is the receipt; it is
    kept and the episode is hidden instead.
    """
    e = await db.get(Episode, episode_id)
    if e is None:
        raise NotFound("Episode")
    if await db.scalar(select(EpisodeUnlock.id).where(EpisodeUnlock.episode_id == episode_id).limit(1)):
        audit.record(
            db,
            admin=admin,
            action="episode.archive",
            target_type="episode",
            target_id=e.id,
            note="delete requested; archived because paid unlocks reference it",
            before={"status": e.status.value, "number": e.number},
            after={"status": PublishStatus.archived.value, "number": e.number},
        )
        e.status = PublishStatus.archived
        await db.commit()
        return Ok()
    audit.record(
        db,
        admin=admin,
        action="episode.delete",
        target_type="episode",
        target_id=e.id,
        before={"series_id": str(e.series_id), "number": e.number, "status": e.status.value},
    )
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
    tally = await db.execute(select(SeriesCategory.category_id, func.count()).group_by(SeriesCategory.category_id))
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
    try:
        async with db.begin_nested():
            db.add(c)
            await db.flush()
    except IntegrityError:
        raise Conflict("Slug already exists", code="slug_taken") from None
    await db.commit()
    # `Category.translations` is `lazy="selectin"`, which loads eagerly for objects that came out of a query
    # — and this one never did, it was just inserted. Serialising it therefore triggers a lazy load on an
    # async session outside its greenlet and the request dies with MissingGreenlet. It only bites when the
    # category is created with no translations: supply one and `_apply_translations` populates the collection
    # in memory, which is why creating a category by hand looked fine and creating an untranslated one 500'd.
    await db.refresh(c, ["translations"])
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
    count = await db.scalar(select(func.count()).select_from(SeriesCategory).where(SeriesCategory.category_id == c.id))
    return _category_out(c, count or 0)


@router.delete("/categories/{category_id}", response_model=Ok)
async def delete_category(category_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    c = await db.get(Category, category_id)
    if c is None:
        raise NotFound("Category")
    attached = await db.scalar(
        select(func.count()).select_from(SeriesCategory).where(SeriesCategory.category_id == c.id)
    )
    # Deleting a genre silently detaches it from every series and removes a rail from home; worth a row.
    audit.record(
        db,
        admin=admin,
        action="category.delete",
        target_type="category",
        target_id=c.id,
        before={"slug": c.slug, "name": c.name, "series_count": int(attached or 0)},
    )
    await db.delete(c)
    await db.commit()
    return Ok()
