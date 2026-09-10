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

Refunds come back the same two ways a gateway's do, and for the same reason a webhook alone is not enough:

  - **Real-time developer notifications** are Play's webhook. They arrive through a Pub/Sub push subscription
    as a POST carrying a Google-signed OIDC token; `verify_play_rtdn` checks the token and `apply_rtdn` turns a
    void or cancellation into `payments.mark_refunded`. A refund that is not reversed is coins the viewer keeps.
  - **`list_voided`** is the safety net. A push subscription can be misconfigured, its endpoint can be down for
    longer than Pub/Sub keeps retrying, and the notification for a purchase made before the subscription
    existed never arrives at all. The worker polls the voided-purchases list and reverses whatever the push
    path missed; `mark_refunded` is terminal, so seeing the same void twice costs nothing.
"""

import asyncio
import base64
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, NotFound, Unauthorized
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
# RTDN `oneTimeProductNotification.notificationType`.
ONE_TIME_PRODUCT_PURCHASED = 1
ONE_TIME_PRODUCT_CANCELED = 2
# The voided-purchases list refuses a `startTime` older than this; a poll that has fallen further behind
# starts from here and accepts that anything older was missed.
VOIDED_LOOKBACK = timedelta(days=30)


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


# ---- real-time developer notifications (Pub/Sub push) ----


def _google_oidc_verifier(token: str, audience: str) -> dict:
    """Verify a Google-signed OIDC token: signature against Google's published certificates, issuer, expiry
    and audience. Blocking (the certificates are fetched and cached over HTTP); callers thread it off."""
    from google.auth.transport import requests as google_requests  # noqa: PLC0415 - optional dependency
    from google.oauth2 import id_token  # noqa: PLC0415

    return id_token.verify_oauth2_token(token, google_requests.Request(), audience=audience)


def verify_play_rtdn(
    token: str,
    *,
    audience: str,
    service_account_email: str,
    verifier: Callable[[str, str], dict] | None = None,
) -> dict:
    """The push endpoint's authentication. Returns the token's claims, or raises Unauthorized.

    A valid Google signature only proves that *some* Google account minted the token; any Pub/Sub topic in
    any project can push to a public URL. The audience ties the token to this endpoint and the email ties it
    to the one service account the subscription was told to use, and both have to match. `email_verified`
    is required too: Google sets it for its own service accounts, and a token that lacks it is not one.

    `verifier` is looked up at call time so a test can swap the Google one out without a network.
    """
    try:
        claims = (verifier or _google_oidc_verifier)(token, audience)
    except Exception as exc:  # noqa: BLE001 - any verification failure is a refusal, whatever the library says
        raise Unauthorized("Invalid Pub/Sub token", code="bad_signature") from exc
    email = str(claims.get("email") or "").lower()
    if not claims.get("email_verified") or email != service_account_email.lower():
        raise Unauthorized("Pub/Sub token is not from the expected service account", code="bad_signature")
    return claims


def decode_rtdn(envelope: dict) -> tuple[str, dict]:
    """Unwrap a Pub/Sub push body into (message id, developer notification).

    The notification itself travels base64-encoded inside `message.data`; the message id is what makes the
    delivery idempotent, since Pub/Sub redelivers until it gets a 2xx. Either missing means this was not a
    Pub/Sub push at all, and a 400 is the right answer — the authentication check has already run.
    """
    message = envelope.get("message") if isinstance(envelope, dict) else None
    if not isinstance(message, dict):
        raise AppError("Not a Pub/Sub push message", code="bad_request")
    message_id = message.get("messageId") or message.get("message_id")
    data = message.get("data")
    if not message_id or not isinstance(data, str):
        raise AppError("Pub/Sub message has no id or data", code="bad_request")
    try:
        notification = json.loads(base64.b64decode(data, validate=True))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AppError("Pub/Sub message data is not a JSON notification", code="bad_request") from exc
    if not isinstance(notification, dict):
        raise AppError("Pub/Sub message data is not a JSON notification", code="bad_request")
    return str(message_id), notification


def rtdn_kind(notification: dict) -> str | None:
    """Which of Play's notification families this is; stored as the inbox row's event type."""
    for key in (
        "voidedPurchaseNotification",
        "oneTimeProductNotification",
        "subscriptionNotification",
        "testNotification",
    ):
        if key in notification:
            return key
    return None


def refund_token(notification: dict) -> str | None:
    """The purchase token to reverse, or None when this notification reverses nothing.

    A voided purchase is a refund or chargeback that has already happened. A cancelled one-time product is a
    pending purchase the viewer backed out of; `mark_refunded` leaves a purchase that was never paid alone,
    so routing it the same way is safe and covers the case where the pending state was somehow granted.
    """
    voided = notification.get("voidedPurchaseNotification")
    if isinstance(voided, dict) and voided.get("purchaseToken"):
        return str(voided["purchaseToken"])
    one_time = notification.get("oneTimeProductNotification")
    if isinstance(one_time, dict) and one_time.get("purchaseToken"):
        if int(one_time.get("notificationType") or 0) == ONE_TIME_PRODUCT_CANCELED:
            return str(one_time["purchaseToken"])
    return None


async def apply_rtdn(session: AsyncSession, notification: dict) -> str:
    """Inbox handler: void or cancellation -> refunded; everything else ignored.

    The package name is checked against ours rather than trusted: the push subscription is authenticated,
    but a topic shared across apps would deliver another app's voids, and a purchase token is opaque enough
    that a collision would be invisible.
    """
    s = get_settings()
    package = notification.get("packageName")
    if package != s.google_play_package_name:
        log.warning("play.rtdn_package_mismatch", package=package)
        return "ignored"
    token = refund_token(notification)
    if token is None:
        return "ignored"
    purchase = await session.scalar(select(Purchase).where(Purchase.gateway == GATEWAY, Purchase.external_id == token))
    if purchase is None:
        # A void for a purchase never redeemed here: nothing was granted, so there is nothing to take back.
        log.info("play.rtdn_unknown_purchase", kind=rtdn_kind(notification))
        return "ignored"
    await payments.mark_refunded(
        session, purchase.id, raw={"source": "play_rtdn", "kind": rtdn_kind(notification), "notification": notification}
    )
    return "refunded"


# ---- voided purchases (the polled safety net) ----


@dataclass
class VoidedPurchase:
    """One entry from the voided-purchases list. `reason` and `source` are Google's enums, kept for the audit."""

    purchase_token: str
    order_id: str | None
    voided_time_ms: int | None
    reason: int | None
    source: int | None


