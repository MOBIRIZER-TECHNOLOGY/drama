"""Growth tooling for admins: experiments, feature flags, offers, coupons, QoE and funnel analytics."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import Date, Float

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.errors import Conflict, NotFound
from app.models.engagement import AnalyticsEvent
from app.models.identity import User
from app.models.ops import Experiment, ExperimentAssignment, FeatureFlag
from app.models.wallet import CoinLedger, Coupon, EpisodeUnlock, Offer, Purchase, PurchaseStatus
from app.schemas.common import Ok
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[require_role(AdminRole.finance, AdminRole.editor)])


# ---- experiments ----


class ExperimentIn(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9_]{3,64}$")
    description: str | None = None
    variants: dict[str, dict] = Field(min_length=2)
    allocation: dict[str, int]

    @field_validator("allocation")
    @classmethod
    def _sums_to_100(cls, v: dict[str, int]) -> dict[str, int]:
        if sum(v.values()) != 100:
            raise ValueError("allocation must sum to 100")
        return v


class ExperimentOut(BaseModel):
    key: str
    description: str | None
    variants: dict
    allocation: dict
    started_at: datetime | None
    ended_at: datetime | None
    status: str


def _exp_status(e: Experiment) -> str:
    now = datetime.now(UTC)
    if e.started_at is None:
        return "draft"
    if e.ended_at is not None and e.ended_at <= now:
        return "ended"
    return "running"


def _exp_out(e: Experiment) -> ExperimentOut:
    return ExperimentOut(
        key=e.key,
        description=e.description,
        variants=e.variants,
        allocation=e.allocation,
        started_at=e.started_at,
        ended_at=e.ended_at,
        status=_exp_status(e),
    )


@router.get("/experiments", response_model=list[ExperimentOut])
async def experiments(db: DB) -> list[ExperimentOut]:
    rows = await db.scalars(select(Experiment).order_by(Experiment.key))
    return [_exp_out(e) for e in rows.all()]


@router.post("/experiments", response_model=ExperimentOut, status_code=201)
async def create_experiment(body: ExperimentIn, db: DB) -> ExperimentOut:
    if await db.get(Experiment, body.key):
        raise Conflict("Experiment key exists", code="key_taken")
    if set(body.allocation) != set(body.variants):
        raise Conflict("allocation keys must match variants", code="bad_allocation")
    e = Experiment(key=body.key, description=body.description, variants=body.variants, allocation=body.allocation)
    db.add(e)
    await db.commit()
    return _exp_out(e)


@router.put("/experiments/{key}", response_model=ExperimentOut)
async def update_experiment(key: str, body: ExperimentIn, db: DB) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    if e.started_at is not None and body.variants.keys() != e.variants.keys():
        raise Conflict("Cannot change variants of a running experiment", code="running")
    e.description, e.variants, e.allocation = body.description, body.variants, body.allocation
    await db.commit()
    return _exp_out(e)


@router.post("/experiments/{key}/start", response_model=ExperimentOut)
async def start_experiment(key: str, db: DB) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    e.started_at, e.ended_at = datetime.now(UTC), None
    await db.commit()
    return _exp_out(e)


@router.post("/experiments/{key}/stop", response_model=ExperimentOut)
async def stop_experiment(key: str, db: DB) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    e.ended_at = datetime.now(UTC)
    await db.commit()
    return _exp_out(e)


class VariantResult(BaseModel):
    variant: str
    users: int
    unlocks: int
    unlock_rate: float
    purchasers: int
    purchases: int
    revenue: dict[str, float]
    coins_spent: int


@router.get("/experiments/{key}/results", response_model=list[VariantResult])
async def experiment_results(key: str, db: DB) -> list[VariantResult]:
    """Per-variant outcomes read straight off rows that recorded the variant map at the time."""
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    since = e.started_at or datetime(2000, 1, 1, tzinfo=UTC)
    users_by_variant = dict(
        (
            await db.execute(
                select(ExperimentAssignment.variant, func.count())
                .where(ExperimentAssignment.experiment_key == key)
                .group_by(ExperimentAssignment.variant)
            )
        ).all()
    )
    vkey = EpisodeUnlock.variant_map[key].astext
    unlocks = dict(
        (
            await db.execute(
                select(vkey, func.count()).where(EpisodeUnlock.created_at >= since, vkey.is_not(None)).group_by(vkey)
            )
        ).all()
    )
    pkey = Purchase.variant_map[key].astext
    paid_where = (Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= since, pkey.is_not(None))
    # Distinct buyers must be counted per variant, not per (variant, currency): a variant whose buyers
    # paid in different currencies would otherwise report only its largest currency group.
    purchasers = dict(
        (
            await db.execute(
                select(pkey, func.count(func.distinct(Purchase.user_id))).where(*paid_where).group_by(pkey)
            )
        ).all()
    )
    prow = await db.execute(
        select(pkey, func.count(), Purchase.currency, func.sum(Purchase.amount))
        .where(*paid_where)
        .group_by(pkey, Purchase.currency)
    )
    purchases: dict[str, int] = {}
    revenue: dict[str, dict[str, float]] = {}
    for variant, count, cur, total in prow.all():
        purchases[variant] = purchases.get(variant, 0) + count
        revenue.setdefault(variant, {})[cur] = float(total or 0)
    lkey = CoinLedger.variant_map[key].astext
    spent = dict(
        (
            await db.execute(
                select(lkey, func.coalesce(func.sum(-CoinLedger.delta), 0))
                .where(CoinLedger.created_at >= since, CoinLedger.delta < 0, lkey.is_not(None))
                .group_by(lkey)
            )
        ).all()
    )
    out = []
    for variant in e.variants:
        n = users_by_variant.get(variant, 0)
        u = unlocks.get(variant, 0)
        out.append(
            VariantResult(
                variant=variant,
                users=n,
                unlocks=u,
                unlock_rate=(u / n) if n else 0.0,
                purchasers=purchasers.get(variant, 0),
                purchases=purchases.get(variant, 0),
                revenue=revenue.get(variant, {}),
                coins_spent=int(spent.get(variant, 0)),
            )
        )
    return out


# ---- feature flags ----


class FlagIn(BaseModel):
    enabled: bool
    rules: dict | None = (
        None  # {"platforms": ["android"], "countries": ["IN"], "min_app_version": 12, "percentage": 50}
    )


class FlagOut(BaseModel):
    key: str
    enabled: bool
    rules: dict | None
    updated_at: datetime


@router.get("/flags", response_model=list[FlagOut])
async def flags(db: DB) -> list[FlagOut]:
    rows = await db.scalars(select(FeatureFlag).order_by(FeatureFlag.key))
    return [FlagOut(key=f.key, enabled=f.enabled, rules=f.rules, updated_at=f.updated_at) for f in rows.all()]


@router.put("/flags/{key}", response_model=FlagOut)
async def put_flag(key: str, body: FlagIn, db: DB, admin: CurrentAdmin) -> FlagOut:
    f = await db.get(FeatureFlag, key)
    before = {"enabled": f.enabled, "rules": f.rules} if f is not None else None
    if f is None:
        f = FeatureFlag(key=key, enabled=body.enabled, rules=body.rules, updated_at=datetime.now(UTC))
        db.add(f)
    else:
        f.enabled, f.rules, f.updated_at = body.enabled, body.rules, datetime.now(UTC)
    # A flag is a production kill switch. After an incident, "who turned this on" has to be answerable.
    audit.record(
        db,
        admin=admin,
        action="flag.set",
        target_type="flag",
        target_id=key,
        before=before,
        after={"enabled": f.enabled, "rules": f.rules},
    )
    await db.commit()
    return FlagOut(key=f.key, enabled=f.enabled, rules=f.rules, updated_at=f.updated_at)


@router.delete("/flags/{key}", response_model=Ok)
async def delete_flag(key: str, db: DB, admin: CurrentAdmin) -> Ok:
    f = await db.get(FeatureFlag, key)
    if f is None:
        raise NotFound("Flag")
    audit.record(
        db, admin=admin, action="flag.delete", target_type="flag", target_id=key, before={"enabled": f.enabled}
    )
    await db.delete(f)
    await db.commit()
    return Ok()


# ---- offers and coupons ----


class OfferIn(BaseModel):
    title: str = Field(max_length=120)
    kind: str = Field(pattern="^(first_purchase|bundle|winback|coupon)$")
    pack_id: uuid.UUID | None = None
    discount_pct: int | None = Field(default=None, ge=1, le=90)
    eligibility: dict | None = None  # {"first_purchase": true, "inactive_days": 14, "countries": ["IN"]}
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True


class OfferOut(OfferIn):
    id: uuid.UUID
    coupons: list["CouponOut"] = []


class CouponIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{4,32}$")
    max_uses: int | None = None


class CouponOut(BaseModel):
    id: uuid.UUID
    code: str
    max_uses: int | None
    used: int


async def _offer_out(db, o: Offer) -> OfferOut:
    cs = (await db.scalars(select(Coupon).where(Coupon.offer_id == o.id))).all()
    return OfferOut(
        id=o.id,
        title=o.title,
        kind=o.kind,
        pack_id=o.pack_id,
        discount_pct=o.discount_pct,
        eligibility=o.eligibility,
        starts_at=o.starts_at,
        ends_at=o.ends_at,
        is_active=o.is_active,
        coupons=[CouponOut(id=c.id, code=c.code, max_uses=c.max_uses, used=c.used) for c in cs],
    )


@router.get("/offers", response_model=list[OfferOut])
async def offers(db: DB) -> list[OfferOut]:
    rows = await db.scalars(select(Offer).order_by(Offer.created_at.desc()))
    return [await _offer_out(db, o) for o in rows.all()]


@router.post("/offers", response_model=OfferOut, status_code=201)
async def create_offer(body: OfferIn, db: DB) -> OfferOut:
    o = Offer(**body.model_dump())
    db.add(o)
    await db.commit()
    return await _offer_out(db, o)


@router.put("/offers/{offer_id}", response_model=OfferOut)
async def update_offer(offer_id: uuid.UUID, body: OfferIn, db: DB) -> OfferOut:
    o = await db.get(Offer, offer_id)
    if o is None:
        raise NotFound("Offer")
    for k, v in body.model_dump().items():
        setattr(o, k, v)
    await db.commit()
    return await _offer_out(db, o)


@router.post("/offers/{offer_id}/coupons", response_model=CouponOut, status_code=201)
async def add_coupon(offer_id: uuid.UUID, body: CouponIn, db: DB) -> CouponOut:
    if await db.get(Offer, offer_id) is None:
        raise NotFound("Offer")
    if await db.scalar(select(Coupon.id).where(Coupon.code == body.code)):
        raise Conflict("Coupon code exists", code="code_taken")
    c = Coupon(code=body.code, offer_id=offer_id, max_uses=body.max_uses)
    db.add(c)
    await db.commit()
    return CouponOut(id=c.id, code=c.code, max_uses=c.max_uses, used=c.used)


@router.delete("/coupons/{coupon_id}", response_model=Ok)
async def delete_coupon(coupon_id: uuid.UUID, db: DB) -> Ok:
    c = await db.get(Coupon, coupon_id)
    if c is None:
        raise NotFound("Coupon")
    await db.delete(c)
    await db.commit()
    return Ok()


# ---- analytics: QoE and funnel ----


class QoeRow(BaseModel):
    date: str
    platform: str | None
    plays: int
    p50_start_ms: float | None
    p95_start_ms: float | None
    rebuffer_ratio: float | None
    error_rate: float | None


@router.get("/analytics/qoe", response_model=list[QoeRow])
async def qoe(db: DB, days: int = Query(14, ge=1, le=90)) -> list[QoeRow]:
    since = datetime.now(UTC) - timedelta(days=days)
    day = cast(AnalyticsEvent.ts, Date)
    ttff = cast(AnalyticsEvent.props["ttff_ms"].astext, Float)
    starts = (
        select(
            day.label("d"),
            AnalyticsEvent.platform.label("p"),
            func.count().label("plays"),
            func.percentile_cont(0.5).within_group(ttff).label("p50"),
            func.percentile_cont(0.95).within_group(ttff).label("p95"),
        )
        .where(AnalyticsEvent.name == "first_frame", AnalyticsEvent.ts >= since)
        .group_by(day, AnalyticsEvent.platform)
        .subquery()
    )
    rb = (
        select(day.label("d"), AnalyticsEvent.platform.label("p"), func.count().label("rebuffers"))
        .where(AnalyticsEvent.name == "rebuffer", AnalyticsEvent.ts >= since)
        .group_by(day, AnalyticsEvent.platform)
        .subquery()
    )
    er = (
        select(day.label("d"), AnalyticsEvent.platform.label("p"), func.count().label("errors"))
        .where(AnalyticsEvent.name == "play_error", AnalyticsEvent.ts >= since)
        .group_by(day, AnalyticsEvent.platform)
        .subquery()
    )
    rows = await db.execute(
        select(starts.c.d, starts.c.p, starts.c.plays, starts.c.p50, starts.c.p95, rb.c.rebuffers, er.c.errors)
        .outerjoin(rb, (rb.c.d == starts.c.d) & (rb.c.p == starts.c.p))
        .outerjoin(er, (er.c.d == starts.c.d) & (er.c.p == starts.c.p))
        .order_by(starts.c.d.desc())
    )
    out = []
    for d, p, plays, p50, p95, rebuffers, errors in rows.all():
        out.append(
            QoeRow(
                date=str(d),
                platform=p,
                plays=plays,
                p50_start_ms=float(p50) if p50 is not None else None,
                p95_start_ms=float(p95) if p95 is not None else None,
                rebuffer_ratio=(rebuffers or 0) / plays if plays else None,
                error_rate=(errors or 0) / plays if plays else None,
            )
        )
    return out


class FunnelOut(BaseModel):
    range_days: int
    steps: list[dict]  # [{name, users}]


@router.get("/analytics/funnel", response_model=FunnelOut)
async def funnel(db: DB, days: int = Query(30, ge=1, le=365)) -> FunnelOut:
    since = datetime.now(UTC) - timedelta(days=days)
    steps = []
    for name in ("app_open", "series_view", "play_start", "paywall_view", "unlock", "checkout_start"):
        n = await db.scalar(
            select(func.count(func.distinct(func.coalesce(AnalyticsEvent.user_id, AnalyticsEvent.session_id)))).where(
                AnalyticsEvent.name == name, AnalyticsEvent.ts >= since
            )
        )
        steps.append({"name": name, "users": n or 0})
    paid = await db.scalar(
        select(func.count(func.distinct(Purchase.user_id))).where(
            Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= since
        )
    )
    steps.append({"name": "paid", "users": paid or 0})
    _ = (User, JSONB)  # keep imports for future breakdowns
    return FunnelOut(range_days=days, steps=steps)
