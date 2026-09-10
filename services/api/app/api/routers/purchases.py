import asyncio
import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, client_country
from app.core.config import get_settings
from app.core.errors import AppError, NotFound, Unauthorized
from app.core.ratelimit import limiter
from app.models.wallet import Purchase
from app.schemas.purchases import CheckoutIn, CheckoutOut, PlayRedeemIn, PurchaseOut, QuoteIn, QuoteOut
from app.services import config as config_svc
from app.services import payments, store_billing

router = APIRouter(tags=["purchases"])


def _out(p: Purchase) -> PurchaseOut:
    return PurchaseOut(
        id=p.id,
        status=p.status,
        gateway=p.gateway,
        currency=p.currency,
        amount=float(p.amount),
        coins_granted=p.coins_granted,
        paid_at=p.paid_at,
        created_at=p.created_at,
    )


@router.post("/purchases/play/redeem", response_model=PurchaseOut)
@limiter.limit("20/minute")
async def redeem_play(request: Request, body: PlayRedeemIn, ctx: CurrentUser, db: DB) -> PurchaseOut:
    """Grant a Google Play purchase after verifying it with Google.

    Android must sell digital content through Play Billing, so this is the Android equivalent of the Stripe and
    Razorpay webhooks — and it keeps the same rule those follow: the client reports that a purchase happened,
    the server asks the store what actually happened, and only a confirmed purchase moves coins.
    """
    variants = await config_svc.variant_map(db, ctx.user.id)
    purchase = await store_billing.redeem(
        db,
        user=ctx.user,
        product_id=body.product_id,
        purchase_token=body.purchase_token,
        variant_map=variants or None,
    )
    await db.commit()
    return _out(purchase)


@router.post("/purchases/checkout", response_model=CheckoutOut)
@limiter.limit("10/minute")
async def checkout(
    request: Request,
    body: CheckoutIn,
    ctx: CurrentUser,
    db: DB,
    country: Annotated[str | None, Depends(client_country)],
) -> CheckoutOut:
    variants = await config_svc.variant_map(db, ctx.user.id)
    # The country is the edge's word, never the client's. Regional prices exist because some markets pay less,
    # and a body field would let anyone claim to be in the cheapest one. Unknown becomes "*", the world price.
    country = country or "*"
    purchase, handle = await payments.create_purchase(
        db,
        user=ctx.user,
        pack_id=body.pack_id,
        gateway=body.gateway,
        currency=body.currency,
        country=country,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        variant_map=variants or None,
        coupon_code=body.coupon_code,
        offer_id=body.offer_id,
        country_hint=country,
    )
    await db.commit()
    s = get_settings()
    if body.gateway == "stripe":
        return CheckoutOut(
            purchase_id=purchase.id,
            gateway="stripe",
            checkout_url=handle,
            currency=purchase.currency,
            amount=float(purchase.amount),
            discount_pct=purchase.discount_pct,
        )
    return CheckoutOut(
        purchase_id=purchase.id,
        gateway="razorpay",
        order_id=handle,
        key_id=s.razorpay_key_id,
        amount_minor=payments._minor_units(Decimal(purchase.amount), purchase.currency),
        currency=purchase.currency,
        amount=float(purchase.amount),
        discount_pct=purchase.discount_pct,
    )


@router.post("/purchases/quote", response_model=QuoteOut)
@limiter.limit("30/minute")
async def quote(
    request: Request,
    body: QuoteIn,
    ctx: CurrentUser,
    db: DB,
    country: Annotated[str | None, Depends(client_country)],
) -> QuoteOut:
    """Price a pack with any offer or coupon applied, without creating a purchase."""
    resolved = country or "*"  # edge-resolved, for the same reason as checkout
    q = await payments.quote_purchase(
        db,
        user=ctx.user,
        pack_id=body.pack_id,
        currency=body.currency,
        country=resolved,
        coupon_code=body.coupon_code,
        offer_id=body.offer_id,
        country_hint=country,
    )
    return QuoteOut(
        pack_id=q.pack.id,
        currency=q.currency,
        list_amount=float(q.list_amount),
        amount=float(q.amount),
        discount_pct=q.discount_pct,
        coins=q.coins,
        offer_id=q.offer.id if q.offer else None,
        offer_title=q.offer.title if q.offer else None,
        coupon_code=q.coupon.code if q.coupon else None,
    )


