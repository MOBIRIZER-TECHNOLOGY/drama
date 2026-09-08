import asyncio
import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser, OptionalUser, client_country
from app.core.config import get_settings
from app.core.errors import AgeGateRequired, Conflict, Forbidden, NotFound, Unauthorized
from app.core.ratelimit import limiter
from app.core.redis import cache_available, note_cache_failure, note_cache_success, redis_client
from app.models.catalog import Category, Embedding, Episode, PublishStatus, Series, SeriesTranslation, Subtitle
from app.models.engagement import Favorite, Like, WatchProgress
from app.models.wallet import EpisodeUnlock
from app.schemas.catalog import (
    BundleQuoteOut,
    BundleUnlockOut,
    CategoryOut,
    ContinueProgress,
    EpisodeOut,
    HomeOut,
    HomeRail,
    PlayOut,
    SeriesCard,
    SeriesDetail,
    ShortItem,
    ShortsOut,
    SubtitleTrack,
    UnlockOut,
    UnlockRequest,
)
from app.services import access as access_svc
from app.services import config as config_svc
from app.services import recommend
from app.services.media import sign_hls_url, sign_path
from app.services.storage import public_url

log = structlog.get_logger()
router = APIRouter(tags=["catalog"])
GUEST_ID = uuid.UUID(int=0)  # signs playback URLs for anonymous viewers of free episodes

Lang = Annotated[str, Query(max_length=10)]


def _pick_translation(series: Series, lang: str) -> SeriesTranslation | None:
    by_lang = {t.lang: t for t in series.translations}
    return (
        by_lang.get(lang)
        or by_lang.get(series.original_language)
        or by_lang.get("en")
        or (series.translations[0] if series.translations else None)
    )


def _category_out(c: Category, lang: str) -> CategoryOut:
    """A genre name in the viewer's language, falling back to the English name the admin typed."""
    for tr in c.translations:
        if tr.lang == lang:
            return CategoryOut(id=c.id, slug=c.slug, name=tr.name)
    return CategoryOut(id=c.id, slug=c.slug, name=c.name)


def _card(
    series: Series,
    lang: str,
    episode_count: int,
    *,
    first_episode_id: uuid.UUID | None = None,
    progress: ContinueProgress | None = None,
) -> SeriesCard:
    tr = _pick_translation(series, lang)
    return SeriesCard(
        first_episode_id=first_episode_id,
        progress=progress,
        id=series.id,
        slug=series.slug,
        title=tr.title if tr else series.slug,
        synopsis=tr.synopsis if tr else None,
        cover_url=series.cover_url,
        banner_url=series.banner_url,
        is_featured=series.is_featured,
        is_premium=series.is_premium,
        free_episodes=series.free_episodes,
        episode_count=episode_count,
        view_count=series.view_count,
        like_count=series.like_count,
        categories=[_category_out(c, lang) for c in series.categories],
        released_at=series.released_at,
        content_rating=series.content_rating,
        is_adult=_is_adult(series),
        completion_status=series.completion_status,
        release_note=series.release_note,
        updated_at=series.updated_at,
    )


