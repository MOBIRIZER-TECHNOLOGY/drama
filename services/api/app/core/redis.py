"""Redis, treated as optional everywhere it is used.

Every caller already wraps its Redis calls in `try/except` and carries on without the cache, which is the
right shape. What that shape does not survive on its own is Redis being *unreachable* rather than erroring:
the default client waits on a connect that will never complete, so each optional call costs a full timeout.
The home feed does a `get` and a `set`, and with no Redis running it took 8.2 seconds to serve a page that
computes in milliseconds — slower with a cache configured than with none at all, which is exactly backwards
and precisely the behaviour that turns one dead dependency into a site-wide outage.

Two things prevent that. Connections time out in a fraction of a second rather than tens of them, and a run of
failures parks Redis for a while so the next requests skip it entirely instead of each paying the timeout
again. A cache that is down should cost nothing beyond the work it was saving.
"""

import time

import structlog
from redis.asyncio import Redis, from_url

from app.core.config import get_settings

log = structlog.get_logger()

# Redis is next to the API, so a connection that has not landed in half a second is not going to.
CONNECT_TIMEOUT_SECONDS = 0.5
OPERATION_TIMEOUT_SECONDS = 0.5
# After this many consecutive failures, stop trying for a while.
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 30.0

_client: Redis | None = None
_failures = 0
_skip_until = 0.0


async def redis_client() -> Redis:
    global _client
    if _client is None:
        _client = from_url(
            get_settings().redis_url,
            decode_responses=True,
            socket_connect_timeout=CONNECT_TIMEOUT_SECONDS,
            socket_timeout=OPERATION_TIMEOUT_SECONDS,
            # Without this a dead Redis is re-dialled on every single command in a request.
            retry_on_timeout=False,
        )
    return _client


def cache_available() -> bool:
    """False while Redis is parked after repeated failures. Callers skip it instead of paying the timeout."""
    return time.monotonic() >= _skip_until


def note_cache_failure() -> None:
    """Record a failed Redis call. Enough of them in a row park it for a cooldown."""
    global _failures, _skip_until
    _failures += 1
    if _failures >= FAILURE_THRESHOLD and cache_available():
        _skip_until = time.monotonic() + COOLDOWN_SECONDS
        log.warning("cache.parked", failures=_failures, seconds=COOLDOWN_SECONDS)


def note_cache_success() -> None:
    """A call got through, so the run of failures is over."""
    global _failures
    _failures = 0
