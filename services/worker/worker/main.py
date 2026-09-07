"""arq worker entrypoint.

Run: uv run arq worker.main.WorkerSettings

Jobs are enqueued by the API with `await redis.enqueue_job("transcode_asset", asset_id)`.
Each job is idempotent on its input id so a retry never double-applies.
"""

import structlog
from arq.connections import RedisSettings
from arq.cron import cron

from worker.jobs import ai, media, notify, publish
from worker.settings import get_worker_settings

log = structlog.get_logger()


async def startup(ctx: dict) -> None:
    from app.core import telemetry

    telemetry.init("worker")
    log.info("worker.start")


async def shutdown(ctx: dict) -> None:
    log.info("worker.stop")


class WorkerSettings:
    functions = [
        media.transcode_asset,
        media.generate_thumbnails,
        notify.send_push,
        notify.new_episode_alert,
        notify.streak_reminder,
        notify.resume_reminder,
        ai.run_translation,
        ai.run_series_translation,
        ai.run_ingestion,
        ai.refresh_embeddings,
        ai.transcribe_episode,
        ai.reembed_all,
        publish.indexnow_ping,
    ]
    cron_jobs = [
        cron(publish.publish_scheduled, minute=set(range(60)), run_at_startup=False),
        # Times are UTC. 12:30 and 13:30 UTC are 18:00 and 19:00 in Asia/Kolkata: the evening window when this
        # audience actually watches, and late enough that "your streak ends tonight" is true rather than alarmist.
        cron(notify.streak_reminder, hour={12}, minute={30}, run_at_startup=False),
        cron(notify.resume_reminder, hour={13}, minute={30}, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_worker_settings().redis_url)
    max_jobs = get_worker_settings().max_jobs
    job_timeout = 60 * 60  # transcodes can be long
    retry_jobs = True
    max_tries = 3
    keep_result = 3600  # so /admin/ai/jobs/{id} can report outcomes for an hour
