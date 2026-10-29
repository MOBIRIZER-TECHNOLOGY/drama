"""The parts of the video pipeline the failure tests do not reach: the helpers that build the ffmpeg and
ffprobe command lines, the upload walk, the status write, and the thumbnail job.

Nothing here runs ffmpeg or talks to a bucket. `_run` is replaced by a recorder, so what is asserted is the
command the job would have run - which is the whole behaviour of these helpers: the container it packages,
whether it encrypts, whether it upscales, and the content types it puts on the objects a player fetches.
"""

import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.models.catalog import AssetStatus

from worker.jobs import media

ASSET_ID = uuid.uuid4()

PROBE_JSON = json.dumps(
    {
        "format": {"duration": "12.5"},
        "streams": [
            {"codec_type": "audio", "channels": 2},
            {"codec_type": "video", "width": 1080, "height": 1920},
        ],
    }
)


def _record_run(monkeypatch, code=0, out=""):
    """Swap `_run` for a recorder. Returns the list of argv tuples it was handed."""
    calls: list[tuple[str, ...]] = []

    async def run(*cmd: str) -> tuple[int, str]:
        calls.append(cmd)
        return code, out

    monkeypatch.setattr(media, "_run", run)
    return calls


class FakeS3:
    """Records what would have been downloaded and uploaded, and creates the file ffmpeg would have read."""

    def __init__(self):
        self.uploads: list[tuple[str, str, str, dict]] = []
        self.downloads: list[tuple[str, str, str]] = []

    def download_file(self, bucket, key, dest):
        self.downloads.append((bucket, key, dest))
        Path(dest).write_bytes(b"fake source")

    def upload_file(self, path, bucket, key, ExtraArgs=None):  # noqa: N803 - boto3's keyword
        self.uploads.append((path, bucket, key, ExtraArgs or {}))


class GetSession:
    """A session whose only query is `get`, which is all `_set_status` and the thumbnail job make."""

    def __init__(self, asset):
        self.asset = asset
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, model, key):
        return self.asset

    async def commit(self):
        self.commits += 1


def test_the_s3_client_is_built_for_a_path_style_endpoint(monkeypatch):
    """MinIO and most self-hosted gateways only serve path-style addressing, and presigning needs sigv4."""
    monkeypatch.setattr(
        media,
        "get_settings",
        lambda: SimpleNamespace(
            s3_endpoint="http://minio:9000", s3_region="us-east-1", s3_access_key="ak", s3_secret_key="sk"
        ),
    )
    client = media._s3()
    assert client.meta.endpoint_url == "http://minio:9000"
    assert client.meta.config.signature_version == "s3v4"
    assert client.meta.config.s3["addressing_style"] == "path"


async def test_probe_reports_duration_dimensions_and_whether_there_is_audio(monkeypatch):
    calls = _record_run(monkeypatch, 0, PROBE_JSON)
    info = await media._probe(Path("/tmp/source"))
    assert info == {"duration": 12.5, "width": 1080, "height": 1920, "has_audio": True}
    # JSON on stdout is what the parse depends on; without -show_streams there is nothing to pick a video from.
    assert "-print_format" in calls[0] and "json" in calls[0]
    assert "-show_streams" in calls[0] and "-show_format" in calls[0]


async def test_probe_reports_a_missing_duration_as_zero_rather_than_failing(monkeypatch):
    """A stream with no container duration still transcodes; the row just records 0 seconds."""
    _record_run(monkeypatch, 0, json.dumps({"format": {}, "streams": [{"codec_type": "video", "width": 0}]}))
    info = await media._probe(Path("/tmp/source"))
    assert info == {"duration": 0.0, "width": 0, "height": 0, "has_audio": False}


async def test_probe_rejects_a_file_ffprobe_refuses_and_one_with_no_video(monkeypatch):
    _record_run(monkeypatch, 1, "moov atom not found")
    with pytest.raises(RuntimeError, match="ffprobe failed"):
        await media._probe(Path("/tmp/source"))

    _record_run(monkeypatch, 0, json.dumps({"format": {"duration": "3"}, "streams": [{"codec_type": "audio"}]}))
    with pytest.raises(RuntimeError, match="no video stream"):
        await media._probe(Path("/tmp/source"))


