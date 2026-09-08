"""Convert absolute cover, banner and thumbnail URLs into keys.

These columns held whole URLs, which tied every row to one hostname. The API resolves keys against
`cdn_base_url` now, and anything already absolute is passed through untouched, so old and new rows coexist
happily — but rows left absolute keep the old problem: they only work for whichever client that hostname was
written for, and the CDN cannot move without rewriting them again.

This strips a known base off the front. It is deliberately conservative: a URL pointing somewhere that is not
the configured media host is left alone, because that is a poster hosted elsewhere on purpose rather than one
of ours written the old way.

Usage:
    uv run python scripts/migrate_media_keys.py --dry-run
    uv run python scripts/migrate_media_keys.py --base http://192.168.1.200:8090
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.catalog import Episode, Series  # noqa: E402


def _strip(value: str | None, bases: list[str]) -> str | None:
    """Return the key when `value` sits under one of `bases`, else None to mean "leave it alone"."""
    if not value:
        return None
    for base in bases:
        prefix = base.rstrip("/") + "/"
        if value.startswith(prefix):
            return value[len(prefix) :]
    return None


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base",
        action="append",
        default=[],
        help="A media base URL to strip. Repeatable. Defaults to KATHA_CDN_BASE_URL.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    bases = args.base or [get_settings().cdn_base_url]
    bases = [b for b in bases if b]
    if not bases:
        print("No base URL to strip. Pass --base or set KATHA_CDN_BASE_URL.")
        return 1
    print("Stripping: " + ", ".join(bases))

    changed = 0
    async with SessionLocal() as db:
        for series in (await db.scalars(select(Series))).all():
            for field in ("cover_url", "banner_url"):
                key = _strip(getattr(series, field), bases)
                if key is None:
                    continue
                print(f"  series {series.slug}.{field}: {getattr(series, field)} -> {key}")
                if not args.dry_run:
                    setattr(series, field, key)
                changed += 1

        for episode in (await db.scalars(select(Episode))).all():
            key = _strip(episode.thumbnail_url, bases)
            if key is None:
                continue
            print(f"  episode {episode.id} thumbnail: -> {key}")
            if not args.dry_run:
                episode.thumbnail_url = key
            changed += 1

        if not args.dry_run:
            await db.commit()

    print(f"{'Would convert' if args.dry_run else 'Converted'} {changed} value(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
