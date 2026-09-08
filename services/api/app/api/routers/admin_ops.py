import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, or_, select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.catalog import Series, SeriesTranslation
from app.models.engagement import ContactMessage, Report, ReportStatus
from app.models.identity import User
from app.models.ops import CmsPage, CmsPageTranslation, Language, Notification, UiTranslation
from app.schemas.admin import (
    AdminCmsPageOut,
    AdminCmsPagePage,
    AdminCmsPageSummary,
    AdminContactOut,
    AdminContactPage,
    AdminLanguageOut,
    AdminReportOut,
    AdminReportPage,
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
    """Languages, each with how far its translation has actually got.

    Three grouped counts rather than a query per language: the string keys English defines, how many of them
    each language has, and how many CMS pages each language has a body for.
    """
    rows = list((await db.scalars(select(Language).order_by(Language.sort_order))).all())

    ui_total = (
        await db.scalar(select(func.count()).select_from(UiTranslation).where(UiTranslation.lang == "en"))
    ) or 0
    ui_by_lang = dict(
        (
            await db.execute(select(UiTranslation.lang, func.count()).group_by(UiTranslation.lang))
        ).all()
    )
    pages_total = (await db.scalar(select(func.count()).select_from(CmsPage))) or 0
    pages_by_lang = dict(
        (
            await db.execute(
                select(CmsPageTranslation.lang, func.count(func.distinct(CmsPageTranslation.page_id))).group_by(
                    CmsPageTranslation.lang
                )
            )
        ).all()
    )

    out = []
    for x in rows:
        item = AdminLanguageOut.model_validate(x)
        item.ui_total = ui_total
        item.ui_translated = int(ui_by_lang.get(x.code, 0))
        item.pages_total = pages_total
        item.pages_translated = int(pages_by_lang.get(x.code, 0))
        out.append(item)
    return out


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


@router.get("/pages", response_model=AdminCmsPagePage)
async def pages(
    db: DB,
    q: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminCmsPagePage:
    """Slugs, flags and which languages each page has — paged, searchable, and without the bodies.

    One extra query fetches the titles for the whole page at once; the previous shape ran a query per row and
    returned every body with it.
    """
    stmt = select(CmsPage).order_by(CmsPage.slug)
    count_stmt = select(func.count()).select_from(CmsPage)
    if q:
        needle = f"%{q.strip()}%"
        match = CmsPage.slug.ilike(needle) | CmsPage.id.in_(
            select(CmsPageTranslation.page_id).where(CmsPageTranslation.title.ilike(needle))
        )
        stmt = stmt.where(match)
        count_stmt = count_stmt.where(match)

    total = await db.scalar(count_stmt) or 0
    rows = list((await db.scalars(stmt.offset(offset).limit(limit))).all())
    ids = [p.id for p in rows]
    titles: dict[uuid.UUID, dict[str, str]] = {}
    if ids:
        trs = await db.execute(
            select(CmsPageTranslation.page_id, CmsPageTranslation.lang, CmsPageTranslation.title).where(
                CmsPageTranslation.page_id.in_(ids)
            )
        )
        for page_id, lang, title in trs.all():
            titles.setdefault(page_id, {})[lang] = title

    items = []
    for p in rows:
        by_lang = titles.get(p.id, {})
        items.append(
            AdminCmsPageSummary(
                id=p.id,
                slug=p.slug,
                show_in_footer=p.show_in_footer,
                is_published=p.is_published,
                languages=sorted(by_lang),
                title=by_lang.get("en") or next(iter(by_lang.values()), None),
            )
        )
    return AdminCmsPagePage(items=items, total=total)


@router.get("/pages/{page_id}", response_model=AdminCmsPageOut)
async def page_detail(page_id: uuid.UUID, db: DB) -> AdminCmsPageOut:
    """One page with every translation body — what the editor loads when a row is opened."""
    p = await db.get(CmsPage, page_id)
    if p is None:
        raise NotFound("Page")
    return await _page_out(db, p)


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


@router.get("/reports", response_model=AdminReportPage)
async def reports(
    db: DB,
    status: ReportStatus | None = ReportStatus.open,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    oldest_first: bool = False,
) -> AdminReportPage:
    """Reports, paged, with the total so the screen can stop lying about how much work is left.

    `oldest_first` exists because a queue sorted newest-first is the wrong order for an SLA: the report that has
    been waiting longest is the one that matters.
    """
    stmt = (
        select(Report, User.public_id, SeriesTranslation.title)
        .outerjoin(User, User.id == Report.reporter_id)
        .outerjoin(Series, Series.id == Report.series_id)
        .outerjoin(SeriesTranslation, (SeriesTranslation.series_id == Series.id) & (SeriesTranslation.lang == "en"))
    )
    count_stmt = select(func.count()).select_from(Report)
    if status:
        stmt = stmt.where(Report.status == status)
        count_stmt = count_stmt.where(Report.status == status)
    total = await db.scalar(count_stmt) or 0
    order = Report.created_at.asc() if oldest_first else Report.created_at.desc()
    rows = await db.execute(stmt.order_by(order).offset(offset).limit(limit))
    return AdminReportPage(
        items=[
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
        ],
        total=total,
    )


@router.put("/reports/{report_id}", response_model=Ok)
async def set_report_status(report_id: uuid.UUID, body: ReportStatusIn, db: DB) -> Ok:
    r = await db.get(Report, report_id)
    if r is None:
        raise NotFound("Report")
    r.status = ReportStatus(body.status)
    await db.commit()
    return Ok()


@router.get("/inbox", response_model=AdminContactPage)
async def inbox(
    db: DB,
    unread_only: bool = False,
    q: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminContactPage:
    """Messages, paged and searchable.

    At the old hard cap, finding one complaint among two hundred was manual scrolling, and the unread count in
    the header was computed from the loaded page — so it was wrong the moment the list was truncated.
    """
    stmt = select(ContactMessage)
    count_stmt = select(func.count()).select_from(ContactMessage)
    if unread_only:
        stmt = stmt.where(ContactMessage.is_read.is_(False))
        count_stmt = count_stmt.where(ContactMessage.is_read.is_(False))
    if q:
        needle = f"%{q.strip()}%"
        match = or_(
            ContactMessage.name.ilike(needle),
            ContactMessage.email.ilike(needle),
            ContactMessage.subject.ilike(needle),
            ContactMessage.message.ilike(needle),
        )
        stmt = stmt.where(match)
        count_stmt = count_stmt.where(match)

    total = await db.scalar(count_stmt) or 0
    # Counted over the whole table, not the page: the header badge is a workload, not a sample.
    unread = await db.scalar(select(func.count()).where(ContactMessage.is_read.is_(False))) or 0
    rows = await db.scalars(stmt.order_by(ContactMessage.created_at.desc()).offset(offset).limit(limit))
    return AdminContactPage(
        items=[AdminContactOut.model_validate(m) for m in rows.all()], total=total, unread=unread
    )


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


class ModerationPage(BaseModel):
    """The queue with its real size, and each half counted separately.

    The endpoint took the newest 200 open reports and the newest 200 flagged series and returned them merged,
    saying nothing about either cap. On the day a review-bomb or a bad ingest fills this queue — the only day
    it matters — an operator was working a sample and could not tell.
    """

    items: list[ModerationItem]
    total: int
    reports: int
    flagged: int


@router.get("/moderation", response_model=ModerationPage)
async def moderation(
    db: DB,
    kind: Annotated[str | None, Query(pattern="^(report|flagged_series)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ModerationPage:
    """Open reports and AI-flagged series in one queue, oldest first within each kind.

    Both halves are counted over the whole table before anything is sliced, so the tab badges are workloads
    rather than samples.
    """
    from app.models.catalog import Series as S

    report_count = (
        await db.scalar(select(func.count()).select_from(Report).where(Report.status == ReportStatus.open))
    ) or 0
    flagged_count = (
        await db.scalar(
            select(func.count())
            .select_from(S)
            .where(S.moderation_flags.is_not(None), func.cardinality(S.moderation_flags) > 0)
        )
    ) or 0

    items: list[ModerationItem] = []
    # `reports` returns a page, not a list. Iterating the model itself yields (field, value) pairs, which is a
    # silent 500 rather than a type error — hence `.items`, and the regression test that calls this endpoint.
    open_reports = (
        await reports(db, status=ReportStatus.open, limit=200)
        if kind != "flagged_series"
        else AdminReportPage(items=[], total=0)
    )
    for r in open_reports.items:
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
    flagged_stmt = (
        select(S, SeriesTranslation.title)
        .outerjoin(SeriesTranslation, (SeriesTranslation.series_id == S.id) & (SeriesTranslation.lang == "en"))
        .where(S.moderation_flags.is_not(None), func.cardinality(S.moderation_flags) > 0)
        .order_by(S.updated_at.desc())
        .limit(200)
    )
    flagged = await db.execute(flagged_stmt) if kind != "report" else None
    for s_, title in (flagged.all() if flagged is not None else []):
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

    # Oldest first: a moderation queue is worked from the back, and newest-first buried the report that had
    # been waiting longest under every fresh one.
    items.sort(key=lambda i: i.created_at)
    total = report_count + flagged_count if kind is None else (report_count if kind == "report" else flagged_count)
    return ModerationPage(
        items=items[offset : offset + limit],
        total=total,
        reports=report_count,
        flagged=flagged_count,
    )


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


class AdminAuditPage(BaseModel):
    items: list[AuditRow]
    total: int


@router.get("/audit", response_model=AdminAuditPage, dependencies=[require_role(AdminRole.owner)])
async def audit_log(
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str | None, Query(max_length=64)] = None,
    target_type: Annotated[str | None, Query(max_length=40)] = None,
    target_id: Annotated[str | None, Query(max_length=64)] = None,
) -> AdminAuditPage:
    """Who did what, most recent first, with the size of the filtered set.

    Owner-only: the log names admins and the accounts they acted on, which is more than a support role needs.
    An audit log you can only page blindly through is not evidence; the total is what makes "show me every
    ban in March" answerable.
    """
    rows = await audit.recent(
        db, limit=limit, offset=offset, action=action, target_type=target_type, target_id=target_id
    )
    total = await audit.count(db, action=action, target_type=target_type, target_id=target_id)
    return AdminAuditPage(items=[AuditRow.model_validate(r, from_attributes=True) for r in rows], total=total)


# ---- push notifications ----
#
# The `notifications` table and the worker's `send_push` job both existed and were unreachable: nothing in the
# product could create a row, so a composed announcement was impossible and the job never had an argument.
# This is the missing half.


class NotificationIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=1000)
    # Mirrors the worker's `_resolve_segment`, which resolves an unknown segment to nobody rather than to
    # everybody. Keeping the shapes named here means a typo is a 422 instead of a silent send to no one.
    segment: dict = Field(default_factory=lambda: {"all": True})
    payload: dict | None = None

    @model_validator(mode="after")
    def _known_segment(self) -> "NotificationIn":
        if not any(k in self.segment for k in ("all", "user_id", "locale")):
            raise ValueError("segment must be one of: {'all': true}, {'user_id': ...}, {'locale': ...}")
        return self


class NotificationRow(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    segment: dict | None
    sent_at: datetime | None
    delivered: int
    failed: int
    created_at: datetime


@router.get("/notifications", response_model=list[NotificationRow])
async def list_notifications(db: DB, limit: Annotated[int, Query(ge=1, le=100)] = 50) -> list[NotificationRow]:
    rows = (await db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(limit))).all()
    return [NotificationRow.model_validate(r, from_attributes=True) for r in rows]


# Owner only. A broadcast reaches every active install at once and cannot be recalled, which is a different
# order of blast radius from anything else in this console.
@router.post(
    "/notifications",
    response_model=NotificationRow,
    status_code=201,
    dependencies=[require_role(AdminRole.owner)],
)
async def create_notification(body: NotificationIn, db: DB, admin: CurrentAdmin) -> NotificationRow:
    """Compose an announcement and hand it to the worker. Delivery is the worker's; this only records intent."""
    row = Notification(
        title=body.title.strip(),
        body=body.body.strip(),
        segment=body.segment,
        payload=body.payload,
        created_by=admin.id,
    )
    db.add(row)
    await db.flush()
    # Snapshot before the commit: reading server-defaulted columns off an expired instance afterwards is an
    # IO call in async context, and the response is already fully determined here.
    out = NotificationRow.model_validate(row, from_attributes=True)
    audit.record(
        db,
        admin=admin,
        action="notification.send",
        target_type="notification",
        target_id=str(row.id),
        after={"title": row.title, "segment": row.segment},
    )
    await db.commit()
    # Enqueued after the commit so the worker cannot read a row that is not there yet.
    await jobs.enqueue("send_push", str(row.id), job_id=f"send-push:{row.id}")
    return out