async def test_an_encrypted_rendition_is_packaged_as_mpeg_ts_under_the_key_info_file(monkeypatch, tmp_path):
    """AES-128 exists for MPEG-TS only, so encryption picks the container and the segment extension with it."""
    calls = _record_run(monkeypatch)
    key_info = tmp_path / "hls.keyinfo"
    out_dir = tmp_path / "hls" / "1080p"
    await media._transcode_rendition(tmp_path / "source", out_dir, "1080p", media.LADDER["1080p"], True, True, key_info)
    cmd = calls[0]
    assert cmd[cmd.index("-hls_segment_type") + 1] == "mpegts"
    assert cmd[cmd.index("-hls_key_info_file") + 1] == str(key_info)
    assert cmd[cmd.index("-hls_segment_filename") + 1].endswith("seg_%04d.ts")
    assert "-hls_fmp4_init_filename" not in cmd
    assert cmd[-1] == str(out_dir / "index.m3u8")
    assert out_dir.is_dir(), "the rendition directory is created before ffmpeg writes into it"


async def test_an_unencrypted_rendition_is_packaged_as_fmp4(monkeypatch, tmp_path):
    calls = _record_run(monkeypatch)
    await media._transcode_rendition(
        tmp_path / "source", tmp_path / "720p", "720p", media.LADDER["720p"], True, True, None
    )
    cmd = calls[0]
    assert cmd[cmd.index("-hls_segment_type") + 1] == "fmp4"
    assert cmd[cmd.index("-hls_fmp4_init_filename") + 1] == "init.mp4"
    assert cmd[cmd.index("-hls_segment_filename") + 1].endswith("seg_%04d.m4s")
    assert "-hls_key_info_file" not in cmd


async def test_the_scale_filter_follows_the_orientation_and_bufsize_doubles_the_bitrate(monkeypatch, tmp_path):
    """`height` in the ladder is the long edge, so a landscape source scales on width instead."""
    calls = _record_run(monkeypatch)
    spec = media.LADDER["1080p"]
    await media._transcode_rendition(tmp_path / "s", tmp_path / "a", "1080p", spec, True, True, None)
    await media._transcode_rendition(tmp_path / "s", tmp_path / "b", "1080p", spec, True, False, None)
    portrait, landscape = calls[0], calls[1]
    assert portrait[portrait.index("-vf") + 1] == "scale=-2:1920"
    assert landscape[landscape.index("-vf") + 1] == "scale=1920:-2"
    assert portrait[portrait.index("-bufsize") + 1] == "7000k"  # twice 3500k
    assert portrait[portrait.index("-maxrate") + 1] == spec["v_bitrate"]


async def test_a_silent_source_is_transcoded_without_an_audio_track(monkeypatch, tmp_path):
    """`-an` rather than an aac encoder with no input: ffmpeg fails outright on the latter."""
    calls = _record_run(monkeypatch)
    await media._transcode_rendition(tmp_path / "s", tmp_path / "480p", "480p", media.LADDER["480p"], False, True, None)
    assert "-an" in calls[0] and "-c:a" not in calls[0]

    calls.clear()
    await media._transcode_rendition(tmp_path / "s", tmp_path / "480p", "480p", media.LADDER["480p"], True, True, None)
    assert calls[0][calls[0].index("-c:a") + 1] == "aac"
    assert calls[0][calls[0].index("-b:a") + 1] == media.LADDER["480p"]["a_bitrate"]


async def test_a_failing_rendition_names_itself_and_carries_ffmpeg_s_own_words(monkeypatch, tmp_path):
    _record_run(monkeypatch, 1, "height not divisible by 2")
    with pytest.raises(RuntimeError, match="ffmpeg 720p failed: height not divisible by 2"):
        await media._transcode_rendition(
            tmp_path / "s", tmp_path / "720p", "720p", media.LADDER["720p"], True, True, None
        )


async def test_every_uploaded_object_gets_the_content_type_its_extension_implies(monkeypatch, tmp_path):
    """A player that fetches a playlist as octet-stream refuses to play it, and segments must be immutable."""
    (tmp_path / "1080p").mkdir()
    for name in ["master.m3u8", "1080p/index.m3u8", "1080p/init.mp4", "1080p/seg_0000.m4s", "1080p/seg_0001.ts"]:
        (tmp_path / name).write_text("x")
    (tmp_path / "1080p" / "notes.txt").write_text("x")
    s3 = FakeS3()
    monkeypatch.setattr(media, "_s3", lambda: s3)
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    count = await media._upload_dir(tmp_path, f"hls/{ASSET_ID}")

    assert count == 6
    types = {key: extra["ContentType"] for _, _, key, extra in s3.uploads}
    assert types[f"hls/{ASSET_ID}/master.m3u8"] == "application/vnd.apple.mpegurl"
    assert types[f"hls/{ASSET_ID}/1080p/init.mp4"] == "video/mp4"
    assert types[f"hls/{ASSET_ID}/1080p/seg_0000.m4s"] == "video/iso.segment"
    assert types[f"hls/{ASSET_ID}/1080p/seg_0001.ts"] == "video/mp2t"
    assert types[f"hls/{ASSET_ID}/1080p/notes.txt"] == "application/octet-stream"
    assert all(e["CacheControl"] == "public, max-age=31536000, immutable" for _, _, _, e in s3.uploads)
    assert {b for _, b, _, _ in s3.uploads} == {"katha"}


