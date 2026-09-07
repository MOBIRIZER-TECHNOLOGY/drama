"""Rate limiting (slowapi over Redis). Keys are the client IP behind a trusted proxy, or the token when signed in.

Storage errors never fail a request (swallow_errors); tests use in-memory storage.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings


def _key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer ") and len(auth) > 40:
        return "tok:" + auth[-32:]  # per-token bucket for signed-in traffic
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