def parse_voided(payload: dict) -> list[VoidedPurchase]:
    out = []
    for row in payload.get("voidedPurchases") or []:
        token = row.get("purchaseToken")
        if not token:
            continue
        voided_ms = row.get("voidedTimeMillis")
        out.append(
            VoidedPurchase(
                purchase_token=str(token),
                order_id=row.get("orderId"),
                voided_time_ms=int(voided_ms) if voided_ms is not None else None,
                reason=row.get("voidedReason"),
                source=row.get("voidedSource"),
            )
        )
    return out


def voided_start_ms(start_time_ms: int | None, *, now: datetime | None = None) -> int:
    """Clamp a poll's start to the window Google serves. Older than that and the API answers 400."""
    current = now or datetime.now(UTC)
    floor = int((current - VOIDED_LOOKBACK).timestamp() * 1000)
    return floor if start_time_ms is None else max(int(start_time_ms), floor)


async def list_voided(start_time_ms: int | None = None) -> list[VoidedPurchase]:
    """Every one-time purchase Google has voided since `start_time_ms`, following pagination to the end."""
    out: list[VoidedPurchase] = []
    page_token: str | None = None
    while True:
        params: dict[str, str | int] = {"startTime": voided_start_ms(start_time_ms)}
        if page_token:
            params["token"] = page_token
        payload = await _get(f"purchases/voidedpurchases?{urlencode(params)}")
        out.extend(parse_voided(payload))
        page_token = (payload.get("tokenPagination") or {}).get("nextPageToken")
        if not page_token:
            return out


__all__ = [
    "GATEWAY",
    "PlayPurchase",
    "VoidedPurchase",
    "apply_rtdn",
    "decode_rtdn",
    "finalize",
    "is_configured",
    "list_voided",
    "parse_product",
    "parse_voided",
    "redeem",
    "refund_token",
    "rtdn_kind",
    "verify_play_rtdn",
    "verify_product",
    "vip_window",
    "voided_start_ms",
]
