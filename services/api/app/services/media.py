"""Playback URL signing.

Local and MinIO: an HMAC token the CDN edge (or a tiny verifier) checks.
Production: swap `sign_hls_url` for CloudFront signed URLs or Bunny token auth. The API never streams bytes.
"""

import base64
import hashlib
import hmac
import uuid
from datetime import datetime
from urllib.parse import urlencode

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings


def sign_hls_url(master_key: str, *, user_id: uuid.UUID, expires: datetime) -> str:
    s = get_settings()
    exp = int(expires.timestamp())
    path = f"/{master_key.lstrip('/')}"
    msg = f"{path}:{exp}:{user_id}".encode()
    sig = base64.urlsafe_b64encode(hmac.new(s.signing_key.encode(), msg, hashlib.sha256).digest()).decode().rstrip("=")
    query = urlencode({"exp": exp, "uid": str(user_id), "sig": sig})
    return f"{s.cdn_base_url.rstrip('/')}{path}?{query}"


def verify_hls_signature(path: str, exp: int, user_id: str, sig: str) -> bool:
    s = get_settings()
    msg = f"{path}:{exp}:{user_id}".encode()
    expected = (
        base64.urlsafe_b64encode(hmac.new(s.signing_key.encode(), msg, hashlib.sha256).digest()).decode().rstrip("=")
    )
    return hmac.compare_digest(expected, sig)


def media_url(value: str | None) -> str | None:
    """Resolve a stored cover, banner or thumbnail into something a client can fetch.

    These columns used to hold absolute URLs, which quietly tied every row to one client's view of one host.
    A device and a browser do not agree on what a development machine is called, so the same database served
    working images to the phone and broken ones to the web; in production it means the CDN hostname is baked
    into every row and cannot be changed, regionalised or moved without a data migration.

    The value is now a key in our own media store, resolved against `cdn_base_url` at response time — the
    same treatment `hls_master_key` has always had. Anything already absolute is passed through untouched, so
    a poster hosted somewhere else still works and existing rows keep resolving while they are migrated.
    """
    if not value:
        return None
    if value.startswith(("http://", "https://", "//", "data:")):
        return value
    return f"{get_settings().cdn_base_url.rstrip('/')}/{value.lstrip('/')}"


# ---- AES-128 HLS content keys ----------------------------------------------
#
# Signed URLs decide who may *start* a stream; they do nothing once bytes are out. Anyone holding an unexpired
# URL, or anything sitting between the CDN and the player, gets the episode. For a catalogue where episode
# three costs coins, that is the whole product sitting in plain `.ts` files.
#
# The key is derived from one master secret and the asset id rather than generated and stored. A database dump
# then carries no content keys at all, restoring an old backup cannot resurrect a retired key, and rotating the
# master rotates the entire catalogue in one move. HKDF because it is the right tool and leaves nothing to
# argue about; the label pins the purpose so the same secret cannot collide with another use later.

# What the packager bakes into the playlist as the key URI. It is never fetched: the manifest route replaces
# it with a URL minted for one viewer. Shared so the packagers and the router cannot drift apart.
PLACEHOLDER_KEY_URI = "katha:key"

CONTENT_KEY_LABEL = b"katha:hls:aes128:v1:"
CONTENT_IV_LABEL = b"katha:hls:aes128-iv:v1:"
CONTENT_KEY_BYTES = 16  # AES-128, which is what HLS METHOD=AES-128 means.


def content_key(asset_id: uuid.UUID) -> bytes:
    """The AES-128 key for one video asset. Deterministic: the same asset always derives the same key."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=CONTENT_KEY_BYTES,
        salt=None,
        info=CONTENT_KEY_LABEL + asset_id.bytes,
    )
    return hkdf.derive(get_settings().content_key_secret.encode())


def content_iv(asset_id: uuid.UUID) -> bytes:
    """The AES-CBC IV for one asset, derived like the key and from the same secret.

    HLS carries one IV per playlist. Left unset, ffmpeg writes zeros into the playlist, and then every segment
    of every rendition is encrypted under the same key and the same IV, so their identical opening bytes
    encrypt identically. Deriving it costs nothing and stores nothing, exactly like the key.
    """
    hkdf = HKDF(algorithm=hashes.SHA256(), length=16, salt=None, info=CONTENT_IV_LABEL + asset_id.bytes)
    return hkdf.derive(get_settings().content_key_secret.encode())


def sign_path(path: str, *, user_id: uuid.UUID, expires: datetime) -> str:
    """Query string authorising one path for one viewer until one moment. The signature is the capability.

    A key request arrives from the video player, which sends no session header of its own, so authorisation
    has to travel in the URL. The signature covers the path, which is what stops a key URL for a free episode
    being edited into a key URL for a paid one.
    """
    exp = int(expires.timestamp())
    p = f"/{path.lstrip('/')}"
    msg = f"{p}:{exp}:{user_id}".encode()
    sig = (
        base64.urlsafe_b64encode(hmac.new(get_settings().signing_key.encode(), msg, hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    return urlencode({"exp": exp, "uid": str(user_id), "sig": sig})