async def _episode_counts(db: AsyncSession, series_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not series_ids:
        return {}
    rows = await db.execute(
        select(Episode.series_id, func.count())
        .where(Episode.series_id.in_(series_ids), Episode.status == PublishStatus.published)
        .group_by(Episode.series_id)
    )
    return {sid: n for sid, n in rows.all()}


async def _first_episode_ids(db: AsyncSession, series_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    """Lowest-numbered published episode per series, so feeds can play without a detail call."""
    if not series_ids:
        return {}
    lowest = (
        select(Episode.series_id, func.min(Episode.number).label("n"))
        .where(Episode.series_id.in_(series_ids), Episode.status == PublishStatus.published)
        .group_by(Episode.series_id)
        .subquery()
    )
    rows = await db.execute(
        select(Episode.series_id, Episode.id).join(
            lowest, (Episode.series_id == lowest.c.series_id) & (Episode.number == lowest.c.n)
        )
    )
    return {sid: eid for sid, eid in rows.all()}


async def _embedding_neighbours(db: AsyncSession, series: Series, *, limit: int) -> list[Series]:
    """Nearest neighbours by embedding, or [] when the vector side is unavailable.

    Everything here depends on pgvector: the extension, the `embeddings` table and the distance operator. Any
    of those can be missing on an environment that has not run the vector migration, and the failure arrives as
    a database error rather than an empty result. This is the "more like this" strip; the caller is the series
    page. Letting it raise took the episode list, the synopsis and the play button down with it, so a broken
    recommendation is reported and swallowed rather than served as a 500.

    The queries run inside a SAVEPOINT because Postgres refuses every further statement on a transaction that
    has already failed, and the caller keeps using this session for the category fallback. A savepoint is what
    makes the failure local: rolling the whole transaction back would work for the connection but expire every
    loaded object, so the next read of `series.categories` would lazily re-query and fail again, in a place
    with no handler for it.
    """
    series_id = series.id
    try:
        async with db.begin_nested():
            own = await db.scalar(select(Embedding).where(Embedding.series_id == series_id).limit(1))
            if own is None:
                return []
            neighbour_ids = (
                await db.scalars(
                    select(Embedding.series_id)
                    .join(Series, Series.id == Embedding.series_id)
                    .where(
                        Embedding.model == own.model,
                        Embedding.series_id != series_id,
                        Series.status == PublishStatus.published,
                    )
                    .order_by(Embedding.vector.cosine_distance(own.vector))
                    .limit(limit)
                )
            ).all()
    except SQLAlchemyError as exc:
        log.warning("similar.embeddings_unavailable", series_id=str(series_id), error=str(exc))
        return []
    if not neighbour_ids:
        return []
    rows = {s.id: s for s in (await db.scalars(_published_series().where(Series.id.in_(neighbour_ids)))).all()}
    return [rows[i] for i in neighbour_ids if i in rows]


async def _similar_series(db: AsyncSession, series: Series, *, limit: int) -> list[Series]:
    """Nearest neighbours by embedding when the series has one; otherwise shared category."""
    neighbours = await _embedding_neighbours(db, series, limit=limit)
    if neighbours:
        return neighbours
    if not series.categories:
        return []
    cat_ids = [c.id for c in series.categories]
    return list(
        (
            await db.scalars(
                _published_series()
                .join(Series.categories)
                .where(Category.id.in_(cat_ids), Series.id != series.id)
                .distinct()
                .limit(limit)
            )
        ).all()
    )


async def _semantic_ids(db: AsyncSession, q: str, *, limit: int) -> list[uuid.UUID]:
    """Vector search for a free-text query. Cached per normalised query; [] when unavailable or slow."""
    try:
        from katha_ai.embeddings import embed_query, model_name
    except ImportError:
        return []
    norm = " ".join(q.lower().split())[:200]
    cache_key = f"semq:{hashlib.sha1(norm.encode()).hexdigest()}"
    vector: list[float] | None = None
    r = None
    try:
        r = await redis_client()
        cached = await r.get(cache_key)
        if cached:
            vector = json.loads(cached)
    except Exception:  # noqa: BLE001 - cache is optional
        r = None
    if vector is None:
        try:
            vector = await asyncio.wait_for(embed_query(norm), timeout=get_settings().semantic_search_timeout_seconds)
        except Exception:  # noqa: BLE001 - provider down or slow: fall back to text search
            return []
        if r is not None:
            try:
                await r.set(cache_key, json.dumps(vector), ex=3600)
            except Exception:  # noqa: BLE001
                pass
    rows = await db.scalars(
        select(Embedding.series_id)
        .join(Series, Series.id == Embedding.series_id)
        .where(Embedding.model == model_name(), Series.status == PublishStatus.published)
        .order_by(Embedding.vector.cosine_distance(vector))
        .limit(limit)
    )
    return list(rows.all())


def _published_series(lang: str | None = None, country: str | None = None):
    """Published, inside its licensing window, visible in this language and territory."""
    now = datetime.now(UTC)
    stmt = (
        select(Series)
        .where(
            Series.status == PublishStatus.published,
            (Series.window_starts_at.is_(None)) | (Series.window_starts_at <= now),
            (Series.window_ends_at.is_(None)) | (Series.window_ends_at > now),
        )
        .options(selectinload(Series.translations), selectinload(Series.categories))
    )
    if lang:
        stmt = stmt.where((Series.visible_languages.is_(None)) | (Series.visible_languages.any(lang)))
    if country:
        stmt = stmt.where((Series.territories.is_(None)) | (Series.territories.any(country)))
    return stmt


def _is_adult(series: Series) -> bool:
    return access_svc.requires_age_gate(series)


@router.get("/home", response_model=HomeOut)
async def home(
    db: DB, ctx: OptionalUser, country: Annotated[str | None, Depends(client_country)], lang: Lang = "en"
) -> HomeOut:
    """All home rails in one call: featured, continue, for you, top picks, newest, one per home category.

    The anonymous response is cached for 60 seconds per language and country.
    """
    cache_key = f"home:{lang}:{country or '*'}"
    # `cache_available()` is what stops a dead Redis costing a timeout on every request. The try/except alone
    # still waits for the connection to fail; this skips it once it has failed enough times to be believed.
    use_cache = ctx is None and cache_available()
    if use_cache:
        try:
            cached = await (await redis_client()).get(cache_key)
            note_cache_success()
            if cached:
                return HomeOut.model_validate_json(cached)
        except Exception:  # noqa: BLE001 - cache optional
            note_cache_failure()
    out = await _build_home(db, ctx, lang, country)
    if use_cache:
        try:
            await (await redis_client()).set(cache_key, out.model_dump_json(), ex=60)
            note_cache_success()
        except Exception:  # noqa: BLE001
            note_cache_failure()
    return out


async def _build_home(db: AsyncSession, ctx, lang: str, country: str | None) -> HomeOut:
    series_rows = list(
        (await db.scalars(_published_series().order_by(Series.sort_weight.desc(), Series.released_at.desc()))).all()
    )
    ids = [s.id for s in series_rows]
    counts = await _episode_counts(db, ids)
    firsts = await _first_episode_ids(db, ids)
    cards = {s.id: _card(s, lang, counts.get(s.id, 0), first_episode_id=firsts.get(s.id)) for s in series_rows}

    rails: list[HomeRail] = []
    featured = [cards[s.id] for s in series_rows if s.is_featured][:8]
    if featured:
        rails.append(HomeRail(key="featured", title="Featured", items=featured))

    if ctx is not None:
        recent = await db.execute(
            select(WatchProgress, Episode)
            .join(Episode, Episode.id == WatchProgress.episode_id)
            .where(WatchProgress.user_id == ctx.user.id, WatchProgress.completed_at.is_(None))
            .order_by(WatchProgress.updated_at.desc())
            .limit(30)
        )
        cont: list[SeriesCard] = []
        seen: set[uuid.UUID] = set()
        for wp, ep in recent.all():
            if wp.series_id in seen or wp.series_id not in cards:
                continue
            seen.add(wp.series_id)
            base = cards[wp.series_id]
            cont.append(
                base.model_copy(
                    update={
                        "progress": ContinueProgress(
                            episode_id=ep.id,
                            episode_number=ep.number,
                            position_sec=wp.position_sec,
                            duration_sec=ep.duration_sec,
                        )
                    }
                )
            )
            if len(cont) >= 12:
                break
        if cont:
            rails.append(HomeRail(key="continue", title="Continue Watching", items=cont))

    if ctx is not None:
        try:
            ids = await recommend.for_you_ids(db, ctx.user.id, limit=12)
        except Exception:  # noqa: BLE001 - embeddings absent or model mismatch
            ids = []
        picks = [cards[i] for i in ids if i in cards]
        if picks:
            rails.append(HomeRail(key="for_you", title="For You", items=picks))

    top = sorted(series_rows, key=lambda s: s.view_count, reverse=True)[:12]
    if top:
        rails.append(HomeRail(key="top_picks", title="Top Picks", items=[cards[s.id] for s in top]))

    newest = sorted(series_rows, key=lambda s: s.released_at or s.created_at, reverse=True)[:12]
    if newest:
        rails.append(HomeRail(key="newest", title="New Releases", items=[cards[s.id] for s in newest]))

    categories = (
        await db.scalars(select(Category).where(Category.show_on_home.is_(True)).order_by(Category.sort_order))
    ).all()
    for cat in categories:
        items = [cards[s.id] for s in series_rows if any(c.id == cat.id for c in s.categories)][:12]
        if items:
            rails.append(HomeRail(key=f"category:{cat.slug}", title=cat.name, items=items))
    return HomeOut(rails=rails)


@router.get("/series", response_model=list[SeriesCard])
@limiter.limit("60/minute")
async def list_series(
    request: Request,
    db: DB,
    country: Annotated[str | None, Depends(client_country)],
    lang: Lang = "en",
    category: str | None = None,
    q: str | None = None,
    sort: Annotated[str, Query(pattern="^(featured|popular|newest|updated)$")] = "featured",
    status: Annotated[str | None, Query(pattern="^(ongoing|completed)$")] = None,
    length: Annotated[str | None, Query(pattern="^(short|medium|long)$")] = None,
    limit: Annotated[int, Query(le=100)] = 40,
    offset: int = 0,
) -> list[SeriesCard]:
    """The catalogue, filtered and ordered.

    `sort` exists because the editorial order was the only order a visitor could have: someone looking for
    what is popular, or what landed this week, had no way to ask. `featured` keeps the operator's own weighting
    and stays the default, so nothing about the curated experience changes unless the visitor asks it to.

    `status` and `length` are the two questions this audience actually asks of a short-drama catalogue — "is it
    finished so I can binge it" and "how much am I committing to" — and neither could be asked at all.
    """
    stmt = _published_series(lang, country)
    if category:
        stmt = stmt.join(Series.categories).where(Category.slug == category)
    if status == "completed":
        stmt = stmt.where(Series.completion_status == "completed")
    elif status == "ongoing":
        # NULL means the operator never said, and an unmarked series is far more likely still running than
        # finished — treating it as completed would promise an ending that may not exist.
        stmt = stmt.where(func.coalesce(Series.completion_status, "ongoing") != "completed")
    if length:
        episodes = (
            select(func.count())
            .select_from(Episode)
            .where(Episode.series_id == Series.id, Episode.status == PublishStatus.published)
            .correlate(Series)
            .scalar_subquery()
        )
        bounds = {"short": (0, 20), "medium": (20, 60), "long": (60, None)}[length]
        stmt = stmt.where(episodes >= bounds[0]) if bounds[0] else stmt
        if bounds[1] is not None:
            stmt = stmt.where(episodes < bounds[1])
    rows: list[Series] = []
    if q and offset == 0 and (semantic_ids := await _semantic_ids(db, q, limit=limit)):
        found = {s.id: s for s in (await db.scalars(stmt.where(Series.id.in_(semantic_ids)))).all()}
        rows = [found[i] for i in semantic_ids if i in found]
    else:
        if q:
            stmt = stmt.join(Series.translations).where(SeriesTranslation.title.ilike(f"%{q}%")).distinct()
        # A stable tiebreak on id keeps paging deterministic: without it two series with equal weight can
        # swap places between pages and one of them is never shown.
        order = {
            "popular": (Series.view_count.desc(), Series.id),
            "newest": (Series.released_at.desc().nullslast(), Series.id),
            "updated": (Series.updated_at.desc(), Series.id),
        }.get(sort, (Series.sort_weight.desc(), Series.released_at.desc().nullslast(), Series.id))
        stmt = stmt.order_by(*order).limit(limit).offset(offset)
        rows = list((await db.scalars(stmt)).all())
    ids = [s.id for s in rows]
    counts = await _episode_counts(db, ids)
    firsts = await _first_episode_ids(db, ids)
    return [_card(s, lang, counts.get(s.id, 0), first_episode_id=firsts.get(s.id)) for s in rows]


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: DB, lang: str = "en") -> list[CategoryOut]:
    rows = await db.scalars(select(Category).order_by(Category.sort_order, Category.name))
    return [_category_out(c, lang) for c in rows.all()]


BROWSE_SERIES_CAP = 400


@router.get("/browse", response_model=HomeOut)
async def browse(
    db: DB,
    country: Annotated[str | None, Depends(client_country)],
    lang: Lang = "en",
    per_category: Annotated[int, Query(ge=1, le=40)] = 12,
) -> HomeOut:
    """Every category with its top series, in one request.

    The browse page used to fetch the catalogue and then make one more request per category — 1 + N round trips
    on every revalidation, which is most of its time to first byte. Grouping happens here instead, over a single
    set of queries, and the shape matches `/home` so the client renders it with the same rail component.

    An uncategorised rail is appended when there is anything in it, so nothing in the catalogue is unreachable.
    """
    series = list(
        (
            await db.scalars(
                _published_series(lang, country)
                .order_by(Series.is_featured.desc(), Series.sort_weight.desc(), Series.view_count.desc(), Series.id)
                .limit(BROWSE_SERIES_CAP)
            )
        ).all()
    )
    if not series:
        return HomeOut(rails=[])

    counts = await _episode_counts(db, [s.id for s in series])
    firsts = await _first_episode_ids(db, [s.id for s in series])

    def card(s: Series) -> SeriesCard:
        return _card(s, lang, counts.get(s.id, 0), first_episode_id=firsts.get(s.id))

    categories = list((await db.scalars(select(Category).order_by(Category.sort_order, Category.name))).all())
    rails: list[HomeRail] = []
    for category in categories:
        items = [card(s) for s in series if any(c.id == category.id for c in s.categories)][:per_category]
        if items:
            rails.append(HomeRail(key=f"category:{category.slug}", title=category.name, items=items))

    loose = [card(s) for s in series if not s.categories][:per_category]
    if loose:
        rails.append(HomeRail(key="uncategorised", title="More on Katha", items=loose))
    return HomeOut(rails=rails)


async def _load_series(
    db: AsyncSession, id_or_slug: str, lang: str | None = None, country: str | None = None
) -> Series:
    stmt = _published_series(lang, country).options(selectinload(Series.episodes))
    try:
        stmt = stmt.where(Series.id == uuid.UUID(id_or_slug))
    except ValueError:
        stmt = stmt.where(Series.slug == id_or_slug)
    series = await db.scalar(stmt)
    if series is None:
        raise NotFound("Series")
    return series


@router.get("/series/{id_or_slug}", response_model=SeriesDetail)
async def series_detail(
    id_or_slug: str,
    db: DB,
    ctx: OptionalUser,
    country: Annotated[str | None, Depends(client_country)],
    lang: Lang = "en",
) -> SeriesDetail:
    series = await _load_series(db, id_or_slug, lang, country)
    published = [e for e in series.episodes if e.status == PublishStatus.published]
    vip = await access_svc.is_vip(db, ctx.user.id) if ctx else False
    unlocked = await access_svc.unlocked_episode_ids(db, ctx.user.id, series.id) if ctx else set()

    episodes = []
    for ep in published:
        free = access_svc.episode_is_free(series, ep)
        episodes.append(
            EpisodeOut(
                id=ep.id,
                number=ep.number,
                title=ep.title,
                thumbnail_url=ep.thumbnail_url,
                duration_sec=ep.duration_sec,
                is_free=free,
                price=access_svc.episode_price(series, ep),
                accessible=free or vip or ep.id in unlocked,
                unlocked=ep.id in unlocked,
            )
        )

    is_fav = is_liked = False
    continue_number = None
    if ctx:
        is_fav = (await db.get(Favorite, (ctx.user.id, series.id))) is not None
        is_liked = (await db.get(Like, (ctx.user.id, series.id))) is not None
        wp = await db.scalar(
            select(WatchProgress)
            .where(WatchProgress.user_id == ctx.user.id, WatchProgress.series_id == series.id)
            .order_by(WatchProgress.updated_at.desc())
            .limit(1)
        )
        if wp:
            ep_by_id = {e.id: e for e in published}
            continue_number = ep_by_id[wp.episode_id].number if wp.episode_id in ep_by_id else None

    # Similar series: same category for now; embeddings replace this in phase 3.
    similar_rows = await _similar_series(db, series, limit=8)
    all_ids = [series.id] + [s.id for s in similar_rows]
    counts = await _episode_counts(db, all_ids)
    firsts = await _first_episode_ids(db, all_ids)
    tr = _pick_translation(series, lang)
    base = _card(series, lang, counts.get(series.id, 0), first_episode_id=firsts.get(series.id))
    return SeriesDetail(
        **base.model_dump(),
        seo_title=tr.seo_title if tr else None,
        meta_description=tr.meta_description if tr else None,
        episodes=episodes,
        is_favorite=is_fav,
        is_liked=is_liked,
        continue_episode_number=continue_number,
        similar=[_card(s, lang, counts.get(s.id, 0), first_episode_id=firsts.get(s.id)) for s in similar_rows],
    )


@router.post("/episodes/{episode_id}/unlock", response_model=UnlockOut)
@limiter.limit("30/minute")
async def unlock(request: Request, episode_id: uuid.UUID, body: UnlockRequest, ctx: CurrentUser, db: DB) -> UnlockOut:
    variants = await config_svc.variant_map(db, ctx.user.id)
    row = await access_svc.unlock_episode(
        db,
        user=ctx.user,
        episode_id=episode_id,
        method=body.method,
        variant_map=variants or None,
        ad_event_id=body.ad_event_id,
    )
    await db.commit()
    await db.refresh(ctx.user)
    return UnlockOut(episode_id=row.episode_id, method=row.method, coin_balance=ctx.user.coin_balance)


SHORTS_SERIES_PER_PAGE = 8
# Episodes emitted per series: the free run plus the first locked one, so the paywall is reached inside the
# feed instead of only on the series page. This is the whole mechanic — swipe, swipe, cliffhanger, offer.
SHORTS_MAX_PER_SERIES = 6


@router.get("/shorts", response_model=ShortsOut)
async def shorts(
    db: DB,
    ctx: OptionalUser,
    country: Annotated[str | None, Depends(client_country)],
    lang: Lang = "en",
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=40)] = 20,
) -> ShortsOut:
    """The vertical feed, as a chain of episodes rather than a carousel of first episodes.

    Each series contributes a run: its free episodes followed by the first locked one. Swiping therefore
    continues the story the viewer is watching until it asks them to pay, which is the loop this format exists
    for. A page ends on a series boundary so a run is never split across two requests.
    """
    offset = 0
    if cursor and cursor.isdigit():
        offset = min(int(cursor), 10_000)

    rows = list(
        (
            await db.scalars(
                _published_series(lang, country)
                .order_by(Series.is_featured.desc(), Series.sort_weight.desc(), Series.view_count.desc(), Series.id)
                .offset(offset)
                .limit(SHORTS_SERIES_PER_PAGE)
            )
        ).all()
    )
    if not rows:
        return ShortsOut(items=[], next_cursor=None)

    series_ids = [s.id for s in rows]
    counts = await _episode_counts(db, series_ids)
    episodes = list(
        (
            await db.scalars(
                select(Episode)
                .where(Episode.series_id.in_(series_ids), Episode.status == PublishStatus.published)
                .order_by(Episode.series_id, Episode.number)
            )
        ).all()
    )
    by_series: dict[uuid.UUID, list[Episode]] = {}
    for ep in episodes:
        by_series.setdefault(ep.series_id, []).append(ep)

    unlocked: set[uuid.UUID] = set()
    favourites: set[uuid.UUID] = set()
    liked: set[uuid.UUID] = set()
    vip = False
    if ctx is not None:
        vip = await access_svc.is_vip(db, ctx.user.id)
        unlocked = set(
            (
                await db.scalars(
                    select(EpisodeUnlock.episode_id).where(
                        EpisodeUnlock.user_id == ctx.user.id, EpisodeUnlock.series_id.in_(series_ids)
                    )
                )
            ).all()
        )
        favourites = set(
            (
                await db.scalars(
                    select(Favorite.series_id).where(
                        Favorite.user_id == ctx.user.id, Favorite.series_id.in_(series_ids)
                    )
                )
            ).all()
        )
        liked = set(
            (
                await db.scalars(
                    select(Like.series_id).where(Like.user_id == ctx.user.id, Like.series_id.in_(series_ids))
                )
            ).all()
        )

    items: list[ShortItem] = []
    consumed = 0
    for series in rows:
        if len(items) >= limit:
            break
        consumed += 1
        run = by_series.get(series.id, [])[:SHORTS_MAX_PER_SERIES]
        tr = _pick_translation(series, lang)
        for i, ep in enumerate(run):
            free = access_svc.episode_is_free(series, ep)
            accessible = free or vip or ep.id in unlocked
            items.append(
                ShortItem(
                    episode_id=ep.id,
                    episode_number=ep.number,
                    episode_title=ep.title,
                    thumbnail_url=ep.thumbnail_url,
                    duration_sec=ep.duration_sec,
                    is_free=free,
                    price=access_svc.episode_price(series, ep),
                    accessible=accessible,
                    series_id=series.id,
                    slug=series.slug,
                    title=tr.title if tr else series.slug,
                    synopsis=tr.synopsis if tr else None,
                    cover_url=series.cover_url,
                    categories=[_category_out(c, lang) for c in series.categories],
                    episode_count=counts.get(series.id, 0),
                    free_episodes=series.free_episodes,
                    content_rating=series.content_rating,
                    is_adult=_is_adult(series),
                    is_favorite=series.id in favourites,
                    is_liked=series.id in liked,
                    starts_series=i == 0,
                )
            )
            # Stop the run one past the free episodes: the first lock is the offer, the rest is the series page.
            if not free:
                break

    # Only advance past series actually emitted, so nothing is skipped between pages.
    next_cursor = str(offset + consumed) if len(rows) == SHORTS_SERIES_PER_PAGE else None
    return ShortsOut(items=items, next_cursor=next_cursor)


