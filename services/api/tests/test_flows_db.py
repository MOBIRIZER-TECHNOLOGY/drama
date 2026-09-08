"""Database-backed flow tests: check-in streaks, task claims, purchase settlement. Skipped without KATHA_TEST_DATABASE_URL."""

import os
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import AgeGateRequired, Conflict
from app.models.catalog import PublishStatus, Series, SeriesTranslation
from app.models.identity import Platform, User
from app.models.wallet import (
    CoinPack,
    LedgerKind,
    PackKind,
    PackPrice,
    Purchase,
    PurchaseStatus,
    RewardFrequency,
    RewardTask,
    RewardTaskKind,
)
from app.services import access, ledger, payments, rewards

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


@pytest.fixture
async def session():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()
    await engine.dispose()


async def _user(session) -> User:
    u = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper())
    session.add(u)
    await session.flush()
    return u


async def test_checkin_streak_advances_and_resets(session):
    u = await _user(session)
    d0 = date(2026, 9, 1)
    c1 = await rewards.checkin(session, u, d0)
    c2 = await rewards.checkin(session, u, d0 + timedelta(days=1))
    assert (c1.streak_day, c2.streak_day) == (1, 2)
    with pytest.raises(Conflict):
        await rewards.checkin(session, u, d0 + timedelta(days=1))
    c3 = await rewards.checkin(session, u, d0 + timedelta(days=5))  # gap resets
    assert c3.streak_day == 1
    balance = (await session.get(User, u.id)).coin_balance
    assert balance == c1.coins + c2.coins + c3.coins


async def test_task_claim_once_and_daily(session):
    u = await _user(session)
    once = RewardTask(
        platform=Platform.web, kind=RewardTaskKind.link, title="Follow", coins=20, frequency=RewardFrequency.once
    )
    daily = RewardTask(
        platform=Platform.web, kind=RewardTaskKind.link, title="Visit", coins=5, frequency=RewardFrequency.daily
    )
    session.add_all([once, daily])
    await session.flush()
    await rewards.claim(session, u, once.id)
    with pytest.raises(Conflict):
        await rewards.claim(session, u, once.id)
    await rewards.claim(session, u, daily.id)
    with pytest.raises(Conflict):
        await rewards.claim(session, u, daily.id)
    assert (await session.get(User, u.id)).coin_balance == 25
    listing = await rewards.tasks_for(session, u.id, Platform.web)
    assert all(item["claimed"] for item in listing)


async def test_purchase_settles_once_and_refunds(session):
    u = await _user(session)
    pack = CoinPack(sku=f"p-{uuid.uuid4().hex[:6]}", name="Test", kind=PackKind.coins, coins=100, bonus_coins=10)
    session.add(pack)
    await session.flush()
    session.add(PackPrice(pack_id=pack.id, currency="INR", country="*", amount=99))
    p = Purchase(
        user_id=u.id,
        pack_id=pack.id,
        gateway="test",
        external_id=uuid.uuid4().hex,
        status=PurchaseStatus.pending,
        currency="INR",
        amount=99,
    )
    session.add(p)
    await session.flush()
    await payments.mark_paid(session, p.id)
    await payments.mark_paid(session, p.id)  # webhook retry
    assert (await session.get(User, u.id)).coin_balance == 110
    await payments.mark_refunded(session, p.id)
    assert (await session.get(User, u.id)).coin_balance == 0
    assert (await session.get(Purchase, p.id)).status == PurchaseStatus.refunded


async def test_vip_pack_extends_membership(session):
    u = await _user(session)
    pack = CoinPack(sku=f"v-{uuid.uuid4().hex[:6]}", name="VIP", kind=PackKind.vip, duration_days=30)
    session.add(pack)
    await session.flush()
    for _ in range(2):
        p = Purchase(
            user_id=u.id,
            pack_id=pack.id,
            gateway="test",
            external_id=uuid.uuid4().hex,
            status=PurchaseStatus.pending,
            currency="INR",
            amount=299,
        )
        session.add(p)
        await session.flush()
        await payments.mark_paid(session, p.id)
    assert await access.is_vip(session, u.id)
    assert await access.is_vip(session, u.id, now=datetime.now(UTC) + timedelta(days=55))
    assert not await access.is_vip(session, u.id, now=datetime.now(UTC) + timedelta(days=61))


async def test_ledger_history_order(session):
    u = await _user(session)
    for i in range(3):
        await ledger.post(session, user_id=u.id, delta=1, kind=LedgerKind.admin_adjust, idempotency_key=f"h:{u.id}:{i}")
    rows = await ledger.history(session, u.id, limit=2)
    assert len(rows) == 2 and rows[0].created_at >= rows[1].created_at


