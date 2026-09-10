"""Deterministic accounts for the end-to-end suites, and a session the browsers can be handed.

The E2E suites need to arrive signed in. Doing that through the real front doors is not possible for the
viewer app: sign-in goes through Firebase, so a browser would need a real Firebase password, a real network
round trip to Google, and a real account per developer — three ways for a test run to fail for reasons that
have nothing to do with Katha. Admin is different: it has its own email/password login, so the admin suite
signs in through the form and exercises that path for real.

So this script mints a viewer session the same way `/v1/auth/exchange` does, using `issue_session`, and
prints it. No test-only endpoint is added to the API: the signing key stays server-side, and the only thing
that crosses into the test runner is a token it could have obtained by signing in anyway.

The access token it prints is minted against that session with a long TTL rather than the production
fifteen minutes. Every spec file gets a browser context of its own from one saved storage state, so all of
them hold the same access/refresh pair: the first context to see the access token expire would rotate the
refresh token, and the next context to present the old one would trip the reuse alarm and revoke the
session for the whole run. A token that outlives the run means no context ever refreshes, and the refresh
token in the fixture is only there so the stored shape matches what the app writes.

Everything it creates is namespaced `@katha.e2e` and is re-created idempotently, so a suite starts from the
same balance and the same accounts however many times it has run before.

Usage:
    uv run python scripts/seed_e2e.py            # human-readable
    uv run python scripts/seed_e2e.py --json     # what the Playwright global setup reads
"""

import argparse
import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, func, or_, select, update  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password, mint_token  # noqa: E402
from app.models.catalog import (  # noqa: E402
    AssetStatus,
    Episode,
    PublishStatus,
    Series,
    SeriesTranslation,
    VideoAsset,
)
from app.models.identity import AdminRole, AdminUser, Platform, User  # noqa: E402
from app.models.wallet import Checkin, CoinLedger, EpisodeUnlock, LedgerKind, RewardClaim  # noqa: E402
from app.services import ledger  # noqa: E402
from app.services import users as users_svc  # noqa: E402

# Private on purpose, and still the right thing to call: it is what generates a public id and referral
# code with the collision retry both unique columns need. Re-implementing that here would be a second
# copy of a rule that has already been got wrong once.
from app.services.users import _insert_user  # noqa: E402, PLC2701

ADMIN_EMAIL = "e2e-admin@katha.e2e"
ADMIN_PASSWORD = "e2e-admin-password-9f3a"  # noqa: S105 - a fixture for a local database, not a secret
USER_EMAIL = "e2e-user@katha.e2e"

# One account per non-owner role, so the admin suite can prove what each role is refused as well as what it
# is allowed — an owner-only run passes every permission check by definition and tests none of them. Same
# password convention as the owner; the passwords are fixtures for a local database, not secrets.
STAFF: dict[str, tuple[str, str, AdminRole, str]] = {
    "owner": (ADMIN_EMAIL, ADMIN_PASSWORD, AdminRole.owner, "E2E Owner"),
    "editor": ("e2e-editor@katha.e2e", "e2e-editor-password-9f3a", AdminRole.editor, "E2E Editor"),
    "support": ("e2e-support@katha.e2e", "e2e-support-password-9f3a", AdminRole.support, "E2E Support"),
    "finance": ("e2e-finance@katha.e2e", "e2e-finance-password-9f3a", AdminRole.finance, "E2E Finance"),
}

# Enough to unlock several episodes without topping up mid-test, and a round number so an assertion on the
# balance after one unlock reads clearly.
STARTING_COINS = 5000

# Longer than any run of the suite, so no browser context ever needs to refresh (see the module docstring).
E2E_ACCESS_TTL_SECONDS = 12 * 60 * 60

# The catalogue suites filter, search and page through the list, which needs more than one series to mean
# anything. A checkout seeded with `scripts/seed.py` alone has exactly one, so the fixture tops the catalogue
# up to this many published series with a few episodes each. They carry no video: playback is driven through
# the primary series, which is the one with a ready asset.
MIN_PUBLISHED_SERIES = 3
FILLER = [
    ("e2e-filler-monsoon", "Monsoon Letters", "मानसून के खत"),
    ("e2e-filler-harbour", "Harbour Lights", "बंदरगाह की रोशनी"),
    ("e2e-filler-orchard", "The Orchard House", "बाग़ वाला घर"),
]


async def _ensure_catalogue(db) -> None:
    """Top the published catalogue up to MIN_PUBLISHED_SERIES with filler titles. Idempotent by slug."""
    published = await db.scalar(
        select(func.count()).select_from(Series).where(Series.status == PublishStatus.published)
    )
    for slug, title_en, title_hi in FILLER:
        if int(published or 0) >= MIN_PUBLISHED_SERIES:
            return
        if await db.scalar(select(Series.id).where(Series.slug == slug)) is not None:
            continue
        now = datetime.now(UTC)
        series = Series(
            slug=slug,
            free_episodes=1,
            status=PublishStatus.published,
            released_at=now,
            original_language="hi",
            content_rating="U",
            completion_status="Completed",
        )
        db.add(series)
        await db.flush()
        db.add(
            SeriesTranslation(series_id=series.id, lang="en", title=title_en, synopsis=f"{title_en}: an E2E fixture.")
        )
        db.add(SeriesTranslation(series_id=series.id, lang="hi", title=title_hi, synopsis=f"{title_hi}: E2E फ़िक्सचर।"))
        for n in range(1, 4):
            db.add(
                Episode(
                    series_id=series.id,
                    number=n,
                    title=f"Episode {n}",
                    status=PublishStatus.published,
                    published_at=now,
                    duration_sec=90,
                )
            )
        await db.flush()
        published = int(published or 0) + 1


