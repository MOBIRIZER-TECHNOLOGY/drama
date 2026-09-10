"""How the transcode job ends when it does not end well. No ffmpeg, no bucket, no database.

The pieces that touch the outside world (`SessionLocal`, `_s3`, `_probe`, `_transcode_rendition`,
`_upload_dir`, `_set_status`) are swapped for fakes, so what is under test is the control flow around them:
a cancelled job kills its child and marks the asset, a transient error asks arq for another try, a
deterministic one fails once.
"""

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from app.models.catalog import AssetStatus
from arq import Retry
from botocore.exceptions import EndpointConnectionError

from worker import settings
from worker.jobs import media

ASSET_ID = uuid.uuid4()


class FakeSession:
    """Enough of an AsyncSession for `transcode_asset`'s opening transaction."""

    def __init__(self, asset):
        self.asset = asset

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalar(self, stmt):
        return self.asset

    async def commit(self):
        pass


@pytest.fixture
def job(monkeypatch):
    """A failed asset ready for a re-run, with every external call faked and status writes recorded."""
    asset = SimpleNamespace(status=AssetStatus.failed, error="old", source_key="uploads/videos/x.mp4")
    statuses: list[tuple[AssetStatus, dict]] = []

    async def set_status(aid, status, **fields):
        statuses.append((status, fields))

    monkeypatch.setattr(media, "SessionLocal", lambda: FakeSession(asset))
    monkeypatch.setattr(media, "_set_status", set_status)
    monkeypatch.setattr(media, "_s3", lambda: SimpleNamespace(download_file=lambda *a, **k: None))
    return SimpleNamespace(asset=asset, statuses=statuses)


async def test_a_cancelled_job_marks_the_asset_failed_and_re_raises(job, monkeypatch):
    """Without this an interrupted worker left the row saying `transcoding` for good, with nothing transcoding."""

    async def probe_forever(path):
        await asyncio.Event().wait()

    monkeypatch.setattr(media, "_probe", probe_forever)
    task = asyncio.create_task(media.transcode_asset({}, str(ASSET_ID)))
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [s for s, _ in job.statuses] == [AssetStatus.failed]
    assert "interrupted" in job.statuses[0][1]["error"]


async def test_a_storage_error_asks_for_a_retry_while_tries_remain(job, monkeypatch):
    def unreachable(*a, **k):
        raise EndpointConnectionError(endpoint_url="http://minio:9000")

    monkeypatch.setattr(media, "_s3", lambda: SimpleNamespace(download_file=unreachable))
    with pytest.raises(Retry):
        await media.transcode_asset({"job_try": 1}, str(ASSET_ID))
    status, fields = job.statuses[-1]
    assert status == AssetStatus.queued
    assert fields["error"].startswith(f"try 1 of {settings.MAX_TRIES}")


async def test_the_last_try_of_a_storage_error_fails_for_good(job, monkeypatch):
    """arq never runs the job again after `max_tries`, so the final attempt must leave the row `failed` itself."""

    def unreachable(*a, **k):
        raise EndpointConnectionError(endpoint_url="http://minio:9000")

    monkeypatch.setattr(media, "_s3", lambda: SimpleNamespace(download_file=unreachable))
    with pytest.raises(EndpointConnectionError):
        await media.transcode_asset({"job_try": settings.MAX_TRIES}, str(ASSET_ID))
    status, fields = job.statuses[-1]
    assert status == AssetStatus.failed
    assert fields["error"].startswith(f"gave up after {settings.MAX_TRIES} tries")


async def test_a_bad_input_fails_once_without_a_retry(job, monkeypatch):
    async def no_video(path):
        raise RuntimeError("no video stream")

    monkeypatch.setattr(media, "_probe", no_video)
    with pytest.raises(RuntimeError, match="no video stream"):
        await media.transcode_asset({"job_try": 1}, str(ASSET_ID))
    assert job.statuses[-1] == (AssetStatus.failed, {"error": "no video stream"})


async def test_the_key_info_file_carries_no_iv_and_renditions_record_the_key_version(job, monkeypatch):
    """One IV for the whole asset made every segment encrypt its identical headers identically. Left out,
    ffmpeg uses each segment's sequence number and writes it into the playlist, which the API preserves."""
    seen: dict = {}

    async def probe(path):
        return {"duration": 10.0, "width": 1080, "height": 1920, "has_audio": True}

    async def rendition(src, out_dir, name, spec, has_audio, portrait, key_info):
        seen["keyinfo"] = key_info.read_text(encoding="utf-8")
        seen["key"] = key_info.with_name("hls.key").read_bytes()
        out_dir.mkdir(parents=True, exist_ok=True)

    async def upload(local, prefix):
        return 0

    monkeypatch.setattr(media, "_probe", probe)
    monkeypatch.setattr(media, "_transcode_rendition", rendition)
    monkeypatch.setattr(media, "_upload_dir", upload)
    monkeypatch.setattr(media, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=True, hls_ladder=["1080p"]))

    out = await media.transcode_asset({}, str(ASSET_ID))
    lines = seen["keyinfo"].splitlines()
    assert lines[0] == media.PLACEHOLDER_KEY_URI
    assert len(lines) == 2, "a third line would pin one IV for every segment"
    assert len(seen["key"]) == 16
    assert out["key_version"] == media.KEY_VERSION == "v1"
    status, fields = job.statuses[-1]
    assert status == AssetStatus.ready
    assert fields["renditions"]["1080p"]["key_version"] == "v1"


async def test_run_kills_the_child_when_cancelled(monkeypatch):
    """A cancelled coroutine does not cancel its process; ffmpeg would keep writing into a deleted tree."""
    proc = SimpleNamespace(returncode=None, killed=False)

    async def communicate():
        await asyncio.Event().wait()

    def kill():
        proc.killed = True
        proc.returncode = -9

    async def wait():
        return proc.returncode

    proc.communicate, proc.kill, proc.wait = communicate, kill, wait

    async def spawn(*cmd, **kw):
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(media._run("ffmpeg", "-i", "x"))
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert proc.killed


def test_the_worker_refuses_to_encrypt_under_a_fallback_secret(monkeypatch):
    import app.core.config as config

    monkeypatch.setattr(settings, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=True))
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(media_encryption_key=None))
    with pytest.raises(RuntimeError, match="KATHA_MEDIA_ENCRYPTION_KEY"):
        settings.assert_encryption_configured()

    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(media_encryption_key="k" * 32))
    settings.assert_encryption_configured()

    monkeypatch.setattr(settings, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=False))
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(media_encryption_key=None))
    settings.assert_encryption_configured()
