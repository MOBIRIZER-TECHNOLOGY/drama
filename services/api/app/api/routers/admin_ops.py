import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.catalog import Series, SeriesTranslation
from app.models.engagement import ContactMessage, Report, ReportStatus
from app.models.identity import User
from app.models.ops import CmsPage, CmsPageTranslation, Language, UiTranslation
from app.schemas.admin import (
    AdminCmsPageOut,
    AdminContactOut,
    AdminLanguageOut,
    AdminReportOut,
    CmsPageIn,
    CmsTranslationIn,
    LanguageIn,
    ReportStatusIn,
    TranslateJobIn,
    TranslationsIn,
)
from app.schemas.common import Ok
from app.services import audit, jobs
from app.services.html import sanitize_body_html

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.editor, AdminRole.support)])


# ---- languages and UI translations ----


@router.get("/languages", response_model=list[AdminLanguageOut])
async def languages(db: DB) -> list[AdminLanguageOut]:
    rows = await db.scalars(select(Language).order_by(Language.sort_order))
    return [AdminLanguageOut.model_validate(x) for x in rows.all()]


@router.put("/languages/{code}", response_model=AdminLanguageOut)
async def upsert_language(code: str, body: LanguageIn, db: DB) -> AdminLanguageOut:
    row = await db.get(Language, code)
    if row is None:
        row = Language(code=code)
        db.add(row)
    for k, v in body.model_dump(exclude={"code"}).items():
        setattr(row, k, v)
    await db.commit()
    return AdminLanguageOut.model_validate(row)


@router.delete("/languages/{code}", response_model=Ok)
async def delete_language(code: str, db: DB) -> Ok:
    if code == "en":
        raise Conflict("English is the source language", code="cannot_delete_source")
    row = await db.get(Language, code)
    if row is None:
        raise NotFound("Language")
    await db.delete(row)
    await db.commit()
    return Ok()


@router.get("/translations/{lang}")
async def get_translations(lang: str, db: DB) -> dict:
    rows = await db.scalars(select(UiTranslation).where(UiTranslation.lang.in_([lang, "en"])))
    source: dict[str, str] = {}
    target: dict[str, dict] = {}
    for r in rows.all():
        if r.lang == "en":
            source[r.key] = r.value
        if r.lang == lang:
            target[r.key] = {"value": r.value, "source": r.source}
    return {"lang": lang, "source": source, "target": target, "missing": [k for k in source if k not in target]}


@router.put("/translations/{lang}", response_model=Ok)
async def put_translations(lang: str, body: TranslationsIn, db: DB) -> Ok:
    if await db.get(Language, lang) is None:
        raise NotFound("Language")
    now = datetime.now(UTC)
    for key, value in body.messages.items():
        row = await db.get(UiTranslation, (lang, key))
        if row is None:
            db.add(UiTranslation(lang=lang, key=key, value=value, source=body.source, updated_at=now))
        else:
            row.value = value
            row.source = body.source
            row.updated_at = now
    await db.commit()
    return Ok()


@router.post("/translations/{lang}/ai")
async def ai_translate(lang: str, body: TranslateJobIn, db: DB) -> dict:
    """Queue the LangGraph translation job for missing (or given) keys. Worker writes results with source=ai."""
    if lang == "en":
        raise Conflict("English is the source language", code="cannot_translate_source")
    data = await get_translations(lang, db)
    keys = body.keys or data["missing"]
    payload = {k: data["source"][k] for k in keys if k in data["source"]}
    if not payload:
        return {"queued": 0}
    job_id = await jobs.enqueue("run_translation", lang, payload, namespace="ui", job_id=f"ui-translate:{lang}")
    return {"queued": len(payload), "job_id": job_id}


# ---- CMS pages ----


async def _page_out(db, p: CmsPage) -> AdminCmsPageOut:
    trs = (await db.scalars(select(CmsPageTranslation).where(CmsPageTranslation.page_id == p.id))).all()
    return AdminCmsPageOut(
        id=p.id,
        slug=p.slug,
        show_in_footer=p.show_in_footer,
        is_published=p.is_published,
        translations=[CmsTranslationIn(lang=t.lang, title=t.title, body_html=t.body_html) for t in trs],
    )


@router.get("/pages", response_model=list[AdminCmsPageOut])
async def pages(db: DB) -> list[AdminCmsPageOut]:
    rows = await db.scalars(select(CmsPage).order_by(CmsPage.slug))
    return [await _page_out(db, p) for p in rows.all()]


