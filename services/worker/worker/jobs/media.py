"""Video pipeline: source object -> HLS ladder -> CDN.

transcode_asset(asset_id):
  1. mark transcoding, download the source from the bucket to a temp dir
  2. ffprobe for duration and dimensions
  3. ffmpeg one pass per rendition (portrait ladder), 4-second fMP4 segments, AES-128 optional later
  4. write master.m3u8, upload everything under hls/{asset_id}/
  5. mark ready with renditions + duration, or failed with the error

The job is idempotent: a `ready` asset returns immediately, and a retry re-runs from scratch.
"""

import asyncio
import json
import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import boto3
import structlog
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.catalog import AssetStatus, VideoAsset
from app.services.media import PLACEHOLDER_KEY_URI, content_iv, content_key
from botocore.config import Config
from sqlalchemy import select

from worker.settings import get_worker_settings

log = structlog.get_logger()

# Portrait 9:16 ladder. Height is the long edge; width scales, even-rounded.
LADDER = {
    "1080p": {"height": 1920, "v_bitrate": "3500k", "a_bitrate": "128k", "bandwidth": 3800000},
    "720p": {"height": 1280, "v_bitrate": "1800k", "a_bitrate": "96k", "bandwidth": 2000000},
    "480p": {"height": 854, "v_bitrate": "900k", "a_bitrate": "64k", "bandwidth": 1000000},
}


def _s3():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        region_name=s.s3_region,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


