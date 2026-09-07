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
