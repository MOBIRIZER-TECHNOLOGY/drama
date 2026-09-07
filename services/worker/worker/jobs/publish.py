"""Content factory scheduling: drip-release episodes at their scheduled time, ping IndexNow on publish."""

from datetime import UTC, datetime

import httpx
import structlog
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.catalog import Episode, PublishStatus
from sqlalchemy import select

log = structlog.get_logger()


async def publish_scheduled(ctx: dict) -> dict:
    """Cron (every minute): episodes in review with scheduled_at in the past become published."""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(Episode)
                .where(
                    Episode.status == PublishStatus.review,
                    Episode.scheduled_at.is_not(None),
                    Episode.scheduled_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
        ).all()
        for ep in rows:
            ep.status = PublishStatus.published
            ep.published_at = ep.published_at or now
        await db.commit()
        episode_ids = [str(ep.id) for ep in rows]
    if rows:
        log.info("publish.scheduled", count=len(rows))
        # An episode going live is the one moment the people watching that series want to hear from us.
        # Enqueued rather than sent inline so a push outage never blocks the release.
        redis = ctx.get("redis")
        if redis is not None:
            for episode_id in episode_ids:
                await redis.enqueue_job("new_episode_alert", episode_id)
    return {"published": len(rows)}


async def indexnow_ping(ctx: dict, paths: list[str]) -> dict:
    """Tell Bing and Yandex about changed URLs. No-op without a key."""
    s = get_settings()
    if not s.indexnow_key or not s.site_base_url:
        return {"status": "skipped"}
    host = s.site_base_url.split("//", 1)[-1].split("/", 1)[0]
    urls = [f"{s.site_base_url.rstrip('/')}/{p.lstrip('/')}" for p in paths]
    payload = {
        "host": host,
        "key": s.indexnow_key,
        "keyLocation": f"{s.site_base_url.rstrip('/')}/{s.indexnow_key}.txt",
        "urlList": urls,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post("https://api.indexnow.org/indexnow", json=payload)
    log.info("indexnow.ping", status=r.status_code, urls=len(urls))
    return {"status": r.status_code, "urls": len(urls)}