@router.post("/pages", response_model=AdminCmsPageOut, status_code=201)
async def create_page(body: CmsPageIn, db: DB) -> AdminCmsPageOut:
    if await db.scalar(select(CmsPage.id).where(CmsPage.slug == body.slug)):
        raise Conflict("Slug already exists", code="slug_taken")
    p = CmsPage(slug=body.slug, show_in_footer=body.show_in_footer, is_published=body.is_published)
    db.add(p)
    await db.flush()
    for t in body.translations:
        db.add(CmsPageTranslation(page_id=p.id, lang=t.lang, title=t.title, body_html=sanitize_body_html(t.body_html)))
    await db.commit()
    return await _page_out(db, p)


@router.put("/pages/{page_id}", response_model=AdminCmsPageOut)
async def update_page(page_id: uuid.UUID, body: CmsPageIn, db: DB) -> AdminCmsPageOut:
    p = await db.get(CmsPage, page_id)
    if p is None:
        raise NotFound("Page")
    p.slug, p.show_in_footer, p.is_published = body.slug, body.show_in_footer, body.is_published
    existing = {
        t.lang: t
        for t in (await db.scalars(select(CmsPageTranslation).where(CmsPageTranslation.page_id == p.id))).all()
    }
    for t in body.translations:
        row = existing.pop(t.lang, None)
        clean = sanitize_body_html(t.body_html)
        if row is None:
            db.add(CmsPageTranslation(page_id=p.id, lang=t.lang, title=t.title, body_html=clean))
        else:
            row.title, row.body_html = t.title, clean
    for row in existing.values():
        await db.delete(row)
    await db.commit()
    return await _page_out(db, p)


@router.delete("/pages/{page_id}", response_model=Ok)
async def delete_page(page_id: uuid.UUID, db: DB) -> Ok:
    p = await db.get(CmsPage, page_id)
    if p is None:
        raise NotFound("Page")
    await db.delete(p)
    await db.commit()
    return Ok()


# ---- reports and inbox ----


@router.get("/reports", response_model=list[AdminReportOut])
async def reports(
    db: DB, status: ReportStatus | None = ReportStatus.open, limit: int = Query(100, le=500)
) -> list[AdminReportOut]:
    stmt = (
        select(Report, User.public_id, SeriesTranslation.title)
        .outerjoin(User, User.id == Report.reporter_id)
        .outerjoin(Series, Series.id == Report.series_id)
        .outerjoin(SeriesTranslation, (SeriesTranslation.series_id == Series.id) & (SeriesTranslation.lang == "en"))
    )
    if status:
        stmt = stmt.where(Report.status == status)
    rows = await db.execute(stmt.order_by(Report.created_at.desc()).limit(limit))
    return [
        AdminReportOut(
            id=r.id,
            reporter_public_id=pub,
            series_id=r.series_id,
            series_title=title,
            episode_id=r.episode_id,
            reason=r.reason,
            details=r.details,
            status=r.status.value,
            created_at=r.created_at,
        )
        for r, pub, title in rows.all()
    ]


@router.put("/reports/{report_id}", response_model=Ok)
async def set_report_status(report_id: uuid.UUID, body: ReportStatusIn, db: DB) -> Ok:
    r = await db.get(Report, report_id)
    if r is None:
        raise NotFound("Report")
    r.status = ReportStatus(body.status)
    await db.commit()
    return Ok()


@router.get("/inbox", response_model=list[AdminContactOut])
async def inbox(db: DB, unread_only: bool = False, limit: int = Query(100, le=500)) -> list[AdminContactOut]:
    stmt = select(ContactMessage)
    if unread_only:
        stmt = stmt.where(ContactMessage.is_read.is_(False))
    rows = await db.scalars(stmt.order_by(ContactMessage.created_at.desc()).limit(limit))
    return [AdminContactOut.model_validate(m) for m in rows.all()]


@router.put("/inbox/{message_id}/read", response_model=Ok)
async def mark_read(message_id: uuid.UUID, db: DB) -> Ok:
    m = await db.get(ContactMessage, message_id)
    if m is None:
        raise NotFound("Message")
    m.is_read = True
    await db.commit()
    return Ok()


@router.delete("/inbox/{message_id}", response_model=Ok)
async def delete_message(message_id: uuid.UUID, db: DB) -> Ok:
    m = await db.get(ContactMessage, message_id)
    if m is None:
        raise NotFound("Message")
    await db.delete(m)
    await db.commit()
    return Ok()


