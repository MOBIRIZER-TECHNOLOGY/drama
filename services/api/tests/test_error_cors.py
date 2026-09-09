"""A server error must reach the browser as a server error.

Starlette answers unhandled exceptions in `ServerErrorMiddleware`, which wraps every other middleware — CORS
included. The 500 it produces therefore carries no `Access-Control-Allow-Origin`, and a browser does not
report it as a 500: it reports a CORS failure, with no status and no body, naming a missing header. The
front-end then has a message pointing at API configuration while the actual fault is a bug in a handler,
invisible from the client and findable only in the server log.

That is not hypothetical here — a 500 on `/v1/home` presented in exactly that shape, and the CORS message is
what it looked like from the browser for as long as it took to go and read the server's own logs.

`install_error_boundary` catches one layer inside CORS so the error travels back out as an ordinary
response. These tests pin both halves: the status and body the client gets, and the header that lets it read
them.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

ORIGIN = "http://localhost:3000"


@pytest.fixture
def app_that_raises(monkeypatch) -> FastAPI:
    """The real app, plus one route that raises. Building the app for real is the point: the ordering of the
    middleware is what is under test, and a hand-rolled stack would not exercise it."""
    monkeypatch.setenv("KATHA_CORS_ORIGINS", f'["{ORIGIN}"]')
    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.main import create_app

    app = create_app()

    @app.get("/v1/_boom")
    async def boom() -> dict:
        raise RuntimeError("something failed deep in a handler")

    return app


async def test_an_unhandled_error_answers_with_cors_headers(app_that_raises):
    async with AsyncClient(transport=ASGITransport(app=app_that_raises), base_url="http://test") as c:
        res = await c.get("/v1/_boom", headers={"Origin": ORIGIN})

    assert res.status_code == 500
    # The header the browser needs before it will let the page read the response at all.
    assert res.headers.get("access-control-allow-origin") == ORIGIN


async def test_the_error_body_carries_a_request_id_to_quote(app_that_raises):
    """Without this the client has a 500 and no way to point support at the right log line."""
    async with AsyncClient(transport=ASGITransport(app=app_that_raises), base_url="http://test") as c:
        res = await c.get("/v1/_boom", headers={"Origin": ORIGIN})

    detail = res.json()["detail"]
    assert detail["code"] == "internal_error"
    assert detail["request_id"]
    # The message stays generic: an exception string can carry a query, a path or a token.
    assert "something failed deep in a handler" not in res.text


async def test_a_normal_response_is_unaffected(app_that_raises):
    async with AsyncClient(transport=ASGITransport(app=app_that_raises), base_url="http://test") as c:
        res = await c.get("/health", headers={"Origin": ORIGIN})

    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == ORIGIN
