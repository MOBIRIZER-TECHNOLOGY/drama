"""Growth tooling for admins: experiments, feature flags, offers, coupons, QoE and funnel analytics."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import String, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.types import Date, Float

from app.api.deps import DB, AdminRole, CurrentAdmin, require_role
from app.core.config import get_settings
from app.core.errors import Conflict, NotFound
from app.models.engagement import AnalyticsEvent
from app.models.ops import AuditLog, Experiment, ExperimentAssignment, FeatureFlag
from app.models.wallet import CoinLedger, Coupon, EpisodeUnlock, Offer, Purchase, PurchaseStatus
from app.schemas.common import Ok, UtcDatetime
from app.services import audit, stats

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


def _exp_snapshot(e: Experiment) -> dict:
    return {
        "allocation": e.allocation,
        "variants": sorted(e.variants),
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "ended_at": e.ended_at.isoformat() if e.ended_at else None,
    }


# An experiment decides what price or paywall a slice of the audience sees. Starting, stopping and
# reallocating one are revenue decisions, and "who changed the split mid-test" has to be answerable.
@router.put("/experiments/{key}", response_model=ExperimentOut)
async def update_experiment(key: str, body: ExperimentIn, db: DB, admin: CurrentAdmin) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    if e.started_at is not None and body.variants.keys() != e.variants.keys():
        raise Conflict("Cannot change variants of a running experiment", code="running")
    before = _exp_snapshot(e)
    e.description, e.variants, e.allocation = body.description, body.variants, body.allocation
    audit.record(
        db,
        admin=admin,
        action="experiment.update",
        target_type="experiment",
        target_id=key,
        before=before,
        after=_exp_snapshot(e),
    )
    await db.commit()
    return _exp_out(e)


@router.post("/experiments/{key}/start", response_model=ExperimentOut)
async def start_experiment(key: str, db: DB, admin: CurrentAdmin) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    before = _exp_snapshot(e)
    e.started_at, e.ended_at = datetime.now(UTC), None
    audit.record(
        db,
        admin=admin,
        action="experiment.start",
        target_type="experiment",
        target_id=key,
        before=before,
        after=_exp_snapshot(e),
    )
    await db.commit()
    return _exp_out(e)


@router.post("/experiments/{key}/stop", response_model=ExperimentOut)
async def stop_experiment(key: str, db: DB, admin: CurrentAdmin) -> ExperimentOut:
    e = await db.get(Experiment, key)
    if e is None:
        raise NotFound("Experiment")
    before = _exp_snapshot(e)
    e.ended_at = datetime.now(UTC)
    audit.record(
        db,
        admin=admin,
        action="experiment.stop",
        target_type="experiment",
        target_id=key,
        before=before,
        after=_exp_snapshot(e),
    )
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
    """Buyers over assigned users. The outcome the test is run on."""
    conversion: float = 0.0
    """True for the variant every other one is measured against — the first declared."""
    is_control: bool = False
    """Relative lift over the control, e.g. 12.0 for "12% better". None until both arms are large enough."""
    lift_pct: float | None = None
    p_value: float | None = None
    significant: bool = False
    """Why there is no verdict yet, when there isn't one."""
    note: str | None = None


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
        buyers = purchasers.get(variant, 0)
        out.append(
            VariantResult(
                variant=variant,
                users=n,
                unlocks=u,
                unlock_rate=(u / n) if n else 0.0,
                purchasers=buyers,
                purchases=purchases.get(variant, 0),
                revenue=revenue.get(variant, {}),
                coins_spent=int(spent.get(variant, 0)),
                conversion=(buyers / n) if n else 0.0,
            )
        )

    # Significance against the control arm. Computed here rather than in the console because the definition of
    # "converted" belongs with the query that produces it, and two clients must not disagree about whether a
    # price change won.
    #
    # The baseline used to be "the first declared variant", taken as the first key of `e.variants`. That is
    # not recoverable: the column is JSONB, and Postgres returns its keys shortest-first rather than in the
    # order they were written, so an experiment declared {"control": ..., "b": ...} came back with "b" as the
    # baseline and every lift and p-value computed backwards — a wrong number, stated confidently, about the
    # decision the screen exists to make. So the choice is explicit now: the arm actually named "control",
    # and failing that the first in sorted order, which is at least the same arm on every call.
    if out:
        control = next((row for row in out if row.variant.lower() == "control"), None)
        if control is None:
            control = min(out, key=lambda row: row.variant)
        control.is_control = True
        for row in (r for r in out if r is not control):
            verdict = stats.compare(control.purchasers, control.users, row.purchasers, row.users)
            row.lift_pct = verdict.lift_pct
            row.p_value = verdict.p_value
            row.significant = verdict.significant
            row.note = verdict.note
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
    # Who last touched it. A flag is a production kill switch, and "who turned this on" was answerable only by
    # leaving this screen for the audit log — which support and finance roles cannot open at all.
    updated_by: str | None = None


