"""Encrypted HLS: manifests from here, segments from the CDN, keys only to whoever paid.

A signed CDN URL decides who may *start* a stream and nothing after that. The bytes it points at are plain
`.ts` files, so an unexpired URL — or anything sitting between the CDN and the player — is the episode. For a
catalogue where episode three costs coins, that is the product itself lying in the open.

AES-128 fixes that, and it needs somewhere to hand out keys. The player asks for the key itself, over plain
HTTP, carrying no session header of its own, so the authorisation has to be in the URL. That is why the
manifests are served here rather than from the CDN: a static manifest can only carry a static key URL, and a
static key URL is one anybody can replay. Rewriting the manifest per request is what lets the key URL be
minted for one viewer and expire.

Only manifests pass through this service. They are a few kilobytes of text; the segments they point at stay on
the CDN with their own signatures, so `The API never streams bytes` still holds.

The three routes mirror the three things a player fetches:

    /v1/stream/{asset}/master.m3u8      the variant list, rewritten to point back here
    /v1/stream/{asset}/v/{variant}/index.m3u8   the segment list, with the key line injected
    /v1/stream/{asset}/key              sixteen bytes, and only with a valid signature

None of them require a session. The signature is the capability, minted by `POST /v1/episodes/{id}/play` only
after that endpoint has checked the viewer may watch. It covers the path, which is what stops a key URL for a
free episode being edited into one for a paid episode.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
import structlog
from fastapi import APIRouter, Query, Response

from app.api.deps import DB
from app.core.config import get_settings
from app.core.errors import Forbidden, NotFound
from app.models.catalog import AssetStatus, VideoAsset
from app.services.media import content_key, sign_path, verify_hls_signature

log = structlog.get_logger()
router = APIRouter(prefix="/stream", tags=["stream"])

# Variant directory names as the packager writes them: "1080p", "720p". Anything else is refused rather than
# sanitised, because this value becomes part of a URL fetched from storage.
VARIANT_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
# The URI attribute of an EXT-X-KEY line, which is the only part this service replaces.
URI_RE = re.compile(r'URI="[^"]*"')

PLAYLIST_MEDIA_TYPE = "application/vnd.apple.mpegurl"
# Long enough for a viewer to finish an episode without a mid-stream 403, short enough that a leaked manifest
# URL is not a permanent grant.
LINK_TTL = timedelta(hours=2)
FETCH_TIMEOUT = 10.0


def _authorise(path: str, exp: int, uid: str, sig: str) -> uuid.UUID:
    """Check the signature and its expiry, and return the viewer it was minted for."""
    if exp < int(datetime.now(UTC).timestamp()):
        raise Forbidden("This playback link has expired")
    if not verify_hls_signature(path, exp, uid, sig):
        raise Forbidden("This playback link is not valid")
    try:
        return uuid.UUID(uid)
    except ValueError as exc:
        raise Forbidden("This playback link is not valid") from exc


async def _asset(db: DB, asset_id: uuid.UUID) -> VideoAsset:
    asset = await db.get(VideoAsset, asset_id)
    if asset is None or asset.status != AssetStatus.ready or not asset.hls_master_key:
        raise NotFound("Video")
    return asset


def _asset_dir(asset: VideoAsset) -> str:
    """The directory the packager wrote this asset into, relative to the media root."""
    return (asset.hls_master_key or "").lstrip("/").rsplit("/", 1)[0]


def _origin(asset: VideoAsset) -> str:
    """Where this service reads manifests from. Internal: never handed to a client."""
    return f"{get_settings().origin_url.rstrip('/')}/{_asset_dir(asset)}"


def _edge(asset: VideoAsset) -> str:
    """Where the viewer's player reads segments from. Public, and usually a different host."""
    return f"{get_settings().cdn_base_url.rstrip('/')}/{_asset_dir(asset)}"


