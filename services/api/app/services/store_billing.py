"""Google Play Billing verification.

Google Play's Payments policy requires digital content consumed inside an Android app to be sold through Play
Billing. Card checkout in a browser sheet is a store-rejection blocker, not a UX preference, so this is the path
Android purchases take.

The contract mirrors a gateway webhook exactly, and for the same reason: the client tells us *that* something
happened, and we ask Google what actually happened before a single coin is granted. A purchase token is proof
only once Google has confirmed it, and only for the product and package it was issued against.

Two failure modes worth naming, because the product this replaces hit both:

  - **Unacknowledged purchases are auto-refunded after three days.** A purchase must be acknowledged (for a
    subscription) or consumed (for a consumable, which acknowledges implicitly) or the customer silently gets
    their money back and keeps nothing. `finalize` does this and is called after the coins are granted.
  - **A client-reported "success" is not a success.** Nothing here trusts the client's word about the outcome;
    the only input taken from it is the token to go and check.
"""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.models.identity import User
from app.models.wallet import CoinPack, PackKind, Purchase, PurchaseStatus
from app.services import payments

log = structlog.get_logger()

GATEWAY = "play"
API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"

# Google's purchaseState for a one-time product: 0 purchased, 1 cancelled, 2 pending.
PURCHASED = 0
# acknowledgementState: 0 not acknowledged, 1 acknowledged.
ACKNOWLEDGED = 1


@dataclass
class PlayPurchase:
    """The parts of Google's response this decision depends on."""

    order_id: str | None
    purchase_state: int
    acknowledged: bool
    price_minor: int | None
    currency: str | None
    raw: dict

    @property
    def is_purchased(self) -> bool:
        return self.purchase_state == PURCHASED


def _credentials():
    """Service-account credentials for the Play Developer API.

    Imported lazily: google-auth arrives with firebase-admin, and an install that never touches Play billing
    should not pay for the import at startup.
    """
    s = get_settings()
    if not (s.google_play_package_name and s.google_play_service_account_file):
        raise AppError("Google Play billing is not configured", code="gateway_unavailable")
    from google.oauth2 import service_account  # noqa: PLC0415 - optional dependency, resolved on first use

    return service_account.Credentials.from_service_account_file(s.google_play_service_account_file, scopes=[SCOPE])


def _access_token() -> str:
    """Blocking token mint; callers push it off the event loop."""
    from google.auth.transport.requests import Request as GoogleRequest  # noqa: PLC0415

    creds = _credentials()
    creds.refresh(GoogleRequest())
    return str(creds.token)


async def _get(path: str) -> dict:
    s = get_settings()
    token = await asyncio.to_thread(_access_token)
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{API_ROOT}/{s.google_play_package_name}/{path}", headers={"Authorization": f"Bearer {token}"}
        )
    if r.status_code == 404:
        raise AppError("Google does not recognise this purchase", status_code=400, code="play_token_unknown")
    if r.status_code >= 300:
        log.warning("play.api_error", status=r.status_code, body=r.text[:300], path=path)
        raise AppError("Could not verify the purchase with Google", status_code=502, code="play_verify_failed")
    return r.json()


async def _post(path: str, body: dict | None = None) -> None:
    s = get_settings()
    token = await asyncio.to_thread(_access_token)
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{API_ROOT}/{s.google_play_package_name}/{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=body or {},
        )
    # 410 means already consumed, which is the state we wanted anyway.
    if r.status_code >= 300 and r.status_code != 410:
        log.warning("play.finalize_error", status=r.status_code, body=r.text[:300], path=path)


def parse_product(payload: dict) -> PlayPurchase:
    price = payload.get("priceAmountMicros")
    return PlayPurchase(
        order_id=payload.get("orderId"),
        purchase_state=int(payload.get("purchaseState", 1)),
        acknowledged=int(payload.get("acknowledgementState", 0)) == ACKNOWLEDGED,
        # Play reports micros; the rest of the system speaks minor units.
        price_minor=int(price) // 10_000 if price is not None else None,
        currency=payload.get("priceCurrencyCode"),
        raw=payload,
    )


async def verify_product(product_id: str, token: str) -> PlayPurchase:
    return parse_product(await _get(f"purchases/products/{product_id}/tokens/{token}"))


async def finalize(product_id: str, token: str, *, consumable: bool) -> None:
    """Acknowledge (and consume, for a consumable) so Google does not auto-refund after three days."""
    if consumable:
        # Consuming implies acknowledgement and lets the same product be bought again.
        await _post(f"purchases/products/{product_id}/tokens/{token}:consume")
    else:
        await _post(f"purchases/products/{product_id}/tokens/{token}:acknowledge")


async def redeem(
    session: AsyncSession,
    *,
    user: User,
    product_id: str,
    purchase_token: str,
    variant_map: dict | None = None,
) -> Purchase:
    """Verify a Play purchase and grant it, exactly once.

    Idempotency comes from the database, not from bookkeeping here: `(gateway, external_id)` is unique and the
    external id is the purchase token, so a retried or replayed call finds the existing row and returns it
    rather than granting twice.
    """
    pack = await session.scalar(
        select(CoinPack).where(CoinPack.google_product_id == product_id, CoinPack.is_active.is_(True))
    )
    if pack is None:
        raise NotFound("Pack")

    existing = await session.scalar(
        select(Purchase).where(Purchase.gateway == GATEWAY, Purchase.external_id == purchase_token)
    )
    if existing is not None:
        # A client retry after a dropped response. Make sure Google was told, then hand back the same row.
        if existing.status == PurchaseStatus.paid:
            await finalize(product_id, purchase_token, consumable=pack.kind == PackKind.coins)
        return existing

    verified = await verify_product(product_id, purchase_token)
    if not verified.is_purchased:
        raise AppError("This purchase is not complete", status_code=400, code="play_not_purchased")

    purchase = Purchase(
        user_id=user.id,
        pack_id=pack.id,
        gateway=GATEWAY,
        status=PurchaseStatus.pending,
        currency=(verified.currency or "INR").upper(),
        # Play is the source of truth for what was actually charged, including local tax and pricing.
        amount=Decimal(verified.price_minor or 0) / 100,
        coins_granted=0,
        external_id=purchase_token,
        gateway_payment_id=verified.order_id,
        variant_map=variant_map,
        raw={"play": verified.raw},
    )
    session.add(purchase)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError:
        # Two concurrent redemptions of the same token; the other one won.
        row = await session.scalar(
            select(Purchase).where(Purchase.gateway == GATEWAY, Purchase.external_id == purchase_token)
        )
        if row is None:
            raise
        return row

    paid = await payments.mark_paid(
        session,
        purchase.id,
        raw={"source": "play", "order_id": verified.order_id},
        gateway_payment_id=verified.order_id,
    )
    # Only after the coins are safely in the ledger. If this call fails the job is retried by the client's next
    # redeem; what must never happen is consuming a token whose coins were not granted.
    await finalize(product_id, purchase_token, consumable=pack.kind == PackKind.coins)
    return paid


def vip_window(days: int, *, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Helper for tests and for admin grants: a VIP window of `days` starting now."""
    start = now or datetime.now(UTC)
    return start, start + timedelta(days=days)


def is_configured() -> bool:
    s = get_settings()
    return bool(s.google_play_package_name and s.google_play_service_account_file)


__all__ = [
    "GATEWAY",
    "PlayPurchase",
    "finalize",
    "is_configured",
    "parse_product",
    "redeem",
    "verify_product",
    "vip_window",
]
