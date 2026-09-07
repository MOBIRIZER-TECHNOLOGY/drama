"""Admin AI actions. Metadata generation runs inline (seconds); everything else is a queued job."""

import asyncio
import uuid

import structlog
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.deps import DB, AdminRole, require_role
from app.core.errors import AppError, NotFound
from app.core.ratelimit import limiter
from app.models.catalog import Episode, Series
from app.services import jobs

log = structlog.get_logger()
router = APIRouter(prefix="/admin/ai", tags=["admin"], dependencies=[require_role(AdminRole.editor)])


class MetadataIn(BaseModel):
    seed: str = Field(min_length=3, max_length=4000, description="Logline, notes, or a pasted synopsis")
    language: str = Field(default="English", max_length=40)
    title: str | None = None
    synopsis: str | None = None
    transcript: str | None = Field(default=None, max_length=20000)


class MetadataOut(BaseModel):
    title: str
    synopsis: str
    genres: list[str]
    tags: list[str]
    seo_title: str
    meta_description: str
    keywords: list[str]
    slug: str
    content_rating: str
    moderation_flags: list[str]
    confidence: float


class JobOut(BaseModel):
    job_id: str | None
    queued: bool = True


@router.post("/series-metadata", response_model=MetadataOut)
@limiter.limit("10/minute")
async def series_metadata(request: Request, body: MetadataIn) -> MetadataOut:
    """Draft title, synopsis, genres, tags, SEO and a rating from a seed. Goes to the form for human approval."""
    try:
        from katha_ai.graphs.metadata import generate_metadata
    except ImportError as exc:  # katha-ai not installed in this deployment
        raise AppError("AI features are not installed on this API", status_code=503, code="ai_unavailable") from exc
    try:
        result = await asyncio.wait_for(
            generate_metadata(
                seed=body.seed,
                language=body.language,
                title=body.title,
                synopsis=body.synopsis,
                transcript=body.transcript,
            ),
            timeout=90,
        )
    except TimeoutError as exc:
        raise AppError("Generation timed out, try a shorter seed", status_code=504, code="ai_timeout") from exc
    except Exception as exc:  # noqa: BLE001 - provider details go to the log, not the browser
        log.exception("ai.metadata_failed")
        raise AppError("The AI provider returned an error", status_code=502, code="ai_error") from exc
    return MetadataOut(**result)


class JobStatusOut(BaseModel):
    job_id: str
    status: str  # queued | running | complete | failed | not_found
    result: dict | None = None
    error: str | None = None


@router.get("/jobs/{job_id}", response_model=JobStatusOut)
async def job_status(job_id: str) -> JobStatusOut:
    """Status of a queued AI or media job (arq). Results are kept for an hour."""
    from arq.jobs import Job, JobStatus

    job = Job(job_id, await jobs.queue())
    status = await job.status()
    if status == JobStatus.not_found:
        return JobStatusOut(job_id=job_id, status="not_found")
    if status in (JobStatus.deferred, JobStatus.queued):
        return JobStatusOut(job_id=job_id, status="queued")
    if status == JobStatus.in_progress:
        return JobStatusOut(job_id=job_id, status="running")
    info = await job.result_info()
    if info is None:
        return JobStatusOut(job_id=job_id, status="running")
    if info.success:
        result = info.result if isinstance(info.result, dict) else {"value": info.result}
        return JobStatusOut(job_id=job_id, status="complete", result=result)
    return JobStatusOut(job_id=job_id, status="failed", error=str(info.result)[:500])


class TranslateSeriesIn(BaseModel):
    languages: list[str] | None = None  # None = all active languages except the source


@router.post("/series/{series_id}/translate", response_model=JobOut)
async def translate_series(series_id: uuid.UUID, body: TranslateSeriesIn, db: DB) -> JobOut:
    if await db.get(Series, series_id) is None:
        raise NotFound("Series")
    job_id = await jobs.enqueue(
        "run_series_translation", str(series_id), body.languages, job_id=f"series-translate:{series_id}"
    )
    return JobOut(job_id=job_id)


@router.post("/series/{series_id}/embeddings", response_model=JobOut)
async def refresh_embeddings(series_id: uuid.UUID, db: DB) -> JobOut:
    if await db.get(Series, series_id) is None:
        raise NotFound("Series")
    job_id = await jobs.enqueue("refresh_embeddings", str(series_id), job_id=f"embed:{series_id}")
    return JobOut(job_id=job_id)


class SubtitlesIn(BaseModel):
    languages: list[str] | None = None


@router.post("/episodes/{episode_id}/subtitles", response_model=JobOut)
async def transcribe_episode(episode_id: uuid.UUID, body: SubtitlesIn, db: DB) -> JobOut:
    ep = await db.get(Episode, episode_id)
    if ep is None:
        raise NotFound("Episode")
    if ep.video_asset_id is None:
        raise AppError("Episode has no video asset", code="no_asset")
    job_id = await jobs.enqueue("transcribe_episode", str(episode_id), body.languages, job_id=f"subtitles:{episode_id}")
    return JobOut(job_id=job_id)


class TranscriptOut(BaseModel):
    series_id: uuid.UUID
    episodes: int
    language: str | None
    text: str


@router.get("/series/{series_id}/transcript", response_model=TranscriptOut)
async def series_transcript(series_id: uuid.UUID, db: DB, episodes: int = 3) -> TranscriptOut:
    """Plain text of the source-language subtitles for the first episodes, to feed the metadata generator."""
    import re

    from sqlalchemy import select

    from app.models.catalog import Subtitle
    from app.services import storage

    series = await db.get(Series, series_id)
    if series is None:
        raise NotFound("Series")
    eps = (
        await db.scalars(
            select(Episode)
            .where(Episode.series_id == series_id)
            .order_by(Episode.number)
            .limit(max(1, min(episodes, 10)))
        )
    ).all()
    lang = series.original_language
    parts: list[str] = []
    for ep in eps:
        sub = await db.scalar(select(Subtitle).where(Subtitle.episode_id == ep.id, Subtitle.lang == lang))
        if sub is None:
            continue
        try:
            raw = await asyncio.to_thread(storage.get_object_text, sub.vtt_key)
        except Exception:  # noqa: BLE001 - missing object: skip the episode
            continue
        lines = [
            ln.strip()
            for ln in raw.splitlines()
            if ln.strip() and not ln.startswith("WEBVTT") and "-->" not in ln and not re.fullmatch(r"\d+", ln.strip())
        ]
        parts.append(f"Episode {ep.number}: " + " ".join(lines))
    text = "\n\n".join(parts)[:20000]
    return TranscriptOut(series_id=series_id, episodes=len(parts), language=lang if parts else None, text=text)


@router.post("/reembed-all", response_model=JobOut)
async def reembed_all() -> JobOut:
    """After changing the embedding model: refresh every published series."""
    job_id = await jobs.enqueue("reembed_all", job_id="reembed-all")
    return JobOut(job_id=job_id)