@router.get("/purchases/{purchase_id}", response_model=PurchaseOut)
async def get_purchase(purchase_id: uuid.UUID, ctx: CurrentUser, db: DB) -> PurchaseOut:
    p = await db.get(Purchase, purchase_id)
    if p is None or p.user_id != ctx.user.id:
        raise NotFound("Purchase")
    return _out(p)


@router.get("/purchases", response_model=list[PurchaseOut])
async def list_purchases(ctx: CurrentUser, db: DB) -> list[PurchaseOut]:
    rows = await db.scalars(
        select(Purchase).where(Purchase.user_id == ctx.user.id).order_by(Purchase.created_at.desc()).limit(50)
    )
    return [_out(p) for p in rows.all()]


# ---- webhooks: signature-verified, inbox-deduplicated, always 2xx once verified so gateways stop retrying ----


async def _apply(db, gateway: str, event_id: str, event_type: str | None, event: dict, apply) -> dict:
    # `record_event` returns None for an event that already succeeded and the cleared row for one whose last
    # delivery errored, so a gateway retry after a transient failure is processed rather than swallowed.
    row = await payments.record_event(db, gateway, event_id, event_type, event)
    if row is None:
        await db.rollback()
        return {"result": "duplicate"}
    try:
        result = await apply(db, event)
        payments.finish_event(row, result)
        await db.commit()
        return {"result": result}
    except Exception as exc:  # noqa: BLE001 - keep the inbox row so the event can be re-driven
        await db.rollback()
        async with db.begin():
            row2 = await payments.record_event(db, gateway, event_id, event_type, event)
            if row2 is not None:
                payments.finish_event(row2, "error", str(exc)[:1000])
        raise


@router.post("/webhooks/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, db: DB, stripe_signature: str = Header(default="")) -> dict:
    s = get_settings()
    if not s.stripe_webhook_secret:
        raise AppError("Stripe webhook secret not configured", status_code=503, code="not_configured")
    payload = await request.body()
    try:
        event = payments.verify_stripe(payload, stripe_signature, s.stripe_webhook_secret)
    except Exception as exc:  # noqa: BLE001 - any verification failure is a 400
        raise AppError("Invalid Stripe signature", status_code=400, code="bad_signature") from exc
    event = dict(event)
    return await _apply(db, "stripe", str(event.get("id")), event.get("type"), event, payments.apply_stripe_event)


@router.post("/webhooks/razorpay", include_in_schema=False)
async def razorpay_webhook(request: Request, db: DB, x_razorpay_signature: str = Header(default="")) -> dict:
    s = get_settings()
    if not s.razorpay_webhook_secret:
        raise AppError("Razorpay webhook secret not configured", status_code=503, code="not_configured")
    payload = await request.body()
    event = payments.verify_razorpay(payload, x_razorpay_signature, s.razorpay_webhook_secret)
    event_id = payments.razorpay_event_id(event, dict(request.headers))
    return await _apply(db, "razorpay", event_id, event.get("event"), event, payments.apply_razorpay_event)


@router.post("/webhooks/play", include_in_schema=False)
async def play_webhook(request: Request, db: DB, authorization: str = Header(default="")) -> dict:
    """Google Play real-time developer notifications, delivered by a Pub/Sub push subscription.

    This is the refund half of Play billing: `/purchases/play/redeem` grants coins, and without this route
    nothing ever took them back when Google refunded or voided the purchase. Pub/Sub authenticates with a
    Google-signed OIDC bearer token rather than an HMAC, so the check is a signature *and* an identity: the
    token has to name this endpoint as its audience and the one service account the subscription uses.
    """
    s = get_settings()
    if not (s.google_play_rtdn_audience and s.google_play_rtdn_service_account_email):
        raise AppError("Google Play notifications not configured", status_code=503, code="not_configured")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("Missing Pub/Sub bearer token", code="bad_signature")
    # Certificate fetch and RSA verification are blocking; off the loop like the Stripe SDK call in checkout.
    await asyncio.to_thread(
        store_billing.verify_play_rtdn,
        token.strip(),
        audience=s.google_play_rtdn_audience,
        service_account_email=s.google_play_rtdn_service_account_email,
    )
    try:
        envelope = await request.json()
    except ValueError as exc:
        raise AppError("Body is not JSON", code="bad_request") from exc
    message_id, notification = store_billing.decode_rtdn(envelope)
    return await _apply(
        db,
        store_billing.GATEWAY,
        message_id,
        store_billing.rtdn_kind(notification),
        notification,
        store_billing.apply_rtdn,
    )
