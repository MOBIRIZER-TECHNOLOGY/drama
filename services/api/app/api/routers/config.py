from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import DB, OptionalUser, client_platform
from app.schemas.config import ConfigOut
from app.services import config as config_svc

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=ConfigOut)
async def get_config(db: DB, ctx: OptionalUser, platform: Annotated[str, Depends(client_platform)]) -> ConfigOut:
    """Remote config for web and mobile: toggles, economy, languages, flags and sticky experiment variants."""
    data = await config_svc.build(db, user_id=ctx.user.id if ctx else None, platform=platform)
    await db.commit()  # persists any new experiment assignments
    return ConfigOut.model_validate(data)
