"""AI graph runners. Graphs live in services/ai; the worker owns scheduling, persistence and object storage."""

import asyncio
import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import structlog
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.catalog import Embedding, Episode, Series, SeriesTranslation, Subtitle
from app.models.ops import Language, UiTranslation
from katha_ai.embeddings import embed_documents, model_name, series_document
from katha_ai.graphs.subtitles import to_vtt, transcribe, translate_cues
from katha_ai.graphs.translation import run_translation_batch
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from worker.jobs.media import _run, _s3
from worker.settings import get_worker_settings

log = structlog.get_logger()


async def run_translation(ctx: dict, lang: str, keys: dict[str, str], *, namespace: str = "ui") -> dict:
    """Translate UI strings into `lang` and persist them as source=ai (never overwriting human rows)."""
    result = await run_translation_batch(target_lang=lang, items=keys, namespace=namespace)
    written = 0
    if namespace == "ui" and result:
        async with SessionLocal() as db:
            now = datetime.now(UTC)
            existing = {
                r.key: r
                for r in (
                    await db.scalars(
                        select(UiTranslation).where(UiTranslation.lang == lang, UiTranslation.key.in_(list(result)))
                    )
                ).all()
            }
            for key, value in result.items():
                row = existing.get(key)
                if row is None:
                    db.add(UiTranslation(lang=lang, key=key, value=value, source="ai", updated_at=now))
                    written += 1
                elif row.source == "ai":
                    row.value, row.updated_at = value, now
                    written += 1
            await db.commit()
    log.info("translation.done", lang=lang, translated=len(result), written=written)
    return {"translated": len(result), "written": written}


async def run_series_translation(ctx: dict, series_id: str, target_langs: list[str] | None = None) -> dict:
    """Translate a series' title, synopsis and SEO fields from its source language into active languages."""
    sid = uuid.UUID(series_id)
    async with SessionLocal() as db:
        series = await db.scalar(select(Series).where(Series.id == sid).options(selectinload(Series.translations)))
        if series is None:
            return {"status": "missing"}
        by_lang = {t.lang: t for t in series.translations}
        source = by_lang.get(series.original_language) or by_lang.get("en") or next(iter(by_lang.values()), None)
        if source is None:
            return {"status": "no_source"}
        langs = target_langs or [
            lang.code
            for lang in (await db.scalars(select(Language).where(Language.is_active.is_(True)))).all()
            if lang.code != source.lang
        ]
    items = {
        "title": source.title,
        "synopsis": source.synopsis or "",
        "seo_title": source.seo_title or "",
        "meta_description": source.meta_description or "",
    }
    items = {k: v for k, v in items.items() if v}
    done = 0
    for lang in langs:
        out = await run_translation_batch(target_lang=lang, items=items, namespace="series")
        if "title" not in out:
            continue
        async with SessionLocal() as db:
            row = await db.get(SeriesTranslation, (sid, lang))
            if row is not None and row.source == "human":
                continue
            if row is None:
                row = SeriesTranslation(series_id=sid, lang=lang, title=out["title"], source="ai")
                db.add(row)
            row.title = out["title"]
            row.synopsis = out.get("synopsis") or row.synopsis
            row.seo_title = out.get("seo_title") or row.seo_title
            row.meta_description = out.get("meta_description") or row.meta_description
            row.source = "ai"
            await db.commit()
            done += 1
    log.info("series_translation.done", series_id=series_id, languages=done)
    return {"languages": done}


async def refresh_embeddings(ctx: dict, series_id: str) -> dict:
    """Embed the series' canonical document and upsert the pgvector row."""
    sid = uuid.UUID(series_id)
    async with SessionLocal() as db:
        series = await db.scalar(
            select(Series)
            .where(Series.id == sid)
            .options(selectinload(Series.translations), selectinload(Series.categories), selectinload(Series.tags))
        )
        if series is None:
            return {"status": "missing"}
        by_lang = {t.lang: t for t in series.translations}
        tr = by_lang.get("en") or by_lang.get(series.original_language) or next(iter(by_lang.values()), None)
        if tr is None:
            return {"status": "no_text"}
        doc = series_document(
            title=tr.title,
            synopsis=tr.synopsis,
            categories=[c.name for c in series.categories],
            tags=[t.name for t in series.tags],
        )
    [vector] = await embed_documents([doc])
    name = model_name()
    async with SessionLocal() as db:
        row = await db.get(Embedding, (sid, name))
        if row is None:
            db.add(Embedding(series_id=sid, model=name, vector=vector, updated_at=datetime.now(UTC)))
        else:
            row.vector = vector
            row.updated_at = datetime.now(UTC)
        await db.commit()
    log.info("embeddings.done", series_id=series_id, model=name)
    return {"status": "ok", "model": name}


