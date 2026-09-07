"""Episode access: who can watch what, and the unlock transaction."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AgeGateRequired, Conflict, NotFound
from app.models.catalog import Episode, PublishStatus, Series
from app.models.identity import User
from app.models.wallet import EpisodeUnlock, LedgerKind, UnlockMethod, VipMembership
from app.services import ledger, rewards


async def is_vip(session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    row = await session.scalar(
        select(VipMembership.id)
        .where(VipMembership.user_id == user_id, VipMembership.starts_at <= now, VipMembership.ends_at > now)
        .limit(1)
    )
    return row is not None


def requires_age_gate(series: Series) -> bool:
    """Whether a viewer must have confirmed their age before this series will play.

    A series with no rating counts as adult. A missing rating is an editorial omission, and on a catalogue that
    carries mature titles the safe reading of an omission is "not yet cleared", never "safe for everyone" —
    otherwise forgetting one dropdown ships ungated adult content. `unrated_is_adult` turns this off for a
    catalogue that is entirely general-audience.
    """
    s = get_settings()
    rating = (series.content_rating or "").strip()
    return s.unrated_is_adult if not rating else rating in s.adult_ratings


def episode_price(series: Series, episode: Episode) -> int:
    if episode.price_override is not None:
        return episode.price_override
    if series.episode_price is not None:
        return series.episode_price
    return get_settings().default_episode_price


def episode_is_free(series: Series, episode: Episode) -> bool:
    if episode.is_free_override is not None:
        return episode.is_free_override
    return episode.number <= series.free_episodes


async def unlocked_episode_ids(session: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await session.scalars(
        select(EpisodeUnlock.episode_id).where(EpisodeUnlock.user_id == user_id, EpisodeUnlock.series_id == series_id)
    )
    return set(rows.all())


async def highest_accessible_number(session: AsyncSession, user_id: uuid.UUID, series: Series) -> int:
    """Highest episode number the user can already watch (free by override or window, or unlocked)."""
    episodes = (
        await session.scalars(
            select(Episode).where(Episode.series_id == series.id, Episode.status == PublishStatus.published)
        )
    ).all()
    unlocked = await unlocked_episode_ids(session, user_id, series.id)
    highest = 0
    for ep in episodes:
        if episode_is_free(series, ep) or ep.id in unlocked:
            highest = max(highest, ep.number)
    return highest


@dataclass
class BundleQuote:
    """What it costs to unlock every episode of a series the viewer cannot already watch."""

    series: Series
    episodes: list[Episode]
    list_price: int
    price: int
    discount_pct: int

    @property
    def count(self) -> int:
        return len(self.episodes)

    @property
    def saving(self) -> int:
        return self.list_price - self.price


async def quote_series_bundle(session: AsyncSession, *, user: User, series: Series) -> BundleQuote:
    """Price the remaining episodes as one purchase. Creates nothing, so the paywall can show it before asking."""
    episodes = list(
        (
            await session.scalars(
                select(Episode)
                .where(Episode.series_id == series.id, Episode.status == PublishStatus.published)
                .order_by(Episode.number)
            )
        ).all()
    )
    unlocked = await unlocked_episode_ids(session, user.id, series.id)
    remaining = [ep for ep in episodes if not episode_is_free(series, ep) and ep.id not in unlocked]
    list_price = sum(episode_price(series, ep) for ep in remaining)
    pct = series.bundle_discount_pct
    if pct is None:
        pct = get_settings().default_bundle_discount_pct
    pct = max(0, min(90, pct))
    # Round down: the viewer is never charged more than the advertised discount implies.
    price = (list_price * (100 - pct)) // 100
    return BundleQuote(series=series, episodes=remaining, list_price=list_price, price=price, discount_pct=pct)


async def unlock_series_bundle(
    session: AsyncSession, *, user: User, series_id: uuid.UUID, variant_map: dict | None = None
) -> list[EpisodeUnlock]:
    """Unlock every remaining episode of a series in one transaction, at the bundle price.

    This deliberately ignores the sequential rule: the viewer has bought the whole series, so there is nothing
    left to unlock in order. The age gate and the VIP/free checks still apply.
    """
    series = await session.get(Series, series_id)
    if series is None or series.status != PublishStatus.published:
        raise NotFound("Series")
    if requires_age_gate(series) and user.age_confirmed_at is None:
        raise AgeGateRequired()
    if await is_vip(session, user.id):
        raise Conflict("VIP already includes every episode", code="already_accessible")

    quote = await quote_series_bundle(session, user=user, series=series)
    if not quote.episodes:
        raise Conflict("Every episode is already unlocked", code="already_accessible")

    # Keyed on the highest episode included, so buying again after new episodes drop is a separate, valid purchase
    # while a double-tap on the same set is a no-op.
    highest = max(ep.number for ep in quote.episodes)
    ledger_row = await ledger.post(
        session,
        user_id=user.id,
        delta=-quote.price,
        kind=LedgerKind.unlock,
        idempotency_key=f"bundle:{user.id}:{series.id}:{highest}",
        ref_type="series",
        ref_id=str(series.id),
        note=f"{quote.count} episodes",
        variant_map=variant_map,
    )
    now = datetime.now(UTC)
    unlocks = [
        EpisodeUnlock(
            user_id=user.id,
            episode_id=ep.id,
            series_id=series.id,
            method=UnlockMethod.coins,
            ledger_id=ledger_row.id,
            variant_map=variant_map,
            created_at=now,
        )
        for ep in quote.episodes
    ]
    session.add_all(unlocks)
    await session.flush()
    return unlocks


async def unlock_episode(
    session: AsyncSession,
    *,
    user: User,
    episode_id: uuid.UUID,
    method: UnlockMethod,
    variant_map: dict | None = None,
    ad_event_id: str | None = None,
) -> EpisodeUnlock:
    """One transaction: validate, post the ledger row (coins) or consume the ad event, insert the unlock. Idempotent."""
    episode = await session.scalar(
        select(Episode).where(Episode.id == episode_id, Episode.status == PublishStatus.published)
    )
    if episode is None:
        raise NotFound("Episode")
    series = await session.get(Series, episode.series_id)
    if series is None or series.status != PublishStatus.published:
        raise NotFound("Series")

    existing = await session.scalar(
        select(EpisodeUnlock).where(EpisodeUnlock.user_id == user.id, EpisodeUnlock.episode_id == episode.id)
    )
    if existing is not None:
        return existing

    if requires_age_gate(series) and user.age_confirmed_at is None:
        raise AgeGateRequired()
    if episode_is_free(series, episode) or await is_vip(session, user.id):
        raise Conflict("Episode is already accessible", code="already_accessible")

    highest = await highest_accessible_number(session, user.id, series)
    if episode.number != highest + 1:
        raise Conflict(f"Unlock episode {highest + 1} first", code="sequential_unlock_required")

    if method == UnlockMethod.coins:
        ledger_row = await ledger.post(
            session,
            user_id=user.id,
            delta=-episode_price(series, episode),
            kind=LedgerKind.unlock,
            idempotency_key=f"unlock:{user.id}:{episode.id}",
            ref_type="episode",
            ref_id=str(episode.id),
            variant_map=variant_map,
        )
    elif method == UnlockMethod.ad:
        if not ad_event_id:
            raise Conflict("A verified ad event is required", code="ad_event_required")
        # Only a network-verified completion (AdEvent written by the SSV callback) can unlock. None exist until
        # phase 2 wires AdMob SSV, so this path rejects every request today by construction.
        await rewards.consume_ad_event(session, user.id, ad_event_id, purpose="unlock")
        ledger_row = await ledger.post(
            session,
            user_id=user.id,
            delta=0,
            kind=LedgerKind.ad_unlock,
            idempotency_key=f"ad-unlock:{user.id}:{episode.id}",
            ref_type="ad_event",
            ref_id=ad_event_id,
            variant_map=variant_map,
        )
    else:
        raise Conflict("Unsupported unlock method", code="bad_method")

    unlock = EpisodeUnlock(
        user_id=user.id,
        episode_id=episode.id,
        series_id=series.id,
        method=method,
        ledger_id=ledger_row.id,
        variant_map=variant_map,
        created_at=datetime.now(UTC),
    )
    session.add(unlock)
    await session.flush()
    return unlock
