"""The rewarded-ad callback.

`AdEvent` and `consume_ad_event` were built and nothing ever wrote a row, so rewarded ads — the one earn
mechanic that costs no coins — could not run at all. This is the missing half: AdMob calls this URL after a
viewer finishes an ad, and only a correctly signed call creates the row a claim can spend.

The endpoint is unauthenticated by necessity (Google is the caller) and safe because the signature is the
authentication. Nothing here trusts a parameter it has not verified: every value is read from the signed
prefix of the query string (`admob_ssv.signed_params`), never from the framework's parse of the whole URL,
and the ad unit has to be one an operator configured, so a genuine callback for some other app's unit — signed
by Google all the same — cannot mint coins here.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import select

from app.api.deps import DB
from app.models.identity import User
from app.models.ops import AdPlacement
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
) -> Response:
    """Record a verified reward.

    Always answers 200: Google retries anything else, and a callback we have decided to refuse will never
    become acceptable on a retry. Refusals are logged instead, because a spike in them is the signal that
    someone is trying to mint coins.

    Only `signature` and `key_id` are taken from the framework's parse. Everything else comes from the signed
    prefix, so a value the signature does not cover is never read at all.
    """
    query = request.url.query

    params = admob_ssv.signed_params(query)
    if params is None:
        log.warning("admob.ssv_malformed", key_id=key_id)
        return Response(status_code=200)
    transaction_id = _bounded(params.get("transaction_id"), 160)
    user_id = _bounded(params.get("user_id"), 64)
    ad_unit = _bounded(params.get("ad_unit"), 160)
    custom_data = _bounded(params.get("custom_data"), 120)

    if not admob_ssv.is_fresh(_bounded(params.get("timestamp"), 32)):
        log.warning("admob.ssv_stale", transaction_id=transaction_id)
        return Response(status_code=200)

    if not await admob_ssv.verify(query, signature, key_id):
        log.warning("admob.ssv_invalid", transaction_id=transaction_id, key_id=key_id)
        return Response(status_code=200)

    if not transaction_id or not user_id:
        log.warning("admob.ssv_incomplete", transaction_id=transaction_id)
        return Response(status_code=200)

    reward_amount = _reward_amount(params.get("reward_amount"))
    if reward_amount is None and params.get("reward_amount") is not None:
        log.warning("admob.ssv_bad_reward", transaction_id=transaction_id, value=params.get("reward_amount"))
        return Response(status_code=200)

    # The unit has to be one an operator configured for this app. Google signs callbacks for every app that
    # uses SSV, so a genuine signature alone only proves someone watched an ad somewhere.
    if not ad_unit or not await _is_configured_unit(db, ad_unit):
        log.warning("admob.ssv_unknown_unit", transaction_id=transaction_id, ad_unit=ad_unit)
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


def _bounded(value: str | None, limit: int) -> str | None:
    """A signed value, or None when it is absent or longer than the column that would store it."""
    if value is None or len(value) > limit:
        return None
    return value


def _reward_amount(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        amount = int(value)
    except ValueError:
        return None
    return amount if 0 <= amount <= 100_000 else None


async def _is_configured_unit(db, ad_unit: str) -> bool:
    """Whether an active AdMob placement names this unit.

    AdMob reports the unit's numeric id in the callback, while operators enter the full `ca-app-pub-…/…`
    form the SDK wants, so both spellings are accepted. The active set is a handful of rows, read in full.
    """
    rows = await db.scalars(
        select(AdPlacement.unit_id).where(AdPlacement.provider == "admob", AdPlacement.is_active.is_(True))
    )
    return any(unit == ad_unit or unit.rsplit("/", 1)[-1] == ad_unit for unit in rows.all())
