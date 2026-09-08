"""Encrypted HLS: key derivation, key delivery, and what the manifests are rewritten into.

Signed URLs decide who may start a stream and nothing after that; the segments behind them used to be plain
`.ts` files. AES-128 closes that, and the parts worth pinning are the ones that fail quietly:

  - the key must be reachable only with a signature that names this asset, or the paywall is decorative
  - the rewritten EXT-X-KEY line must keep its IV. Rebuilding the line from scratch drops it, the player then
    falls back to the media sequence number, and every segment decrypts to noise. That happened once here.
  - segments must point at the public edge, not the origin the API reads from
  - a playlist with no EXT-X-KEY must be refused rather than served, because serving it hands out the episode
    in the clear through a route that claims to be encrypted

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.routers import stream
from app.core.db import get_session
from app.main import app
from app.models.catalog import AssetStatus, VideoAsset
from app.services.media import content_iv, content_key, sign_path

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

VIEWER = uuid.UUID("11111111-1111-1111-1111-111111111111")

MASTER = """#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1080x1920
1080p/index.m3u8
"""

VARIANT = """#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="katha:key",IV=0xDEADBEEF00000000000000000000CAFE
#EXTINF:4.000000,
seg_0000.ts
#EXT-X-ENDLIST
"""

UNENCRYPTED_VARIANT = """#EXTM3U
#EXTINF:4.000000,
seg_0000.ts
#EXT-X-ENDLIST
"""


@pytest.fixture
async def asset():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        row = VideoAsset(
            source_key="uploads/test.mp4",
            status=AssetStatus.ready,
            hls_master_key=f"library/test-{uuid.uuid4().hex[:8]}/hls/S01E01/master.m3u8",
            is_encrypted=True,
        )
        s.add(row)
        await s.commit()
        yield row
    await engine.dispose()


@pytest.fixture
async def client(asset):
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def _signed(path: str, minutes: int = 30) -> str:
    return sign_path(path, user_id=VIEWER, expires=datetime.now(UTC) + timedelta(minutes=minutes))


# ---- key derivation --------------------------------------------------------


def test_a_key_is_sixteen_bytes_and_stable_for_an_asset():
    a = uuid.uuid4()
    assert len(content_key(a)) == 16
    assert content_key(a) == content_key(a)


def test_two_assets_never_share_a_key_or_an_iv():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert content_key(a) != content_key(b)
    assert content_iv(a) != content_iv(b)


def test_the_iv_is_not_the_key():
    """Derived from the same secret, so a shared label would have made them identical."""
    a = uuid.uuid4()
    assert content_iv(a) != content_key(a)


# ---- key delivery ----------------------------------------------------------


async def test_the_key_needs_a_signature_naming_this_asset(client, asset):
    path = f"/v1/stream/{asset.id}/key"
    res = await client.get(f"{path}?{_signed(path)}")
    assert res.status_code == 200
    assert res.content == content_key(asset.id)
    # A key is a secret and a manifest is per-viewer; neither may sit in a shared cache.
    assert "no-store" in res.headers["cache-control"]


async def test_a_tampered_signature_is_refused(client, asset):
    path = f"/v1/stream/{asset.id}/key"
    query = _signed(path).replace("sig=", "sig=x")
    assert (await client.get(f"{path}?{query}")).status_code == 403


async def test_a_signature_for_one_asset_does_not_open_another(client, asset):
    """The path is inside the signed message, which is what stops a free episode's key URL being edited."""
    other = uuid.uuid4()
    query = _signed(f"/v1/stream/{other}/key")
    assert (await client.get(f"/v1/stream/{asset.id}/key?{query}")).status_code == 403


async def test_an_expired_signature_is_refused(client, asset):
    path = f"/v1/stream/{asset.id}/key"
    assert (await client.get(f"{path}?{_signed(path, minutes=-5)}")).status_code == 403


# ---- manifest rewriting ----------------------------------------------------


async def test_the_master_points_variants_back_here_signed(client, asset, monkeypatch):
    async def fake_fetch(_url: str) -> str:
        return MASTER

    monkeypatch.setattr(stream, "_fetch", fake_fetch)
    path = f"/v1/stream/{asset.id}/master.m3u8"
    res = await client.get(f"{path}?{_signed(path)}")
    assert res.status_code == 200
    body = res.text
    assert f"/v1/stream/{asset.id}/v/1080p/index.m3u8?" in body
    assert "sig=" in body
    # The stream-inf line describes the rendition and must survive untouched.
    assert "#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1080x1920" in body


async def test_the_rewritten_key_line_keeps_its_iv(client, asset, monkeypatch):
    """The bug this test exists for: dropping IV makes every segment decrypt to noise."""

    async def fake_fetch(_url: str) -> str:
        return VARIANT

    monkeypatch.setattr(stream, "_fetch", fake_fetch)
    path = f"/v1/stream/{asset.id}/v/1080p/index.m3u8"
    res = await client.get(f"{path}?{_signed(path)}")
    assert res.status_code == 200
    body = res.text
    assert "IV=0xDEADBEEF00000000000000000000CAFE" in body
    assert "METHOD=AES-128" in body
    assert 'URI="katha:key"' not in body
    assert f"/v1/stream/{asset.id}/key?" in body


async def test_segments_point_at_the_edge_not_the_origin(client, asset, monkeypatch):
    async def fake_fetch(_url: str) -> str:
        return VARIANT

    monkeypatch.setattr(stream, "_fetch", fake_fetch)
    path = f"/v1/stream/{asset.id}/v/1080p/index.m3u8"
    body = (await client.get(f"{path}?{_signed(path)}")).text
    segment = next(line for line in body.splitlines() if "seg_0000.ts" in line)
    assert segment.startswith("http")
    assert "1080p/seg_0000.ts?" in segment and "sig=" in segment


async def test_an_unencrypted_playlist_is_refused_rather_than_served(client, asset, monkeypatch):
    """Serving it would hand out the episode in the clear through a route that promises encryption."""

    async def fake_fetch(_url: str) -> str:
        return UNENCRYPTED_VARIANT

    monkeypatch.setattr(stream, "_fetch", fake_fetch)
    path = f"/v1/stream/{asset.id}/v/1080p/index.m3u8"
    assert (await client.get(f"{path}?{_signed(path)}")).status_code == 404


async def test_a_variant_name_that_is_not_a_rendition_is_refused(client, asset):
    """This value becomes part of a URL fetched from storage, so it is matched, not sanitised."""
    path = f"/v1/stream/{asset.id}/v/..%2F..%2Fetc/index.m3u8"
    assert (await client.get(f"{path}?{_signed(path)}")).status_code == 404
