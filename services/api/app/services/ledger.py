"""The coin ledger. Every coin movement goes through `post()`; nothing else writes users.coin_balance.

Rules:
- Append-only rows with a unique idempotency key. Replaying the same key returns the original row.
- The user row is locked (SELECT ... FOR UPDATE) so concurrent spends serialise.
- A negative delta that would take the balance below zero raises InsufficientCoins.
- balance_after is stored on the row so history is auditable without re-summing.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InsufficientCoins, NotFound
from app.models.identity import User
from app.models.wallet import CoinLedger, LedgerKind


async def post(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    delta: int,
    kind: LedgerKind,
    idempotency_key: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
    note: str | None = None,
    variant_map: dict | None = None,
    created_by: str | None = None,
    allow_negative: bool = False,
) -> CoinLedger:
    existing = await session.scalar(select(CoinLedger).where(CoinLedger.idempotency_key == idempotency_key))
    if existing is not None:
        return existing

    user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise NotFound("User")

    new_balance = user.coin_balance + delta
    if new_balance < 0 and not allow_negative:
        raise InsufficientCoins(needed=-delta, balance=user.coin_balance)

    row = CoinLedger(
        user_id=user_id,
        delta=delta,
        balance_after=new_balance,
        kind=kind,
        ref_type=ref_type,
        ref_id=ref_id,
        idempotency_key=idempotency_key,
        note=note,
        variant_map=variant_map,
        created_by=created_by,
        created_at=datetime.now(UTC),
    )
    try:
        async with session.begin_nested():  # savepoint: a lost race must not roll back the caller's work
            user.coin_balance = new_balance
            session.add(row)
            await session.flush()
    except IntegrityError:
        await session.refresh(user)
        winner = await session.scalar(select(CoinLedger).where(CoinLedger.idempotency_key == idempotency_key))
        if winner is None:
            raise
        return winner
    return row


async def history(
    session: AsyncSession, user_id: uuid.UUID, *, limit: int = 50, before: datetime | None = None
) -> list[CoinLedger]:
    stmt = select(CoinLedger).where(CoinLedger.user_id == user_id)
    if before is not None:
        stmt = stmt.where(CoinLedger.created_at < before)
    stmt = stmt.order_by(CoinLedger.created_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())
