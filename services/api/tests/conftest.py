import os

os.environ.setdefault("KATHA_ENV", "test")
os.environ.setdefault("KATHA_JWT_SECRET", "test-secret-test-secret-test-secret-1234")

# Point the application's own engine at the test database too.
#
# Most suites hand the app a session through the `get_session` override, but anything that reaches
# `SessionLocal` directly — a background task, a service that opens its own session, a handler the override
# does not reach — would otherwise answer from KATHA_DATABASE_URL, which on a developer's machine is their
# working database. That does not fail loudly: it quietly returns real rows, so a test sees an empty rail or
# a 404 for a series that plainly exists, and worse, a test that writes has just written to real data.
_TEST_DB = os.environ.get("KATHA_TEST_DATABASE_URL")
if _TEST_DB:
    os.environ["KATHA_DATABASE_URL"] = _TEST_DB

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def pytest_report_header(config):
    """Say up front when the database-backed suites are not going to run.

    Without KATHA_TEST_DATABASE_URL roughly a third of this suite skips, and pytest reports the run as
    passing. CI always sets it, so the green tick there means the whole suite; a local run without it means
    considerably less, and that difference should be visible before the dots start rather than inferred from
    a skip count afterwards.
    """
    if _TEST_DB:
        return f"database-backed tests: enabled ({_TEST_DB.rsplit('/', 1)[-1]})"
    return (
        "database-backed tests: SKIPPED — KATHA_TEST_DATABASE_URL is not set. "
        "A pass here does not cover the routers, the money paths or anything else that needs a database."
    )


def pytest_terminal_summary(terminalreporter):
    """Repeat the warning at the end, where `-q` cannot hide it.

    The header above is suppressed in quiet mode, which is how most runs are invoked, and the whole point of
    the warning is that it reaches someone who would otherwise read a green line as a full pass.
    """
    if not _TEST_DB:
        terminalreporter.write_sep(
            "!",
            "KATHA_TEST_DATABASE_URL not set - the database-backed tests did not run",
            red=True,
        )
