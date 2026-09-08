"""Finding one order among many.

The console's search box and date range used to filter the rows already loaded, so a dispute quoting an order
id could only be found if that order happened to be on the current page — and the money figure beside it was a
subtotal of whatever had loaded rather than of what was asked for. Both now run in the database, and these
cover the shapes a dispute actually arrives in.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.core.db import get_session
from app.main import app
from app.models.identity import AdminRole, AdminUser, User
from app.models.wallet import CoinPack, PackKind, Purchase, PurchaseStatus

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")


@pytest.fixture
async def seeded():
    """Two buyers, three orders, one of them a month old — enough to tell filtering from luck."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    marker = uuid.uuid4().hex[:8]
    async with maker() as s:
        admin = AdminUser(
            email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
            display_name="Finance",
            password_hash="x",
            role=AdminRole.owner,
            is_active=True,
        )
        buyer = User(
            public_id=f"pub{marker}",
            email=f"buyer-{marker}@katha-test.dev",
            referral_code=uuid.uuid4().hex[:8].upper(),
        )
        other = User(public_id=f"oth{marker}", referral_code=uuid.uuid4().hex[:8].upper())
        pack = CoinPack(sku=f"pk-{marker}", name="Test pack", kind=PackKind.coins, coins=100)
        s.add_all([admin, buyer, other, pack])
        await s.flush()

        now = datetime.now(UTC)
        recent = Purchase(
            user_id=buyer.id,
            pack_id=pack.id,
            gateway="stripe",
            external_id=f"cs_{marker}",
            gateway_payment_id=f"pi_{marker}",
            status=PurchaseStatus.paid,
            currency="INR",
            amount=99,
            coins_granted=100,
            created_at=now,
            paid_at=now,
        )
        old = Purchase(
            user_id=buyer.id,
            pack_id=pack.id,
            gateway="stripe",
            external_id=f"cs_old_{marker}",
            gateway_payment_id=f"pi_old_{marker}",
            status=PurchaseStatus.paid,
            currency="INR",
            amount=449,
            coins_granted=550,
            created_at=now - timedelta(days=30),
            paid_at=now - timedelta(days=30),
        )
        someone_else = Purchase(
            user_id=other.id,
            pack_id=pack.id,
            gateway="razorpay",
            external_id=f"or_{marker}",
            gateway_payment_id=f"pay_{marker}",
            status=PurchaseStatus.paid,
            currency="INR",
            amount=799,
            coins_granted=1200,
            created_at=now,
            paid_at=now,
        )
        s.add_all([recent, old, someone_else])
        await s.commit()

        async def _session():
            async with maker() as inner:
                yield inner

        app.dependency_overrides[deps.current_admin] = lambda: admin
        app.dependency_overrides[get_session] = _session
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c, marker, recent, buyer
        app.dependency_overrides.pop(deps.current_admin, None)
        app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def test_search_by_gateway_payment_id(seeded):
    """The id a Stripe dispute quotes — ours is not the one the other party holds."""
    client, marker, recent, _ = seeded
    r = await client.get(f"/v1/admin/purchases?q=pi_{marker}")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["items"]]
    assert str(recent.id) in ids
    assert r.json()["total"] == 1


async def test_search_by_email(seeded):
    client, marker, _, _ = seeded
    r = await client.get(f"/v1/admin/purchases?q=buyer-{marker}@katha-test.dev")
    page = r.json()
    assert page["total"] == 2, "both of this buyer's orders, not just the ones on screen"


async def test_search_by_our_own_uuid(seeded):
    client, _, recent, _ = seeded
    r = await client.get(f"/v1/admin/purchases?q={recent.id}")
    assert [p["id"] for p in r.json()["items"]] == [str(recent.id)]


async def test_date_range_is_inclusive_of_the_end_day(seeded):
    client, marker, recent, _ = seeded
    today = datetime.now(UTC).date().isoformat()
    r = await client.get(f"/v1/admin/purchases?q={marker}&date_from={today}&date_to={today}")
    page = r.json()
    # The month-old order is excluded; both of today's are kept.
    assert page["total"] == 2
    assert all(p["created_at"][:10] == today for p in page["items"])


async def test_totals_follow_the_filter_not_the_page(seeded):
    """The reconciliation figure must describe what was asked for, not what happened to load."""
    client, marker, _, _ = seeded
    r = await client.get(f"/v1/admin/purchases?q=buyer-{marker}@katha-test.dev&limit=1")
    page = r.json()
    assert len(page["items"]) == 1, "one row on the page"
    assert page["total"] == 2, "but two in the filtered set"
    assert page["totals_by_currency"]["INR"] == pytest.approx(99 + 449)
