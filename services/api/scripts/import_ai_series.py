"""Import a delivered AI-series pack (catalog.json + per-episode folders) as draft series; preview by default.

Videos go in as queued `video_assets` and the arq worker builds the HLS ladder, exactly as an admin upload does.
Nothing is published here: series and episodes stay drafts until an operator publishes them.

    python scripts/import_ai_series.py [--pack <dir with catalog.json>] [--video-root <dir>] [--apply] [--wait] [--publish]

The default pack is seed/ai-series at the repository root (see seed/README.md). `--wait` blocks until the worker has
finished every transcode, and `--publish` then makes the series and episodes live, so a fresh checkout is one command
away from a populated app. Re-running is safe: series that are already imported are skipped.
"""

import argparse
import asyncio
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.catalog import (  # noqa: E402
    AssetStatus,
    Category,
    Episode,
    PublishStatus,
    Series,
    SeriesTranslation,
    Subtitle,
    VideoAsset,
)
from app.services import jobs, storage  # noqa: E402

AI_NOTE = "AI-generated series. "
RATINGS = {"UA": "UA7"}  # the pack says plain "UA"; Katha only knows U, UA7, UA13, UA16, A
VALID_RATINGS = {"U", "UA7", "UA13", "UA16", "A"}


def rating(s: dict) -> str | None:
    r = RATINGS.get(s.get("content_rating"), s.get("content_rating"))
    if r is not None and r not in VALID_RATINGS:
        raise ValueError(f"{s['slug']}: unknown content rating {r!r}; an unknown rating is treated as adult")
    return r


def srt_to_vtt(srt: str) -> str:
    body = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", srt.replace("\r\n", "\n").strip())
    return "WEBVTT\n\n" + body + "\n"


def _put(key: str, path: Path | None, content_type: str, *, data: bytes | None = None, cache: str = "public, max-age=3600") -> None:
    client, bucket = storage._client(), get_settings().s3_bucket
    if data is not None:
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type, CacheControl=cache)
        return
    with path.open("rb") as body:  # type: ignore[union-attr]
        client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, CacheControl=cache)


async def import_pack(pack: Path, video_root: Path, catalog: dict) -> None:
    queued: list[str] = []
    async with SessionLocal() as db:
        for order, s in enumerate(catalog["series"]):
            slug = s["slug"]
            series = await db.scalar(select(Series).where(Series.slug == slug))
            if series is not None:
                print(f"skip {slug}: already imported")
                continue
            cover_key, banner_key = f"images/{slug}/cover.jpg", f"images/{slug}/banner.jpg"
            _put(cover_key, pack / s["cover"], "image/jpeg")
            _put(banner_key, pack / s["banner"], "image/jpeg")

            cats = []
            for name in s["categories"]:
                cslug = name.lower().replace(" ", "-")
                cat = await db.scalar(select(Category).where(Category.slug == cslug))
                if cat is None:
                    cat = Category(slug=cslug, name=name, sort_order=10)
                    db.add(cat)
                    await db.flush()
                cats.append(cat)

            series = Series(
                slug=slug,
                categories=cats,
                # Full URLs, as the admin console's own uploads store them; the console renders this field as an <img src>.
                cover_url=storage.public_url(cover_key),
                banner_url=storage.public_url(banner_key),
                original_language="hi",
                free_episodes=s["free_episodes"],
                completion_status=s.get("completion_status"),
                release_note="AI-generated · Hindi",
                content_rating=rating(s),
                moderation_note=s.get("content_advisory"),
                is_featured=order < 3,
                sort_weight=100 - order,
                status=PublishStatus.draft,
            )
            db.add(series)
            await db.flush()
            db.add(
                SeriesTranslation(
                    series_id=series.id,
                    lang="en",
                    title=s["title"],
                    synopsis=AI_NOTE + s["synopsis"] + f"\n\n{s.get('ai_disclosure_note', '')}".rstrip(),
                    seo_title=f"{s['title']} | Katha"[:70],
                    meta_description=s["synopsis"][:200],
                )
            )
            db.add(
                SeriesTranslation(
                    series_id=series.id,
                    lang="hi",
                    title=s["title_hi"],
                    synopsis=AI_NOTE + s["synopsis"],
                )
            )

            for e in s["episodes"]:
                folder = Path(e["video"]).parent
                video = video_root / e["video"]
                thumb_key = f"images/{slug}/{folder.name}.jpg"
                _put(thumb_key, pack / e["thumbnail"], "image/jpeg")
                source_key = storage.object_key("uploads/videos", "video.mp4")
                _put(source_key, video, "video/mp4", cache="private, max-age=0")

                asset = VideoAsset(source_key=source_key, status=AssetStatus.queued, size_bytes=video.stat().st_size)
                db.add(asset)
                await db.flush()
                ep = Episode(
                    series_id=series.id,
                    number=e["number"],
                    title=e["title"],
                    thumbnail_url=storage.public_url(thumb_key),
                    duration_sec=e["duration_sec"],
                    video_asset_id=asset.id,
                    is_free_override=bool(e["is_free"]),
                    status=PublishStatus.draft,
                )
                db.add(ep)
                await db.flush()
                vtt_key = f"subtitles/{slug}/{folder.name}.hi.vtt"
                _put(
                    vtt_key,
                    None,
                    "text/vtt",
                    data=srt_to_vtt((pack / e["subtitles_hi"]).read_text(encoding="utf-8")).encode("utf-8"),
                )
                db.add(Subtitle(episode_id=ep.id, lang="hi", vtt_key=vtt_key, source="ai"))
                queued.append(str(asset.id))
            await db.commit()
            print(f"imported {slug}: {len(s['episodes'])} episodes (draft)", flush=True)

    for aid in queued:
        await jobs.enqueue("transcode_asset", aid, job_id=f"transcode:{aid}")
    await jobs.close()
    print(f"queued {len(queued)} transcodes")


