"""Enqueue background work on the arq queue shared with services/worker."""

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import get_settings

_pool: ArqRedis | None = None
RESULT_TTL_SECONDS = 3600


async def queue() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


async def enqueue(name: str, *args, job_id: str | None = None, **kwargs) -> str | None:
    """Enqueue a job. Pass `job_id` to deduplicate: arq refuses a second job with the same id while one is live."""
    job = await (await queue()).enqueue_job(name, *args, _job_id=job_id, **kwargs)
    return job.job_id if job else job_id


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