async def transcribe_episode(ctx: dict, episode_id: str, target_langs: list[str] | None = None) -> dict:
    """Extract audio, transcribe, write the source-language VTT, then translated VTTs. Uploads under subtitles/."""
    eid = uuid.UUID(episode_id)
    async with SessionLocal() as db:
        episode = await db.scalar(
            select(Episode)
            .where(Episode.id == eid)
            .options(selectinload(Episode.video_asset), selectinload(Episode.series))
        )
        if episode is None or episode.video_asset is None:
            return {"status": "missing"}
        source_key = episode.video_asset.source_key
        source_lang = episode.series.original_language
        if target_langs is None:
            target_langs = [
                lang.code
                for lang in (await db.scalars(select(Language).where(Language.is_active.is_(True)))).all()
                if lang.code != source_lang
            ]
    tmp = Path(tempfile.mkdtemp(prefix="katha-sub-"))
    try:
        src = tmp / "source"
        await asyncio.to_thread(_s3().download_file, get_settings().s3_bucket, source_key, str(src))
        audio = tmp / "audio.m4a"
        code, out = await _run(
            get_worker_settings().ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "48k",
            str(audio),
        )
        if code != 0:
            raise RuntimeError(f"audio extract failed: {out[-400:]}")
        cues, detected = await transcribe(audio, language=source_lang)
        if not cues:
            return {"status": "no_speech"}
        written = await _write_vtt(eid, source_lang, to_vtt(cues), tmp)
        for lang in target_langs:
            translated = await translate_cues(cues, target_lang=lang)
            written += await _write_vtt(eid, lang, to_vtt(translated), tmp)
        log.info("subtitles.done", episode_id=episode_id, languages=1 + len(target_langs), detected=detected)
        return {"status": "ok", "cues": len(cues), "files": written}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def _write_vtt(episode_id: uuid.UUID, lang: str, text: str, tmp: Path) -> int:
    key = f"subtitles/{episode_id}/{lang}.vtt"
    local = tmp / f"{lang}.vtt"
    local.write_text(text, encoding="utf-8")  # noqa: ASYNC240 - tiny local write
    await asyncio.to_thread(
        _s3().upload_file,
        str(local),
        get_settings().s3_bucket,
        key,
        ExtraArgs={"ContentType": "text/vtt; charset=utf-8"},
    )
    async with SessionLocal() as db:
        row = await db.scalar(select(Subtitle).where(Subtitle.episode_id == episode_id, Subtitle.lang == lang))
        if row is None:
            db.add(Subtitle(episode_id=episode_id, lang=lang, vtt_key=key, source="ai"))
        elif row.source == "ai":
            row.vtt_key = key
        await db.commit()
    return 1


async def run_ingestion(ctx: dict, series_id: str) -> dict:
    """Content factory after publish: embeddings, translations, and subtitles for every episode with video."""
    from arq.connections import ArqRedis

    a = await refresh_embeddings(ctx, series_id)
    b = await run_series_translation(ctx, series_id)
    queued = 0
    async with SessionLocal() as db:
        eps = (
            await db.scalars(
                select(Episode).where(Episode.series_id == uuid.UUID(series_id), Episode.video_asset_id.is_not(None))
            )
        ).all()
        existing = {
            (row.episode_id)
            for row in (await db.scalars(select(Subtitle).where(Subtitle.episode_id.in_([e.id for e in eps])))).all()
        }
    redis: ArqRedis | None = ctx.get("redis")
    for ep in eps:
        if ep.id in existing or redis is None:
            continue
        await redis.enqueue_job("transcribe_episode", str(ep.id), None, _job_id=f"subtitles:{ep.id}")
        queued += 1
    return {"embeddings": a, "translations": b, "subtitles_queued": queued}


async def reembed_all(ctx: dict) -> dict:
    """After an embedding model change: refresh every published series (runs inline, one at a time)."""
    from app.models.catalog import PublishStatus as PS

    async with SessionLocal() as db:
        ids = [str(i) for i in (await db.scalars(select(Series.id).where(Series.status == PS.published))).all()]
    done = 0
    for sid in ids:
        out = await refresh_embeddings(ctx, sid)
        done += out.get("status") == "ok"
    log.info("embeddings.reembed_all", total=len(ids), done=done)
    return {"total": len(ids), "done": done}