async def _primary_series(db) -> Series | None:
    """The series the viewer suites play: one this fixture owns, with several episodes and playable media.

    Owned, because the fixture narrows the primary's free window to one episode so the second starts locked,
    and the unlock and guest suites are largely about what happens at that lock. Doing that to a film carried
    under a licence whose whole term is "free to watch" would put a price on something that is not ours to
    price, so licensed catalogue content is never chosen no matter what else is in the database.

    Several episodes, because a single-episode film has nothing to lock: a catalogue whose first published
    title was a complete short film used to be selected here, and the paywall suites failed looking for an
    episode two that could not exist.

    Republished when archived, so that curating the catalogue for some other review — archiving the drama
    fixtures to present a film collection, say — leaves the suites something to drive rather than silently
    disarming them.
    """
    owned = or_(Series.slug == "sample-series", Series.slug.startswith("e2e-"))
    primary = await db.scalar(
        select(Series)
        .join(Episode, Episode.series_id == Series.id)
        .join(VideoAsset, VideoAsset.id == Episode.video_asset_id)
        .where(owned, VideoAsset.status == AssetStatus.ready)
        .group_by(Series.id)
        .having(func.count(func.distinct(Episode.id)) > 1)
        .order_by(Series.created_at)
        .limit(1)
    )
    if primary is None:
        primary = await db.scalar(select(Series).where(owned).order_by(Series.created_at).limit(1))
    if primary is None:
        return None
    if primary.status != PublishStatus.published:
        primary.status = PublishStatus.published
        primary.released_at = primary.released_at or datetime.now(UTC)
        await db.execute(
            update(Episode)
            .where(Episode.series_id == primary.id, Episode.status != PublishStatus.published)
            .values(status=PublishStatus.published, published_at=func.coalesce(Episode.published_at, datetime.now(UTC)))
        )
    return primary


async def _upsert_admin(db, *, email: str, password: str, role: AdminRole, display_name: str) -> AdminUser:
    admin = await db.scalar(select(AdminUser).where(AdminUser.email == email))
    if admin is None:
        admin = AdminUser(email=email, display_name=display_name, role=role)
        db.add(admin)
    # Reset every run: a suite that changed the password or the role, or an older fixture with a different
    # one, must not make the next run fail in a way that looks like a login or a permissions bug.
    admin.password_hash = hash_password(password)
    admin.role = role
    admin.totp_secret = None
    if hasattr(admin, "is_active"):
        admin.is_active = True
    return admin


