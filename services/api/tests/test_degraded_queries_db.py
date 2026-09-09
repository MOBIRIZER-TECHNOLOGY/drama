"""What happens to a request when an optional query fails.

Recommendations and semantic search sit on pgvector: an extension, a table and a distance operator that a
given database may simply not have — a managed Postgres with the extension not enabled, an environment that
has not run the vector migration, a replica built without it. The code already expected those queries to fail
and caught the error.

Catching it was not enough, and the way it failed is the point of these tests. Postgres marks the whole
transaction aborted once a statement in it errors, and refuses every later statement on that transaction. So
a swallowed failure in the "For You" rail came back as `InFailedSQLTransactionError` from the *category*
query further down the same handler, and the home page returned 500 — for every signed-in viewer who had
watched anything, on any deployment without the embeddings table. The traceback pointed at the innocent
query and never mentioned the real one.

`best_effort` contains the failure in a SAVEPOINT, which is what makes it local. A full rollback would also
clear the error, but it expires every object already loaded in the session, so the next attribute access
lazily re-queries somewhere with no handler for it.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import best_effort
from app.models.identity import User

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


@pytest.fixture
async def session():
    engine = create_async_engine(DB_URL, poolclass=None)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_the_session_survives_a_failed_optional_query(session):
    """The regression: a later query on the same transaction still works."""
    async with best_effort(session, "test"):
        await session.execute(text("SELECT * FROM a_table_that_does_not_exist"))

    # Without the savepoint this raises InFailedSQLTransactionError, which is what the 500 was.
    rows = await session.scalars(select(User).limit(1))
    assert rows.all() is not None


async def test_a_failure_does_not_expire_objects_already_loaded(session):
    """Why a SAVEPOINT and not `rollback()`.

    Rolling the transaction back clears the error too, but expires every loaded object; the next attribute
    read then goes back to the database, in a place written on the assumption that it would not.
    """
    user = await session.scalar(select(User).limit(1))
    if user is None:
        pytest.skip("no users seeded in the test database")
    loaded_id = user.id

    async with best_effort(session, "test"):
        await session.execute(text("SELECT * FROM a_table_that_does_not_exist"))

    # No I/O, no DetachedInstanceError: the object is still usable.
    assert user.id == loaded_id


async def test_a_successful_block_commits_its_work(session):
    """The block must not quietly discard the queries that did succeed."""
    async with best_effort(session, "test"):
        value = await session.scalar(text("SELECT 42"))
    assert value == 42


async def test_the_block_swallows_rather_than_raises(session):
    """Call sites keep their fallback value; nothing above them has to handle the error."""
    ran_after = False
    async with best_effort(session, "test"):
        await session.execute(text("SELECT * FROM a_table_that_does_not_exist"))
    ran_after = True
    assert ran_after
