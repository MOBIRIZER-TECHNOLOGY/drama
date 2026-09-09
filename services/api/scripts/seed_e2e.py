"""Deterministic accounts for the end-to-end suites, and a session the browsers can be handed.

The E2E suites need to arrive signed in. Doing that through the real front doors is not possible for the
viewer app: sign-in goes through Firebase, so a browser would need a real Firebase password, a real network
round trip to Google, and a real account per developer — three ways for a test run to fail for reasons that
have nothing to do with Katha. Admin is different: it has its own email/password login, so the admin suite
signs in through the form and exercises that path for real.

So this script mints a viewer session the same way `/v1/auth/exchange` does, using `issue_session`, and
prints it. No test-only endpoint is added to the API: the signing key stays server-side, and the only thing
that crosses into the test runner is a token it could have obtained by signing in anyway.

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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.catalog import Series, SeriesTranslation  # noqa: E402
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

# Enough to unlock several episodes without topping up mid-test, and a round number so an assertion on the
# balance after one unlock reads clearly.
STARTING_COINS = 5000


async def main(as_json: bool) -> int:
    settings = get_settings()
    if settings.env not in ("local", "test"):
        print(f"Refusing to run in env={settings.env}: this creates accounts with known passwords.")
        return 1

    async with SessionLocal() as db:
        admin = await db.scalar(select(AdminUser).where(AdminUser.email == ADMIN_EMAIL))
        if admin is None:
            admin = AdminUser(email=ADMIN_EMAIL, display_name="E2E Owner", role=AdminRole.owner)
            db.add(admin)
        # Reset every run: a suite that changed the password, or an older fixture with a different one,
        # must not make the next run fail in a way that looks like a login bug.
        admin.password_hash = hash_password(ADMIN_PASSWORD)
        admin.role = AdminRole.owner
        admin.totp_secret = None
        if hasattr(admin, "is_active"):
            admin.is_active = True

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

        access, refresh, _ = await users_svc.issue_session(
            db,
            user,
            platform=Platform.web,
            device_id="e2e-runner",
            device_name="Playwright",
            app_version="e2e",
            ip="127.0.0.1",
        )

        # Slugs and titles the suites navigate to and assert on, rather than hard-coding names that depend on
        # whichever catalogue happens to be seeded. Titles live in the translation table, not on the series.
        rows = (
            await db.execute(
                select(Series.slug, SeriesTranslation.title)
                .join(SeriesTranslation, SeriesTranslation.series_id == Series.id)
                .where(SeriesTranslation.lang == "en")
                .order_by(Series.created_at)
                .limit(3)
            )
        ).all()
        await db.commit()

        payload = {
            "admin": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            "user": {
                "email": USER_EMAIL,
                "public_id": user.public_id,
                "coin_balance": STARTING_COINS,
                "access_token": access,
                "refresh_token": refresh,
                "expires_in": settings.access_token_ttl_seconds,
            },
            "series": [{"slug": slug, "title": title} for slug, title in rows],
        }

    if as_json:
        print(json.dumps(payload))
    else:
        print(f"admin: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"user:  {USER_EMAIL} ({STARTING_COINS} coins)")
        print(f"series: {', '.join(s['slug'] for s in payload['series']) or '(none seeded)'}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Emit the fixture as JSON on stdout.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.json)))
