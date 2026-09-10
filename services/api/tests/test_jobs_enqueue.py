"""`jobs.enqueue` against a fake ArqRedis. No Redis.

arq returns `None` from `enqueue_job` when a job with the id is queued or running, and also when the previous
run's result is still stored. The service used to report the job id either way, so a refused retry looked
queued and never ran. These pin the contract routes rely on: `None` means not queued, `retry=True` clears the
stale result (and nothing else) first, and `enqueue_or_raise` turns a refusal into a 409.
"""

from types import SimpleNamespace

import pytest

from app.services import jobs


class FakeArqRedis:
    def __init__(self, *, refuse: bool = False):
        self.refuse = refuse
        self.deleted: list[str] = []
        self.enqueued: list[tuple] = []

    async def delete(self, *keys: str) -> int:
        self.deleted.extend(keys)
        return len(keys)

    async def enqueue_job(self, function: str, *args, _job_id=None, **kwargs):
        self.enqueued.append((function, args, _job_id, kwargs))
        if self.refuse:
            return None
        return SimpleNamespace(job_id=_job_id or "generated")


@pytest.fixture
def pool(monkeypatch):
    def install(**kw):
        fake = FakeArqRedis(**kw)

        async def queue():
            return fake

        monkeypatch.setattr(jobs, "queue", queue)
        return fake

    return install


async def test_a_refusal_is_returned_as_none_not_the_requested_id(pool):
    fake = pool(refuse=True)
    assert await jobs.enqueue("transcode_asset", "a1", job_id="transcode:a1") is None
    assert fake.enqueued == [("transcode_asset", ("a1",), "transcode:a1", {})]
    assert fake.deleted == []


async def test_an_accepted_job_returns_its_id(pool):
    pool()
    assert await jobs.enqueue("transcode_asset", "a1", job_id="transcode:a1") == "transcode:a1"


async def test_retry_deletes_only_the_stale_result_key_before_enqueueing(pool):
    """The result key is what blocks a re-run of a finished job. The job key, which marks a live one, is left
    alone so deduplication of running jobs survives an admin's retry."""
    fake = pool()
    assert await jobs.enqueue("transcode_asset", "a1", job_id="transcode:a1", retry=True) == "transcode:a1"
    assert fake.deleted == ["arq:result:transcode:a1"]


async def test_retry_without_a_job_id_deletes_nothing(pool):
    fake = pool()
    await jobs.enqueue("indexnow_ping", ["x"], retry=True)
    assert fake.deleted == []


async def test_enqueue_or_raise_surfaces_a_live_job_as_409(pool):
    pool(refuse=True)
    with pytest.raises(jobs.JobInProgress) as info:
        await jobs.enqueue_or_raise("transcode_asset", "a1", job_id="transcode:a1", retry=True)
    assert info.value.status_code == 409
    assert info.value.detail["code"] == "job_in_progress"


async def test_enqueue_or_raise_returns_the_id_when_queued(pool):
    pool()
    assert await jobs.enqueue_or_raise("transcode_asset", "a1", job_id="transcode:a1") == "transcode:a1"
