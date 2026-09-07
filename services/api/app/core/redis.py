from redis.asyncio import Redis, from_url

from app.core.config import get_settings

_client: Redis | None = None


async def redis_client() -> Redis:
    global _client
    if _client is None:
        _client = from_url(get_settings().redis_url, decode_responses=True)
    return _client
