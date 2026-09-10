"""Verify a portable seed pack; explicitly upload/import into a configured Katha API."""

import argparse
import asyncio
import html
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from pack import ROOT, safe_path, verify


def credits_html(seed):
    parts = [
        (
            "<p>This developer collection contains five licensed films split into five sequential chapters each. "
            "These are technical chapter cuts, not original episodic productions. Original audio and end credits are retained.</p>"
        ),
        (
            "<p>Each film remains under its original licence. No creator endorsement is implied, and service terms do not "
            "remove the reuse permissions granted by these licences.</p>"
        ),
    ]
    for series in seed["series"]:
        parts.extend(
            [
                f"<h2>{html.escape(series['title'])}</h2>",
                f"<p>{html.escape(series['attribution'])}</p>",
                (
                    f'<p><a href="{html.escape(series["rights_url"], quote=True)}">Creator licence statement</a> · '
                    f'<a href="{html.escape(series["license_url"], quote=True)}">{html.escape(series["license"])}</a> · '
                    f'<a href="{html.escape(series["source_page_url"], quote=True)}">Original film</a></p>'
                ),
                f"<p>Changes: {html.escape(series['changes'])}</p>",
            ]
        )
    return "\n".join(parts)


async def apply_seed(seed, manifest, publish, archive_originals):
    from app.core.config import get_settings
    from app.core.db import SessionLocal, engine
    from app.models.catalog import (
        AssetStatus,
        Category,
        Episode,
        PublishStatus,
        Series,
        SeriesTranslation,
        VideoAsset,
    )
    from app.models.ops import CmsPage, CmsPageTranslation
    from app.services import storage
    from botocore.exceptions import ClientError
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    settings = get_settings()
    client = storage._client()
    prefix = seed["storage_prefix"]
    safe_path(ROOT, prefix)
    uploaded = 0
    skipped = 0
    for path, metadata in manifest["files"].items():
        if not path.startswith("media/"):
            continue
        key = f"{prefix}/{path}"
        try:
            previous = client.head_object(Bucket=settings.s3_bucket, Key=key)
        except ClientError as error:
            if str(error.response.get("Error", {}).get("Code")) not in (
                "404",
                "NoSuchKey",
                "NotFound",
            ):
                raise
        else:
            if (
                previous.get("Metadata", {}).get("sha256") == metadata["sha256"]
                and previous["ContentLength"] == metadata["size_bytes"]
            ):
                skipped += 1
                continue
        content_type = {
            ".jpg": "image/jpeg",
            ".mp4": "video/mp4",
            ".ts": "video/mp2t",
            ".m3u8": "application/vnd.apple.mpegurl",
        }[Path(path).suffix]
        with safe_path(ROOT, path).open("rb") as stream:
            client.put_object(
                Bucket=settings.s3_bucket,
                Key=key,
                Body=stream,
                ContentType=content_type,
                Metadata={"sha256": metadata["sha256"]},
                CacheControl="public, max-age=3600",
            )
        uploaded += 1
    print(f"Uploaded {uploaded} assets; reused {skipped} matching assets", flush=True)
    now = datetime.now(timezone.utc)
    imported = []
    try:
        async with SessionLocal() as database:
            for order, item in enumerate(seed["series"]):
                series = await database.scalar(
                    select(Series)
                    .where(Series.slug == item["slug"])
                    .options(selectinload(Series.categories))
                )
                if series is None:
                    series = Series(slug=item["slug"], categories=[])
                    database.add(series)
                for field in (
                    "original_language",
                    "free_episodes",
                    "episode_price",
                    "is_premium",
                    "completion_status",
                    "release_note",
                    "content_rating",
                ):
                    setattr(series, field, item[field])
                series.cover_url = f"{prefix}/{item['cover_path']}"
                series.banner_url = f"{prefix}/{item['banner_path']}"
                series.moderation_note = item["content_advisory"]
                series.is_featured = True
                series.sort_weight = 150 - order
                if publish or series.status != PublishStatus.published:
                    series.status = (
                        PublishStatus.published if publish else PublishStatus.draft
                    )
                if publish:
                    series.released_at = series.released_at or now
                await database.flush()
                categories = []
                for name in item["categories"]:
                    slug = name.lower().replace(" ", "-")
                    category = await database.scalar(
                        select(Category).where(Category.slug == slug)
                    )
                    if category is None:
                        category = Category(
                            slug=slug,
                            name=name,
                            sort_order=0 if slug == "short-films" else 10,
                        )
                        database.add(category)
                        await database.flush()
                    categories.append(category)
                series.categories = categories
                translation = await database.get(SeriesTranslation, (series.id, "en"))
                if translation is None:
                    translation = SeriesTranslation(series_id=series.id, lang="en")
                    database.add(translation)
                translation.title = item["title"]
                translation.synopsis = (
                    f"{item['synopsis']}\n\n{item['audio']}. Five sequential chapters from one film, "
                    f"not an original episodic series. {item['changes']}\n\n{item['attribution']} "
                    f"{item['license']}: {item['license_url']} Source and rights: {item['rights_url']}"
                )
                translation.seo_title = f"{item['title']} | Katha"
                translation.meta_description = item["synopsis"][:200]
                for entry in item["episodes"]:
                    episode = await database.scalar(
                        select(Episode).where(
                            Episode.series_id == series.id,
                            Episode.number == entry["number"],
                        )
                    )
                    if episode is None:
                        episode = Episode(series_id=series.id, number=entry["number"])
                        database.add(episode)
                    video = (
                        await database.get(VideoAsset, episode.video_asset_id)
                        if episode.video_asset_id
                        else None
                    )
                    if video is None:
                        video = VideoAsset(source_key=f"{prefix}/{entry['video_path']}")
                        database.add(video)
                        await database.flush()
                    video.source_key = f"{prefix}/{entry['video_path']}"
                    video.hls_master_key = f"{prefix}/{entry['hls_master_path']}"
                    video.status = AssetStatus.ready
                    video.duration_sec = entry["duration_sec"]
                    video.width, video.height = 1280, 720
                    video.renditions = entry["renditions"]
                    video.checksum = entry["video_sha256"]
                    video.size_bytes = entry["video_size_bytes"]
                    video.is_encrypted = False
                    episode.video_asset_id = video.id
                    episode.title = entry["title"]
                    episode.duration_sec = entry["duration_sec"]
                    episode.thumbnail_url = f"{prefix}/{entry['thumbnail_path']}"
                    episode.is_free_override = True
                    episode.price_override = 0
                    episode.status = series.status
                    if publish:
                        episode.published_at = episode.published_at or now
                imported.append(
                    {"slug": series.slug, "series_id": str(series.id), "episodes": 5}
                )
            page = await database.scalar(
                select(CmsPage).where(CmsPage.slug == "film-credits")
            )
            if page is None:
                page = CmsPage(slug="film-credits")
                database.add(page)
                await database.flush()
            page.is_published = publish or page.is_published
            page.show_in_footer = True
            translation = await database.get(CmsPageTranslation, (page.id, "en"))
            if translation is None:
                translation = CmsPageTranslation(page_id=page.id, lang="en")
                database.add(translation)
            translation.title = "Film credits & licences"
            translation.body_html = credits_html(seed)
            if archive_originals:
                originals = await database.scalars(
                    select(Series).where(
                        Series.slug.in_(
                            [item["source"]["slug"] for item in seed["series"]]
                        )
                    )
                )
                for original in originals:
                    original.status = PublishStatus.archived
                    original.is_featured = False
                    print(
                        f"Archived original full-film listing {original.slug}; records/media retained"
                    )
            await database.commit()
    finally:
        await engine.dispose()
    print(json.dumps({"imported": imported, "published": publish}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT.parents[1])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--archive-originals", action="store_true")
    args = parser.parse_args()
    if args.archive_originals and not (args.apply and args.publish):
        parser.error("--archive-originals requires --apply --publish")
    seed, manifest = verify(ROOT)
    if not args.apply:
        print(
            "Preview only: 5 series and 25 free chapters. No storage or database changes."
        )
        return
    api = args.repo.resolve() / "services/api"
    if not (api / "app/main.py").is_file():
        parser.error(
            "--repo must point to the Katha repository with its configured API environment"
        )
    sys.path.insert(0, str(api))
    asyncio.run(apply_seed(seed, manifest, args.publish, args.archive_originals))


if __name__ == "__main__":
    main()
