"""Attach locally generated HLS streams to the seeded episodes, so the player can be exercised for real.

Local development has no transcoder. Without a ready `video_assets` row every episode answers `asset_not_ready`
from `POST /v1/episodes/{id}/play`, which means the player, swipe-between-episodes, auto-advance, resume and
the scrubber cannot be tested at all on a device — the part of the product most worth testing is the part a
local stack cannot reach.

`scripts/seed-assets/gen-hls.py` builds ten short portrait streams with the episode number burned into the
picture and a seconds counter that only moves while frames are actually decoding. This points the episodes at
them. Both are local-only: nothing here runs in staging or production, where real uploads produce real assets.

Serve the streams with the same static server that carries the seed art, and point the API at it:

    python -m http.server 8090 --directory services/api/scripts/seed-assets
    KATHA_CDN_BASE_URL=http://10.0.2.2:8090   (10.0.2.2 is the host as seen from an Android emulator)

Usage: uv run python scripts/seed_local_media.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.catalog import AssetStatus, Series, VideoAsset  # noqa: E402

ASSETS = Path(__file__).parent / "seed-assets"
DURATION_SEC = 8


async def main() -> int:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        print(f"Refusing to run in env={settings.env}: this attaches placeholder video to real episodes.")
        return 1

    async with SessionLocal() as db:
        series = (
            await db.scalars(select(Series).options(selectinload(Series.episodes)).order_by(Series.created_at))
        ).first()
        if series is None:
            print("No series found. Run scripts/seed.py first.")
            return 1

        attached = 0
        missing: list[int] = []
        for episode in sorted(series.episodes, key=lambda e: e.number):
            key = f"media/heiress/ep{episode.number}/master.m3u8"
            if not (ASSETS / key).exists():
                missing.append(episode.number)
                continue

            asset = await db.get(VideoAsset, episode.video_asset_id) if episode.video_asset_id else None
            if asset is None:
                asset = VideoAsset(source_key=f"uploads/local/ep{episode.number}.mp4")
                db.add(asset)
                await db.flush()
                episode.video_asset_id = asset.id

            asset.status = AssetStatus.ready
            asset.hls_master_key = key
            asset.duration_sec = DURATION_SEC
            asset.width = 720
            asset.height = 1280
            # The clients read the episode's own duration for the scrubber's end label.
            episode.duration_sec = DURATION_SEC
            attached += 1

        slug = series.slug
        await db.commit()

    print(f"Attached {attached} episode(s) of '{slug}' to local HLS.")
    if missing:
        print(f"No stream for episode(s) {missing}. Run: python scripts/seed-assets/gen-hls.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
