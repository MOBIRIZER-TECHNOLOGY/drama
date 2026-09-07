"""Purchases. The API creates a `pending` row and a gateway checkout; only a verified webhook marks it paid.

State machine: pending -> paid | failed ; paid -> refunded. Every other transition is ignored (idempotent).
Webhooks go through an inbox table keyed by (gateway, event id) so replays and retries are no-ops.

Stripe: Checkout Session with purchase id in metadata; `checkout.session.completed` / `charge.refunded`.
Razorpay: Orders API with purchase id in notes; `payment.captured` / `refund.processed`, HMAC-SHA256 verified.
RevenueCat (phase 2): INITIAL_PURCHASE / RENEWAL / CANCELLATION events keyed by app_user_id = user id.
"""

import asyncio
import hashlib
import hmac
import json
import uuid
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
from app.models.wallet import (
    CoinPack,
    Coupon,
    LedgerKind,
    Offer,
    PackKind,
    PackPrice,
    Purchase,
    PurchaseStatus,
    Referral,
    VipMembership,
    WebhookEvent,
)
from app.services import ledger

log = structlog.get_logger()

ZERO_DECIMAL = {"JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"}
REFERRAL_REWARD_COINS = 50
TERMINAL = {PurchaseStatus.paid, PurchaseStatus.refunded, PurchaseStatus.failed}


async def price_for(session: AsyncSession, pack: CoinPack, currency: str, country: str) -> PackPrice:
    rows = (
        await session.scalars(
            select(PackPrice).where(PackPrice.pack_id == pack.id, PackPrice.currency == currency.upper())
        )
    ).all()
    chosen = None
    for r in rows:
        if r.country == country.upper():
            return r
        if r.country == "*":
            chosen = r
    if chosen is None:
        raise AppError(f"No {currency} price for pack {pack.sku}", code="no_price")
    return chosen


def _with_purchase(url: str, purchase_id: uuid.UUID) -> str:
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}purchase_id={purchase_id}"


def _minor_units(amount: Decimal, currency: str) -> int:
    return int(amount) if currency.upper() in ZERO_DECIMAL else int(round(amount * 100))


async def create_purchase(
    session: AsyncSession,
    *,
    user: User,
    pack_id: uuid.UUID,
    gateway: str,
    currency: str,
    country: str,
    success_url: str,
    cancel_url: str,
    variant_map: dict | None,
    coupon_code: str | None = None,
    offer_id: uuid.UUID | None = None,
    country_hint: str | None = None,
) -> tuple[Purchase, str]:
    """Returns the pending purchase and the URL / order id the client needs to continue."""
    from app.services import offers as offers_svc

    pack = await session.get(CoinPack, pack_id)
    if pack is None or not pack.is_active:
        raise NotFound("Pack")
    price = await price_for(session, pack, currency, country)
    amount = Decimal(price.amount)
    discount_pct: int | None = None
    applied_offer: Offer | None = None
    applied_coupon: Coupon | None = None
    if coupon_code:
        applied_offer, applied_coupon = await offers_svc.resolve_coupon(
            session, coupon_code, user, country=country_hint
        )
    elif offer_id:
        applied_offer = next(
            (o for o in await offers_svc.eligible(session, user, country=country_hint) if o.id == offer_id), None
        )
        if applied_offer is None:
            raise AppError("Offer is not available", code="offer_unavailable")
    if applied_offer is not None:
        if applied_offer.pack_id and applied_offer.pack_id != pack.id:
            raise AppError("Offer applies to a different pack", code="offer_pack_mismatch")
        discount_pct = applied_offer.discount_pct
        amount = offers_svc.apply_discount(amount, discount_pct)
    purchase = Purchase(
        user_id=user.id,
        pack_id=pack.id,
        gateway=gateway,
        status=PurchaseStatus.pending,
        currency=price.currency,
        amount=amount,
        coins_granted=0,
        variant_map=variant_map,
        offer_id=applied_offer.id if applied_offer else None,
        coupon_code=applied_coupon.code if applied_coupon else None,
        discount_pct=discount_pct,
    )
    session.add(purchase)
    await session.flush()

    s = get_settings()
    minor = _minor_units(amount, price.currency)
    if gateway == "stripe":
        if not s.stripe_secret_key:
            raise AppError("Stripe is not configured", code="gateway_unavailable")
        import stripe

        stripe.api_key = s.stripe_secret_key
        params = dict(
            mode="payment",
            client_reference_id=str(purchase.id),
            metadata={"purchase_id": str(purchase.id), "user_id": str(user.id), "pack_id": str(pack.id)},
            line_items=[
                {
                    "price_data": {
                        "currency": price.currency.lower(),
                        "unit_amount": minor,
                        "product_data": {"name": pack.name},
                    },
                    "quantity": 1,
                }
            ],
            success_url=_with_purchase(success_url, purchase.id),
            cancel_url=_with_purchase(cancel_url, purchase.id),
            expires_at=int((datetime.now(UTC) + timedelta(minutes=30)).timestamp()),
        )
        checkout = await asyncio.to_thread(stripe.checkout.Session.create, **params)  # sync SDK off the loop
        purchase.external_id = checkout.id
        purchase.raw = {"checkout_url": checkout.url}
        return purchase, checkout.url

    if gateway == "razorpay":
        if not (s.razorpay_key_id and s.razorpay_key_secret):
            raise AppError("Razorpay is not configured", code="gateway_unavailable")
        async with httpx.AsyncClient(auth=(s.razorpay_key_id, s.razorpay_key_secret), timeout=20) as client:
            r = await client.post(
                "https://api.razorpay.com/v1/orders",
                json={
                    "amount": minor,
                    "currency": price.currency.upper(),
                    "receipt": str(purchase.id),
                    "notes": {"purchase_id": str(purchase.id), "user_id": str(user.id), "pack_id": str(pack.id)},
                },
            )
        if r.status_code >= 300:
            raise AppError(f"Razorpay order failed: {r.text[:200]}", code="gateway_error")
        order = r.json()
        purchase.external_id = order["id"]
        purchase.raw = {"order": order}
        return purchase, order["id"]

    raise AppError(f"Unsupported gateway {gateway}", code="bad_gateway")


