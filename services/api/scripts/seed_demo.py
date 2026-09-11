"""Fill the half of a local database that `seed.py` leaves empty.

`seed.py` creates the least a checkout needs to boot: an admin, the languages, the categories, the coin packs
and one series. Everything else in this product is *configured* or *earned* rather than created, so a fresh
database has a reward ladder with no tasks, a wallet with no offers, an empty moderation queue and inbox, no
category with a name in any language but English, and no viewer who has ever finished an episode. Two dozen
tables sit at zero, and every screen built on them looks broken rather than new — which is the same thing as
saying those screens cannot be judged, demonstrated, or usefully tested.

This writes one coherent slice of a service that has been running for a little while.

Two rules it keeps, because a fixture that reaches around them teaches the wrong shape of the product and
hides the bugs those rules exist to catch:

  - Coins only ever move through `services/ledger.py`. The daily check-in and the task claim here go through
    the same `rewards.checkin` and `rewards.claim` a phone calls.
  - A purchase only becomes paid the way a verified webhook makes it paid — through `payments.mark_paid`,
    which is what grants the coins, starts the VIP window and pays the referrer.

Local only, and idempotent: every row is matched on its natural key, so a second run changes nothing.

Usage:
    uv run python scripts/seed_demo.py
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal, engine  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.models.catalog import (  # noqa: E402
    Category,
    CategoryTranslation,
    Episode,
    PublishStatus,
    Series,
    Subtitle,
    Tag,
)
from app.models.engagement import (  # noqa: E402
    ContactMessage,
    Favorite,
    Like,
    Report,
    ReportStatus,
    WatchProgress,
)
from app.models.identity import AdminUser, Platform, User  # noqa: E402
from app.models.ops import (  # noqa: E402
    AdPlacement,
    Experiment,
    FeatureFlag,
    Notification,
    Setting,
    UiTranslation,
)
from app.models.wallet import (  # noqa: E402
    CoinPack,
    Coupon,
    Offer,
    PackPrice,
    Purchase,
    PurchaseStatus,
    Referral,
    RewardFrequency,
    RewardTask,
    RewardTaskKind,
    UnlockMethod,
)
from app.services import access, payments, rewards, storage  # noqa: E402

# Private on purpose, and still the right thing to call: it is what generates the public id and referral code
# with the collision retry both unique columns need.
from app.services.users import _insert_user  # noqa: E402, PLC2701

# What an operator would have set, spelled out rather than left to the defaults in `core/config.py`. Writing
# them down is the point: until a namespace exists, the settings screen shows an empty tab and nobody can see
# what is adjustable, let alone adjust it.
SETTINGS: dict[str, dict] = {
    "site": {"name": "Katha", "support_email": "support@katha.local", "url": "http://localhost:3000"},
    "auth": {"email": True, "google": True, "apple": True, "phone": True, "facebook": False},
    "economy": {
        "coins_enabled": True,
        "currency": "INR",
        "currency_symbol": "₹",
        "episode_price": 50,
        "free_episodes": 5,
        "ad_unlocks_per_day": 5,
        "bundle_discount_pct": 30,
    },
    "rewards": {"enabled": True, "daily_rewards": [10, 15, 20, 30, 40, 60, 150], "signup_bonus": 100},
    "referral": {"enabled": True, "referrer_coins": 100, "referee_coins": 100},
    "mobile": {
        "min_version_code": 1,
        "force_update": False,
        "update_url": None,
        # Left unset on purpose. Setting these points the apps at a hosted document instead of the CMS pages
        # they already carry, and the only URL a fixture could offer is a localhost one that no phone can
        # reach. The keys are here so an operator can see what is settable; the value is theirs to fill in.
        "privacy_policy_url": None,
        "terms_url": None,
        "rate_us_url": None,
    },
    "seo": {
        "default_title": "Katha — short dramas",
        "default_description": "Vertical short dramas you can watch on the way to work. New episodes weekly.",
    },
    # Off, and the placements below are inactive to match: a fixture that switches advertising on for
    # everyone who seeds a database is a surprise, not a demo.
    "ads": {"enabled": False},
    "payments": {"razorpay": True, "stripe": True, "play": True},
}

# Only flags the clients actually read. Inventing keys nothing consults would fill the screen with switches
# that do nothing, which is worse than an empty one.
FLAGS = {"rewarded_ads": False}

# (platform, kind, title, description, coins, url, timer_seconds, frequency, is_active, sort_order)
REWARD_TASKS = [
    (
        Platform.web,
        RewardTaskKind.share,
        "Share a drama",
        "Send a friend something you liked.",
        15,
        None,
        0,
        RewardFrequency.daily,
        True,
        10,
    ),
    (
        Platform.web,
        RewardTaskKind.follow,
        "Follow Katha on Instagram",
        "One time, for 50 coins.",
        50,
        "https://instagram.com/",
        0,
        RewardFrequency.once,
        True,
        20,
    ),
    (
        Platform.android,
        RewardTaskKind.share,
        "Share a drama",
        "Send a friend something you liked.",
        15,
        None,
        0,
        RewardFrequency.daily,
        True,
        10,
    ),
    (
        Platform.android,
        RewardTaskKind.follow,
        "Follow Katha on Instagram",
        "One time, for 50 coins.",
        50,
        "https://instagram.com/",
        0,
        RewardFrequency.once,
        True,
        20,
    ),
    # Inactive until rewarded ads are switched on: an ad task that cannot pay out is a dead end on the one
    # screen whose whole promise is that it pays.
    (
        Platform.android,
        RewardTaskKind.rewarded_ad,
        "Watch a short ad",
        "25 coins, once a day.",
        25,
        None,
        30,
        RewardFrequency.daily,
        False,
        30,
    ),
    (
        Platform.ios,
        RewardTaskKind.share,
        "Share a drama",
        "Send a friend something you liked.",
        15,
        None,
        0,
        RewardFrequency.daily,
        True,
        10,
    ),
    (
        Platform.ios,
        RewardTaskKind.follow,
        "Follow Katha on Instagram",
        "One time, for 50 coins.",
        50,
        "https://instagram.com/",
        0,
        RewardFrequency.once,
        True,
        20,
    ),
    (
        Platform.ios,
        RewardTaskKind.rewarded_ad,
        "Watch a short ad",
        "25 coins, once a day.",
        25,
        None,
        30,
        RewardFrequency.daily,
        False,
        30,
    ),
]

# Google's published test unit ids, so a build that accidentally goes live shows a test ad rather than
# billing a real advertiser. Inactive, matching the `ads` namespace above.
AD_PLACEMENTS = [
    (
        "Rewarded unlock",
        "unlock_rewarded",
        "admob",
        "ca-app-pub-3940256099942544/5224354917",
        ["android", "ios"],
        25,
        0,
        10,
    ),
    (
        "Player pre-roll",
        "player_pre",
        "admob",
        "ca-app-pub-3940256099942544/1033173712",
        ["android", "ios"],
        None,
        300,
        20,
    ),
]

CATEGORY_NAMES = {
    "romance": {"hi": "रोमांस", "ta": "காதல்", "te": "శృంగారం", "bn": "রোমান্স", "mr": "प्रणय", "ar": "رومانسي"},
    "revenge": {"hi": "बदला", "ta": "பழிவாங்கல்", "te": "ప్రతీకారం", "bn": "প্রতিশোধ", "mr": "सूड", "ar": "انتقام"},
    "drama": {"hi": "ड्रामा", "ta": "நாடகம்", "te": "డ్రామా", "bn": "নাটক", "mr": "नाट्य", "ar": "دراما"},
    "fantasy": {"hi": "फैंटेसी", "ta": "கற்பனை", "te": "ఫాంటసీ", "bn": "ফ্যান্টাসি", "mr": "कल्पनारम्य", "ar": "خيال"},
    "comedy": {"hi": "कॉमेडी", "ta": "நகைச்சுவை", "te": "హాస్యం", "bn": "কমেডি", "mr": "विनोदी", "ar": "كوميديا"},
    "thriller": {"hi": "थ्रिलर", "ta": "த்ரில்லர்", "te": "థ్రిల్లర్", "bn": "থ্রিলার", "mr": "थरारक", "ar": "إثارة"},
    "short-films": {
        "hi": "लघु फ़िल्में",
        "ta": "குறும்படங்கள்",
        "te": "లఘు చిత్రాలు",
        "bn": "স্বল্পদৈর্ঘ্য ছবি",
        "mr": "लघुपट",
        "ar": "أفلام قصيرة",
    },
    "adventure": {"hi": "एडवेंचर", "ta": "சாகசம்", "te": "సాహసం", "bn": "অ্যাডভেঞ্চার", "mr": "साहसी", "ar": "مغامرة"},
    "animation": {
        "hi": "एनिमेशन",
        "ta": "அனிமேஷன்",
        "te": "యానిమేషన్",
        "bn": "অ্যানিমেশন",
        "mr": "अ‍ॅनिमेशन",
        "ar": "رسوم متحركة",
    },
    "science-fiction": {
        "hi": "विज्ञान कथा",
        "ta": "அறிவியல் புனைவு",
        "te": "సైన్స్ ఫిక్షన్",
        "bn": "কল্পবিজ্ঞান",
        "mr": "विज्ञान कथा",
        "ar": "خيال علمي",
    },
}

TAGS = [
    ("hidden-identity", "Hidden identity"),
    ("billionaire", "Billionaire"),
    ("creative-commons", "Creative Commons"),
    ("animation", "Animation"),
    ("live-action", "Live action"),
]
SERIES_TAGS = {
    "sample-series": ["hidden-identity", "billionaire"],
    "tears-of-steel-chapters": ["creative-commons", "live-action"],
    "sintel-chapters": ["creative-commons", "animation"],
    "big-buck-bunny-chapters": ["creative-commons", "animation"],
    "spring-chapters": ["creative-commons", "animation"],
    "elephants-dream-chapters": ["creative-commons", "animation"],
}

# Hindi for the strings a viewer meets first. Not the whole catalogue: 670 keys in six languages is a
# translation job, and the product already has the right tool for it — the AI translation job behind
# "Translate with AI", reviewed in the console before it ships. What this buys is a language switch that
# visibly does something, and a coverage figure on the Languages screen that is real rather than zero.
# Anything not listed falls back to English, which is what the clients already do for a missing key.
HINDI = {
    # Page metadata first, because it is the part with no fallback worth having: an untranslated key falls
    # back to English, which is fine for a button and wrong for a <title>. Every language variant otherwise
    # shows search engines the same English title and description while hreflang tells them the pages are
    # alternates of one another, which is the one thing that setup must not say.
    "meta.title": "कथा — शॉर्ट ड्रामा",
    "meta.description": "अपनी भाषा में छोटे-छोटे ड्रामा देखें।",
    "nav.home": "होम",
    "nav.shorts": "शॉर्ट्स",
    "nav.browse": "ब्राउज़ करें",
    "nav.rewards": "इनाम",
    "nav.my_list": "मेरी सूची",
    "common.back": "वापस",
    "common.cancel": "रद्द करें",
    "common.close": "बंद करें",
    "common.retry": "फिर कोशिश करें",
    "common.loading": "लोड हो रहा है…",
    "common.sign_in": "साइन इन करें",
    "common.play": "चलाएँ",
    "common.clear": "साफ़ करें",
    "common.done": "हो गया",
    "common.or": "या",
    "common.error": "कुछ गड़बड़ हो गई",
    "home.continue_watching": "देखना जारी रखें",
    "home.for_you": "आपके लिए",
    "home.view_all": "सभी देखें",
    "home.search": "सीरीज़ खोजें",
    "home.empty": "अभी दिखाने को कुछ नहीं है। थोड़ी देर में देखें।",
    "browse.title": "सभी ड्रामा",
    "browse.all": "सभी",
    "browse.categories": "श्रेणियाँ",
    "browse.sort": "क्रम",
    "browse.sort_newest": "सबसे नए",
    "browse.see_all": "सभी देखें",
    "series.episodes": "एपिसोड",
    "series.free": "मुफ़्त",
    "series.continue": "फिर से शुरू करें",
    "series.similar": "ये भी पसंद आ सकते हैं",
    "series.start_over": "शुरू से देखें",
    "player.play": "चलाएँ",
    "player.pause": "रोकें",
    "player.mute": "आवाज़ बंद करें",
    "player.unmute": "आवाज़ चालू करें",
    "player.subtitles": "सबटाइटल",
    "player.replay": "फिर से देखें",
    "player.buffering": "बफ़र हो रहा है…",
    "player.unlock_title": "एपिसोड अनलॉक करें",
    "unlock.with_coins": "{price} सिक्कों में अनलॉक करें",
    "unlock.get_coins": "सिक्के लें",
    "wallet.title": "वॉलेट",
    "wallet.history": "इतिहास",
    "wallet.top_up": "सिक्के जोड़ें",
    "rewards.title": "इनाम",
    "rewards.checkin": "रोज़ाना हाज़िरी",
    "rewards.claim": "लें",
    "rewards.claimed": "मिल गया",
    "rewards.tasks": "काम",
    "auth.sign_in": "साइन इन करें",
    "auth.sign_up": "मुफ़्त साइन अप करें",
    "auth.email_label": "ईमेल",
    "auth.password_label": "पासवर्ड",
    "auth.google": "Google से जारी रखें",
    "auth.sign_out": "साइन आउट करें",
    "age_gate.title": "वयस्क सामग्री",
    "age_gate.confirm": "मैं 18 वर्ष या उससे बड़ा हूँ",
    "age_gate.cancel": "अभी नहीं",
}

DEMO_EMAIL = "demo@katha.local"
FRIEND_EMAIL = "demo-friend@katha.local"


def note(created: int, existing: int, what: str) -> str:
    return f"  {what:28} {created} created, {existing} already there"


async def seed_settings(db) -> str:
    created = existing = 0
    for name, data in SETTINGS.items():
        row = await db.get(Setting, name)
        if row is None:
            db.add(Setting(namespace=name, data=data, updated_at=datetime.now(UTC)))
            created += 1
        else:
            existing += 1
    return note(created, existing, "settings namespaces")


async def seed_flags(db) -> str:
    created = existing = 0
    for key, enabled in FLAGS.items():
        row = await db.get(FeatureFlag, key)
        if row is None:
            db.add(FeatureFlag(key=key, enabled=enabled, updated_at=datetime.now(UTC)))
            created += 1
        else:
            existing += 1
    return note(created, existing, "feature flags")


async def seed_reward_tasks(db) -> str:
    created = existing = 0
    for platform, kind, title, description, coins, url, timer, frequency, active, order in REWARD_TASKS:
        found = await db.scalar(select(RewardTask).where(RewardTask.platform == platform, RewardTask.title == title))
        if found is not None:
            existing += 1
            continue
        db.add(
            RewardTask(
                platform=platform,
                kind=kind,
                title=title,
                description=description,
                coins=coins,
                url=url,
                timer_seconds=timer,
                frequency=frequency,
                is_active=active,
                sort_order=order,
            )
        )
        created += 1
    return note(created, existing, "reward tasks")


async def seed_ad_placements(db) -> str:
    created = existing = 0
    for name, slot, provider, unit, platforms, reward, cap, order in AD_PLACEMENTS:
        found = await db.scalar(
            select(AdPlacement).where(
                AdPlacement.slot == slot, AdPlacement.provider == provider, AdPlacement.unit_id == unit
            )
        )
        if found is not None:
            existing += 1
            continue
        db.add(
            AdPlacement(
                name=name,
                slot=slot,
                provider=provider,
                unit_id=unit,
                platforms=platforms,
                reward_coins=reward,
                frequency_cap_sec=cap,
                is_active=False,
                sort_order=order,
            )
        )
        created += 1
    return note(created, existing, "ad placements (inactive)")


async def seed_offers(db) -> str:
    created = existing = 0
    now = datetime.now(UTC)
    first = await db.scalar(select(Offer).where(Offer.title == "First purchase — 20% off"))
    if first is None:
        first = Offer(
            title="First purchase — 20% off",
            kind="first_purchase",
            discount_pct=20,
            starts_at=now - timedelta(days=7),
            ends_at=now + timedelta(days=60),
            is_active=True,
        )
        db.add(first)
        created += 1
    else:
        existing += 1
    # One offer with no eligibility rules at all, because the two above are both invisible to most viewers:
    # the first-purchase one disappears the moment someone buys, and a coupon is reachable only by code. With
    # only those two, the offers rail is empty for exactly the people who have shown they will pay.
    weekend = await db.scalar(select(Offer).where(Offer.title == "Weekend top-up — 15% off"))
    if weekend is None:
        db.add(
            Offer(
                title="Weekend top-up — 15% off",
                # "bundle" is the API's name for a timed offer with no eligibility rule attached; the schema
                # accepts only first_purchase, bundle, winback and coupon, and a row written straight to the
                # table with anything else makes the admin list fail to serialise for every offer at once.
                kind="bundle",
                discount_pct=15,
                starts_at=now - timedelta(days=1),
                ends_at=now + timedelta(days=5),
                is_active=True,
            )
        )
        created += 1
    else:
        existing += 1
    coupon_offer = await db.scalar(select(Offer).where(Offer.title == "Coupon — 25% off any pack"))
    if coupon_offer is None:
        # Kind "coupon" keeps it out of the offers rail: it is reachable only by typing the code, which is
        # what makes a code worth having.
        coupon_offer = Offer(title="Coupon — 25% off any pack", kind="coupon", discount_pct=25, is_active=True)
        db.add(coupon_offer)
        created += 1
    else:
        existing += 1
    await db.flush()
    if await db.scalar(select(Coupon).where(Coupon.code == "KATHA25")) is None:
        db.add(Coupon(code="KATHA25", offer_id=coupon_offer.id, max_uses=500))
        created += 1
    else:
        existing += 1
    return note(created, existing, "offers and coupons")


async def seed_experiment(db) -> str:
    key = "paywall_cta"
    if await db.get(Experiment, key) is not None:
        return note(0, 1, "experiments")
    db.add(
        Experiment(
            key=key,
            description="Does naming the saving on the unlock sheet sell more bundles than naming the price?",
            variants={"control": "Unlock for {price} coins", "saving": "Unlock the series and save 30%"},
            allocation={"control": 50, "saving": 50},
            started_at=datetime.now(UTC) - timedelta(days=3),
        )
    )
    return note(1, 0, "experiments")


async def seed_category_translations(db) -> str:
    created = existing = skipped = 0
    for category in (await db.scalars(select(Category))).all():
        names = CATEGORY_NAMES.get(category.slug)
        if names is None:
            skipped += 1
            continue
        for lang, name in names.items():
            if await db.get(CategoryTranslation, (category.id, lang)) is not None:
                existing += 1
                continue
            db.add(CategoryTranslation(category_id=category.id, lang=lang, name=name))
            created += 1
    tail = f", {skipped} categories left untranslated" if skipped else ""
    return note(created, existing, "category translations") + tail


async def seed_tags(db) -> str:
    created = existing = 0
    tags: dict[str, Tag] = {}
    for slug, name in TAGS:
        tag = await db.scalar(select(Tag).where(Tag.slug == slug))
        if tag is None:
            tag = Tag(slug=slug, name=name)
            db.add(tag)
            created += 1
        else:
            existing += 1
        tags[slug] = tag
    await db.flush()
    for slug, wanted in SERIES_TAGS.items():
        series = await db.scalar(select(Series).where(Series.slug == slug))
        if series is None:
            continue
        await db.refresh(series, ["tags"])
        have = {tag.slug for tag in series.tags}
        for tag_slug in wanted:
            if tag_slug not in have:
                series.tags.append(tags[tag_slug])
                created += 1
            else:
                existing += 1
    return note(created, existing, "tags and series tags")


async def seed_hindi_ui(db) -> str:
    """Hindi for the keys the English catalogue already has, and only those.

    A row for a key no client asks for is dead weight that also inflates the coverage figure the Languages
    screen reports, so the English table decides what may be translated.
    """
    english = {key for key in (await db.scalars(select(UiTranslation.key).where(UiTranslation.lang == "en"))).all()}
    if not english:
        return note(0, 0, "Hindi UI strings") + ", English not seeded yet (scripts/seed_translations.py)"
    created = existing = unknown = 0
    for key, value in HINDI.items():
        if key not in english:
            unknown += 1
            continue
        if await db.get(UiTranslation, ("hi", key)) is not None:
            existing += 1
            continue
        db.add(UiTranslation(lang="hi", key=key, value=value, source="fixture", updated_at=datetime.now(UTC)))
        created += 1
    covered = (existing + created) / len(english) * 100
    tail = f", {covered:.0f}% of {len(english)} keys"
    if unknown:
        tail += f", {unknown} skipped as unknown"
    return note(created, existing, "Hindi UI strings") + tail


async def seed_ops_activity(db, admin: AdminUser | None) -> str:
    created = existing = 0
    messages = [
        (
            "Priya Nair",
            "priya@example.com",
            "Subtitles in Malayalam?",
            "Loved the first three episodes. Any chance of Malayalam subtitles?",
            False,
        ),
        (
            "Rohit Sharma",
            "rohit@example.com",
            "Payment failed twice",
            "UPI failed twice but the coins arrived on the third try. Was I charged three times?",
            True,
        ),
    ]
    for name, email, subject, message, read in messages:
        if await db.scalar(select(ContactMessage).where(ContactMessage.email == email)) is None:
            db.add(ContactMessage(name=name, email=email, subject=subject, message=message, is_read=read))
            created += 1
        else:
            existing += 1

    episode = await db.scalar(
        select(Episode)
        .join(Series, Series.id == Episode.series_id)
        .where(Series.slug == "sample-series", Episode.number == 2)
    )
    if episode is not None:
        if await db.scalar(select(Report).where(Report.episode_id == episode.id)) is None:
            db.add(
                Report(
                    series_id=episode.series_id,
                    episode_id=episode.id,
                    reason="quality",
                    details="Audio drops out about halfway through.",
                    status=ReportStatus.open,
                )
            )
            created += 1
        else:
            existing += 1

    title = "New episodes tonight"
    if await db.scalar(select(Notification).where(Notification.title == title)) is None:
        sent = datetime.now(UTC) - timedelta(days=1)
        db.add(
            Notification(
                title=title,
                body="Three new episodes of The Heiress in Disguise are live.",
                segment={"kind": "all"},
                sent_at=sent,
                delivered=1,
                failed=0,
                created_by=admin.id if admin else None,
            )
        )
        created += 1
    else:
        existing += 1
    return note(created, existing, "inbox, reports, announcements")


def vtt(title: str) -> str:
    """A short, honestly-labelled caption track, so the subtitle control has something to switch on."""
    return (
        "WEBVTT\n\n"
        "1\n00:00:00.000 --> 00:00:03.000\n"
        f"{title}\n\n"
        "2\n00:00:03.000 --> 00:00:06.000\n"
        "Sample caption track from scripts/seed_demo.py.\n"
    )


async def seed_subtitles(db) -> str:
    """English captions for the fixture drama only.

    Deliberately not for the licensed films: inventing dialogue over someone's film and shipping it as that
    film's subtitles misrepresents their work, and no fixture needs it badly enough.
    """
    series = await db.scalar(select(Series).where(Series.slug == "sample-series"))
    if series is None:
        return note(0, 0, "subtitles") + ", no fixture drama to caption"
    episodes = list(
        (
            await db.scalars(
                select(Episode).where(Episode.series_id == series.id, Episode.number <= 3).order_by(Episode.number)
            )
        ).all()
    )
    settings = get_settings()
    created = existing = 0
    try:
        client = storage._client()
        for episode in episodes:
            if (
                await db.scalar(select(Subtitle).where(Subtitle.episode_id == episode.id, Subtitle.lang == "en"))
                is not None
            ):
                existing += 1
                continue
            key = f"subtitles/{episode.id}/en.vtt"
            client.put_object(
                Bucket=settings.s3_bucket,
                Key=key,
                Body=vtt(episode.title or f"Episode {episode.number}").encode("utf-8"),
                ContentType="text/vtt",
                CacheControl="public, max-age=3600",
            )
            db.add(Subtitle(episode_id=episode.id, lang="en", vtt_key=key, source="fixture"))
            created += 1
    except Exception as error:  # noqa: BLE001 - a demo without captions is worth more than a failed seed
        return note(created, existing, "subtitles") + f", storage unavailable ({type(error).__name__})"
    return note(created, existing, "subtitles")


async def paid_purchase(db, user: User, sku: str, gateway: str) -> tuple[Purchase | None, bool]:
    """Create the pending row a checkout would create, then settle it the way a verified webhook does.

    Returns the purchase and whether this run is what settled it, so a second run can say so rather than
    reporting three sales a day that never happened.
    """
    pack = await db.scalar(select(CoinPack).where(CoinPack.sku == sku))
    if pack is None:
        return None, False
    external = f"demo-{user.email.split('@')[0]}-{sku}"
    purchase = await db.scalar(select(Purchase).where(Purchase.gateway == gateway, Purchase.external_id == external))
    if purchase is None:
        price = await db.scalar(select(PackPrice).where(PackPrice.pack_id == pack.id, PackPrice.currency == "INR"))
        amount = Decimal(price.amount) if price is not None else Decimal("99.00")
        purchase = Purchase(
            user_id=user.id,
            pack_id=pack.id,
            gateway=gateway,
            status=PurchaseStatus.pending,
            currency="INR",
            amount=amount,
            coins_granted=0,
            external_id=external,
            gateway_payment_id=f"pay_{external}",
            raw={"source": "scripts/seed_demo.py"},
        )
        db.add(purchase)
        await db.flush()
    if purchase.status == PurchaseStatus.paid:
        return purchase, False
    settled = await payments.mark_paid(
        db,
        purchase.id,
        raw={"source": "scripts/seed_demo.py"},
        gateway_payment_id=purchase.gateway_payment_id,
        amount_minor=int(Decimal(purchase.amount) * 100),
        currency="INR",
    )
    return settled, True


async def seed_viewer_activity(db) -> list[str]:
    lines = []
    viewer = await db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if viewer is None:
        viewer = await _insert_user(db, email=DEMO_EMAIL, display_name="Demo Viewer", locale="en", country="IN")
        await db.flush()
    friend = await db.scalar(select(User).where(User.email == FRIEND_EMAIL))
    if friend is None:
        friend = await _insert_user(db, email=FRIEND_EMAIL, display_name="Demo Friend", locale="hi", country="IN")
        await db.flush()

    # The invitation before the purchase that pays it: `mark_paid` looks for an unrewarded referral on the
    # buyer, so the row has to exist before the friend's first purchase settles.
    if await db.scalar(select(Referral).where(Referral.referee_id == friend.id)) is None:
        db.add(
            Referral(
                referrer_id=viewer.id,
                referee_id=friend.id,
                code=viewer.referral_code or "DEMO",
                created_at=datetime.now(UTC) - timedelta(days=2),
            )
        )
        await db.flush()

    sales = [
        await paid_purchase(db, viewer, "coins_550", "razorpay"),
        await paid_purchase(db, viewer, "vip_30", "razorpay"),
        await paid_purchase(db, friend, "coins_100", "stripe"),
    ]
    lines.append(
        note(
            sum(1 for purchase, settled_now in sales if settled_now),
            sum(1 for purchase, settled_now in sales if purchase is not None and not settled_now),
            "purchases settled",
        )
    )

    series = list(
        (
            await db.scalars(
                select(Series).where(Series.status == PublishStatus.published).order_by(Series.created_at).limit(3)
            )
        ).all()
    )
    created = existing = 0
    for item in series:
        if await db.get(Favorite, (viewer.id, item.id)) is None:
            db.add(Favorite(user_id=viewer.id, series_id=item.id, created_at=datetime.now(UTC)))
            created += 1
        else:
            existing += 1
        if await db.get(Like, (viewer.id, item.id)) is None:
            db.add(Like(user_id=viewer.id, series_id=item.id, created_at=datetime.now(UTC)))
            created += 1
        else:
            existing += 1
        episode = await db.scalar(select(Episode).where(Episode.series_id == item.id).order_by(Episode.number).limit(1))
        if episode is not None and await db.get(WatchProgress, (viewer.id, episode.id)) is None:
            db.add(
                WatchProgress(
                    user_id=viewer.id,
                    episode_id=episode.id,
                    series_id=item.id,
                    position_sec=max(5, (episode.duration_sec or 60) // 3),
                    updated_at=datetime.now(UTC) - timedelta(hours=5),
                )
            )
            created += 1
    lines.append(note(created, existing, "favourites, likes, history"))

    # One episode bought with coins, through the same call the unlock sheet makes: it is the only way an
    # `episode_unlocks` row can exist that also has a ledger entry to explain it.
    #
    # The friend buys it, not the viewer. The viewer's VIP window makes every episode accessible to them, so
    # a coin unlock is correctly refused as `already_accessible` — and between the two accounts the fixture
    # then covers both ways this product is paid for: a subscription and a single purchase.
    unlocked = held = 0
    locked_episode = await db.scalar(
        select(Episode)
        .join(Series, Series.id == Episode.series_id)
        .where(Series.slug == "sample-series", Episode.number == 2)
    )
    if locked_episode is not None:
        try:
            await access.unlock_episode(db, user=friend, episode_id=locked_episode.id, method=UnlockMethod.coins)
            unlocked += 1
        except AppError:
            held += 1  # already unlocked, or free in this catalogue
    lines.append(note(unlocked, held, "episodes unlocked with coins"))

    earned = already = 0
    try:
        await rewards.checkin(db, viewer)
        earned += 1
    except AppError:
        already += 1  # checked in earlier today, which is the same state this wanted
    task = await db.scalar(
        select(RewardTask).where(RewardTask.platform == Platform.web, RewardTask.kind == RewardTaskKind.share)
    )
    if task is not None:
        try:
            await rewards.claim(db, viewer, task.id)
            earned += 1
        except AppError:
            already += 1  # claimed earlier in this window
    lines.append(note(earned, already, "check-in and task claims"))
    return lines


async def main() -> int:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        print(f"Refusing to run in env={settings.env}: this creates demo accounts and settles demo purchases.")
        return 1
    lines: list[str] = []
    try:
        async with SessionLocal() as db:
            admin = await db.scalar(select(AdminUser).order_by(AdminUser.created_at).limit(1))
            lines.append(await seed_settings(db))
            lines.append(await seed_flags(db))
            lines.append(await seed_reward_tasks(db))
            lines.append(await seed_ad_placements(db))
            lines.append(await seed_offers(db))
            lines.append(await seed_experiment(db))
            lines.append(await seed_category_translations(db))
            lines.append(await seed_hindi_ui(db))
            lines.append(await seed_tags(db))
            lines.append(await seed_ops_activity(db, admin))
            lines.append(await seed_subtitles(db))
            await db.flush()
            lines.extend(await seed_viewer_activity(db))
            await db.commit()
    finally:
        await engine.dispose()
    print("Demo data:")
    for line in lines:
        print(line)
    print(f"\nDemo viewer: {DEMO_EMAIL} (referrer of {FRIEND_EMAIL})")
    return 0


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    raise SystemExit(asyncio.run(main()))
