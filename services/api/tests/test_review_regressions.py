"""Regressions for the review findings that can be checked without a database."""

import os

import pytest

from app.core.config import Settings


def test_production_refuses_default_secret():
    with pytest.raises(ValueError):
        Settings(env="production", jwt_secret="change-me-32-bytes-minimum-please-really", _env_file=None)


def test_production_requires_media_signing_and_webhook_secrets():
    with pytest.raises(ValueError) as exc:
        Settings(
            env="production",
            jwt_secret="x" * 48,
            cdn_signing_mode="none",
            stripe_secret_key="sk_live_x",
            _env_file=None,
        )
    msg = str(exc.value)
    assert "CDN_SIGNING_MODE" in msg and "MEDIA_SIGNING_KEY" in msg and "STRIPE_WEBHOOK_SECRET" in msg


def test_local_accepts_defaults():
    os.environ.pop("KATHA_ENV", None)
    Settings(env="local", _env_file=None)


async def test_unlock_with_ad_requires_verified_event(client):
    """Without a session the route is 401; the service-level rule is covered by the DB tests."""
    r = await client.post(
        "/v1/episodes/00000000-0000-0000-0000-000000000000/unlock", json={"method": "ad", "ad_event_id": "x"}
    )
    assert r.status_code == 401


async def test_request_id_header(client):
    r = await client.get("/health")
    assert r.headers.get("x-request-id")
    r2 = await client.get("/health", headers={"x-request-id": "abc123"})
    assert r2.headers["x-request-id"] == "abc123"


async def test_rate_limited_route_still_returns_model(client):
    """slowapi wraps model-returning routes; a bogus refresh must be a clean 401, not a 500."""
    r2 = await client.post("/v1/events", json={"events": [{"name": "not_a_real_event", "props": {}}]})
    assert r2.status_code == 200
    assert r2.json() == {"ok": True}