def _amount_matches(purchase: Purchase, amount_minor: int | None, currency: str | None) -> bool:
    if amount_minor is None or currency is None:
        return True  # gateway did not report; the verified signature is what we trust
    return (
        amount_minor == _minor_units(Decimal(purchase.amount), purchase.currency)
        and currency.upper() == purchase.currency
    )


async def mark_paid(
    session: AsyncSession,
    purchase_id: uuid.UUID,
    *,
    raw: dict | None = None,
    paid_at: datetime | None = None,
    gateway_payment_id: str | None = None,
    amount_minor: int | None = None,
    currency: str | None = None,
) -> Purchase:
    """pending -> paid, exactly once. Grants coins or VIP through the ledger; any later state is left alone."""
    purchase = await session.scalar(select(Purchase).where(Purchase.id == purchase_id).with_for_update())
    if purchase is None:
        raise NotFound("Purchase")
    if purchase.status in TERMINAL:
        return purchase
    if not _amount_matches(purchase, amount_minor, currency):
        log.warning(
            "purchase.amount_mismatch", purchase_id=str(purchase_id), amount_minor=amount_minor, currency=currency
        )
        purchase.status = PurchaseStatus.failed
        purchase.raw = {**(purchase.raw or {}), "failure": "amount_mismatch", "reported": [amount_minor, currency]}
        await session.flush()
        return purchase
    pack = await session.get(CoinPack, purchase.pack_id)
    assert pack is not None
    now = paid_at or datetime.now(UTC)
    if pack.kind == PackKind.coins:
        coins = pack.coins + pack.bonus_coins
        await ledger.post(
            session,
            user_id=purchase.user_id,
            delta=coins,
            kind=LedgerKind.purchase,
            idempotency_key=f"purchase:{purchase.id}",
            ref_type="purchase",
            ref_id=str(purchase.id),
            note=pack.name,
            variant_map=purchase.variant_map,
        )
        purchase.coins_granted = coins
    else:
        days = pack.duration_days or 30
        current = await session.scalar(
            select(VipMembership)
            .where(VipMembership.user_id == purchase.user_id, VipMembership.ends_at > now)
            .order_by(VipMembership.ends_at.desc())
            .limit(1)
        )
        starts = current.ends_at if current else now
        session.add(
            VipMembership(
                user_id=purchase.user_id,
                starts_at=starts,
                ends_at=starts + timedelta(days=days),
                source="purchase",
                purchase_id=purchase.id,
            )
        )
    purchase.status = PurchaseStatus.paid
    purchase.paid_at = now
    if purchase.coupon_code:
        coupon = await session.scalar(select(Coupon).where(Coupon.code == purchase.coupon_code).with_for_update())
        if coupon is not None:
            coupon.used += 1
    if gateway_payment_id:
        purchase.gateway_payment_id = gateway_payment_id
    if raw is not None:
        purchase.raw = {**(purchase.raw or {}), "paid_event": raw}
    await session.flush()
    await _reward_referrer_on_first_purchase(session, purchase)
    return purchase


async def _reward_referrer_on_first_purchase(session: AsyncSession, purchase: Purchase) -> None:
    ref = await session.scalar(
        select(Referral)
        .where(Referral.referee_id == purchase.user_id, Referral.rewarded_at.is_(None))
        .with_for_update()
    )
    if ref is None:
        return
    await ledger.post(
        session,
        user_id=ref.referrer_id,
        delta=REFERRAL_REWARD_COINS,
        kind=LedgerKind.referral,
        idempotency_key=f"referral:{ref.id}",
        ref_type="referral",
        ref_id=str(ref.id),
        note="Referral reward",
    )
    ref.rewarded_at = datetime.now(UTC)


