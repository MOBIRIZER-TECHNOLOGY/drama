"""Tests that need no database: app wiring, token helpers, signing, and the OpenAPI document."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.security import decode_token, hash_password, mint_token, verify_password
from app.services.media import sign_hls_url, verify_hls_signature


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_openapi_lists_core_routes(client):
    r = await client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    for p in [
        "/v1/auth/exchange",
        "/v1/config",
        "/v1/home",
        "/v1/series/{id_or_slug}",
        "/v1/episodes/{episode_id}/unlock",
        "/v1/episodes/{episode_id}/play",
        "/v1/wallet/packs",
    ]:
        assert p in paths, p


async def test_protected_routes_require_bearer(client):
    for path in ["/v1/auth/me", "/v1/wallet", "/v1/wallet/ledger"]:
        r = await client.get(path)
        assert r.status_code == 401, path


def test_token_roundtrip_and_kind_check():
    token = mint_token("user-1", "access", session_id="sid-1")
    payload = decode_token(token, "access")
    assert payload["sub"] == "user-1" and payload["sid"] == "sid-1"
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, "refresh")


def test_password_hashing():
    h = hash_password("correct horse")
    assert verify_password("correct horse", h)
    assert not verify_password("wrong", h)


def test_hls_signature_binds_user_and_expiry():
    uid = uuid.uuid4()
    exp = datetime.now(UTC) + timedelta(minutes=5)
    url = sign_hls_url("hls/abc/master.m3u8", user_id=uid, expires=exp)
    assert "/hls/abc/master.m3u8?" in url
    query = dict(part.split("=") for part in url.split("?")[1].split("&"))
    assert verify_hls_signature("/hls/abc/master.m3u8", int(query["exp"]), str(uid), query["sig"])
    assert not verify_hls_signature("/hls/abc/master.m3u8", int(query["exp"]), str(uuid.uuid4()), query["sig"])
