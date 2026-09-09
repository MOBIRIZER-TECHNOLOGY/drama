import contextlib
from collections.abc import AsyncIterator

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

log = structlog.get_logger()


class Base(DeclarativeBase):
    pass


_settings = get_settings()
engine = create_async_engine(_settings.database_url, pool_pre_ping=True, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


@contextlib.asynccontextmanager
async def best_effort(session: AsyncSession, where: str) -> AsyncIterator[None]:
    """Run queries that are allowed to fail without taking the request down.

    Recommendations, semantic search and anything else built on pgvector depend on an extension, a table and
    an operator that a given environment may not have. Catching the error is not enough on its own: Postgres
    marks the whole transaction aborted and refuses every later statement on it, so a swallowed failure here
    surfaces as `InFailedSQLTransactionError` from an unrelated query further down the handler — a 500 whose
    traceback points at the innocent statement and never mentions the real one.

    A SAVEPOINT is what makes the failure local. Rolling the whole transaction back would also clear the
    error, but it expires every object already loaded in this session, so the next attribute access lazily
    re-queries in a place with no handler for it.

    The block is for reads. Anything whose writes must survive belongs in the outer transaction, where a
    failure is supposed to fail the request.
    """
    try:
        async with session.begin_nested():
            yield
    except Exception:  # noqa: BLE001 - the point of the block: degrade, having contained the damage
        log.warning("query.degraded", where=where, exc_info=True)