async def mark_refunded(session: AsyncSession, purchase_id: uuid.UUID, *, raw: dict | None = None) -> Purchase:
    """paid -> refunded, exactly once. Reverses coins through the ledger (balance may go negative) and ends VIP."""
    purchase = await session.scalar(select(Purchase).where(Purchase.id == purchase_id).with_for_update())
    if purchase is None:
        raise NotFound("Purchase")
    if purchase.status != PurchaseStatus.paid:
        return purchase
    if purchase.coins_granted:
        await ledger.post(
            session,
            user_id=purchase.user_id,
            delta=-purchase.coins_granted,
            kind=LedgerKind.refund,
            idempotency_key=f"refund:{purchase.id}",
            ref_type="purchase",
            ref_id=str(purchase.id),
            note="Refund",
            variant_map=purchase.variant_map,
            allow_negative=True,
        )
    now = datetime.now(UTC)
    vips = await session.scalars(
        select(VipMembership).where(VipMembership.purchase_id == purchase.id, VipMembership.ends_at > now)
    )
    for vip in vips.all():
        vip.ends_at = max(vip.starts_at, now)
    purchase.status = PurchaseStatus.refunded
    purchase.refunded_at = now
    if raw is not None:
        purchase.raw = {**(purchase.raw or {}), "refund_event": raw}
    await session.flush()
    return purchase


# ---- webhook inbox ----


async def record_event(
    session: AsyncSession, gateway: str, event_id: str, event_type: str | None, payload: dict
) -> WebhookEvent | None:
    """Insert the inbox row. Returns None when this event id was already received (replay)."""
    row = WebhookEvent(
        gateway=gateway, event_id=event_id, event_type=event_type, payload=payload, received_at=datetime.now(UTC)
    )
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError:
        return None
    return row


def finish_event(row: WebhookEvent, result: str, error: str | None = None) -> None:
    row.processed_at = datetime.now(UTC)
    row.result = result
    row.error = error


# ---- verification (pure, testable) ----


def verify_stripe(payload: bytes, sig_header: str, secret: str) -> dict:
    import stripe

    return stripe.Webhook.construct_event(payload, sig_header, secret)


def verify_razorpay(payload: bytes, signature: str, secret: str) -> dict:
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise AppError("Bad Razorpay signature", status_code=400, code="bad_signature")
    return json.loads(payload)


def verify_razorpay_checkout(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    """Client-side Checkout.js handshake; informational only, the webhook is the source of truth."""
    expected = hmac.new(key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def razorpay_event_id(event: dict, headers: dict) -> str:
    """Razorpay sends x-razorpay-event-id; fall back to a hash of the payload for older accounts."""
    return headers.get("x-razorpay-event-id") or hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()


async def apply_stripe_event(session: AsyncSession, event: dict) -> str:
    kind = event.get("type", "")
    obj = event.get("data", {}).get("object", {})
    if kind == "checkout.session.completed" and obj.get("payment_status") == "paid":
        pid = (obj.get("metadata") or {}).get("purchase_id") or obj.get("client_reference_id")
        if pid:
            await mark_paid(
                session,
                uuid.UUID(pid),
                raw={"id": event.get("id"), "type": kind},
                gateway_payment_id=obj.get("payment_intent"),
                amount_minor=obj.get("amount_total"),
                currency=obj.get("currency"),
            )
            return "paid"
    if kind == "charge.refunded":
        purchase = await session.scalar(
            select(Purchase).where(
                Purchase.gateway == "stripe", Purchase.gateway_payment_id == obj.get("payment_intent")
            )
        )
        if purchase is not None:
            await mark_refunded(session, purchase.id, raw={"id": event.get("id"), "type": kind})
            return "refunded"
    if kind == "checkout.session.expired":
        pid = (obj.get("metadata") or {}).get("purchase_id")
        if pid:
            p = await session.scalar(select(Purchase).where(Purchase.id == uuid.UUID(pid)).with_for_update())
            if p is not None and p.status == PurchaseStatus.pending:
                p.status = PurchaseStatus.failed
                return "expired"
    return "ignored"


async def apply_razorpay_event(session: AsyncSession, event: dict) -> str:
    kind = event.get("event", "")
    payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    if kind == "payment.captured":
        pid = (payment.get("notes") or {}).get("purchase_id")
        if pid:
            await mark_paid(
                session,
                uuid.UUID(pid),
                raw={"payment_id": payment.get("id"), "event": kind},
                gateway_payment_id=payment.get("id"),
                amount_minor=payment.get("amount"),
                currency=payment.get("currency"),
            )
            return "paid"
    if kind == "refund.processed":
        refund = event.get("payload", {}).get("refund", {}).get("entity", {})
        purchase = await session.scalar(
            select(Purchase).where(
                Purchase.gateway == "razorpay", Purchase.gateway_payment_id == refund.get("payment_id")
            )
        )
        if purchase is not None:
            await mark_refunded(session, purchase.id, raw={"refund_id": refund.get("id"), "event": kind})
            return "refunded"
    return "ignored"
