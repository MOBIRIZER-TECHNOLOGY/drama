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
