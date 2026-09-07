"""Offer eligibility and coupon application. Discounts are percentages applied to the regional price at checkout."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.identity import User
from app.models.wallet import Coupon, Offer, Purchase, PurchaseStatus


async def _has_paid(session: AsyncSession, user_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(
            select(Purchase.id).where(Purchase.user_id == user_id, Purchase.status == PurchaseStatus.paid).limit(1)
        )
    )


async def _last_paid_at(session: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    return await session.scalar(
        select(func.max(Purchase.paid_at)).where(Purchase.user_id == user_id, Purchase.status == PurchaseStatus.paid)
    )


async def eligible(
    session: AsyncSession, user: User, *, country: str | None, now: datetime | None = None
) -> list[Offer]:
    """Offers this user may see right now (coupon-kind offers are only reachable by code)."""
    now = now or datetime.now(UTC)
    rows = (
        await session.scalars(
            select(Offer).where(
                Offer.is_active.is_(True),
                Offer.kind != "coupon",
                (Offer.starts_at.is_(None)) | (Offer.starts_at <= now),
                (Offer.ends_at.is_(None)) | (Offer.ends_at > now),
            )
        )
    ).all()
    out: list[Offer] = []
    paid = None
    last_paid = None
    for o in rows:
        rules = o.eligibility or {}
        if rules.get("countries") and (country or "").upper() not in [c.upper() for c in rules["countries"]]:
            continue
        if o.kind == "first_purchase" or rules.get("first_purchase"):
            paid = await _has_paid(session, user.id) if paid is None else paid
            if paid:
                continue
        if o.kind == "winback" or rules.get("inactive_days"):
            days = int(rules.get("inactive_days") or 14)
            last_paid = await _last_paid_at(session, user.id) if last_paid is None else last_paid
            if last_paid is None or last_paid > now - timedelta(days=days):
                continue
        out.append(o)
    return out


async def resolve_coupon(session: AsyncSession, code: str, user: User, *, country: str | None) -> tuple[Offer, Coupon]:
    coupon = await session.scalar(select(Coupon).where(Coupon.code == code.strip().upper()).with_for_update())
    if coupon is None:
        raise AppError("Coupon not found", status_code=404, code="coupon_invalid")
    if coupon.max_uses is not None and coupon.used >= coupon.max_uses:
        raise AppError("Coupon has been fully redeemed", code="coupon_exhausted")
    offer = await session.get(Offer, coupon.offer_id)
    now = datetime.now(UTC)
    if (
        offer is None
        or not offer.is_active
        or (offer.starts_at and offer.starts_at > now)
        or (offer.ends_at and offer.ends_at <= now)
    ):
        raise AppError("Coupon is not active", code="coupon_inactive")
    rules = offer.eligibility or {}
    if rules.get("countries") and (country or "").upper() not in [c.upper() for c in rules["countries"]]:
        raise AppError("Coupon is not valid in your region", code="coupon_region")
    if (offer.kind == "first_purchase" or rules.get("first_purchase")) and await _has_paid(session, user.id):
        raise AppError("Coupon is for first purchases only", code="coupon_first_purchase")
    return offer, coupon


def apply_discount(amount: Decimal, pct: int | None) -> Decimal:
    if not pct:
        return amount
    return (amount * (Decimal(100 - pct) / Decimal(100))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
