from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DB
from app.core.errors import NotFound
from app.models.ops import CmsPage, CmsPageTranslation, Language, UiTranslation
from app.schemas.content import CmsPageOut, FooterLink, LanguageOut, TranslationsOut

router = APIRouter(tags=["content"])


@router.get("/languages", response_model=list[LanguageOut])
async def languages(db: DB) -> list[LanguageOut]:
    rows = await db.scalars(select(Language).where(Language.is_active.is_(True)).order_by(Language.sort_order))
    return [LanguageOut(code=r.code, name=r.name, native_name=r.native_name, rtl=r.is_rtl) for r in rows.all()]


@router.get("/translations/{lang}", response_model=TranslationsOut)
async def translations(lang: str, db: DB) -> TranslationsOut:
    """UI strings for a language, falling back to English key by key."""
    rows = await db.scalars(select(UiTranslation).where(UiTranslation.lang.in_([lang, "en"])))
    messages: dict[str, str] = {}
    for r in rows.all():
        if r.lang == lang or r.key not in messages:
            messages[r.key] = r.value
    return TranslationsOut(lang=lang, messages=messages)


@router.get("/pages", response_model=list[FooterLink])
async def footer_pages(db: DB, lang: str = "en") -> list[FooterLink]:
    rows = await db.execute(
        select(CmsPage, CmsPageTranslation)
        .join(CmsPageTranslation, CmsPageTranslation.page_id == CmsPage.id)
        .where(
            CmsPage.is_published.is_(True), CmsPage.show_in_footer.is_(True), CmsPageTranslation.lang.in_([lang, "en"])
        )
    )
    best: dict[str, FooterLink] = {}
    for page, tr in rows.all():
        if page.slug not in best or tr.lang == lang:
            best[page.slug] = FooterLink(slug=page.slug, title=tr.title)
    return list(best.values())


@router.get("/pages/{slug}", response_model=CmsPageOut)
async def page(slug: str, db: DB, lang: str = "en") -> CmsPageOut:
    rows = await db.execute(
        select(CmsPage, CmsPageTranslation)
        .join(CmsPageTranslation, CmsPageTranslation.page_id == CmsPage.id)
        .where(CmsPage.slug == slug, CmsPage.is_published.is_(True), CmsPageTranslation.lang.in_([lang, "en"]))
    )
    chosen = None
    for _page, tr in rows.all():
        if chosen is None or tr.lang == lang:
            chosen = tr
    if chosen is None:
        raise NotFound("Page")
    return CmsPageOut(slug=slug, title=chosen.title, body_html=chosen.body_html, lang=chosen.lang)


class SitemapEntry(BaseModel):
    slug: str
    updated_at: datetime
    langs: list[str]
    # Highest published episode number, so the sitemap can list one URL per episode. "<series> episode 12 watch
    # online" is the highest-volume query class in this category and every episode lived behind ?ep=N, which is
    # a query parameter Google will not index as a page.
    episode_count: int = 0


class SitemapOut(BaseModel):
    series: list[SitemapEntry]
    pages: list[str]


@router.get("/sitemap", response_model=SitemapOut)
async def sitemap(db: DB) -> SitemapOut:
    """Feed for the web sitemap: published series with their available languages, and published CMS pages."""
    from sqlalchemy import func
    from sqlalchemy.orm import selectinload

    from app.models.catalog import Episode, PublishStatus, Series

    rows = list(
        (
            await db.scalars(
                select(Series)
                .where(Series.status == PublishStatus.published)
                .options(selectinload(Series.translations))
            )
        ).all()
    )
    counts = dict(
        (
            await db.execute(
                select(Episode.series_id, func.count())
                .where(
                    Episode.series_id.in_([s.id for s in rows]),
                    Episode.status == PublishStatus.published,
                )
                .group_by(Episode.series_id)
            )
        ).all()
    )
    series = [
        SitemapEntry(
            slug=s.slug,
            updated_at=s.updated_at,
            langs=[t.lang for t in s.translations],
            episode_count=counts.get(s.id, 0),
        )
        for s in rows
    ]
    pages = [p.slug for p in (await db.scalars(select(CmsPage).where(CmsPage.is_published.is_(True)))).all()]
    return SitemapOut(series=series, pages=pages)