@router.get("/series/{series_id}/bundle", response_model=BundleQuoteOut)
async def bundle_quote(series_id: uuid.UUID, ctx: CurrentUser, db: DB) -> BundleQuoteOut:
    """Price every episode the viewer cannot yet watch, as one purchase. Creates nothing."""
    series = await db.get(Series, series_id)
    if series is None or series.status != PublishStatus.published:
        raise NotFound("Series")
    quote = await access_svc.quote_series_bundle(db, user=ctx.user, series=series)
    return BundleQuoteOut(
        series_id=series.id,
        episode_count=quote.count,
        list_price=quote.list_price,
        price=quote.price,
        discount_pct=quote.discount_pct,
        saving=quote.saving,
        affordable=ctx.user.coin_balance >= quote.price,
        coin_balance=ctx.user.coin_balance,
    )


@router.post("/series/{series_id}/bundle", response_model=BundleUnlockOut)
@limiter.limit("10/minute")
async def unlock_bundle(request: Request, series_id: uuid.UUID, ctx: CurrentUser, db: DB) -> BundleUnlockOut:
    """Unlock the rest of the series in one transaction, at the bundle discount."""
    variants = await config_svc.variant_map(db, ctx.user.id)
    before = ctx.user.coin_balance
    rows = await access_svc.unlock_series_bundle(
        db, user=ctx.user, series_id=series_id, variant_map=variants or None
    )
    await db.commit()
    await db.refresh(ctx.user)
    return BundleUnlockOut(
        series_id=series_id,
        episode_ids=[r.episode_id for r in rows],
        spent=before - ctx.user.coin_balance,
        coin_balance=ctx.user.coin_balance,
    )


