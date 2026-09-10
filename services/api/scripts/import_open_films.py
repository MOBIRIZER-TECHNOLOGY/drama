"""Import the prepared open-film catalogue; preview by default, apply explicitly."""

import argparse
import asyncio
import html
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.catalog import (  # noqa: E402
    AssetStatus,
    Category,
    Episode,
    PublishStatus,
    Series,
    SeriesTranslation,
    VideoAsset,
)
from app.models.ops import CmsPage, CmsPageTranslation  # noqa: E402
from app.services import storage  # noqa: E402
from scripts.prepare_open_films import ASSETS, CATALOG_PATH, MANIFEST_PATH, checksum, validate_playlist  # noqa: E402


def verified_manifest() -> tuple[dict, dict]:
    catalog = json.loads(CATALOG_PATH.read_text())
    manifest = json.loads(MANIFEST_PATH.read_text())
    if manifest["catalog_sha256"] != checksum(CATALOG_PATH):
        raise ValueError("Catalogue changed; run prepare_open_films.py before importing.")
    if {film["slug"] for film in catalog["films"]} != {film["slug"] for film in manifest["films"]}:
        raise ValueError("Prepared manifest does not match the catalogue.")
    for asset in manifest["films"]:
        paths = {asset["source_key"]: asset["source_sha256"], **asset["objects"]}
        for key, digest in paths.items():
            path = (ASSETS / key).resolve()
            if not path.is_relative_to(ASSETS.resolve()) or not path.is_file() or checksum(path) != digest:
                raise ValueError(f"Missing or modified asset: {key}")
        for label in asset["renditions"]:
            validate_playlist((ASSETS / asset["hls_master_key"]).parent / label / "index.m3u8", asset["duration_sec"])
    return catalog, manifest


def upload_assets(manifest: dict) -> None:
    client = storage._client()
    bucket = get_settings().s3_bucket
    for asset in manifest["films"]:
        for key in [asset["source_key"], *asset["objects"]]:
            suffix = Path(key).suffix
            mime = {
                ".mp4": "video/mp4",
                ".m3u8": "application/vnd.apple.mpegurl",
                ".ts": "video/mp2t",
                ".jpg": "image/jpeg",
            }[suffix]
            with (ASSETS / key).open("rb") as body:
                client.put_object(
                    Bucket=bucket,
                    Key=key,
                    Body=body,
                    ContentType=mime,
                    CacheControl="public, max-age=3600" if suffix != ".mp4" else "private, max-age=0",
                )
        print(f"Uploaded {asset['slug']}: source, HLS renditions and artwork", flush=True)


def credits_html(catalog: dict) -> str:
    parts = [
        "<p>These complete short films are shared under Creative Commons Attribution 3.0. "
        "They are works of their credited creators, not Katha originals. Full credits are preserved in each film.</p>",
        "<p>The films remain available under their original licence; general service terms do not remove "
        "the reuse rights granted by that licence. No endorsement of Katha by the creators is implied.</p>",
    ]
    for film in catalog["films"]:
        parts.extend(
            [
                f"<h2>{html.escape(film['title'])} ({film['year']})</h2>",
                f"<p>{html.escape(film['attribution'])}</p>",
                f'<p><a href="{html.escape(film["rights_url"], quote=True)}">Creator licence statement</a> · '
                f'<a href="{catalog["license_url"]}">CC BY 3.0</a> · '
                f'<a href="{html.escape(film["source_page_url"], quote=True)}">Original film</a></p>',
                "<p>Changes: converted to HLS at 720p and 360p, frame rate converted to 24 fps, "
                "letterboxed without cropping the film. Catalogue images are resized/cropped still frames from "
                "this film. No story edits, dubbing or replacement music. Original credits retained.</p>",
            ]
        )
    return "\n".join(parts)