async def test_set_status_writes_the_fields_it_is_given_and_stamps_the_row(monkeypatch):
    asset = SimpleNamespace(status=AssetStatus.queued, error="old", updated_at=None, duration_sec=None)
    session = GetSession(asset)
    monkeypatch.setattr(media, "SessionLocal", lambda: session)

    await media._set_status(ASSET_ID, AssetStatus.ready, error=None, duration_sec=12)

    assert asset.status == AssetStatus.ready
    assert (asset.error, asset.duration_sec) == (None, 12)
    assert asset.updated_at is not None and asset.updated_at.tzinfo is not None
    assert session.commits == 1


async def test_set_status_on_a_deleted_asset_does_nothing_rather_than_raising(monkeypatch):
    """The asset can be deleted while its transcode runs; the failure path must not fail on top of that."""
    session = GetSession(None)
    monkeypatch.setattr(media, "SessionLocal", lambda: session)
    await media._set_status(ASSET_ID, AssetStatus.failed, error="boom")
    assert session.commits == 0


class ScalarSession:
    def __init__(self, asset):
        self.asset = asset
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalar(self, stmt):
        return self.asset

    async def commit(self):
        self.commits += 1


async def test_transcoding_an_asset_that_is_gone_is_a_no_op(monkeypatch):
    session = ScalarSession(None)
    monkeypatch.setattr(media, "SessionLocal", lambda: session)
    assert await media.transcode_asset({}, str(ASSET_ID)) == {"status": "missing"}
    assert session.commits == 0


async def test_a_ready_asset_is_not_transcoded_again(monkeypatch):
    """The job is enqueued on upload and can be redelivered; re-running it would replace a live manifest."""
    asset = SimpleNamespace(status=AssetStatus.ready, error=None, source_key="uploads/x.mp4")
    session = ScalarSession(asset)
    monkeypatch.setattr(media, "SessionLocal", lambda: session)
    assert await media.transcode_asset({}, str(ASSET_ID)) == {"status": "already_ready"}
    assert asset.status == AssetStatus.ready and session.commits == 0


async def test_the_ladder_never_upscales(monkeypatch):
    """A 480p source gets its own 480p rung and the smaller 360p one; 1080p and 720p are skipped as upscales."""
    asset = SimpleNamespace(status=AssetStatus.queued, error=None, source_key="uploads/small.mp4")
    statuses: list[tuple[AssetStatus, dict]] = []
    done: list[str] = []

    async def set_status(aid, status, **fields):
        statuses.append((status, fields))

    async def probe(path):
        return {"duration": 30.0, "width": 480, "height": 854, "has_audio": True}

    async def rendition(src, out_dir, name, spec, has_audio, portrait, key_info):
        done.append(name)
        out_dir.mkdir(parents=True, exist_ok=True)

    async def upload(local, prefix):
        return 1

    monkeypatch.setattr(media, "SessionLocal", lambda: ScalarSession(asset))
    monkeypatch.setattr(media, "_set_status", set_status)
    monkeypatch.setattr(media, "_s3", lambda: FakeS3())
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))
    monkeypatch.setattr(media, "_probe", probe)
    monkeypatch.setattr(media, "_transcode_rendition", rendition)
    monkeypatch.setattr(media, "_upload_dir", upload)
    monkeypatch.setattr(
        media, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=False, hls_ladder=["1080p", "720p", "480p", "360p"])
    )

    out = await media.transcode_asset({}, str(ASSET_ID))

    assert done == ["480p", "360p"]
    assert out["renditions"] == ["480p", "360p"]
    status, fields = statuses[-1]
    assert status == AssetStatus.ready
    assert fields["hls_master_key"] == f"hls/{ASSET_ID}/master.m3u8"
    assert fields["is_encrypted"] is False
    assert out["encrypted"] is False and out["key_version"] is None
    # Unencrypted renditions carry no key version: its absence is what means "in the clear".
    assert "key_version" not in fields["renditions"]["480p"]
    assert fields["duration_sec"] == 30 and (fields["width"], fields["height"]) == (480, 854)
    # 480p is the source's own size, so the short edge is the source's short edge.
    assert fields["renditions"]["480p"] == {
        "bandwidth": media.LADDER["480p"]["bandwidth"],
        "width": 480,
        "height": 854,
        "playlist": "480p/index.m3u8",
    }


