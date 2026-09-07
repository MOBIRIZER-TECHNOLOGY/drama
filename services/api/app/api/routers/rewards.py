import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import DB, CurrentUser, client_platform
from app.models.identity import Platform
from app.schemas.rewards import CheckinOut, CheckinStatus, ClaimOut, ClaimRequest, TaskOut
from app.services import config as config_svc
from app.services import rewards as rewards_svc

router = APIRouter(prefix="/rewards", tags=["rewards"])


@router.get("/checkin", response_model=CheckinStatus)
async def checkin_status(ctx: CurrentUser, db: DB) -> CheckinStatus:
    status = await rewards_svc.checkin_status(db, ctx.user.id)
    return CheckinStatus(**status, coin_balance=ctx.user.coin_balance)


@router.post("/checkin", response_model=CheckinOut)
async def checkin(ctx: CurrentUser, db: DB) -> CheckinOut:
    variants = await config_svc.variant_map(db, ctx.user.id)
    row = await rewards_svc.checkin(db, ctx.user, variant_map=variants or None)
    await db.commit()
    await db.refresh(ctx.user)
    return CheckinOut(day=row.day, streak_day=row.streak_day, coins=row.coins, coin_balance=ctx.user.coin_balance)


@router.get("/tasks", response_model=list[TaskOut])
async def tasks(ctx: CurrentUser, db: DB, platform: Annotated[str, Depends(client_platform)]) -> list[TaskOut]:
    plat = Platform(platform) if platform in Platform.__members__ else Platform.web
    items = await rewards_svc.tasks_for(db, ctx.user.id, plat)
    return [
        TaskOut(
            id=i["task"].id,
            kind=i["task"].kind,
            title=i["task"].title,
            description=i["task"].description,
            coins=i["task"].coins,
            url=i["task"].url,
            timer_seconds=i["task"].timer_seconds,
            frequency=i["task"].frequency,
            claimed=i["claimed"],
        )
        for i in items
    ]


@router.post("/tasks/{task_id}/claim", response_model=ClaimOut)
async def claim(task_id: uuid.UUID, body: ClaimRequest, ctx: CurrentUser, db: DB) -> ClaimOut:
    variants = await config_svc.variant_map(db, ctx.user.id)
    row = await rewards_svc.claim(db, ctx.user, task_id, ad_event_id=body.ad_event_id, variant_map=variants or None)
    await db.commit()
    await db.refresh(ctx.user)
    task = await db.get(rewards_svc.RewardTask, row.task_id)
    return ClaimOut(task_id=row.task_id, coins=task.coins if task else 0, coin_balance=ctx.user.coin_balance)