@router.get("/flags", response_model=list[FlagOut])
async def flags(db: DB) -> list[FlagOut]:
    """Flags with the admin who last set each one, in one grouped query rather than a lookup per row."""
    rows = list((await db.scalars(select(FeatureFlag).order_by(FeatureFlag.key))).all())
    last_by_key: dict[str, str] = {}
    if rows:
        # The most recent audit row per flag: rank inside the partition rather than fetching the whole log.
        ranked = (
            select(
                AuditLog.target_id,
                AuditLog.admin_email,
                func.row_number()
                .over(partition_by=AuditLog.target_id, order_by=AuditLog.created_at.desc())
                .label("rn"),
            )
            .where(AuditLog.target_type == "flag", AuditLog.target_id.in_([f.key for f in rows]))
            .subquery()
        )
        latest = await db.execute(select(ranked.c.target_id, ranked.c.admin_email).where(ranked.c.rn == 1))
        last_by_key = {k: email for k, email in latest.all() if email}

    return [
        FlagOut(
            key=f.key,
            enabled=f.enabled,
            rules=f.rules,
            updated_at=f.updated_at,
            updated_by=last_by_key.get(f.key),
        )
        for f in rows
    ]


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
    starts_at: UtcDatetime | None = None
    ends_at: UtcDatetime | None = None
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


def _offer_snapshot(o: Offer) -> dict:
    return {
        "title": o.title,
        "kind": o.kind,
        "pack_id": str(o.pack_id) if o.pack_id else None,
        "discount_pct": o.discount_pct,
        "eligibility": o.eligibility,
        "starts_at": o.starts_at.isoformat() if o.starts_at else None,
        "ends_at": o.ends_at.isoformat() if o.ends_at else None,
        "is_active": o.is_active,
    }


# Offers and coupons are discounts on real money. Every create, change and removal is recorded, because a
# 90% coupon that appeared for an afternoon is exactly the thing finance will ask about afterwards.
@router.post("/offers", response_model=OfferOut, status_code=201)
async def create_offer(body: OfferIn, db: DB, admin: CurrentAdmin) -> OfferOut:
    o = Offer(**body.model_dump())
    db.add(o)
    await db.flush()
    audit.record(db, admin=admin, action="offer.create", target_type="offer", target_id=o.id, after=_offer_snapshot(o))
    await db.commit()
    return await _offer_out(db, o)


@router.put("/offers/{offer_id}", response_model=OfferOut)
async def update_offer(offer_id: uuid.UUID, body: OfferIn, db: DB, admin: CurrentAdmin) -> OfferOut:
    o = await db.get(Offer, offer_id)
    if o is None:
        raise NotFound("Offer")
    before = _offer_snapshot(o)
    for k, v in body.model_dump().items():
        setattr(o, k, v)
    audit.record(
        db,
        admin=admin,
        action="offer.update",
        target_type="offer",
        target_id=o.id,
        before=before,
        after=_offer_snapshot(o),
    )
    await db.commit()
    return await _offer_out(db, o)