async def _run(*cmd: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace")


async def _probe(path: Path) -> dict:
    ws = get_worker_settings()
    code, out = await _run(
        ws.ffprobe_bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)
    )
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {out[-500:]}")
    data = json.loads(out)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        raise RuntimeError("no video stream")
    return {
        "duration": float(data.get("format", {}).get("duration") or 0),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "has_audio": any(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    }


async def _transcode_rendition(
    src: Path, out_dir: Path, name: str, spec: dict, has_audio: bool, portrait: bool, key_info: Path | None
) -> None:
    ws = get_worker_settings()
    out_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240 - tiny local fs op
    # Scale so the long edge equals spec height; keep aspect; force even dimensions.
    scale = f"scale=-2:{spec['height']}" if portrait else f"scale={spec['height']}:-2"
    cmd = [
        ws.ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-vf",
        scale,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        spec["v_bitrate"],
        "-maxrate",
        spec["v_bitrate"],
        "-bufsize",
        str(int(spec["v_bitrate"][:-1]) * 2) + "k",
        "-g",
        "96",
        "-keyint_min",
        "96",
        "-sc_threshold",
        "0",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", spec["a_bitrate"], "-ac", "2"]
    else:
        cmd += ["-an"]
    cmd += ["-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments"]
    if key_info is not None:
        # AES-128 is defined for MPEG-TS only. fMP4 encryption in HLS means SAMPLE-AES, which needs a licence
        # server; until there is one, protecting the media costs the container.
        cmd += [
            "-hls_segment_type",
            "mpegts",
            "-hls_key_info_file",
            str(key_info),
            "-hls_segment_filename",
            str(out_dir / "seg_%04d.ts"),
        ]
    else:
        cmd += [
            "-hls_segment_type",
            "fmp4",
            "-hls_fmp4_init_filename",
            "init.mp4",
            "-hls_segment_filename",
            str(out_dir / "seg_%04d.m4s"),
        ]
    cmd += [str(out_dir / "index.m3u8")]
    code, out = await _run(*cmd)
    if code != 0:
        raise RuntimeError(f"ffmpeg {name} failed: {out[-800:]}")


def _master_playlist(renditions: dict[str, dict], *, encrypted: bool) -> str:
    # Version 7 is required by fMP4's EXT-X-MAP. TS needs only 6, and claiming 7 there would shut out players
    # that support everything actually used.
    version = 6 if encrypted else 7
    lines = ["#EXTM3U", f"#EXT-X-VERSION:{version}", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for name, r in renditions.items():
        lines.append(
            f'#EXT-X-STREAM-INF:BANDWIDTH={r["bandwidth"]},RESOLUTION={r["width"]}x{r["height"]},CODECS="avc1.4d401f,mp4a.40.2"'
        )
        lines.append(f"{name}/index.m3u8")
    return "\n".join(lines) + "\n"


async def _upload_dir(local: Path, prefix: str) -> int:
    client = _s3()
    bucket = get_settings().s3_bucket
    count = 0
    for path in local.rglob("*"):  # noqa: ASYNC240 - local temp dir walk
        if path.is_file():
            key = f"{prefix}/{path.relative_to(local).as_posix()}"
            ctype = (
                "application/vnd.apple.mpegurl"
                if path.suffix == ".m3u8"
                else "video/mp4"
                if path.suffix == ".mp4"
                else "video/iso.segment"
                if path.suffix == ".m4s"
                else "video/mp2t"
                if path.suffix == ".ts"
                else "application/octet-stream"
            )
            await asyncio.to_thread(
                client.upload_file,
                str(path),
                bucket,
                key,
                ExtraArgs={"ContentType": ctype, "CacheControl": "public, max-age=31536000, immutable"},
            )
            count += 1
    return count


async def _set_status(aid: uuid.UUID, status: AssetStatus, **fields) -> None:
    async with SessionLocal() as db:
        asset = await db.get(VideoAsset, aid)
        if asset is None:
            return
        asset.status = status
        for k, v in fields.items():
            setattr(asset, k, v)
        asset.updated_at = datetime.now(UTC)
        await db.commit()


async def transcode_asset(ctx: dict, asset_id: str) -> dict:
    aid = uuid.UUID(asset_id)
    async with SessionLocal() as db:
        asset = await db.scalar(select(VideoAsset).where(VideoAsset.id == aid).with_for_update())
        if asset is None:
            return {"status": "missing"}
        if asset.status == AssetStatus.ready:
            return {"status": "already_ready"}
        asset.status = AssetStatus.transcoding
        asset.error = None
        await db.commit()
        source_key = asset.source_key

    tmp = Path(tempfile.mkdtemp(prefix="katha-"))
    try:
        src = tmp / "source"
        await asyncio.to_thread(_s3().download_file, get_settings().s3_bucket, source_key, str(src))
        info = await _probe(src)
        portrait = info["height"] >= info["width"]
        long_edge = max(info["width"], info["height"])
        out_root = tmp / "hls"

        # The key and IV are derived from the master secret and this asset's id, never stored. ffmpeg needs
        # them on disk, so they live in the same temp tree that is deleted in `finally`; the API derives the
        # same values again when a player asks for the key.
        encrypt = get_worker_settings().hls_encrypt
        key_info: Path | None = None
        if encrypt:
            key_file = tmp / "hls.key"
            key_file.write_bytes(content_key(aid))  # noqa: ASYNC240 - local temp write
            key_info = tmp / "hls.keyinfo"
            key_info.write_text(  # noqa: ASYNC240 - local temp write
                f"{PLACEHOLDER_KEY_URI}\n{key_file.as_posix()}\n{content_iv(aid).hex()}\n",
                encoding="utf-8",
            )

        renditions: dict[str, dict] = {}
        for name in get_worker_settings().hls_ladder:
            spec = LADDER[name]
            if spec["height"] > long_edge and renditions:
                continue  # never upscale, but always keep at least one rendition
            await _transcode_rendition(src, out_root / name, name, spec, info["has_audio"], portrait, key_info)
            short_edge = max(2, int(round(spec["height"] * min(info["width"], info["height"]) / long_edge / 2) * 2))
            renditions[name] = {
                "bandwidth": spec["bandwidth"],
                "width": short_edge if portrait else spec["height"],
                "height": spec["height"] if portrait else short_edge,
                "playlist": f"{name}/index.m3u8",
            }
        (out_root / "master.m3u8").write_text(_master_playlist(renditions, encrypted=encrypt), encoding="utf-8")
        prefix = f"hls/{aid}"
        uploaded = await _upload_dir(out_root, prefix)
        await _set_status(
            aid,
            AssetStatus.ready,
            hls_master_key=f"{prefix}/master.m3u8",
            # Recorded so `/play` knows to hand back the manifest route, which mints the per-viewer key URL,
            # rather than a direct CDN link that no player could decrypt.
            is_encrypted=encrypt,
            renditions=renditions,
            duration_sec=round(info["duration"]),
            width=info["width"],
            height=info["height"],
        )
        log.info(
            "transcode.ready", asset_id=asset_id, renditions=list(renditions), files=uploaded, encrypted=encrypt
        )
        return {"status": "ready", "renditions": list(renditions), "files": uploaded, "encrypted": encrypt}
    except Exception as exc:  # any failure is recorded on the asset for the admin to see
        await _set_status(aid, AssetStatus.failed, error=str(exc)[:2000])
        log.error("transcode.failed", asset_id=asset_id, error=str(exc))
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def generate_thumbnails(ctx: dict, asset_id: str, at_sec: float = 1.0) -> dict:
    """Poster frame from the source, uploaded to images/thumbs/{asset_id}.jpg."""
    aid = uuid.UUID(asset_id)
    async with SessionLocal() as db:
        asset = await db.get(VideoAsset, aid)
        if asset is None:
            return {"status": "missing"}
        source_key = asset.source_key
    tmp = Path(tempfile.mkdtemp(prefix="katha-thumb-"))
    try:
        src = tmp / "source"
        await asyncio.to_thread(_s3().download_file, get_settings().s3_bucket, source_key, str(src))
        out = tmp / "thumb.jpg"
        code, log_out = await _run(
            get_worker_settings().ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            str(at_sec),
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-vf",
            "scale=-2:1280",
            "-q:v",
            "3",
            str(out),
        )
        if code != 0:
            raise RuntimeError(log_out[-500:])
        key = f"images/thumbs/{aid}.jpg"
        await asyncio.to_thread(
            _s3().upload_file, str(out), get_settings().s3_bucket, key, ExtraArgs={"ContentType": "image/jpeg"}
        )
        return {"status": "ok", "key": key}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