async def test_ad_unlock_rejected_without_verified_event(session):
    from app.models.catalog import Episode as Ep
    from app.models.wallet import AdEvent, UnlockMethod

    u = await _user(session)
    # Rated explicitly: an unrated series counts as adult, which would trip the age gate before the ad check.
    s = Series(
        slug=f"s-{uuid.uuid4().hex[:8]}",
        free_episodes=1,
        episode_price=10,
        status=PublishStatus.published,
        content_rating="U",
    )
    session.add(s)
    await session.flush()
    session.add(SeriesTranslation(series_id=s.id, lang="en", title="T"))
    # Three episodes: 1 is free, 2 and 3 are locked, so a reused ad event has a legitimate next target to try.
    eps = [
        Ep(series_id=s.id, number=n, status=PublishStatus.published, published_at=datetime.now(UTC)) for n in (1, 2, 3)
    ]
    session.add_all(eps)
    await session.flush()

    # A client-invented transaction id unlocks nothing: only a network-verified AdEvent counts.
    with pytest.raises(Conflict):
        await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.ad, ad_event_id="forged")

    session.add(
        AdEvent(user_id=u.id, network="admob", ssv_transaction_id="tx1", purpose="unlock", created_at=datetime.now(UTC))
    )
    await session.flush()
    row = await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.ad, ad_event_id="tx1")
    assert row.method == UnlockMethod.ad

    # Replaying the same request is idempotent: the same unlock comes back and nothing further is consumed.
    again = await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.ad, ad_event_id="tx1")
    assert again.id == row.id

    # The fraud case: one verified ad completion must not unlock a second episode.
    with pytest.raises(Conflict):
        await access.unlock_episode(session, user=u, episode_id=eps[2].id, method=UnlockMethod.ad, ad_event_id="tx1")


async def test_paid_then_refund_is_terminal(session):
    u = await _user(session)
    pack = CoinPack(sku=f"p-{uuid.uuid4().hex[:6]}", name="Test", kind=PackKind.coins, coins=100)
    session.add(pack)
    await session.flush()
    p = Purchase(
        user_id=u.id,
        pack_id=pack.id,
        gateway="test",
        external_id=uuid.uuid4().hex,
        status=PurchaseStatus.pending,
        currency="INR",
        amount=99,
    )
    session.add(p)
    await session.flush()
    await payments.mark_paid(session, p.id, amount_minor=9900, currency="INR")
    await payments.mark_refunded(session, p.id)
    await payments.mark_paid(session, p.id)  # replayed capture after refund must not flip back
    assert (await session.get(Purchase, p.id)).status == PurchaseStatus.refunded
    assert (await session.get(User, u.id)).coin_balance == 0


async def test_amount_mismatch_fails_purchase(session):
    u = await _user(session)
    pack = CoinPack(sku=f"p-{uuid.uuid4().hex[:6]}", name="Test", kind=PackKind.coins, coins=100)
    session.add(pack)
    await session.flush()
    p = Purchase(
        user_id=u.id,
        pack_id=pack.id,
        gateway="test",
        external_id=uuid.uuid4().hex,
        status=PurchaseStatus.pending,
        currency="INR",
        amount=99,
    )
    session.add(p)
    await session.flush()
    await payments.mark_paid(session, p.id, amount_minor=100, currency="INR")
    assert (await session.get(Purchase, p.id)).status == PurchaseStatus.failed
    assert (await session.get(User, u.id)).coin_balance == 0


async def test_webhook_inbox_dedupes(session):
    assert await payments.record_event(session, "stripe", "evt_1", "x", {}) is not None
    assert await payments.record_event(session, "stripe", "evt_1", "x", {}) is None


async def test_offer_eligibility_and_coupon(session):
    from app.models.wallet import Coupon, Offer
    from app.services import offers as offers_svc

    u = await _user(session)
    first = Offer(title="Welcome 30", kind="first_purchase", discount_pct=30, is_active=True)
    win = Offer(title="Come back", kind="winback", discount_pct=20, eligibility={"inactive_days": 14})
    code_offer = Offer(title="Promo", kind="coupon", discount_pct=10)
    session.add_all([first, win, code_offer])
    await session.flush()
    session.add(Coupon(code="KATHA10", offer_id=code_offer.id, max_uses=1))
    await session.flush()
    visible = await offers_svc.eligible(session, u, country=None)
    assert {o.title for o in visible} == {
        "Welcome 30"
    }  # no purchases yet: first-purchase yes, winback no, coupon hidden
    offer, coupon = await offers_svc.resolve_coupon(session, "katha10", u, country="IN")
    assert offer.id == code_offer.id and coupon.code == "KATHA10"