# ---- moderation queue: open reports plus series the metadata graph flagged ----


class ModerationItem(BaseModel):
    kind: str  # report | flagged_series
    id: uuid.UUID
    series_id: uuid.UUID | None
    series_title: str | None
    series_status: str | None
    reason: str
    details: str | None
    created_at: datetime


@router.get("/moderation", response_model=list[ModerationItem])
async def moderation(db: DB) -> list[ModerationItem]:
    from app.models.catalog import Series as S

    items: list[ModerationItem] = []
    for r in await reports(db, status="open", limit=200):
        items.append(
            ModerationItem(
                kind="report",
                id=r.id,
                series_id=r.series_id,
                series_title=r.series_title,
                series_status=None,
                reason=r.reason,
                details=r.details,
                created_at=r.created_at,
            )
        )
    flagged = await db.execute(
        select(S, SeriesTranslation.title)
        .outerjoin(SeriesTranslation, (SeriesTranslation.series_id == S.id) & (SeriesTranslation.lang == "en"))
        .where(S.moderation_flags.is_not(None), func.cardinality(S.moderation_flags) > 0)
        .order_by(S.updated_at.desc())
        .limit(200)
    )
    for s_, title in flagged.all():
        items.append(
            ModerationItem(
                kind="flagged_series",
                id=s_.id,
                series_id=s_.id,
                series_title=title,
                series_status=s_.status.value,
                reason=", ".join(s_.moderation_flags or []),
                details=s_.moderation_note,
                created_at=s_.updated_at,
            )
        )
    return items


class ModerateSeriesIn(BaseModel):
    action: str = Field(pattern="^(clear_flags|unpublish|set_rating)$")
    content_rating: str | None = Field(default=None, pattern="^(U|UA7|UA13|UA16|A)$")
    note: str | None = None

    @model_validator(mode="after")
    def _rating_required(self) -> "ModerateSeriesIn":
        if self.action == "set_rating" and not self.content_rating:
            raise ValueError("content_rating is required for set_rating")
        return self


@router.post("/moderation/series/{series_id}", response_model=Ok)
async def moderate_series(series_id: uuid.UUID, body: ModerateSeriesIn, db: DB, admin: CurrentAdmin) -> Ok:
    """Act on a moderation item, and record who decided what.

    Clearing an AI safety flag, unpublishing a title and changing its rating are all content decisions someone
    may have to defend later — a takedown dispute, a store review, a complaint. None of them left a trace.
    """
    from app.models.catalog import PublishStatus
    from app.models.catalog import Series as S

    s_ = await db.get(S, series_id)
    if s_ is None:
        raise NotFound("Series")

    before = {
        "moderation_flags": list(s_.moderation_flags or []),
        "status": s_.status.value,
        "content_rating": s_.content_rating,
    }
    if body.action == "clear_flags":
        s_.moderation_flags = []
    elif body.action == "unpublish":
        s_.status = PublishStatus.review
    elif body.action == "set_rating":
        s_.content_rating = body.content_rating
    if body.note is not None:
        s_.moderation_note = body.note

    audit.record(
        db,
        admin=admin,
        action=f"moderation.{body.action}",
        target_type="series",
        target_id=s_.id,
        note=body.note,
        before=before,
        after={
            "moderation_flags": list(s_.moderation_flags or []),
            "status": s_.status.value,
            "content_rating": s_.content_rating,
        },
    )
    await db.commit()
    return Ok()


class AuditRow(BaseModel):
    id: uuid.UUID
    admin_email: str | None
    action: str
    target_type: str | None
    target_id: str | None
    note: str | None
    before: dict | None
    after: dict | None
    created_at: datetime


@router.get("/audit", response_model=list[AuditRow], dependencies=[require_role(AdminRole.owner)])
async def audit_log(
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str | None, Query(max_length=64)] = None,
    target_type: Annotated[str | None, Query(max_length=40)] = None,
    target_id: Annotated[str | None, Query(max_length=64)] = None,
) -> list[AuditRow]:
    """Who did what, most recent first.

    Owner-only: the log names admins and the accounts they acted on, which is more than a support role needs.
    """
    rows = await audit.recent(
        db, limit=limit, offset=offset, action=action, target_type=target_type, target_id=target_id
    )
    return [AuditRow.model_validate(r, from_attributes=True) for r in rows]
