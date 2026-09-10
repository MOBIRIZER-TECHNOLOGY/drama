"""Database-backed tests. Skipped unless KATHA_TEST_DATABASE_URL points at a Postgres with the schema applied.

CI provides one (see .github/workflows/ci.yml). Locally: docker compose up, then
  KATHA_TEST_DATABASE_URL=postgresql+asyncpg://katha:katha@localhost:5432/katha_test uv run pytest
"""

import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import Conflict, InsufficientCoins
from app.models.catalog import Episode, PublishStatus, Series, SeriesTranslation
from app.models.identity import User
from app.models.wallet import LedgerKind, UnlockMethod
from app.services import access, ledger

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


@pytest.fixture
async def session():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()
    await engine.dispose()


async def _user(session, coins=0) -> User:
    u = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper(), coin_balance=0)
    session.add(u)
    await session.flush()
    if coins:
        await ledger.post(
            session, user_id=u.id, delta=coins, kind=LedgerKind.admin_adjust, idempotency_key=f"seed:{u.id}"
        )
    return u


async def _series(session, free=1, price=20, episodes=3, rating="U") -> tuple[Series, dict[int, Episode]]:
    """A published series and its episodes by number.

    The rating is set explicitly because an unrated series counts as adult, so leaving it off would put every
    test behind the age gate rather than exercising what it is named for.

    Episodes are returned rather than reached through `series.episodes`: that relationship is lazy, and touching
    it outside a greenlet context raises MissingGreenlet under the async driver.
    """
    s = Series(
        slug=f"s-{uuid.uuid4().hex[:8]}",
        free_episodes=free,
        episode_price=price,
        status=PublishStatus.published,
        content_rating=rating,
    )
    session.add(s)
    await session.flush()
    session.add(SeriesTranslation(series_id=s.id, lang="en", title="Test"))
    eps = {
        n: Episode(series_id=s.id, number=n, status=PublishStatus.published, published_at=datetime.now(UTC))
        for n in range(1, episodes + 1)
    }
    session.add_all(list(eps.values()))
    await session.flush()
    return s, eps


async def test_ledger_is_idempotent_and_blocks_overdraft(session):
    u = await _user(session)
    a = await ledger.post(session, user_id=u.id, delta=50, kind=LedgerKind.signup_bonus, idempotency_key=f"k:{u.id}")
    b = await ledger.post(session, user_id=u.id, delta=50, kind=LedgerKind.signup_bonus, idempotency_key=f"k:{u.id}")
    assert a.id == b.id
    assert (await session.get(User, u.id)).coin_balance == 50
    with pytest.raises(InsufficientCoins):
        await ledger.post(session, user_id=u.id, delta=-60, kind=LedgerKind.unlock, idempotency_key=f"x:{u.id}")


async def test_unlock_is_sequential_and_charges_once(session):
    u = await _user(session, coins=100)
    _, eps = await _series(session, free=1, price=20)
    with pytest.raises(Conflict):
        await access.unlock_episode(session, user=u, episode_id=eps[3].id, method=UnlockMethod.coins)
    first = await access.unlock_episode(session, user=u, episode_id=eps[2].id, method=UnlockMethod.coins)
    again = await access.unlock_episode(session, user=u, episode_id=eps[2].id, method=UnlockMethod.coins)
    assert first.id == again.id
    assert (await session.get(User, u.id)).coin_balance == 80
    with pytest.raises(Conflict):
        await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.coins)


async def test_the_balance_moves_in_the_database_not_from_a_stale_copy(session):
    """Two spends in one session used to start from the balance the request authenticated with.

    The user object a handler holds was loaded before any ledger call; computing the new balance from it and
    writing the sum back meant a balance that had moved behind it was silently overwritten. The move is now
    one atomic UPDATE, and the loaded object is told what the database returned so the response is right too.
    """
    from sqlalchemy import select, update

    u = await _user(session, coins=100)
    assert u.coin_balance == 100
    # Another writer moves the balance behind the object this "request" holds, which is now stale.
    await session.execute(
        update(User).where(User.id == u.id).values(coin_balance=50),
        execution_options={"synchronize_session": False},
    )
    assert u.coin_balance == 100

    row = await ledger.post(session, user_id=u.id, delta=-20, kind=LedgerKind.unlock, idempotency_key=f"s:{u.id}")
    assert row.balance_after == 30, "computed from the database's 50, not the object's 100"
    assert await session.scalar(select(User.coin_balance).where(User.id == u.id)) == 30
    assert u.coin_balance == 30, "the in-session object reflects what the database returned"

    # The overdraft guard is checked against the database's balance at the moment of the write, and refusing
    # leaves nothing behind: the next post still sees 30.
    with pytest.raises(InsufficientCoins):
        await ledger.post(session, user_id=u.id, delta=-31, kind=LedgerKind.unlock, idempotency_key=f"o:{u.id}")
    assert u.coin_balance == 30
    ok = await ledger.post(session, user_id=u.id, delta=-30, kind=LedgerKind.unlock, idempotency_key=f"z:{u.id}")
    assert ok.balance_after == 0 and u.coin_balance == 0


async def test_posting_to_a_missing_user_is_not_found_not_insufficient(session):
    from app.core.errors import NotFound

    with pytest.raises(NotFound):
        await ledger.post(session, user_id=uuid.uuid4(), delta=-1, kind=LedgerKind.unlock, idempotency_key="nobody")
    with pytest.raises(NotFound):
        await ledger.post(
            session, user_id=uuid.uuid4(), delta=1, kind=LedgerKind.admin_adjust, idempotency_key="nobody2"
        )