async def _fetch(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
            res = await client.get(url)
    except httpx.HTTPError as exc:
        # An unreachable origin is an operational problem, not a missing video, but the viewer gets the same
        # answer either way and a stack trace in the response helps nobody.
        log.error("stream.origin_unreachable", url=url, error=str(exc))
        raise NotFound("Video") from exc
    if res.status_code != 200:
        log.warning("stream.origin_unavailable", url=url, status=res.status_code)
        raise NotFound("Video")
    return res.text


def _no_store(body: str | bytes, media_type: str) -> Response:
    # Manifests carry a viewer's signed URLs and the key is a secret. Neither may sit in a shared cache.
    return Response(content=body, media_type=media_type, headers={"Cache-Control": "no-store, private"})


@router.get("/{asset_id}/master.m3u8")
async def master(
    asset_id: uuid.UUID,
    db: DB,
    exp: Annotated[int, Query()],
    uid: Annotated[str, Query()],
    sig: Annotated[str, Query()],
) -> Response:
    viewer = _authorise(f"/v1/stream/{asset_id}/master.m3u8", exp, uid, sig)
    asset = await _asset(db, asset_id)
    source = await _fetch(f"{_origin(asset)}/master.m3u8")
    expires = datetime.now(UTC) + LINK_TTL

    out: list[str] = []
    for line in source.splitlines():
        stripped = line.strip()
        # Every non-comment line in a master playlist is a variant playlist path, e.g. "1080p/index.m3u8".
        if stripped and not stripped.startswith("#"):
            variant = stripped.split("/", 1)[0]
            if not VARIANT_RE.match(variant):
                log.warning("stream.unexpected_variant", asset_id=str(asset_id), value=stripped)
                continue
            path = f"/v1/stream/{asset_id}/v/{variant}/index.m3u8"
            out.append(f"{path}?{sign_path(path, user_id=viewer, expires=expires)}")
            continue
        out.append(line)
    return _no_store("\n".join(out) + "\n", PLAYLIST_MEDIA_TYPE)


@router.get("/{asset_id}/v/{variant}/index.m3u8")
async def variant_playlist(
    asset_id: uuid.UUID,
    variant: str,
    db: DB,
    exp: Annotated[int, Query()],
    uid: Annotated[str, Query()],
    sig: Annotated[str, Query()],
) -> Response:
    if not VARIANT_RE.match(variant):
        raise NotFound("Video")
    viewer = _authorise(f"/v1/stream/{asset_id}/v/{variant}/index.m3u8", exp, uid, sig)
    asset = await _asset(db, asset_id)
    edge = _edge(asset)
    source = await _fetch(f"{_origin(asset)}/{variant}/index.m3u8")
    expires = datetime.now(UTC) + LINK_TTL

    key_path = f"/v1/stream/{asset_id}/key"
    key_query = sign_path(key_path, user_id=viewer, expires=expires)
    key_url = f"{get_settings().api_base_url.rstrip('/')}{key_path}?{key_query}"

    out: list[str] = []
    seen_key = False
    for line in source.splitlines():
        stripped = line.strip()
        # The packager writes its own EXT-X-KEY with whatever URI it was configured with. Replace it, so the
        # key location is decided here at request time rather than baked in at packaging time.
        if stripped.startswith("#EXT-X-KEY"):
            # Only the URI is ours to change. The line also carries METHOD and, crucially, IV: rebuilding it
            # from scratch drops the IV, the player then falls back to the media sequence number, and every
            # segment decrypts to noise. Swap the one attribute and leave the rest of the line alone.
            out.append(URI_RE.sub(f'URI="{key_url}"', stripped, count=1))
            seen_key = True
            continue
        if stripped and not stripped.startswith("#"):
            if not seen_key:
                # Unencrypted media reaching an encrypted route is a packaging mistake, and serving it would
                # quietly hand out the episode in the clear. Better to fail loudly.
                log.error("stream.unencrypted_variant", asset_id=str(asset_id), variant=variant)
                raise NotFound("Video")
            out.append(f"{edge}/{variant}/{stripped}?{sign_path(f'/{stripped}', user_id=viewer, expires=expires)}")
            continue
        out.append(line)
    return _no_store("\n".join(out) + "\n", PLAYLIST_MEDIA_TYPE)


@router.get("/{asset_id}/key")
async def key(
    asset_id: uuid.UUID,
    db: DB,
    exp: Annotated[int, Query()],
    uid: Annotated[str, Query()],
    sig: Annotated[str, Query()],
) -> Response:
    """Sixteen raw bytes. The signature is the only thing standing between a request and the episode."""
    _authorise(f"/v1/stream/{asset_id}/key", exp, uid, sig)
    await _asset(db, asset_id)
    return _no_store(content_key(asset_id), "application/octet-stream")
