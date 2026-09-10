"""Enqueue background work on the arq queue shared with services/worker."""

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from arq.constants import result_key_prefix

from app.core.config import get_settings
from app.core.errors import AppError

_pool: ArqRedis | None = None
RESULT_TTL_SECONDS = 3600


class JobInProgress(AppError):
    """The queue already holds a live job with this id, so a second copy was refused."""

    code = "job_in_progress"

    def __init__(self, job_id: str):
        super().__init__(f"Job {job_id} is already queued or running", status_code=409, code=self.code)


async def queue() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


async def enqueue(name: str, *args, job_id: str | None = None, retry: bool = False, **kwargs) -> str | None:
    """Enqueue a job and return its id, or `None` when arq refused it.

    Pass `job_id` to deduplicate. arq refuses a second job with the same id in two situations: one is queued or
    running, or the *result* of the last run is still stored (the worker keeps results for `RESULT_TTL_SECONDS`
    so the admin console can report outcomes). The second case used to be invisible: the refusal was reported as
    success, and an admin retrying a failed transcode within the hour got "queued" and nothing ever ran.

    `retry=True` is for those explicit re-runs. It deletes the stale result key first, so a finished job can be
    run again, but leaves the job key alone, so a job that is genuinely live is still refused. Callers must treat
    `None` as "not queued"; `enqueue_or_raise` turns it into a 409 for routes.
    """
    pool = await queue()
    if retry and job_id:
        await pool.delete(result_key_prefix + job_id)
    job = await pool.enqueue_job(name, *args, _job_id=job_id, **kwargs)
    return job.job_id if job else None


async def enqueue_or_raise(name: str, *args, job_id: str, retry: bool = False, **kwargs) -> str:
    """`enqueue` for routes that must not report success for a job that was never queued."""
    queued = await enqueue(name, *args, job_id=job_id, retry=retry, **kwargs)
    if queued is None:
        raise JobInProgress(job_id)
    return queued


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