async def test_the_transcode_temp_tree_is_gone_once_the_job_ends(monkeypatch):
    """ffmpeg's input, the HLS output and the content key all live in it; leaving it behind leaks the key."""
    asset = SimpleNamespace(status=AssetStatus.queued, error=None, source_key="uploads/x.mp4")
    seen: dict = {}

    async def set_status(aid, status, **fields):
        pass

    async def probe(path):
        seen["tmp"] = path.parent
        return {"duration": 5.0, "width": 1080, "height": 1920, "has_audio": True}

    async def rendition(src, out_dir, name, spec, has_audio, portrait, key_info):
        out_dir.mkdir(parents=True, exist_ok=True)

    async def upload(local, prefix):
        return 1

    monkeypatch.setattr(media, "SessionLocal", lambda: ScalarSession(asset))
    monkeypatch.setattr(media, "_set_status", set_status)
    monkeypatch.setattr(media, "_s3", lambda: FakeS3())
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))
    monkeypatch.setattr(media, "_probe", probe)
    monkeypatch.setattr(media, "_transcode_rendition", rendition)
    monkeypatch.setattr(media, "_upload_dir", upload)
    monkeypatch.setattr(media, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=True, hls_ladder=["1080p"]))

    await media.transcode_asset({}, str(ASSET_ID))
    assert not seen["tmp"].exists()


async def test_a_thumbnail_is_a_single_frame_at_the_requested_second(monkeypatch):
    asset = SimpleNamespace(source_key="uploads/videos/x.mp4")
    s3 = FakeS3()
    calls = _record_run(monkeypatch)
    monkeypatch.setattr(media, "SessionLocal", lambda: GetSession(asset))
    monkeypatch.setattr(media, "_s3", lambda: s3)
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    out = await media.generate_thumbnails({}, str(ASSET_ID), at_sec=4.5)

    assert out == {"status": "ok", "key": f"images/thumbs/{ASSET_ID}.jpg"}
    cmd = calls[0]
    # -ss before -i so ffmpeg seeks instead of decoding four seconds of video to throw away.
    assert cmd.index("-ss") < cmd.index("-i")
    assert cmd[cmd.index("-ss") + 1] == "4.5"
    assert cmd[cmd.index("-frames:v") + 1] == "1"
    assert cmd[cmd.index("-vf") + 1] == "scale=-2:1280"
    assert s3.downloads == [("katha", "uploads/videos/x.mp4", s3.downloads[0][2])]
    path, bucket, key, extra = s3.uploads[0]
    assert (bucket, key) == ("katha", f"images/thumbs/{ASSET_ID}.jpg")
    assert extra == {"ContentType": "image/jpeg"}


async def test_no_thumbnail_is_attempted_for_an_asset_that_is_gone(monkeypatch):
    calls = _record_run(monkeypatch)
    monkeypatch.setattr(media, "SessionLocal", lambda: GetSession(None))
    assert await media.generate_thumbnails({}, str(ASSET_ID)) == {"status": "missing"}
    assert calls == []


async def test_a_failed_thumbnail_raises_and_still_cleans_up_its_temp_dir(monkeypatch):
    """Unlike the transcode, this job has no status column to write to, so it fails loudly and leaves no litter."""
    asset = SimpleNamespace(source_key="uploads/videos/x.mp4")
    s3 = FakeS3()
    _record_run(monkeypatch, 1, "Output file is empty")
    monkeypatch.setattr(media, "SessionLocal", lambda: GetSession(asset))
    monkeypatch.setattr(media, "_s3", lambda: s3)
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))

    with pytest.raises(RuntimeError, match="Output file is empty"):
        await media.generate_thumbnails({}, str(ASSET_ID))
    assert s3.uploads == []
    assert not Path(s3.downloads[0][2]).parent.exists()


async def test_run_returns_the_exit_code_and_the_merged_output():
    """stderr is folded into stdout: ffmpeg reports its errors there, and the job quotes them back to the admin."""
    code, out = await media._run("sh", "-c", "echo out; echo err 1>&2; exit 3")
    assert code == 3
    assert "out" in out and "err" in out


