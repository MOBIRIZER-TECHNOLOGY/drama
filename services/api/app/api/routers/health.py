from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DB
from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    s = get_settings()
    return {"status": "ok", "service": s.app_name, "version": s.api_version, "env": s.env}


@router.get("/ready")
async def ready(db: DB) -> dict:
    await db.execute(text("SELECT 1"))
    from app.core.redis import redis_client

    await (await redis_client()).ping()
    return {"status": "ready"}
