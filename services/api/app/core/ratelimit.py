"""Rate limiting (slowapi over Redis). Keys are the client IP behind a trusted proxy, or the account when signed in.

A per-account bucket only exists for a bearer token this service actually issued. The earlier version keyed on
the last characters of whatever followed `Bearer `, which let anyone sidestep the IP bucket by sending a fresh
random header with each request — the limiter would have handed every one of them its own budget. A token is
now decoded first; if it is not a valid access or admin token, the request is charged to the IP like any
anonymous one.

Storage errors never fail a request (swallow_errors); tests use in-memory storage.
"""

import jwt
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.security import decode_token


def _key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        for kind in ("access", "admin"):
            try:
                payload = decode_token(token, kind)
            except jwt.PyJWTError:
                continue
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"  # per-account bucket for signed-in traffic
            break
    return "ip:" + get_remote_address(request)


_settings = get_settings()
limiter = Limiter(
    key_func=_key,
    storage_uri="memory://" if _settings.env == "test" else _settings.redis_url,
    default_limits=["600/minute"],
    headers_enabled=False,  # header injection needs raw Response returns; our routes return models
    swallow_errors=True,
    in_memory_fallback_enabled=True,
)
