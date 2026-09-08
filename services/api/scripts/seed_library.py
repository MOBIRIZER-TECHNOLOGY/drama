"""Import the real drama catalogue from `ref/videos/library` into the database.

`scripts/seed.py` invents one placeholder series so a fresh checkout is not empty. This imports the actual
content instead: five series, nineteen episodes, with covers, per-episode posters and HLS already built by the
video pipeline that produced them. Everything a screen shows — titles in two scripts, real synopses, real
durations, real free/locked splits — comes from `catalog.json` rather than from something written to look
plausible, which is the only way the layouts get tested against content that will actually ship.

The catalogue also carries deliberate stress cases: an episode whose `title_display` is a sentence long,
precisely to find where a card truncates. Those are imported as-is. A layout that only ever sees tidy data is
not a layout that has been tested.

`ref/` is a local vendor directory and is not committed, so this is a no-op with a clear message when the
catalogue is absent.

The media is served as static files, keyed relative to the library root:

    python -m http.server 8090 --directory ref/videos
    KATHA_CDN_BASE_URL=http://10.0.2.2:8090     (10.0.2.2 is the host as seen from an Android emulator)

Usage: uv run python scripts/seed_library.py [--library PATH] [--cdn-base URL]
"""

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

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

DEFAULT_LIBRARY = Path(__file__).resolve().parents[3] / "ref" / "videos" / "library"


def _slugify(value: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in value.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")[:80]


async def _category(db, name: str, order: int) -> Category:
    slug = _slugify(name)
    row = await db.scalar(select(Category).where(Category.slug == slug))
    if row is None:
        row = Category(slug=slug, name=name.title(), sort_order=order)
        db.add(row)
        await db.flush()
    return row


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    args = parser.parse_args()

    catalog_path = args.library / "catalog.json"
    if not catalog_path.exists():
        print(f"No catalogue at {catalog_path}.")
        print("ref/ is a local vendor directory and is not committed; nothing to import.")
        return 0

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

    imported = 0
    async with SessionLocal() as db:
        for order, entry in enumerate(catalog.get("series", [])):
            slug = entry["slug"]
            series = await db.scalar(
                select(Series).options(selectinload(Series.categories)).where(Series.slug == slug)
            )
            if series is None:
                # `categories=[]` matters: without it the collection is unloaded on the flushed instance and
                # the membership check below becomes a lazy load, which in async is a MissingGreenlet.
                series = Series(slug=slug, categories=[])
                db.add(series)

            lang = entry.get("language") or "en"
            series.original_language = lang
            series.free_episodes = int(entry.get("free_episodes") or 0)
            series.status = PublishStatus.published
            series.released_at = series.released_at or datetime.now(UTC)
            series.content_rating = "U"
            # The catalogue is portrait short-drama with everything already delivered.
            series.completion_status = "completed"
            # One featured title is enough to fill the hero without every card claiming to be the highlight.
            series.is_featured = order == 0
            series.sort_weight = 100 - order
            # Stored as a key, not a URL: the API resolves it against its own CDN base at response time, so
            # one database serves a phone and a browser that disagree about what this host is called.
            if entry.get("cover"):
                series.cover_url = entry["cover"]
            await db.flush()

            genre = entry.get("genre")
            if genre:
                category = await _category(db, genre, order)
                if category.id not in {c.id for c in series.categories}:
                    series.categories.append(category)

            # English carries the working title; the local-script title is stored under the series' own
            # language, which is what makes the Devanagari and Tamil rendering testable from real data.
            titles = {"en": entry["title"]}
            if entry.get("title_local") and lang != "en":
                titles[lang] = entry["title_local"]
            for tlang, title in titles.items():
                tr = await db.get(SeriesTranslation, (series.id, tlang))
                if tr is None:
                    tr = SeriesTranslation(series_id=series.id, lang=tlang, title=title)
                    db.add(tr)
                tr.title = title
                tr.synopsis = entry.get("synopsis")
                tr.source = "ai" if entry.get("ai_generated") else "human"

            for ep in entry.get("episodes", []):
                number = int(ep["number"])
                row = await db.scalar(
                    select(Episode).where(Episode.series_id == series.id, Episode.number == number)
                )
                if row is None:
                    row = Episode(series_id=series.id, number=number)
                    db.add(row)
                # `title_display` is the stress-case variant where the catalogue provides one; it is the whole
                # reason it exists, so it wins over the tidy title.
                row.title = ep.get("title_display") or ep.get("title")
                row.duration_sec = ep.get("duration_sec")
                row.status = PublishStatus.published
                row.published_at = row.published_at or datetime.now(UTC)
                # `locked` and `coin_cost` are per-episode facts in the catalogue and override the series rule.
                row.is_free_override = not ep.get("locked", False)
                row.price_override = int(ep["coin_cost"]) if ep.get("coin_cost") else None
                if ep.get("poster_9x16"):
                    row.thumbnail_url = ep["poster_9x16"]
                await db.flush()

                hls = ep.get("hls")
                if hls:
                    asset = await db.get(VideoAsset, row.video_asset_id) if row.video_asset_id else None
                    if asset is None:
                        asset = VideoAsset(source_key=ep.get("file") or hls)
                        db.add(asset)
                        await db.flush()
                        row.video_asset_id = asset.id
                    asset.status = AssetStatus.ready
                    asset.hls_master_key = hls
                    asset.duration_sec = ep.get("duration_sec")
                    asset.width = catalog.get("frame", {}).get("width")
                    asset.height = catalog.get("frame", {}).get("height")

            imported += 1
            print(f"  {slug}: {len(entry.get('episodes', []))} episode(s)")

        await db.commit()

    print(f"Imported {imported} series from {catalog_path}.")
    print("Covers, posters and HLS are stored as keys; the API resolves them against KATHA_CDN_BASE_URL.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
