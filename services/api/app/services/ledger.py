"""The coin ledger. Every coin movement goes through `post()`; nothing else writes users.coin_balance.

Rules:
- Append-only rows with a unique idempotency key. Replaying the same key returns the original row.
- The balance moves in one atomic `UPDATE … SET coin_balance = coin_balance + delta`, so concurrent spends
  serialise on the row lock and no caller ever computes a balance from a value it read earlier. The previous
  shape read the user, added in Python and wrote the sum back — and the user it read was usually the copy the
  request had already loaded to authenticate, so a second spend in the same session started from a balance
  that was stale before the first one had finished.
- A negative delta that would take the balance below zero raises InsufficientCoins; the guard is in the WHERE
  clause, so it is checked against the balance at the moment of the write and nothing earlier.
- balance_after is stored on the row so history is auditable without re-summing.
- The in-session User, when one is loaded, is updated from what the database returned, so a caller that reads
  `ctx.user.coin_balance` after posting sees the real number rather than the one it authenticated with.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.orm.util import identity_key

from app.core.errors import InsufficientCoins, NotFound
from app.models.identity import User
from app.models.wallet import CoinLedger, LedgerKind


async def _apply_delta(session: AsyncSession, user_id: uuid.UUID, delta: int, *, allow_negative: bool) -> int:
    """Move the balance in the database and return the new value.

    No row comes back in two cases — the user does not exist, or the guard refused an overdraft — and the
    caller deserves a different answer for each, so the miss is followed by a locked read to tell them apart.
    `populate_existing` makes that read refresh any copy of the user already in the session, so the error it
    raises quotes the balance the database refused on, not the one the request arrived with.
    """
    stmt = update(User).where(User.id == user_id)
    if not allow_negative:
        stmt = stmt.where(User.coin_balance + delta >= 0)
    stmt = stmt.values(coin_balance=User.coin_balance + delta).returning(User.coin_balance)
    new_balance = (await session.execute(stmt, execution_options={"synchronize_session": False})).scalar_one_or_none()
    if new_balance is not None:
        return int(new_balance)
    user = await session.scalar(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )
    if user is None:
        raise NotFound("User")
    raise InsufficientCoins(needed=-delta, balance=user.coin_balance)


def _sync_loaded_user(session: AsyncSession, user_id: uuid.UUID, balance: int) -> None:
    """Reflect the new balance on the session's copy of the user without marking it dirty.

    The dependency layer loads the user to authenticate the request, and handlers return that same object.
    Setting the attribute normally would queue a second UPDATE writing a value the database already holds;
    `set_committed_value` records it as what the database has, which is exactly the truth.
    """
    user = session.sync_session.identity_map.get(identity_key(User, user_id))
    if user is not None:
        set_committed_value(user, "coin_balance", balance)


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

    row = CoinLedger(
        user_id=user_id,
        delta=delta,
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
            new_balance = await _apply_delta(session, user_id, delta, allow_negative=allow_negative)
            row.balance_after = new_balance
            session.add(row)
            await session.flush()
    except IntegrityError:
        # The savepoint undid the balance move, so the session's copy of the user is still accurate.
        winner = await session.scalar(select(CoinLedger).where(CoinLedger.idempotency_key == idempotency_key))
        if winner is None:
            raise
        return winner
    _sync_loaded_user(session, user_id, new_balance)
    return row


async def history(
    session: AsyncSession, user_id: uuid.UUID, *, limit: int = 50, before: datetime | None = None
) -> list[CoinLedger]:
    stmt = select(CoinLedger).where(CoinLedger.user_id == user_id)
    if before is not None:
        stmt = stmt.where(CoinLedger.created_at < before)
    stmt = stmt.order_by(CoinLedger.created_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())
