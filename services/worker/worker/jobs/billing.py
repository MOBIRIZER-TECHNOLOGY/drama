"""Store billing reconciliation: the refunds a push notification did not bring.

Google Play reports refunds and chargebacks through real-time developer notifications, which the API receives
at `/v1/webhooks/play`. That path is authoritative when it works and silent when it does not — a Pub/Sub
subscription pointed at the wrong URL, an endpoint down for longer than Pub/Sub retries, or a purchase made
before the subscription existed all leave a refunded viewer holding their coins, with nothing in any log to
say so. So the worker also asks Google directly, on a schedule, for everything voided since it last looked,
and reverses whatever the push path missed. `payments.mark_refunded` is terminal, so a void seen by both
paths is reversed once.

The checkpoint is the wall-clock time a successful run started, kept in Redis; the next run rewinds it by
`OVERLAP` so a void that Google indexed late is still caught. A failed run leaves the checkpoint alone and the
next run covers the same ground again.
"""

import time
from datetime import timedelta

import structlog
from app.core.db import SessionLocal
from app.models.wallet import Purchase, PurchaseStatus
from app.services import payments, store_billing
from sqlalchemy import select

log = structlog.get_logger()

CHECKPOINT_KEY = "play:voided:reconciled_ms"
# How far behind the checkpoint each run starts. Wide, because it costs one extra page at most and a void
# that lands in Google's index a few hours after it happened is otherwise missed for good.
OVERLAP = timedelta(days=1)


async def _checkpoint(redis) -> int | None:
    if redis is None:
        return None
    raw = await redis.get(CHECKPOINT_KEY)
    if raw is None:
        return None
    return int(raw.decode() if isinstance(raw, bytes) else raw)


async def reconcile_play_voided(ctx: dict) -> dict:
    """Reverse every Play purchase Google has voided since the last run. Safe to re-run; skips when Play is off."""
    if not store_billing.is_configured():
        return {"status": "not_configured"}

    redis = ctx.get("redis")
    started_ms = int(time.time() * 1000)
    last = await _checkpoint(redis)
    start_ms = None if last is None else last - int(OVERLAP.total_seconds() * 1000)
    voided = await store_billing.list_voided(start_ms)

    refunded = 0
    unknown = 0
    async with SessionLocal() as db:
        for v in voided:
            purchase = await db.scalar(
                select(Purchase).where(
                    Purchase.gateway == store_billing.GATEWAY, Purchase.external_id == v.purchase_token
                )
            )
            if purchase is None:
                # Never redeemed here, so nothing was granted; a void for it is Google's business alone.
                unknown += 1
                continue
            if purchase.status != PurchaseStatus.paid:
                continue
            await payments.mark_refunded(
                db,
                purchase.id,
                raw={
                    "source": "play_reconcile",
                    "order_id": v.order_id,
                    "voided_time_ms": v.voided_time_ms,
                    "reason": v.reason,
                    "voided_source": v.source,
                },
            )
            refunded += 1
            log.info("play.voided_reconciled", purchase_id=str(purchase.id), order_id=v.order_id)
        await db.commit()

    if redis is not None:
        await redis.set(CHECKPOINT_KEY, str(started_ms))
    return {"status": "ok", "voided": len(voided), "refunded": refunded, "unknown": unknown}
