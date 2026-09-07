"""Product and QoE events from every client, batched. Stored with the viewer's experiment variants."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import DB, OptionalUser, client_platform
from app.core.ratelimit import limiter
from app.models.engagement import AnalyticsEvent
from app.schemas.common import Ok
from app.services import config as config_svc

router = APIRouter(tags=["events"])

ALLOWED = {
    # product
    "app_open",
    "screen_view",
    "series_view",
    "episode_view",
    "unlock_view",
    "unlock",
    "paywall_view",
    "checkout_start",
    "checkout_return",
    "search",
    "share",
    "signup",
    "login",
    # QoE
    "play_start",
    "first_frame",
    "rebuffer",
    "bitrate_switch",
    "play_error",
    "play_complete",
    "play_pause",
    "seek",
}


class EventIn(BaseModel):
    name: str = Field(max_length=64)
    ts: datetime | None = None
    props: dict = Field(default_factory=dict)


class EventBatch(BaseModel):
    events: list[EventIn] = Field(max_length=200)
    session_id: uuid.UUID | None = None
    device: dict | None = None  # {model, os, ram_gb, network, app_version}


@router.post("/events", response_model=Ok)
@limiter.limit("120/minute")
async def ingest(
    request: Request, body: EventBatch, db: DB, ctx: OptionalUser, platform: Annotated[str, Depends(client_platform)]
) -> Ok:
    variants = await config_svc.variant_map(db, ctx.user.id) if ctx else {}
    now = datetime.now(UTC)
    rows = []
    for e in body.events:
        if e.name not in ALLOWED:
            continue
        props = {k: v for k, v in e.props.items() if isinstance(v, (str, int, float, bool)) or v is None}
        if body.device:
            props["device"] = body.device
        ts = e.ts or now
        if abs((now - ts).total_seconds()) > 7 * 24 * 3600:  # clock skew or replay: clamp to now
            ts = now
        rows.append(
            AnalyticsEvent(
                user_id=ctx.user.id if ctx else None,
                session_id=body.session_id or (ctx.session_id if ctx else None),
                platform=platform,
                name=e.name,
                props=props,
                variant_map=variants or None,
                ts=ts,
            )
        )
    if rows:
        db.add_all(rows)
        await db.commit()
    return Ok()