@router.post("/offers/{offer_id}/coupons", response_model=CouponOut, status_code=201)
async def add_coupon(offer_id: uuid.UUID, body: CouponIn, db: DB, admin: CurrentAdmin) -> CouponOut:
    if await db.get(Offer, offer_id) is None:
        raise NotFound("Offer")
    if await db.scalar(select(Coupon.id).where(Coupon.code == body.code)):
        raise Conflict("Coupon code exists", code="code_taken")
    c = Coupon(code=body.code, offer_id=offer_id, max_uses=body.max_uses)
    # The lookup above is advisory; the unique index on `code` is the guard, and the savepoint turns a lost
    # race into the same 409 instead of a 500.
    try:
        async with db.begin_nested():
            db.add(c)
            await db.flush()
    except IntegrityError:
        raise Conflict("Coupon code exists", code="code_taken") from None
    audit.record(
        db,
        admin=admin,
        action="coupon.create",
        target_type="coupon",
        target_id=c.id,
        after={"code": c.code, "offer_id": str(offer_id), "max_uses": c.max_uses},
    )
    await db.commit()
    return CouponOut(id=c.id, code=c.code, max_uses=c.max_uses, used=c.used)


@router.delete("/coupons/{coupon_id}", response_model=Ok)
async def delete_coupon(coupon_id: uuid.UUID, db: DB, admin: CurrentAdmin) -> Ok:
    c = await db.get(Coupon, coupon_id)
    if c is None:
        raise NotFound("Coupon")
    audit.record(
        db,
        admin=admin,
        action="coupon.delete",
        target_type="coupon",
        target_id=c.id,
        before={"code": c.code, "offer_id": str(c.offer_id), "max_uses": c.max_uses, "used": c.used},
    )
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
    # Bucketed in the product timezone: the operator reads "yesterday" as a local day, and a UTC boundary put
    # an Indian evening's plays into the following date.
    day = cast(func.timezone(get_settings().reward_timezone, AnalyticsEvent.ts), Date)
    # Events come from clients, and a client can send `ttff_ms: "fast"`. A bare cast raises for the whole
    # query — one bad beacon blanked the screen — so only values that look like numbers are cast, and CASE
    # is what keeps Postgres from evaluating the cast on the rest.
    ttff_text = AnalyticsEvent.props["ttff_ms"].astext
    ttff = case((ttff_text.op("~")(r"^\d+(\.\d+)?$"), cast(ttff_text, Float)), else_=None)
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
    steps: list[dict]  # [{name, users}] — sequenced: each step counts only people who reached the one before it


# The journey, in order. Each step is counted only within the set that reached the previous one, so the
# percentages are a real funnel rather than six unrelated populations.
FUNNEL_STEPS = ("app_open", "series_view", "play_start", "paywall_view", "unlock")


@router.get("/analytics/funnel", response_model=FunnelOut)
async def funnel(db: DB, days: int = Query(30, ge=1, le=365)) -> FunnelOut:
    """Sequenced acquisition funnel.

    This used to count each step independently, which meant a viewer could appear at `unlock` without ever
    appearing at `app_open`, and every "% of previous" was arithmetic across unrelated populations. The screen
    said so in a caveat, which is not a fix: numbers that read as a funnel get presented as one.

    Identity is the user id where there is one and the session id otherwise, so a guest's journey survives up to
    the point they sign in. `paid` is drawn from purchases rather than events, because money is recorded by the
    payment webhook and is true regardless of whether a client analytics beacon ever arrived.
    """
    since = datetime.now(UTC) - timedelta(days=days)
    # Both sides cast: COALESCE(varchar, uuid) is a type error in Postgres, and this query 500'd every time.
    actor = func.coalesce(cast(AnalyticsEvent.user_id, String), cast(AnalyticsEvent.session_id, String))

    async def actors(name: str, within: set[str] | None) -> set[str]:
        rows = await db.scalars(
            select(func.distinct(actor)).where(
                AnalyticsEvent.name == name, AnalyticsEvent.ts >= since, actor.is_not(None)
            )
        )
        found = {str(a) for a in rows.all() if a is not None}
        return found if within is None else found & within

    steps: list[dict] = []
    reached: set[str] | None = None
    for name in FUNNEL_STEPS:
        reached = await actors(name, reached)
        steps.append({"name": name, "users": len(reached)})

    # Anyone who actually paid, restricted to those who reached the last event step so the sequence holds.
    paid_rows = await db.scalars(
        select(func.distinct(cast(Purchase.user_id, String))).where(
            Purchase.status == PurchaseStatus.paid, Purchase.paid_at >= since
        )
    )
    paid = {str(u) for u in paid_rows.all()}
    steps.append({"name": "paid", "users": len(paid & reached) if reached is not None else len(paid)})
    return FunnelOut(range_days=days, steps=steps)
