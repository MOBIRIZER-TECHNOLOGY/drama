import json
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import DB, OptionalUser, client_platform
from app.core.redis import cache_available, note_cache_failure, note_cache_success, redis_client
from app.schemas.config import ConfigOut
from app.services import config as config_svc

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=ConfigOut)
async def get_config(db: DB, ctx: OptionalUser, platform: Annotated[str, Depends(client_platform)]) -> ConfigOut:
    """Remote config for web and mobile: toggles, economy, languages, flags and sticky experiment variants.

    Every field but `variants` is the same for every viewer on this platform, so that half is cached for 60s
    the same way `catalog.home` caches its anonymous response; `variants` is computed fresh every time, since
    it is sticky per user and a first-time bucketing has to write its assignment row.
    """
    cache_key = f"config:{platform}"
    use_cache = cache_available()
    shared: dict | None = None
    if use_cache:
        try:
            cached = await (await redis_client()).get(cache_key)
            note_cache_success()
            if cached:
                shared = json.loads(cached)
        except Exception:  # noqa: BLE001 - cache optional
            note_cache_failure()
    if shared is None:
        shared = await config_svc.build_shared(db, platform=platform)
        if use_cache:
            try:
                # `default=str` is only for the ad placement UUIDs; ConfigOut re-parses them from the JSON
                # string back into `uuid.UUID` on the way out, so nothing downstream sees the difference.
                await (await redis_client()).set(cache_key, json.dumps(shared, default=str), ex=60)
                note_cache_success()
            except Exception:  # noqa: BLE001
                note_cache_failure()
    data = {**shared, "variants": await config_svc.variant_map(db, ctx.user.id if ctx else None)}
    await db.commit()  # persists any new experiment assignments
    return ConfigOut.model_validate(data)