async def main(as_json: bool) -> int:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        print(f"Refusing to run in env={settings.env}: this creates accounts with known passwords.")
        return 1

    async with SessionLocal() as db:
        staff: dict[str, AdminUser] = {}
        for name, (email, password, role, display_name) in STAFF.items():
            staff[name] = await _upsert_admin(db, email=email, password=password, role=role, display_name=display_name)
        await db.flush()
        # A session per role, minted exactly as the login route mints one, so the role-boundary suite can
        # start each role signed in without three more trips through a login form that is rate-limited to
        # five attempts a minute. The owner still signs in through the form once, in the suite's setup.
        staff_tokens = {
            name: mint_token(
                str(admin.id),
                "admin",
                ttl=E2E_ACCESS_TTL_SECONDS,
                extra={"role": admin.role.value, "tv": admin.token_version},
            )
            for name, admin in staff.items()
        }

        await _ensure_catalogue(db)
        primary = await _primary_series(db)
        if primary is not None:
            # Exactly one free episode, so the second always starts locked: the guest suite asserts the
            # sign-in prompt on it and the unlock suite spends coins on it. A catalogue seeded with a more
            # generous free window would make both pass vacuously or not at all.
            primary.free_episodes = 1
            # And the per-episode overrides go with it. `episode_is_free` asks the episode before it asks the
            # series, so an editor who marked episode two free by hand — or an earlier fixture that did —
            # silently outranks the window set above, and the paywall suites then look for a lock that the
            # catalogue no longer has. Clearing both columns leaves one rule deciding.
            await db.execute(
                update(Episode)
                .where(Episode.series_id == primary.id)
                .values(is_free_override=None, price_override=None)
            )

        user = await db.scalar(select(User).where(User.email == USER_EMAIL))
        if user is None:
            user = await _insert_user(db, email=USER_EMAIL, display_name="E2E Viewer", locale="en", country="IN")
        # Reset every run: the profile suite renames this account, and a run interrupted between the rename
        # and its cleanup would otherwise leave the next one starting from a different name.
        user.display_name = "E2E Viewer"
        await db.flush()

        # Episodes stay unlocked forever once bought, so a suite that unlocks one would pass the first time
        # and then assert against an already-unlocked episode on every run after — a test that keeps passing
        # while testing nothing. Watch progress is deliberately kept: a viewer with history is what exercises
        # the recommendation path on the home page.
        await db.execute(delete(EpisodeUnlock).where(EpisodeUnlock.user_id == user.id))

        # The ledger has to go with them. `unlock_episode` posts its charge under the idempotency key
        # `unlock:{user}:{episode}`, and `ledger.post` returns the existing row for a key it has already
        # seen — correct for a retried request, and quietly wrong here: clearing the unlock without clearing
        # the ledger row means the next run unlocks the episode again and is never charged for it. The suite
        # then watches an episode open for free and calls it a pass.
        # Check-ins and reward claims point at the ledger rows that paid them out, so they go first. Clearing
        # them also puts the daily check-in back within reach, which is the state that suite expects.
        await db.execute(delete(Checkin).where(Checkin.user_id == user.id))
        await db.execute(delete(RewardClaim).where(RewardClaim.user_id == user.id))
        await db.execute(delete(CoinLedger).where(CoinLedger.user_id == user.id))
        user.coin_balance = 0
        await db.flush()

        # One credit, so the balance and the sum of the ledger agree — the invariant the wallet is built on.
        # The key is unique per run because the rows above are gone and a fixed one would collide.
        await ledger.post(
            db,
            user_id=user.id,
            delta=STARTING_COINS,
            kind=LedgerKind.admin_adjust,
            idempotency_key=f"e2e-reset-{user.id}-{uuid.uuid4().hex}",
            note="E2E fixture reset",
        )

        _, refresh, session_row = await users_svc.issue_session(
            db,
            user,
            platform=Platform.web,
            device_id="e2e-runner",
            device_name="Playwright",
            app_version="e2e",
            ip="127.0.0.1",
        )
        # Bound to the session row like the real one, so "sign out this device" and the revocation check in
        # `current_user` still apply to it; only the lifetime differs.
        access = mint_token(str(user.id), "access", session_id=str(session_row.id), ttl=E2E_ACCESS_TTL_SECONDS)

        # Slugs and titles the suites navigate to and assert on, rather than hard-coding names that depend on
        # whichever catalogue happens to be seeded. Titles live in the translation table, not on the series.
        rows = list(
            (
                await db.execute(
                    select(Series.slug, SeriesTranslation.title)
                    .join(SeriesTranslation, SeriesTranslation.series_id == Series.id)
                    .where(SeriesTranslation.lang == "en", Series.status == PublishStatus.published)
                    .order_by(Series.created_at)
                    .limit(3)
                )
            ).all()
        )
        primary_row = None
        if primary is not None:
            title = await db.scalar(
                select(SeriesTranslation.title).where(
                    SeriesTranslation.series_id == primary.id, SeriesTranslation.lang == "en"
                )
            )
            encrypted = await db.scalar(
                select(VideoAsset.is_encrypted)
                .join(Episode, Episode.video_asset_id == VideoAsset.id)
                .where(Episode.series_id == primary.id, Episode.number == 1)
            )
            primary_row = {
                "slug": primary.slug,
                "title": title or primary.slug,
                "free_episodes": primary.free_episodes,
                # Whether the first episode's media is AES-128 packaged. The playback suite proves the signed
                # manifest, variant and key round-trip only when it is; a plain static catalogue skips those.
                "encrypted": bool(encrypted),
            }
            # Primary first: the suites that take "the first series" mean this one.
            rows = [(primary.slug, primary_row["title"])] + [r for r in rows if r[0] != primary.slug]
        await db.commit()

        payload = {
            # `admin` is the owner, kept under its original key; `admins` adds one entry per role (owner
            # included) without changing anything a fixture written before it exists would read.
            "admin": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            "admins": {
                name: {
                    "email": email,
                    "password": password,
                    "role": role.value,
                    "token": staff_tokens[name],
                    "expires_in": E2E_ACCESS_TTL_SECONDS,
                }
                for name, (email, password, role, _) in STAFF.items()
            },
            "user": {
                "email": USER_EMAIL,
                "public_id": user.public_id,
                "coin_balance": STARTING_COINS,
                "access_token": access,
                "refresh_token": refresh,
                "expires_in": E2E_ACCESS_TTL_SECONDS,
            },
            "series": [{"slug": slug, "title": title} for slug, title in rows],
            "primary": primary_row,
        }

    if as_json:
        print(json.dumps(payload))
    else:
        for name, (email, password, _, _) in STAFF.items():
            print(f"{name + ':':<9}{email} / {password}")
        print(f"user:    {USER_EMAIL} ({STARTING_COINS} coins)")
        print(f"series: {', '.join(s['slug'] for s in payload['series']) or '(none seeded)'}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Emit the fixture as JSON on stdout.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.json)))
