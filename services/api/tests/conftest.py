import os

os.environ.setdefault("KATHA_ENV", "test")
os.environ.setdefault("KATHA_JWT_SECRET", "test-secret-test-secret-test-secret-1234")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
