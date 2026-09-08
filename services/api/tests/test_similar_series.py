"""The "more like this" strip must never be able to take the series page down with it.

Found on a device: the app showed an empty catalogue because `GET /v1/series/{id}` was answering 500. The
cause was `relation "embeddings" does not exist` — an environment without the pgvector migration — raised from
the recommendation query and propagated straight out of the handler. Everything the page is actually for (the
synopsis, the episode list, the play button) died for the sake of a strip at the bottom.

pgvector may be absent, the table may be missing, the distance operator may be unregistered. All of those
arrive as a database error rather than an empty result, so the guard is on the exception, not on a lookup.

The second test here is the one worth keeping honest. The first fix rolled the whole transaction back, which
works for the connection and ruins the session: SQLAlchemy expires every loaded object on rollback, so reading
`series.categories` for the fallback re-queried a detached instance and failed again, one frame further out.
A savepoint keeps the failure local and the loaded objects intact.
"""

import uuid

import pytest
from sqlalchemy.exc import ProgrammingError

from app.api.routers import catalog


def _db_error() -> ProgrammingError:
    return ProgrammingError("SELECT embeddings", {}, Exception('relation "embeddings" does not exist'))


class _Series:
    """Just enough of a Series for the function under test."""

    def __init__(self, categories=None):
        self.id = uuid.uuid4()
        self.categories = categories or []


class _Savepoint:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        self._session.savepoints += 1
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self._session.savepoints_rolled_back += 1
        return False


class _Session:
    """A session that records how the failure was contained."""

    def __init__(self, *, fail: bool):
        self._fail = fail
        self.savepoints = 0
        self.savepoints_rolled_back = 0
        self.rolled_back = False

    def begin_nested(self):
        return _Savepoint(self)

    async def scalar(self, *_args, **_kwargs):
        if self._fail:
            raise _db_error()
        return None

    async def rollback(self):
        self.rolled_back = True


@pytest.mark.asyncio
async def test_a_missing_embeddings_table_yields_no_neighbours_instead_of_raising():
    assert await catalog._embedding_neighbours(_Session(fail=True), _Series(), limit=8) == []


@pytest.mark.asyncio
async def test_the_query_is_contained_in_a_savepoint_not_a_transaction_rollback():
    """A full rollback expires every loaded object, and the caller still needs `series.categories`."""
    db = _Session(fail=True)
    await catalog._embedding_neighbours(db, _Series(), limit=8)
    assert db.savepoints == 1
    assert db.savepoints_rolled_back == 1
    assert db.rolled_back is False


@pytest.mark.asyncio
async def test_a_series_without_an_embedding_is_not_an_error():
    db = _Session(fail=False)
    assert await catalog._embedding_neighbours(db, _Series(), limit=8) == []
    assert db.rolled_back is False


@pytest.mark.asyncio
async def test_the_series_id_is_read_before_the_failure_is_handled():
    """Reading it afterwards is what re-triggered the load that had just failed."""

    class _Exploding(_Series):
        def __init__(self):
            super().__init__()
            self._id = uuid.uuid4()
            self.reads = 0

        @property
        def id(self):
            self.reads += 1
            if self.reads > 1:
                raise AssertionError("series.id was read again while handling the failure")
            return self._id

        @id.setter
        def id(self, value):
            self._id = value

    assert await catalog._embedding_neighbours(_Session(fail=True), _Exploding(), limit=8) == []


@pytest.mark.asyncio
async def test_similar_series_falls_through_to_categories_when_vectors_are_gone():
    """The whole point of swallowing the error: the caller still gets the fallback it was written to use."""
    series = _Series()  # no categories, so the fallback returns [] without touching the database
    assert await catalog._similar_series(_Session(fail=True), series, limit=8) == []
