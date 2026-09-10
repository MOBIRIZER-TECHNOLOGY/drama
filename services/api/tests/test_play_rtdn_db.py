"""Play refunds against the database: a void takes the coins back, and the inbox makes delivery idempotent.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import base64
import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.identity import User
from app.models.wallet import CoinPack, PackKind, Purchase, PurchaseStatus
from app.services import payments, store_billing

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

PACKAGE = "app.katha.test"
AUDIENCE = "https://api.katha.test/v1/webhooks/play"
SERVICE_ACCOUNT = "play-rtdn@katha-test.iam.gserviceaccount.com"


@pytest.fixture
async def session():
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()
    await engine.dispose()


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_play_package_name", PACKAGE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_audience", AUDIENCE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_service_account_email", SERVICE_ACCOUNT, raising=False)


async def _paid_play_purchase(session) -> tuple[User, Purchase]:
    u = User(public_id=str(uuid.uuid4().int)[:8], referral_code=uuid.uuid4().hex[:8].upper())
    pack = CoinPack(sku=f"p-{uuid.uuid4().hex[:6]}", name="Test", kind=PackKind.coins, coins=100)
    session.add_all([u, pack])
    await session.flush()
    p = Purchase(
        user_id=u.id,
        pack_id=pack.id,
        gateway=store_billing.GATEWAY,
        external_id=f"play-token-{uuid.uuid4().hex}",
        status=PurchaseStatus.pending,
        currency="INR",
        amount=99,
    )
    session.add(p)
    await session.flush()
    await payments.mark_paid(session, p.id)
    assert (await session.get(User, u.id)).coin_balance == 100
    return u, p


def _cancelled(token: str, package: str = PACKAGE) -> dict:
    return {
        "version": "1.0",
        "packageName": package,
        "eventTimeMillis": "1757412000000",
        "oneTimeProductNotification": {
            "version": "1.0",
            "notificationType": store_billing.ONE_TIME_PRODUCT_CANCELED,
            "purchaseToken": token,
            "sku": "coins_100",
        },
    }


def _voided(token: str) -> dict:
    return {
        "version": "1.0",
        "packageName": PACKAGE,
        "eventTimeMillis": "1757412000000",
        "voidedPurchaseNotification": {"purchaseToken": token, "orderId": "GPA.1", "productType": 1, "refundType": 1},
    }


async def test_a_cancelled_play_purchase_is_refunded_once(session):
    u, p = await _paid_play_purchase(session)
    assert await store_billing.apply_rtdn(session, _cancelled(p.external_id)) == "refunded"
    assert (await session.get(User, u.id)).coin_balance == 0
    assert (await session.get(Purchase, p.id)).status == PurchaseStatus.refunded
    # The void for the same purchase, arriving later, finds nothing left to reverse.
    await store_billing.apply_rtdn(session, _voided(p.external_id))
    assert (await session.get(User, u.id)).coin_balance == 0


async def test_another_apps_notification_is_ignored(session):
    u, p = await _paid_play_purchase(session)
    assert await store_billing.apply_rtdn(session, _cancelled(p.external_id, package="com.other.app")) == "ignored"
    assert (await session.get(Purchase, p.id)).status == PurchaseStatus.paid
    assert (await session.get(User, u.id)).coin_balance == 100


async def test_a_void_for_a_token_never_redeemed_here_is_ignored(session):
    assert await store_billing.apply_rtdn(session, _voided("never-seen")) == "ignored"


async def test_the_webhook_route_reverses_the_purchase_and_dedupes_redelivery(monkeypatch):
    """Pub/Sub redelivers until it gets a 2xx, so the same message id must be answered without a second reversal."""
    engine = create_async_engine(DB_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _session():
        async with maker() as s:
            yield s

    def good_claims(token, audience):
        return {"aud": audience, "email": SERVICE_ACCOUNT, "email_verified": True}

    monkeypatch.setattr(store_billing, "_google_oidc_verifier", good_claims)
    app.dependency_overrides[get_session] = _session
    try:
        async with maker() as s:
            u, p = await _paid_play_purchase(s)
            await s.commit()
        message_id = f"msg-{uuid.uuid4().hex}"
        body = {
            "message": {
                "data": base64.b64encode(json.dumps(_voided(p.external_id)).encode()).decode(),
                "messageId": message_id,
            },
            "subscription": "projects/katha-test/subscriptions/play-rtdn",
        }
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            first = await c.post("/v1/webhooks/play", json=body, headers={"Authorization": "Bearer jwt"})
            assert first.status_code == 200, first.text
            assert first.json() == {"result": "refunded"}
            again = await c.post("/v1/webhooks/play", json=body, headers={"Authorization": "Bearer jwt"})
            assert again.status_code == 200 and again.json() == {"result": "duplicate"}
        async with maker() as s:
            assert (await s.get(Purchase, p.id)).status == PurchaseStatus.refunded
            assert (await s.get(User, u.id)).coin_balance == 0
    finally:
        app.dependency_overrides.pop(get_session, None)
        await engine.dispose()
