"""Seed a local database: owner admin, languages, categories, packs with INR and USD prices, one sample series.

Usage: uv run python scripts/seed.py --admin-email you@example.com --admin-password 'strong'
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

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
PACKS = [
    ("coins_100", "Starter", PackKind.coins, 100, 0, None, {"INR": 99, "USD": 1.99}),
    ("coins_550", "Popular", PackKind.coins, 500, 50, None, {"INR": 449, "USD": 7.99}),
    ("coins_1200", "Best Value", PackKind.coins, 1000, 200, None, {"INR": 799, "USD": 14.99}),
    ("vip_30", "VIP Monthly", PackKind.vip, 0, 0, 30, {"INR": 299, "USD": 4.99}),
]


async def main(email: str, password: str) -> None:
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
        if not await db.scalar(select(Series).where(Series.slug == "sample-series")):
            s = Series(
                slug="sample-series",
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
            s.categories.append(cats["romance"])
            db.add(s)
            await db.flush()
            db.add(
                SeriesTranslation(
                    series_id=s.id,
                    lang="en",
                    title="The Heiress in Disguise",
                    synopsis="A wealthy heiress hides her identity and falls for the wrong man.",
                )
            )
            db.add(
                SeriesTranslation(
                    series_id=s.id,
                    lang="hi",
                    title="भेष में वारिस",
                    synopsis="एक अमीर वारिस अपनी पहचान छुपाती है और गलत आदमी से प्यार कर बैठती है।",
                )
            )
            for n in range(1, 11):
                db.add(
                    Episode(
                        series_id=s.id,
                        number=n,
                        title=f"Episode {n}",
                        status=PublishStatus.published,
                        published_at=datetime.now(UTC),
                        duration_sec=120,
                    )
                )
        await db.commit()
    print("seeded")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--admin-email", required=True)
    p.add_argument("--admin-password", required=True)
    a = p.parse_args()
    asyncio.run(main(a.admin_email, a.admin_password))