async def test_age_gate_blocks_unlock(session):
    from app.models.catalog import Episode as Ep
    from app.models.wallet import UnlockMethod

    u = await _user(session)
    await ledger.post(session, user_id=u.id, delta=100, kind=LedgerKind.admin_adjust, idempotency_key=f"a:{u.id}")
    s = Series(
        slug=f"s-{uuid.uuid4().hex[:8]}",
        free_episodes=1,
        episode_price=10,
        status=PublishStatus.published,
        content_rating="A",
    )
    session.add(s)
    await session.flush()
    session.add(SeriesTranslation(series_id=s.id, lang="en", title="T"))
    eps = [Ep(series_id=s.id, number=n, status=PublishStatus.published, published_at=datetime.now(UTC)) for n in (1, 2)]
    session.add_all(eps)
    await session.flush()
    with pytest.raises(AgeGateRequired):
        await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.coins)
    u.age_confirmed_at = datetime.now(UTC)
    row = await access.unlock_episode(session, user=u, episode_id=eps[1].id, method=UnlockMethod.coins)
    assert row.method == UnlockMethod.coins


async def test_quote_prices_without_creating_a_purchase(session):
    from sqlalchemy import func
    from sqlalchemy import select as sel

    from app.models.wallet import CoinPack as CP
    from app.models.wallet import Offer
    from app.models.wallet import PackPrice as PP
    from app.services import payments as pay

    u = await _user(session)
    pack = CP(sku=f"q-{uuid.uuid4().hex[:6]}", name="Starter", kind=PackKind.coins, coins=100, bonus_coins=10)
    session.add(pack)
    await session.flush()
    session.add(PP(pack_id=pack.id, currency="INR", country="*", amount=99))
    offer = Offer(title="Welcome 30", kind="first_purchase", discount_pct=30, is_active=True)
    session.add(offer)
    await session.flush()

    before = await session.scalar(sel(func.count()).select_from(Purchase))
    plain = await pay.quote_purchase(session, user=u, pack_id=pack.id, currency="INR", country="*")
    assert plain.amount == plain.list_amount == 99 and plain.coins == 110 and plain.discount_pct is None
    discounted = await pay.quote_purchase(
        session, user=u, pack_id=pack.id, currency="INR", country="*", offer_id=offer.id, country_hint="IN"
    )
    assert discounted.amount == Decimal("69.30") and discounted.discount_pct == 30
    after = await session.scalar(sel(func.count()).select_from(Purchase))
    assert before == after  # quoting creates nothing


async def test_ad_unlocks_are_capped_per_day(session):
    """The daily cap was published to every client and enforced nowhere.

    `/v1/config` tells the app `economy.ad_unlocks_per_day`, and the app shows it as a free-unlock counter, but
    nothing on the server counted them. Ad unlocks cannot currently succeed at all (they need a network-verified
    AdEvent, and AdMob SSV only landed recently), so the hole was invisible: the moment that path works, the cap
    is the only thing standing between a viewer and the whole catalogue for the price of watching adverts.
    """
    from app.models.catalog import Episode as Ep
    from app.models.ops import Setting
    from app.models.wallet import AdEvent, UnlockMethod

    u = await _user(session)
    s = Series(
        slug=f"s-{uuid.uuid4().hex[:8]}",
        free_episodes=1,
        episode_price=10,
        status=PublishStatus.published,
        content_rating="U",
    )
    session.add(s)
    await session.flush()
    session.add(SeriesTranslation(series_id=s.id, lang="en", title="T"))
    eps = [
        Ep(series_id=s.id, number=n, status=PublishStatus.published, published_at=datetime.now(UTC))
        for n in (1, 2, 3, 4)
    ]
    session.add_all(eps)

    # A cap of two, so the third unlock is the one that must be refused.
    session.add(Setting(namespace="economy", data={"ad_unlocks_per_day": 2}, updated_at=datetime.now(UTC)))
    await session.flush()

    assert await access.ad_unlocks_remaining(session, u.id) == 2

    for i, episode in enumerate(eps[1:3], start=1):
        session.add(
            AdEvent(
                user_id=u.id,
                network="admob",
                ssv_transaction_id=f"cap-tx{i}",
                purpose="unlock",
                created_at=datetime.now(UTC),
            )
        )
        await session.flush()
        await access.unlock_episode(
            session, user=u, episode_id=episode.id, method=UnlockMethod.ad, ad_event_id=f"cap-tx{i}"
        )

    assert await access.ad_unlocks_remaining(session, u.id) == 0

    # A third, with a perfectly valid ad event: the cap is what refuses it, not the event.
    session.add(
        AdEvent(
            user_id=u.id,
            network="admob",
            ssv_transaction_id="cap-tx3",
            purpose="unlock",
            created_at=datetime.now(UTC),
        )
    )
    await session.flush()
    with pytest.raises(Conflict) as exc:
        await access.unlock_episode(
            session, user=u, episode_id=eps[3].id, method=UnlockMethod.ad, ad_event_id="cap-tx3"
        )
    assert exc.value.detail["code"] == "ad_unlock_limit_reached"

    # Coins are a separate budget and must not be caught by an ad cap.
    await ledger.post(session, user_id=u.id, delta=100, kind=LedgerKind.signup_bonus, idempotency_key=f"top-{u.id}")
    row = await access.unlock_episode(session, user=u, episode_id=eps[3].id, method=UnlockMethod.coins)
    assert row is not None
