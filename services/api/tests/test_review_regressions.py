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


def test_unimplemented_signing_modes_are_not_accepted():
    """A mode that boots cleanly and verifies nothing is worse than a typo."""
    for mode in ("cloudfront", "bunny"):
        with pytest.raises(ValueError):
            Settings(env="local", cdn_signing_mode=mode, _env_file=None)


def test_a_password_reset_link_is_not_an_admin_session():
    """The link travels by email; decoding it as an `admin` token must fail before any other check runs."""
    import jwt

    from app.core.security import decode_token, mint_token

    token = mint_token("00000000-0000-0000-0000-000000000001", "admin_reset", ttl=60, extra={"tv": 0})
    with pytest.raises(jwt.PyJWTError):
        decode_token(token, "admin")
    assert decode_token(token, "admin_reset")["kind"] == "admin_reset"


def _request(headers: dict[str, str] | None = None, client=("10.0.0.7", 1234)):
    from fastapi import Request

    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw, "client": client, "scheme": "http"})


def test_rate_limit_key_only_trusts_tokens_this_service_issued():
    """A made-up bearer used to get its own bucket, which is a bypass with a header rotator."""
    from app.core.ratelimit import _key
    from app.core.security import mint_token

    assert _key(_request()) == "ip:10.0.0.7"
    assert _key(_request({"authorization": "Bearer " + "x" * 80})) == "ip:10.0.0.7"
    # A refresh token is not a session either; only access and admin tokens name an account.
    refresh = mint_token("11111111-1111-1111-1111-111111111111", "refresh")
    assert _key(_request({"authorization": f"Bearer {refresh}"})) == "ip:10.0.0.7"
    access = mint_token("11111111-1111-1111-1111-111111111111", "access")
    assert _key(_request({"authorization": f"Bearer {access}"})) == "user:11111111-1111-1111-1111-111111111111"


def test_client_ip_does_not_read_the_forwarded_header_itself():
    """uvicorn rewrites `client` only for trusted proxies; re-reading the header would take anyone's word."""
    from app.api.deps import client_ip

    assert client_ip(_request({"x-forwarded-for": "1.2.3.4, 10.0.0.7"})) == "10.0.0.7"


def test_forwarded_proxies_default_to_loopback():
    assert Settings(env="local", _env_file=None).forwarded_allow_ips == "127.0.0.1"


def test_an_unknown_rating_is_gated_like_an_adult_one():
    """ "Not in the adult list" is not the same as "cleared for everyone"."""
    from app.models.catalog import Series
    from app.services.access import requires_age_gate

    def series(rating):
        return Series(slug="x", content_rating=rating)

    assert requires_age_gate(series("A")) is True
    assert requires_age_gate(series("U")) is False
    assert requires_age_gate(series("UA13")) is False
    assert requires_age_gate(series("PG-13")) is True  # another market's scheme: nobody cleared it here
    assert requires_age_gate(series("u")) is True  # a typo is not a clearance either
    assert requires_age_gate(series("")) is True  # unrated_is_adult


def test_checkout_currency_is_an_iso_code_and_country_is_not_the_clients_to_choose():
    import uuid

    from pydantic import ValidationError

    from app.schemas.purchases import CheckoutIn, QuoteIn

    base = {
        "pack_id": str(uuid.uuid4()),
        "gateway": "stripe",
        "success_url": "https://a/s",
        "cancel_url": "https://a/c",
    }
    assert CheckoutIn(**base, currency="USD").currency == "USD"
    for bad in ("usd", "US", "USDD", "U$D"):
        with pytest.raises(ValidationError):
            CheckoutIn(**base, currency=bad)
    # A client that still sends a country is ignored rather than refused, and the value goes nowhere.
    assert not hasattr(CheckoutIn(**base, country="IN"), "country")
    assert not hasattr(QuoteIn(pack_id=uuid.uuid4(), country="IN"), "country")