DEFAULT_PACK = Path(__file__).resolve().parents[3] / "seed" / "ai-series"


async def wait_for_transcodes(slugs: list[str], timeout_s: int) -> None:
    """Block until every video of the given series is `ready`; stop early if one fails."""
    deadline = time.monotonic() + timeout_s
    while True:
        async with SessionLocal() as db:
            rows = (
                await db.execute(
                    select(VideoAsset.status, func.count())
                    .join(Episode, Episode.video_asset_id == VideoAsset.id)
                    .join(Series, Series.id == Episode.series_id)
                    .where(Series.slug.in_(slugs))
                    .group_by(VideoAsset.status)
                )
            ).all()
        counts = {status: n for status, n in rows}
        total = sum(counts.values())
        ready = counts.get(AssetStatus.ready, 0)
        print(f"  transcodes: {ready}/{total} ready", flush=True)
        if counts.get(AssetStatus.failed, 0):
            sys.exit("a transcode failed; check the worker log, then re-run")
        if total and ready == total:
            return
        if time.monotonic() > deadline:
            sys.exit(f"timed out after {timeout_s}s with {ready}/{total} ready; is the worker running?")
        await asyncio.sleep(10)


async def publish_pack(slugs: list[str]) -> None:
    """Make the imported series and their episodes live. Only ready videos are published."""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        for slug in slugs:
            series = await db.scalar(select(Series).where(Series.slug == slug))
            if series is None:
                continue
            eps = (await db.scalars(select(Episode).where(Episode.series_id == series.id))).all()
            published = 0
            for ep in eps:
                asset = await db.get(VideoAsset, ep.video_asset_id) if ep.video_asset_id else None
                if asset is None or asset.status != AssetStatus.ready:
                    continue
                if ep.status != PublishStatus.published:
                    ep.status, ep.published_at = PublishStatus.published, now
                published += 1
            if published:
                series.status = PublishStatus.published
            await db.commit()
            print(f"published {slug}: {published}/{len(eps)} episodes", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pack", type=Path, default=DEFAULT_PACK, help="folder holding catalog.json, covers, thumbnails, subtitles (default: seed/ai-series)")
    ap.add_argument("--video-root", type=Path, help="folder mirroring the pack with the video files to upload (default: the pack)")
    ap.add_argument("--apply", action="store_true", help="upload and import (otherwise only a preview)")
    ap.add_argument("--wait", action="store_true", help="after importing, wait until the worker has transcoded every video")
    ap.add_argument("--publish", action="store_true", help="publish series and episodes whose video is ready (implies --wait)")
    ap.add_argument("--timeout", type=int, default=3600, help="seconds to wait for transcodes (default 3600)")
    args = ap.parse_args()
    catalog = json.loads((args.pack / "catalog.json").read_text(encoding="utf-8"))
    root = args.video_root or args.pack
    missing = [
        p
        for s in catalog["series"]
        for e in s["episodes"]
        for p in (args.pack / e["thumbnail"], args.pack / e["subtitles_hi"], root / e["video"])
        if not p.is_file()
    ]
    eps = sum(len(s["episodes"]) for s in catalog["series"])
    print(f"{len(catalog['series'])} series, {eps} episodes, {len(missing)} missing files")
    if missing:
        sys.exit("missing: " + ", ".join(str(m) for m in missing[:5]))
    if not args.apply:
        print("Preview only. Use --apply to upload and import drafts.")
        return
    slugs = [s["slug"] for s in catalog["series"]]
    asyncio.run(import_pack(args.pack, root, catalog))
    if args.wait or args.publish:
        asyncio.run(wait_for_transcodes(slugs, args.timeout))
    if args.publish:
        asyncio.run(publish_pack(slugs))


if __name__ == "__main__":
    main()
