"""Re-package an episode's HLS with AES-128, using the key derived for its video asset.

Playback URLs were the only protection on the media: they decide who may start a stream and nothing after
that, and the segments behind them were plain `.ts` files. This encrypts them, so a leaked URL buys a pile of
ciphertext rather than the episode.

Re-packaged from the source MP4 rather than by encrypting the existing segments by hand. ffmpeg writes the
key, the IVs and the playlist together, and hand-rolling AES over segment files is exactly the kind of thing
that appears to work and is subtly wrong.

The key is not written anywhere lasting. It is derived from the master secret and the asset id, handed to
ffmpeg in a temporary file, and deleted; the API derives the same value again when a player asks for it. The
URI baked into the playlist is a placeholder, because the real key URL is minted per viewer at request time.

AES-128 requires MPEG-TS segments — HLS has no such method for fMP4, which needs SAMPLE-AES and a DRM licence
server — so this writes TS.

Usage:
    uv run python scripts/encrypt_hls.py --slug ashes-of-lucknow --episode 1
    uv run python scripts/encrypt_hls.py --all
"""

import argparse
import asyncio
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.catalog import Episode, Series  # noqa: E402
from app.services.media import PLACEHOLDER_KEY_URI, content_iv, content_key  # noqa: E402

RENDITIONS = ("1080p", "720p", "540p", "360p")
DEFAULT_LIBRARY = Path(__file__).resolve().parents[3] / "ref" / "videos"


def _package(source: Path, out_dir: Path, key: bytes, iv: str) -> None:
    """Write one encrypted rendition ladder entry. Overwrites `out_dir` in place."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        key_file = tmp_path / "hls.key"
        key_file.write_bytes(key)
        # ffmpeg's key info file: the URI to write into the playlist, the key, then the IV. Without that
        # third line ffmpeg writes IV=0 into the playlist, so every segment of every rendition is encrypted
        # under the same key and IV and their identical opening bytes encrypt identically. The IV is derived
        # per asset, so it needs no storage either.
        info = tmp_path / "hls.keyinfo"
        info.write_text(f"{PLACEHOLDER_KEY_URI}\n{key_file.as_posix()}\n{iv}\n", encoding="utf-8")

        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("*.ts"):
            old.unlink()
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(source),
                "-c", "copy",
                "-f", "hls",
                "-hls_time", "4",
                "-hls_playlist_type", "vod",
                "-hls_flags", "independent_segments",
                "-hls_key_info_file", str(info),
                "-hls_segment_filename", str(out_dir / "seg_%04d.ts"),
                str(out_dir / "index.m3u8"),
            ],
            check=True,
        )


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument("--slug")
    parser.add_argument("--episode", type=int)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if get_settings().env not in ("local", "test"):
        print(f"Refusing to run in env={get_settings().env}: re-packages media in place.")
        return 1
    if shutil.which("ffmpeg") is None:  # noqa: ASYNC240 - one-off script, not a request path
        print("ffmpeg is not on PATH.")
        return 1
    if not args.all and not (args.slug and args.episode):
        print("Pass --all, or both --slug and --episode.")
        return 1

    done = 0
    async with SessionLocal() as db:
        query = select(Episode).options(selectinload(Episode.video_asset)).join(Series)
        if not args.all:
            query = query.where(Series.slug == args.slug, Episode.number == args.episode)
        episodes = (await db.scalars(query)).all()

        for episode in episodes:
            asset = episode.video_asset
            if asset is None or not asset.hls_master_key:
                continue
            # `source_key` is the original upload; the catalogue stores it relative to the library root.
            source = args.library / asset.source_key
            if not source.exists():  # noqa: ASYNC240 - one-off script, not a request path
                print(f"  skip ep{episode.number}: no source at {source}")
                continue

            hls_root = args.library / Path(asset.hls_master_key).parent
            key = content_key(asset.id)
            iv = content_iv(asset.id).hex()
            for rendition in RENDITIONS:
                out_dir = hls_root / rendition
                if not out_dir.exists():  # noqa: ASYNC240 - one-off script, not a request path
                    continue
                _package(source, out_dir, key, iv)

            asset.is_encrypted = True
            done += 1
            print(f"  encrypted {asset.hls_master_key}")

        await db.commit()

    print(f"Re-packaged {done} asset(s) with AES-128.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
