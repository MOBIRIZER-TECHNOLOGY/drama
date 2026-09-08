"""Create the legal pages every client links to.

Privacy and terms are linked from the web footer, the mobile settings screen and the consent line under the
sign-in form. None of those pages existed, so every one of those links was a 404 — including the consent line
that asks someone to agree to documents they cannot read, and the privacy policy URL both app stores require
before a listing goes live.

The bodies here are placeholders and say so in the first line. They exist so the routes resolve, the footer
is honest and a review build is not rejected for a dead link; the real text is the operator's to write in the
admin console, which is why these are ordinary CMS rows rather than anything hard-coded.

Usage: uv run python scripts/seed_pages.py
"""

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.ops import CmsPage, CmsPageTranslation  # noqa: E402

PLACEHOLDER = (
    "<p><strong>This is a placeholder.</strong> Replace it in the admin console before launch "
    "(Content &rarr; Pages).</p>"
)

PAGES = [
    (
        "privacy",
        "Privacy Policy",
        True,
        PLACEHOLDER
        + "<h2>What we collect</h2><p>An email address or phone number when you create an account, the "
        "episodes you watch so your progress follows you between devices, and the coins you earn and spend."
        "</p><h2>Why</h2><p>To keep you signed in, remember where you left off, and settle purchases.</p>"
        "<h2>Deleting your account</h2><p>Settings &rarr; Delete account removes your profile, your watch "
        "history and your remaining coins. Purchase records are kept where tax law requires it.</p>",
    ),
    (
        "terms",
        "Terms of Service",
        True,
        PLACEHOLDER
        + "<h2>Your account</h2><p>One account per person. Keep your sign-in details to yourself.</p>"
        "<h2>Coins</h2><p>Coins unlock episodes. They have no cash value, cannot be transferred between "
        "accounts, and are not refundable once spent on an episode.</p>"
        "<h2>Content</h2><p>Episodes are licensed for personal viewing. Recording or redistributing them is "
        "not permitted.</p>",
    ),
    (
        "about",
        "About Katha",
        True,
        PLACEHOLDER + "<p>Katha is a short-drama streaming service: complete stories in episodes built for a phone.</p>",
    ),
    (
        "rate",
        "Rate Katha",
        False,
        PLACEHOLDER
        + "<p>Ratings open in the app store. Set the store link in Settings &rarr; Mobile so this page is "
        "skipped entirely.</p>",
    ),
]


async def main() -> int:
    created = 0
    async with SessionLocal() as db:
        for slug, title, in_footer, body in PAGES:
            page = await db.scalar(select(CmsPage).where(CmsPage.slug == slug))
            if page is None:
                page = CmsPage(slug=slug, show_in_footer=in_footer, is_published=True)
                db.add(page)
                await db.flush()
                created += 1
            tr = await db.get(CmsPageTranslation, (page.id, "en"))
            if tr is None:
                tr = CmsPageTranslation(page_id=page.id, lang="en", title=title, body_html=body)
                db.add(tr)
            # An existing page is left alone: it may already hold the real text.
            page.updated_at = datetime.now(UTC)
        await db.commit()

    print(f"Created {created} page(s); {len(PAGES) - created} already existed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