@router.post("/episodes/{episode_id}/play", response_model=PlayOut)
async def play(episode_id: uuid.UUID, ctx: OptionalUser, db: DB) -> PlayOut:
    """Access check, then a short-lived signed playback URL. Locked episodes never get a URL.

    Guests may play free episodes (the hook before sign-up); anything else needs a session.
    """
    episode = await db.scalar(
        select(Episode)
        .where(Episode.id == episode_id, Episode.status == PublishStatus.published)
        .options(selectinload(Episode.video_asset), selectinload(Episode.series))
    )
    if episode is None:
        raise NotFound("Episode")
    series = episode.series
    if _is_adult(series):
        if ctx is None:
            raise Unauthorized("Sign in to watch this episode")
        if ctx.user.age_confirmed_at is None:
            raise AgeGateRequired("Confirm your age to watch this episode")
    if ctx is None:
        if not access_svc.episode_is_free(series, episode):
            raise Unauthorized("Sign in to watch this episode")
        signer_id = GUEST_ID
    else:
        allowed = (
            access_svc.episode_is_free(series, episode)
            or await access_svc.is_vip(db, ctx.user.id)
            or episode.id in await access_svc.unlocked_episode_ids(db, ctx.user.id, series.id)
        )
        if not allowed:
            raise Forbidden("Episode is locked")
        signer_id = ctx.user.id

    ttl = get_settings().play_token_ttl_seconds
    expires = datetime.now(UTC) + timedelta(seconds=ttl)
    hls_url = None
    asset = episode.video_asset
    if asset and asset.hls_master_key:
        if asset.is_encrypted:
            # Encrypted assets are played through the manifest routes rather than straight off the CDN: the
            # key URL inside the manifest has to be minted for this viewer and this moment, which a static
            # file on a CDN cannot be. Segments still come from the CDN; only the manifests pass through here.
            path = f"/v1/stream/{asset.id}/master.m3u8"
            query = sign_path(path, user_id=signer_id, expires=expires)
            hls_url = f"{get_settings().api_base_url.rstrip('/')}{path}?{query}"
        else:
            hls_url = sign_hls_url(asset.hls_master_key, user_id=signer_id, expires=expires)
    if hls_url is None and not episode.embed_html:
        raise Conflict("Episode video is still being prepared", code="asset_not_ready")

    subs = (await db.scalars(select(Subtitle).where(Subtitle.episode_id == episode.id))).all()
    wp = await db.get(WatchProgress, (ctx.user.id, episode.id)) if ctx else None
    next_ep = await db.scalar(
        select(Episode.id).where(
            Episode.series_id == series.id,
            Episode.number == episode.number + 1,
            Episode.status == PublishStatus.published,
        )
    )
    return PlayOut(
        episode_id=episode.id,
        hls_url=hls_url,
        embed_html=episode.embed_html,
        expires_at=expires,
        resume_position_sec=wp.position_sec if wp else 0,
        next_episode_id=next_ep,
        subtitles=[SubtitleTrack(lang=x.lang, url=public_url(x.vtt_key)) for x in subs],
    )