async def import_catalog(catalog: dict, manifest: dict, publish: bool, archive_demo: bool) -> None:
    assets = {asset["slug"]: asset for asset in manifest["films"]}
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        for order, film in enumerate(catalog["films"]):
            asset_info = assets[film["slug"]]
            series = await db.scalar(
                select(Series).where(Series.slug == film["slug"]).options(selectinload(Series.categories))
            )
            if series is None:
                series = Series(slug=film["slug"], categories=[])
                db.add(series)
            series.cover_url = asset_info["cover_key"]
            series.banner_url = asset_info["banner_key"]
            series.original_language = film["original_language"]
            series.free_episodes = 1
            series.episode_price = 0
            series.is_premium = False
            series.is_featured = True
            series.sort_weight = 100 - order
            series.completion_status = "Completed"
            series.release_note = f"Complete short film · {film['year']} · {film['audio_description']}"
            series.content_rating = film["editorial_rating"]
            series.moderation_note = film["content_advisory"]
            if publish or series.status != PublishStatus.published:
                series.status = PublishStatus.published if publish else PublishStatus.draft
            if publish:
                series.released_at = series.released_at or now
            await db.flush()
            categories = []
            for name in ["Short Films", *film["genres"]]:
                slug = name.lower().replace(" ", "-")
                category = await db.scalar(select(Category).where(Category.slug == slug))
                if category is None:
                    category = Category(slug=slug, name=name, sort_order=0 if slug == "short-films" else 10)
                    db.add(category)
                    await db.flush()
                categories.append(category)
            series.categories = categories
            translation = await db.get(SeriesTranslation, (series.id, "en"))
            if translation is None:
                translation = SeriesTranslation(series_id=series.id, lang="en")
                db.add(translation)
            translation.title = film["title"]
            translation.synopsis = (
                f"{film['synopsis']}\n\n{film['audio_description']}. {film['attribution']} "
                f"CC BY 3.0: {catalog['license_url']} Source and rights: {film['rights_url']} "
                "Full original credits retained. HLS conversion and letterboxing; cover images cropped from film frames."
            )
            translation.seo_title = f"{film['title']} ({film['year']}) | Katha"
            translation.meta_description = film["synopsis"][:200]
            episode = await db.scalar(select(Episode).where(Episode.series_id == series.id, Episode.number == 1))
            if episode is None:
                episode = Episode(series_id=series.id, number=1)
                db.add(episode)
            video = await db.get(VideoAsset, episode.video_asset_id) if episode.video_asset_id else None
            if video is None:
                video = VideoAsset(source_key=asset_info["source_key"])
                db.add(video)
                await db.flush()
            video.source_key = asset_info["source_key"]
            video.status = AssetStatus.ready
            video.hls_master_key = asset_info["hls_master_key"]
            video.duration_sec = asset_info["duration_sec"]
            video.width = 1280
            video.height = 720
            video.renditions = asset_info["renditions"]
            video.checksum = asset_info["source_sha256"]
            video.size_bytes = asset_info["source_size_bytes"]
            video.is_encrypted = False
            episode.video_asset_id = video.id
            episode.title = f"{film['title']} — Full Film"
            episode.thumbnail_url = asset_info["banner_key"]
            episode.duration_sec = asset_info["duration_sec"]
            episode.is_free_override = True
            episode.price_override = 0
            episode.status = series.status
            if publish:
                episode.published_at = episode.published_at or now
        page = await db.scalar(select(CmsPage).where(CmsPage.slug == "film-credits"))
        if page is None:
            page = CmsPage(slug="film-credits")
            db.add(page)
            await db.flush()
        page.show_in_footer = True
        page.is_published = publish or page.is_published
        translation = await db.get(CmsPageTranslation, (page.id, "en"))
        if translation is None:
            translation = CmsPageTranslation(page_id=page.id, lang="en")
            db.add(translation)
        translation.title = "Film credits & licences"
        translation.body_html = credits_html(catalog)
        if archive_demo:
            samples = await db.scalars(
                select(Series).where(
                    Series.slug.in_(
                        [
                            "sample-series",
                            "e2e-filler-monsoon",
                            "e2e-filler-harbour",
                            "e2e-filler-orchard",
                        ]
                    )
                )
            )
            for sample in samples:
                sample.status = PublishStatus.archived
                sample.is_featured = False
                print(f"Archived {sample.slug}; test media and viewing history are retained.")
        await db.commit()
    print("Imported 3 full films and the film-credits page.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--archive-demo", action="store_true", help="Archive sample-series and the three known e2e-filler fixtures."
    )
    args = parser.parse_args()
    if args.archive_demo and not args.publish:
        parser.error("--archive-demo requires --publish so the replacement catalogue is visible.")
    catalog, manifest = verified_manifest()
    print(
        f"Verified {len(manifest['films'])} films; {sum(asset['duration_sec'] for asset in manifest['films'])} seconds."
    )
    if not args.apply:
        print("Preview only. Use --apply to upload/import drafts; add --publish to make them visible.")
        return
    upload_assets(manifest)
    asyncio.run(import_catalog(catalog, manifest, args.publish, args.archive_demo))


if __name__ == "__main__":
    main()
