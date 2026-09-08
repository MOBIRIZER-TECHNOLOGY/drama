"""The rewarded-ad callback.

`AdEvent` and `consume_ad_event` were built and nothing ever wrote a row, so rewarded ads — the one earn
mechanic that costs no coins — could not run at all. This is the missing half: AdMob calls this URL after a
viewer finishes an ad, and only a correctly signed call creates the row a claim can spend.

The endpoint is unauthenticated by necessity (Google is the caller) and safe because the signature is the
authentication. Nothing here trusts a parameter it has not verified.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import select

from app.api.deps import DB
from app.models.identity import User
from app.models.wallet import AdEvent
from app.services import admob_ssv

router = APIRouter(prefix="/ads", tags=["ads"], include_in_schema=False)
log = structlog.get_logger()


@router.get("/admob/ssv")
async def admob_ssv_callback(
    request: Request,
    db: DB,
    signature: Annotated[str, Query(max_length=512)],
    key_id: Annotated[str, Query(max_length=64)],
    user_id: Annotated[str | None, Query(max_length=64)] = None,
    transaction_id: Annotated[str | None, Query(max_length=160)] = None,
    ad_unit: Annotated[str | None, Query(max_length=160)] = None,
    reward_amount: Annotated[int | None, Query(ge=0, le=100_000)] = None,
    custom_data: Annotated[str | None, Query(max_length=120)] = None,
    timestamp: Annotated[str | None, Query(max_length=32)] = None,
) -> Response:
    """Record a verified reward.

    Always answers 200: Google retries anything else, and a callback we have decided to refuse will never
    become acceptable on a retry. Refusals are logged instead, because a spike in them is the signal that
    someone is trying to mint coins.
    """
    query = request.url.query

    if not admob_ssv.is_fresh(timestamp):
        log.warning("admob.ssv_stale", transaction_id=transaction_id)
        return Response(status_code=200)

    if not await admob_ssv.verify(query, signature, key_id):
        log.warning("admob.ssv_invalid", transaction_id=transaction_id, key_id=key_id)
        return Response(status_code=200)

    if not transaction_id or not user_id:
        log.warning("admob.ssv_incomplete", transaction_id=transaction_id)
        return Response(status_code=200)

    try:
        subject = uuid.UUID(user_id)
    except ValueError:
        log.warning("admob.ssv_bad_user", user_id=user_id)
        return Response(status_code=200)

    if not await db.scalar(select(User.id).where(User.id == subject)):
        log.warning("admob.ssv_unknown_user", user_id=user_id)
        return Response(status_code=200)

    # Google retries on any non-200, and a network hiccup means the same completion can arrive twice. The
    # transaction id is unique, so a repeat is a no-op rather than a second reward.
    if await db.scalar(select(AdEvent.id).where(AdEvent.ssv_transaction_id == transaction_id)):
        return Response(status_code=200)

    # `custom_data` is ours: the client sets it to say what the ad was for. Anything else is treated as an
    # unlock, which is the conservative reading — a task claim additionally checks the task exists.
    purpose, _, ref = (custom_data or "unlock").partition(":")
    db.add(
        AdEvent(
            user_id=subject,
            network="admob",
            ssv_transaction_id=transaction_id,
            ad_unit_id=ad_unit,
            purpose=purpose if purpose in {"unlock", "task"} else "unlock",
            ref_id=ref or None,
            reward_coins=reward_amount,
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    return Response(status_code=200)
