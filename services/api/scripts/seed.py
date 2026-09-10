"""Seed a local database: owner admin, languages, categories, packs with INR and USD prices, one sample series.

The sample series carries real artwork. Without it every card in both apps renders an empty poster frame, so a
fresh checkout looks broken rather than empty — and none of the cover, rail or hero layouts can be judged.
`scripts/seed-assets/` holds the art already cropped to the shapes the clients actually use: 9:16 for a cover
(the source poster is 2:3, so the crop takes the sides, and 136px off the bottom because the poster's lower
third is empty city and a card is mostly seen 120px wide) and 16:9 for the hero banner.

The art is uploaded to the configured bucket under fixed keys, so re-seeding overwrites rather than piling up
objects. If object storage is not reachable — no MinIO running, say — seeding continues without covers and
says so, because a missing demo image is not a reason to fail the whole seed.

Usage: uv run python scripts/seed.py --admin-email you@example.com --admin-password 'strong'
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.catalog import Category, Episode, PublishStatus, Series, SeriesTranslation
from app.models.identity import AdminRole, AdminUser
from app.models.ops import Language
from app.models.wallet import CoinPack, PackKind, PackPrice

LANGUAGES = [
    ("en", "English", "English", False),
    ("hi", "Hindi", "हिन्दी", False),
    ("ta", "Tamil", "தமிழ்", False),
    ("te", "Telugu", "తెలుగు", False),
    ("bn", "Bengali", "বাংলা", False),
    ("mr", "Marathi", "मराठी", False),
    ("ar", "Arabic", "العربية", True),
]
CATEGORIES = ["Romance", "Revenge", "Drama", "Fantasy", "Comedy", "Thriller"]
ASSETS = Path(__file__).resolve().parent / "seed-assets"
# Fixed keys rather than the random ones `storage.object_key` mints for real uploads: seeding twice should
# replace the demo art, not leave an orphan behind every time.
SEED_ART = {
    "cover": ("images/seed/heiress-cover.webp", "heiress-cover.webp"),
    "banner": ("images/seed/heiress-banner.webp", "heiress-banner.webp"),
}
PACKS = [
    ("coins_100", "Starter", PackKind.coins, 100, 0, None, {"INR": 99, "USD": 1.99}),
    ("coins_550", "Popular", PackKind.coins, 500, 50, None, {"INR": 449, "USD": 7.99}),
    ("coins_1200", "Best Value", PackKind.coins, 1000, 200, None, {"INR": 799, "USD": 14.99}),
    ("vip_30", "VIP Monthly", PackKind.vip, 0, 0, 30, {"INR": 299, "USD": 4.99}),
]

EPISODES = [
    (1, "The Wrong Invitation", 108, True, None),
    (2, "A Name She Cannot Use", 116, True, None),
    (3, "The Man from the Rain", 126, False, 25),
    (4, "Dinner with the Enemy", 134, False, 25),
    (5, "The Photograph", 117, False, 30),
    (6, "One Night, One Promise", 141, False, 30),
    (7, "Her Father's Secret", 129, False, 30),
    (8, "The Engagement Trap", 138, False, 35),
    (9, "No More Disguises", 146, False, 35),
    (10, "The Heiress Returns", 158, False, 40),
]


def upload_seed_art() -> dict[str, str]:
    """Put the demo artwork in the bucket and hand back public URLs, or `{}` if storage is unavailable."""
    from app.services import storage

    urls: dict[str, str] = {}
    try:
        client = storage._client()  # noqa: SLF001 - the seed is the one caller that uploads without a presign
        bucket = get_settings().s3_bucket
        for role, (key, filename) in SEED_ART.items():
            path = ASSETS / filename
            if not path.exists():
                print(f"  seed art missing: {path}")
                continue
            client.put_object(
                Bucket=bucket,
                Key=key,
                Body=path.read_bytes(),
                ContentType="image/webp",
                CacheControl="public, max-age=31536000, immutable",
            )
            urls[role] = storage.public_url(key)
        if urls:
            print(f"  uploaded {len(urls)} seed images to {bucket}")
    except Exception as exc:  # noqa: BLE001 - any storage failure is a warning, never a failed seed
        print(f"  skipping seed artwork ({type(exc).__name__}: {exc}); covers will be empty")
        return {}
    return urls


async def main(email: str, password: str) -> int:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        # The same guard the other seed scripts carry: this creates an owner account with a password given on
        # the command line, and a published sample series. Neither belongs in a real environment.
        print(f"Refusing to run in env={settings.env}: this creates an owner account and demo content.")
        return 1
    async with SessionLocal() as db:
        if not await db.scalar(select(AdminUser).where(AdminUser.email == email.lower())):
            db.add(
                AdminUser(
                    email=email.lower(),
                    display_name="Owner",
                    password_hash=hash_password(password),
                    role=AdminRole.owner,
                )
            )
        for i, (code, name, native, rtl) in enumerate(LANGUAGES):
            if not await db.get(Language, code):
                db.add(Language(code=code, name=name, native_name=native, is_rtl=rtl, sort_order=i))
        cats = {}
        for i, name in enumerate(CATEGORIES):
            slug = name.lower()
            cat = await db.scalar(select(Category).where(Category.slug == slug))
            if cat is None:
                cat = Category(slug=slug, name=name, sort_order=i)
                db.add(cat)
                await db.flush()
            cats[slug] = cat
        for i, (sku, name, kind, coins, bonus, days, prices) in enumerate(PACKS):
            pack = await db.scalar(select(CoinPack).where(CoinPack.sku == sku))
            if pack is None:
                pack = CoinPack(
                    sku=sku,
                    name=name,
                    kind=kind,
                    coins=coins,
                    bonus_coins=bonus,
                    duration_days=days,
                    sort_order=i,
                    badge="popular" if sku == "coins_550" else None,
                )
                db.add(pack)
                await db.flush()
                for cur, amount in prices.items():
                    db.add(PackPrice(pack_id=pack.id, currency=cur, country="*", amount=amount))
        art = upload_seed_art()
        existing = await db.scalar(select(Series).where(Series.slug == "sample-series"))
        if existing is not None and art:
            # Re-seeding an existing database should still pick up artwork added since it was first seeded.
            existing.cover_url = art.get("cover")
            existing.banner_url = art.get("banner")
        series = existing
        if series is None:
            series = Series(
                slug="sample-series",
                cover_url=art.get("cover"),
                banner_url=art.get("banner"),
                free_episodes=2,
                is_featured=True,
                status=PublishStatus.published,
                released_at=datetime.now(UTC),
                original_language="hi",
                # Required in practice: an unrated series is treated as adult (see access.requires_age_gate),
                # so a seeded catalogue with no ratings would be gated for every guest.
                content_rating="U",
                completion_status="Ongoing",
                release_note="New episodes every Friday",
            )
            series.categories.append(cats["romance"])
            db.add(series)
            await db.flush()
            db.add(
                SeriesTranslation(
                    series_id=series.id,
                    lang="en",
                    title="The Heiress in Disguise",
                    synopsis="A wealthy heiress hides her identity and falls for the wrong man.",
                )
            )
            db.add(
                SeriesTranslation(
                    series_id=series.id,
                    lang="hi",
                    title="भेष में वारिस",
                    synopsis="एक अमीर वारिस अपनी पहचान छुपाती है और गलत आदमी से प्यार कर बैठती है।",
                )
            )
        for number, title, duration, is_free, price in EPISODES:
            episode = await db.scalar(select(Episode).where(Episode.series_id == series.id, Episode.number == number))
            if episode is None:
                episode = Episode(series_id=series.id, number=number)
                db.add(episode)
            episode.title = title
            episode.status = PublishStatus.published
            episode.published_at = episode.published_at or datetime.now(UTC)
            episode.duration_sec = duration
            episode.is_free_override = is_free
            episode.price_override = price
            if art.get("cover"):
                episode.thumbnail_url = art["cover"]
        await db.commit()
    print("seeded")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--admin-email", required=True)
    p.add_argument("--admin-password", required=True)
    a = p.parse_args()
    raise SystemExit(asyncio.run(main(a.admin_email, a.admin_password)))
