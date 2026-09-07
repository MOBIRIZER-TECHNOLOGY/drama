"""Pure tests for tranche 1: offers, media verifier, events allow-list."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.services.media import sign_hls_url
from app.services.offers import apply_discount


def test_apply_discount_rounds_half_up():
    assert apply_discount(Decimal("99.00"), 30) == Decimal("69.30")
    assert apply_discount(Decimal("99.99"), 50) == Decimal("50.00")
    assert apply_discount(Decimal("99.00"), None) == Decimal("99.00")


async def test_media_verify_accepts_grant_and_rejects_forgery(client, monkeypatch):
    from app.core import config as cfg

    s = cfg.get_settings()
    monkeypatch.setattr(s, "cdn_signing_mode", "hmac")
    uid = uuid.uuid4()
    url = sign_hls_url("hls/abc/master.m3u8", user_id=uid, expires=datetime.now(UTC) + timedelta(minutes=5))
    query = url.split("?", 1)[1]
    ok = await client.get("/v1/media/verify", headers={"x-original-uri": f"/media/hls/abc/master.m3u8?{query}"})
    assert ok.status_code == 204
    seg = await client.get("/v1/media/verify", headers={"x-original-uri": f"/media/hls/abc/720p/seg_0001.m4s?{query}"})
    assert seg.status_code == 204
    bad = await client.get("/v1/media/verify", headers={"x-original-uri": f"/media/hls/other/master.m3u8?{query}"})
    assert bad.status_code == 403
    none = await client.get("/v1/media/verify", headers={"x-original-uri": "/media/hls/abc/master.m3u8"})
    assert none.status_code == 403


async def test_events_endpoint_rejects_unknown_names_silently(client):
    r = await client.post("/v1/events", json={"events": [{"name": "not_a_real_event", "props": {}}]})
    assert r.status_code == 200
