"""Edge verifier for signed playback URLs (cdn_signing_mode=hmac).

nginx fronts the bucket and calls GET /v1/media/verify via auth_request with the original URI. We check the
HMAC over path, expiry and user id; nginx serves the object only on 2xx. Playlist and segment requests carry the
same query, so one grant covers a whole episode for its lifetime.
"""

from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Header, Response

from app.core.config import get_settings
from app.services.media import verify_hls_signature

router = APIRouter(prefix="/media", tags=["media"], include_in_schema=False)


@router.get("/verify")
async def verify(x_original_uri: str = Header(default="")) -> Response:
    s = get_settings()
    if s.cdn_signing_mode == "none":
        return Response(status_code=204)
    parts = urlsplit(x_original_uri)
    q = parse_qs(parts.query)
    try:
        exp = int(q["exp"][0])
        uid = q["uid"][0]
        sig = q["sig"][0]
    except (KeyError, ValueError, IndexError):
        return Response(status_code=403)
    if exp < int(datetime.now(UTC).timestamp()):
        return Response(status_code=403)
    # Grants are minted for the bucket-relative master playlist path ("/hls/{asset}/master.m3u8"). The edge
    # sees it under a mount prefix (cdn_base_url path or /media); segments live in the same asset directory.
    path = parts.path if parts.path.startswith("/") else "/" + parts.path
    cdn_prefix = urlsplit(s.cdn_base_url).path.rstrip("/")
    rel_paths = {path}
    for prefix in {cdn_prefix, "/media"}:
        if prefix and path.startswith(prefix + "/"):
            rel_paths.add(path[len(prefix) :])
    for rel in rel_paths:
        parent = rel.rsplit("/", 1)[0]
        grand = parent.rsplit("/", 1)[0]
        for candidate in (rel, f"{parent}/master.m3u8", f"{grand}/master.m3u8"):
            if verify_hls_signature(candidate, exp, uid, sig):
                return Response(status_code=204)
    return Response(status_code=403)
