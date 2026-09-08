"""Ad placements: where ads may run, and what a rewarded view is worth.

The console screen for this existed before the API did and ran against an in-memory stub, so everything an
operator configured vanished on refresh. These are the endpoints behind it.

Two rules the API enforces rather than trusting the client with:

* a placement with no platforms can never be served, so an empty list is rejected at the edge instead of
  becoming a row that silently does nothing;
* `reward_coins` is meaningful only on a rewarded slot, and is stored as NULL everywhere else — otherwise a
  value left behind by changing the slot in the form becomes a payout nobody intended.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.ops import AdPlacement
from app.schemas.common import Ok
from app.services import audit

router = APIRouter(prefix="/admin/ad-placements", tags=["admin"])

# Kept in one place so the console, the clients and this module cannot drift apart.
SLOTS = ("home_rail", "player_pre", "player_mid", "unlock_rewarded", "paywall")
PROVIDERS = ("admob", "meta", "house")
PLATFORMS = ("android", "ios", "web")
REWARDED_SLOTS = frozenset({"unlock_rewarded"})


class AdPlacementIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slot: str
    provider: str
    unit_id: str = Field(min_length=1, max_length=160)
    platforms: list[str] = Field(min_length=1)
    reward_coins: int | None = Field(default=None, ge=0, le=10_000)
    frequency_cap_sec: int = Field(default=0, ge=0, le=86_400)
    is_active: bool = False
    sort_order: int = Field(default=0, ge=0, le=10_000)

    @field_validator("slot")
    @classmethod
    def _slot(cls, v: str) -> str:
        if v not in SLOTS:
            raise ValueError(f"slot must be one of {', '.join(SLOTS)}")
        return v

    @field_validator("provider")
    @classmethod
    def _provider(cls, v: str) -> str:
        if v not in PROVIDERS:
            raise ValueError(f"provider must be one of {', '.join(PROVIDERS)}")
        return v

    @field_validator("platforms")
    @classmethod
    def _platforms(cls, v: list[str]) -> list[str]:
        unknown = sorted(set(v) - set(PLATFORMS))
        if unknown:
            raise ValueError(f"unknown platform(s): {', '.join(unknown)}")
        # De-duplicated and ordered so two rows that mean the same thing compare equal in the audit diff.
        return [p for p in PLATFORMS if p in set(v)]

    def normalised_reward(self) -> int | None:
        """A reward value only survives on a slot that can pay one out."""
        return self.reward_coins if self.slot in REWARDED_SLOTS else None


class AdPlacementOut(BaseModel):
    id: uuid.UUID
    name: str
    slot: str
    provider: str
    unit_id: str
    platforms: list[str]
    reward_coins: int | None
    frequency_cap_sec: int
    is_active: bool
    sort_order: int
    created_at: datetime | None
    updated_at: datetime | None


class AdPlacementPage(BaseModel):
    items: list[AdPlacementOut]
    total: int
    """How many are live right now — the number that answers "are we showing ads at all?"."""
    active: int


def _out(p: AdPlacement) -> AdPlacementOut:
    return AdPlacementOut(
        id=p.id,
        name=p.name,
        slot=p.slot,
        provider=p.provider,
        unit_id=p.unit_id,
        platforms=list(p.platforms or []),
        reward_coins=p.reward_coins,
        frequency_cap_sec=p.frequency_cap_sec,
        is_active=p.is_active,
        sort_order=p.sort_order,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _snapshot(p: AdPlacement) -> dict:
    return {
        "name": p.name,
        "slot": p.slot,
        "provider": p.provider,
        "unit_id": p.unit_id,
        "platforms": list(p.platforms or []),
        "reward_coins": p.reward_coins,
        "frequency_cap_sec": p.frequency_cap_sec,
        "is_active": p.is_active,
        "sort_order": p.sort_order,
    }


@router.get("", response_model=AdPlacementPage)
async def list_placements(
    admin: CurrentAdmin,
    db: DB,
    slot: Annotated[str | None, Query(max_length=32)] = None,
    active_only: bool = False,
) -> AdPlacementPage:
    stmt = select(AdPlacement).order_by(AdPlacement.sort_order, AdPlacement.name)
    if slot:
        stmt = stmt.where(AdPlacement.slot == slot)
    if active_only:
        stmt = stmt.where(AdPlacement.is_active.is_(True))
    rows = list((await db.scalars(stmt)).all())
    # Counted over everything, not the filtered view: this is a health figure, not a subtotal.
    all_rows = list((await db.scalars(select(AdPlacement))).all())
    return AdPlacementPage(
        items=[_out(p) for p in rows],
        total=len(all_rows),
        active=sum(1 for p in all_rows if p.is_active),
    )


async def _unique(db: DB, body: AdPlacementIn, *, exclude: uuid.UUID | None = None) -> None:
    stmt = select(AdPlacement.id).where(
        AdPlacement.slot == body.slot,
        AdPlacement.provider == body.provider,
        AdPlacement.unit_id == body.unit_id,
    )
    if exclude:
        stmt = stmt.where(AdPlacement.id != exclude)
    if await db.scalar(stmt):
        raise Conflict("That unit is already placed in this slot", code="placement_exists")


@router.post("", response_model=AdPlacementOut, status_code=201, dependencies=[require_role(AdminRole.finance)])
async def create_placement(body: AdPlacementIn, admin: CurrentAdmin, db: DB) -> AdPlacementOut:
    await _unique(db, body)
    p = AdPlacement(
        name=body.name.strip(),
        slot=body.slot,
        provider=body.provider,
        unit_id=body.unit_id.strip(),
        platforms=body.platforms,
        reward_coins=body.normalised_reward(),
        frequency_cap_sec=body.frequency_cap_sec,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(p)
    await db.flush()
    # Server defaults (created_at/updated_at) land on flush, and reading them after the commit would be an
    # implicit lazy load in async context — a MissingGreenlet, not a stale value. Refresh explicitly, then
    # snapshot the response before committing.
    await db.refresh(p)
    out = _out(p)
    audit.record(
        db,
        admin=admin,
        action="ad_placement.create",
        target_type="ad_placement",
        target_id=str(p.id),
        after=_snapshot(p),
    )
    await db.commit()
    return out


@router.put("/{placement_id}", response_model=AdPlacementOut, dependencies=[require_role(AdminRole.finance)])
async def update_placement(
    placement_id: uuid.UUID, body: AdPlacementIn, admin: CurrentAdmin, db: DB
) -> AdPlacementOut:
    p = await db.get(AdPlacement, placement_id)
    if p is None:
        raise NotFound("Ad placement")
    await _unique(db, body, exclude=placement_id)
    before = _snapshot(p)
    p.name = body.name.strip()
    p.slot = body.slot
    p.provider = body.provider
    p.unit_id = body.unit_id.strip()
    p.platforms = body.platforms
    p.reward_coins = body.normalised_reward()
    p.frequency_cap_sec = body.frequency_cap_sec
    p.is_active = body.is_active
    p.sort_order = body.sort_order
    await db.flush()
    await db.refresh(p)
    out = _out(p)
    # Turning a placement on is a money decision; the log carries what changed, not just that something did.
    audit.record(
        db,
        admin=admin,
        action="ad_placement.update",
        target_type="ad_placement",
        target_id=str(p.id),
        before=before,
        after=_snapshot(p),
    )
    await db.commit()
    return out


@router.delete("/{placement_id}", response_model=Ok, dependencies=[require_role(AdminRole.finance)])
async def delete_placement(placement_id: uuid.UUID, admin: CurrentAdmin, db: DB) -> Ok:
    p = await db.get(AdPlacement, placement_id)
    if p is None:
        raise NotFound("Ad placement")
    before = _snapshot(p)
    await db.delete(p)
    audit.record(
        db,
        admin=admin,
        action="ad_placement.delete",
        target_type="ad_placement",
        target_id=str(placement_id),
        before=before,
    )
    await db.commit()
    return Ok()