async def test_run_decodes_output_that_is_not_utf8_instead_of_raising():
    """An ffmpeg error can quote bytes from the input file; a decode error here would mask the real failure."""
    code, out = await media._run("sh", "-c", "printf '\\xff\\xfebad'")
    assert code == 0
    assert "bad" in out


async def test_run_waits_for_the_child_it_killed(monkeypatch):
    """Killing without reaping leaves a zombie; the worker is long-lived, so they accumulate."""
    events: list[str] = []

    async def communicate():
        await asyncio.Event().wait()

    proc = SimpleNamespace(returncode=None)

    def kill():
        events.append("kill")
        proc.returncode = -9

    async def wait():
        events.append("wait")
        return proc.returncode

    proc.communicate, proc.kill, proc.wait = communicate, kill, wait
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *c, **k: _immediately(proc))

    task = asyncio.create_task(media._run("ffmpeg"))
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == ["kill", "wait"]


async def test_run_does_not_kill_a_child_that_already_exited(monkeypatch):
    """`communicate` can be interrupted after the process is done; killing then would target a reaped pid."""
    proc = SimpleNamespace(returncode=0, killed=False)

    async def communicate():
        raise KeyboardInterrupt

    def kill():
        proc.killed = True

    async def wait():
        return 0

    proc.communicate, proc.kill, proc.wait = communicate, kill, wait
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *c, **k: _immediately(proc))

    with pytest.raises(KeyboardInterrupt):
        await media._run("ffmpeg")
    assert not proc.killed


async def _immediately(value):
    return value


async def test_a_source_smaller_than_every_rung_keeps_only_the_smallest(monkeypatch):
    """Dropping every rung would leave an asset with nothing to play, so the smallest one stays."""
    asset = SimpleNamespace(status=AssetStatus.queued, error=None, source_key="uploads/tiny.mp4")
    done: list[str] = []

    async def set_status(aid, status, **fields):
        pass

    async def probe(path):
        return {"duration": 5.0, "width": 240, "height": 426, "has_audio": True}

    async def rendition(src, out_dir, name, spec, has_audio, portrait, key_info):
        done.append(name)
        out_dir.mkdir(parents=True, exist_ok=True)

    async def upload(local, prefix):
        return 1

    monkeypatch.setattr(media, "SessionLocal", lambda: ScalarSession(asset))
    monkeypatch.setattr(media, "_set_status", set_status)
    monkeypatch.setattr(media, "_s3", lambda: FakeS3())
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))
    monkeypatch.setattr(media, "_probe", probe)
    monkeypatch.setattr(media, "_transcode_rendition", rendition)
    monkeypatch.setattr(media, "_upload_dir", upload)
    monkeypatch.setattr(
        media, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=False, hls_ladder=["1080p", "720p", "480p", "360p"])
    )

    assert (await media.transcode_asset({}, str(ASSET_ID)))["renditions"] == ["360p"]
    assert done == ["360p"]


async def test_a_720p_master_is_not_upscaled_to_1080p(monkeypatch):
    asset = SimpleNamespace(status=AssetStatus.queued, error=None, source_key="uploads/master.mp4")
    done: list[str] = []

    async def set_status(aid, status, **fields):
        pass

    async def probe(path):
        return {"duration": 57.0, "width": 720, "height": 1280, "has_audio": True}

    async def rendition(src, out_dir, name, spec, has_audio, portrait, key_info):
        done.append(name)
        out_dir.mkdir(parents=True, exist_ok=True)

    async def upload(local, prefix):
        return 1

    monkeypatch.setattr(media, "SessionLocal", lambda: ScalarSession(asset))
    monkeypatch.setattr(media, "_set_status", set_status)
    monkeypatch.setattr(media, "_s3", lambda: FakeS3())
    monkeypatch.setattr(media, "get_settings", lambda: SimpleNamespace(s3_bucket="katha"))
    monkeypatch.setattr(media, "_probe", probe)
    monkeypatch.setattr(media, "_transcode_rendition", rendition)
    monkeypatch.setattr(media, "_upload_dir", upload)
    monkeypatch.setattr(
        media, "get_worker_settings", lambda: SimpleNamespace(hls_encrypt=False, hls_ladder=["1080p", "720p", "480p", "360p"])
    )

    await media.transcode_asset({}, str(ASSET_ID))
    assert done == ["720p", "480p", "360p"]
