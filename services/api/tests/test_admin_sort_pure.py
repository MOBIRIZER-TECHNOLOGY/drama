"""The admin lists' sort parameters are a closed set, checked before any SQL is built.

A sort key that reached `getattr(Model, sort)` would order by whatever attribute the name happened to hit —
a relationship, a method, a column the console never shows — so the contract is a `Literal` and an unknown
key is a validation error. No database: validation fails before the handler runs, and auth is bypassed the
way `test_admin_endpoints_db.py` does it.
"""

from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.main import app
from app.models.identity import AdminRole


@pytest.fixture
async def owner_client():
    app.dependency_overrides[deps.current_admin] = lambda: SimpleNamespace(role=AdminRole.owner)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(deps.current_admin, None)


@pytest.mark.parametrize(
    "path",
    [
        "/v1/admin/series?sort=slug",
        "/v1/admin/series?sort=translations",
        "/v1/admin/series?sort=title&order=sideways",
        "/v1/admin/users?sort=email",
        "/v1/admin/users?sort=sessions",
        "/v1/admin/users?sort=created_at&order=up",
    ],
)
async def test_an_unknown_sort_key_or_order_is_a_422(owner_client, path):
    r = await owner_client.get(path)
    assert r.status_code == 422, f"{path} -> {r.status_code}: {r.text[:300]}"
    fields = {tuple(err["loc"]) for err in r.json()["detail"]}
    assert ("query", "sort") in fields or ("query", "order") in fields
