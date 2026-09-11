"""The money path, exercised as behaviour rather than as lines.

Four modules decide whether coins are real: `services/payments.py` (quotes, checkout, the webhook state
machine and the referral reversal), `services/store_billing.py` (Google Play), `routers/purchases.py` (the
front door and the webhook endpoints) and `routers/admin_monetization.py` (packs, prices and the settings
that move revenue). Between them they were the least covered part of the service, and every rule below is one
a bug could quietly break while the type checker and the unit tests stayed green:

  - coins only ever move through the ledger, and only a *verified* webhook turns a purchase into `paid`;
  - the country and currency a purchase is priced in come from the server, so a cheap regional price cannot
    be claimed by a client that says it is somewhere else;
  - a refund reverses the buyer's coins *and* the referrer's reward, so a cheap pack plus a refund cannot be
    farmed for referral coins;
  - a webhook without a valid signature, a replay of one already handled, and an event we do not recognise
    are each refused or ignored — but a delivery whose handler *failed* must be retried, not swallowed;
  - a pack, its prices and its offers are finance's to change, and the price edit has to reach checkout.

Every external gateway is faked at its boundary — the Stripe SDK call, the httpx client each service module
holds, Google's OIDC verifier — so nothing here talks to a real payment provider. Signatures, where they are
the thing under test, are computed for real.

Skipped without KATHA_TEST_DATABASE_URL.
"""

import contextlib
import hashlib
import hmac
import json
import os
import random
import time
import types
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
import stripe
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import deps
from app.api.deps import AuthContext
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import AppError, NotFound
from app.main import app
from app.models.identity import AdminRole, AdminUser, User
from app.models.ops import Setting
from app.models.wallet import (
    CoinLedger,
    CoinPack,
    Coupon,
    LedgerKind,
    Offer,
    PackKind,
    PackPrice,
    Purchase,
    PurchaseStatus,
    Referral,
    VipMembership,
    WebhookEvent,
)
from app.services import payments, store_billing

DB_URL = os.environ.get("KATHA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="KATHA_TEST_DATABASE_URL not set")

STRIPE_WHSEC = "whsec_katha_test"
RAZORPAY_KEY_ID = "rzp_test_katha"
RAZORPAY_KEY_SECRET = "rzp_secret_katha"
RAZORPAY_WHSEC = "rzp_whsec_katha"
PLAY_PACKAGE = "app.katha.test"
PLAY_AUDIENCE = "https://api.katha.test/v1/webhooks/play"
PLAY_SERVICE_ACCOUNT = "play-rtdn@katha-test.iam.gserviceaccount.com"
# The edge header the CDN sets. Offers seeded by these tests are scoped to one country so that rows they
# leave behind in the shared database cannot appear in another test's list of eligible offers.
INDIA = {"cf-ipcountry": "IN"}


# ---------------------------------------------------------------------------
# database and app plumbing
# ---------------------------------------------------------------------------


@pytest.fixture
async def engine():
    e = create_async_engine(DB_URL)
    yield e
    await e.dispose()


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def session(maker):
    """A session whose work is rolled back: service-level tests leave the shared database as they found it."""
    async with maker() as s:
        yield s
        await s.rollback()


@pytest.fixture
def committed(maker):
    """Seed rows a *route* has to see: the route opens its own session, so the rows must be committed."""

    @contextlib.asynccontextmanager
    async def _cm():
        async with maker() as s:
            yield s
            await s.commit()

    return _cm


def _client_ip() -> str:
    """A distinct peer address per client, so one test's requests do not spend another's rate-limit budget."""
    return "10." + ".".join(str(random.randint(1, 254)) for _ in range(3))


def _transport() -> ASGITransport:
    return ASGITransport(app=app, client=(_client_ip(), 40000))


async def seed_user(session, *, email: str | None = None) -> User:
    u = User(
        public_id=str(uuid.uuid4().int)[:8],
        email=email,
        referral_code=uuid.uuid4().hex[:8].upper(),
        coin_balance=0,
    )
    session.add(u)
    await session.flush()
    return u


async def seed_pack(
    session,
    *,
    kind: PackKind = PackKind.coins,
    coins: int = 100,
    bonus: int = 10,
    duration_days: int | None = None,
    google_product_id: str | None = None,
    prices: tuple[tuple[str, str, str], ...] = (("INR", "*", "499.00"),),
    is_active: bool = True,
) -> CoinPack:
    pack = CoinPack(
        sku=f"pk-{uuid.uuid4().hex[:10]}",
        name="Coverage pack",
        kind=kind,
        coins=coins,
        bonus_coins=bonus,
        duration_days=duration_days,
        google_product_id=google_product_id,
        is_active=is_active,
    )
    session.add(pack)
    await session.flush()
    for currency, country, amount in prices:
        session.add(PackPrice(pack_id=pack.id, currency=currency, country=country, amount=Decimal(amount)))
    await session.flush()
    return pack


async def seed_purchase(
    session,
    *,
    user: User,
    pack: CoinPack,
    gateway: str = "stripe",
    status: PurchaseStatus = PurchaseStatus.pending,
    amount: str = "499.00",
    currency: str = "INR",
    **kw,
) -> Purchase:
    p = Purchase(
        user_id=user.id,
        pack_id=pack.id,
        gateway=gateway,
        status=status,
        currency=currency,
        amount=Decimal(amount),
        coins_granted=0,
        **kw,
    )
    session.add(p)
    await session.flush()
    return p


async def seed_admin(session, role: AdminRole = AdminRole.owner) -> AdminUser:
    a = AdminUser(
        email=f"{uuid.uuid4().hex[:10]}@katha-test.dev",
        display_name=f"Test {role.value}",
        password_hash="x",
        role=role,
        is_active=True,
    )
    session.add(a)
    await session.flush()
    return a


@pytest.fixture
async def buyer(committed):
    async with committed() as s:
        return await seed_user(s, email=f"buyer-{uuid.uuid4().hex[:8]}@katha-test.dev")


@pytest.fixture
async def client(maker, buyer):
    """The app, signed in as `buyer`, pointed at the test database."""

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[deps.current_user] = lambda: AuthContext(user=buyer, session_id=None)
    async with AsyncClient(transport=_transport(), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(deps.current_user, None)


@pytest.fixture
async def admin_client(maker, committed):
    """An owner, who passes every role check on the monetization router."""
    async with committed() as s:
        admin = await seed_admin(s, AdminRole.owner)

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[deps.current_admin] = lambda: admin
    async with AsyncClient(transport=_transport(), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(deps.current_admin, None)


@pytest.fixture
async def editor_client(maker, committed):
    """An editor: allowed into the router, but not allowed to touch anything priced."""
    async with committed() as s:
        admin = await seed_admin(s, AdminRole.editor)

    async def _session():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[deps.current_admin] = lambda: admin
    async with AsyncClient(transport=_transport(), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(deps.current_admin, None)


@pytest.fixture
async def retired_offers(maker):
    """Offer ids to delete when the test ends.

    An active offer is global: every user sees it in `offers.eligible`. Leaving one behind in the shared test
    database changes what unrelated tests see, so a test that has to commit one takes it away again.
    """
    ids: list[uuid.UUID] = []
    yield ids
    async with maker() as s:
        for offer_id in ids:
            row = await s.get(Offer, offer_id)
            if row is not None:
                await s.delete(row)
        await s.commit()


@pytest.fixture
def gateways(monkeypatch):
    """Credentials for every gateway, so "not configured" is a state a test opts into rather than the default."""
    s = get_settings()
    monkeypatch.setattr(s, "stripe_secret_key", "sk_test_katha", raising=False)
    monkeypatch.setattr(s, "stripe_webhook_secret", STRIPE_WHSEC, raising=False)
    monkeypatch.setattr(s, "razorpay_key_id", RAZORPAY_KEY_ID, raising=False)
    monkeypatch.setattr(s, "razorpay_key_secret", RAZORPAY_KEY_SECRET, raising=False)
    monkeypatch.setattr(s, "razorpay_webhook_secret", RAZORPAY_WHSEC, raising=False)
    monkeypatch.setattr(s, "google_play_package_name", PLAY_PACKAGE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_audience", PLAY_AUDIENCE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_service_account_email", PLAY_SERVICE_ACCOUNT, raising=False)
    return s


# ---------------------------------------------------------------------------
# fake gateways, at the boundary
# ---------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = json.dumps(self._payload)

    def json(self) -> dict:
        return self._payload


def fake_http(monkeypatch, module, handler):
    """Swap the `httpx` name *inside one module* for a stub client driven by `handler`.

    Replacing the attribute on the module rather than on httpx itself matters: the tests drive the app
    through a real `httpx.AsyncClient`, and patching the library globally would break the test's own client.
    Returns the list of calls made, each with the client's constructor kwargs (Razorpay's basic auth rides
    there) alongside the request's.
    """
    calls: list[types.SimpleNamespace] = []

    class _Client:
        def __init__(self, *args, **kwargs):
            self.init = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def _call(self, method, url, **kwargs):
            calls.append(types.SimpleNamespace(method=method, url=url, kwargs=kwargs, init=self.init))
            return handler(method, url, **kwargs)

        async def get(self, url, **kwargs):
            return await self._call("GET", url, **kwargs)

        async def post(self, url, **kwargs):
            return await self._call("POST", url, **kwargs)

    monkeypatch.setattr(module, "httpx", types.SimpleNamespace(AsyncClient=_Client))
    return calls


def fake_stripe_checkout(monkeypatch):
    """Record what we ask Stripe to charge, and answer with a session, without the SDK leaving the process."""
    created: list[dict] = []

    def _create(**params):
        created.append(params)
        sid = f"cs_test_{uuid.uuid4().hex[:12]}"
        return types.SimpleNamespace(id=sid, url=f"https://checkout.stripe.test/{sid}")

    monkeypatch.setattr(stripe.checkout.Session, "create", _create)
    return created


def stripe_signature(payload: bytes, secret: str = STRIPE_WHSEC) -> str:
    """A genuine Stripe signature header, so `verify_stripe` is exercised rather than stubbed out."""
    ts = int(time.time())
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def razorpay_signature(payload: bytes, secret: str = RAZORPAY_WHSEC) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def stripe_event(kind: str, obj: dict, event_id: str | None = None) -> dict:
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex[:16]}",
        "object": "event",
        "api_version": "2024-06-20",
        "created": int(time.time()),
        "type": kind,
        "data": {"object": obj},
    }


def razorpay_captured(purchase_id, *, payment_id: str, amount_minor: int, currency: str = "INR") -> dict:
    return {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "amount": amount_minor,
                    "currency": currency,
                    "notes": {"purchase_id": str(purchase_id)},
                }
            }
        },
    }


def razorpay_refunded(payment_id: str) -> dict:
    return {
        "event": "refund.processed",
        "payload": {"refund": {"entity": {"id": f"rfnd_{uuid.uuid4().hex[:10]}", "payment_id": payment_id}}},
    }


async def post_razorpay(client, event: dict, *, event_id: str | None = None, signature: str | None = None):
    body = json.dumps(event).encode()
    headers = {"content-type": "application/json", "x-razorpay-signature": signature or razorpay_signature(body)}
    if event_id:
        headers["x-razorpay-event-id"] = event_id
    return await client.post("/v1/webhooks/razorpay", content=body, headers=headers)


async def balance(maker, user_id) -> int:
    async with maker() as s:
        return await s.scalar(select(User.coin_balance).where(User.id == user_id))


# ---------------------------------------------------------------------------
# checkout: the server decides what this costs
# ---------------------------------------------------------------------------


async def test_the_price_comes_from_the_edges_country_and_never_from_the_client(
    client, committed, gateways, monkeypatch
):
    """Regional pricing is only safe while the client cannot choose its region.

    The pack below costs ₹99 in India and ₹499 everywhere else. The country is read from the edge header the
    request arrived with; a body field claiming one is ignored, because `CheckoutIn` has no such field and a
    client that invents one must not get the cheap price.
    """
    fake_stripe_checkout(monkeypatch)
    async with committed() as s:
        pack = await seed_pack(s, prices=(("INR", "*", "499.00"), ("INR", "IN", "99.00")))

    common = {
        "pack_id": str(pack.id),
        "gateway": "stripe",
        "currency": "INR",
        "success_url": "https://katha.test/ok",
        "cancel_url": "https://katha.test/no",
    }

    from_india = await client.post("/v1/purchases/checkout", json=common, headers={"cf-ipcountry": "IN"})
    assert from_india.status_code == 200, from_india.text
    assert from_india.json()["amount"] == 99.0

    unknown = await client.post("/v1/purchases/checkout", json=common)
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["amount"] == 499.0, "an unknown country pays the world price"

    claiming = await client.post("/v1/purchases/checkout", json={**common, "country": "IN"})
    assert claiming.status_code == 200, claiming.text
    assert claiming.json()["amount"] == 499.0, "a client that claims a country in the body is still charged 499"


async def test_a_stripe_checkout_creates_a_pending_purchase_and_asks_stripe_for_the_right_amount(
    client, committed, maker, gateways, monkeypatch
):
    created = fake_stripe_checkout(monkeypatch)
    async with committed() as s:
        pack = await seed_pack(s, coins=100, bonus=10, prices=(("INR", "*", "499.00"),))

    r = await client.post(
        "/v1/purchases/checkout",
        json={
            "pack_id": str(pack.id),
            "gateway": "stripe",
            "currency": "INR",
            "success_url": "https://katha.test/ok?ref=1",
            "cancel_url": "https://katha.test/no",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gateway"] == "stripe" and body["currency"] == "INR"
    assert body["checkout_url"].startswith("https://checkout.stripe.test/")

    (params,) = created
    line = params["line_items"][0]["price_data"]
    assert line["unit_amount"] == 49900, "Stripe is asked for minor units of the server-side price"
    assert line["currency"] == "inr"
    assert params["metadata"]["purchase_id"] == body["purchase_id"]
    # The return URLs carry the purchase so the client can poll the row it just created; the existing query
    # string has to survive that.
    assert params["success_url"] == f"https://katha.test/ok?ref=1&purchase_id={body['purchase_id']}"
    assert params["cancel_url"] == f"https://katha.test/no?purchase_id={body['purchase_id']}"

    async with maker() as s:
        p = await s.get(Purchase, uuid.UUID(body["purchase_id"]))
        assert p.status is PurchaseStatus.pending, "a checkout is an intention, not a payment"
        assert p.coins_granted == 0
        assert p.external_id.startswith("cs_test_")
    assert await balance(maker, p.user_id) == 0, "no coins until a verified webhook says so"


async def test_a_razorpay_checkout_creates_an_order_with_our_credentials(
    client, committed, maker, gateways, monkeypatch
):
    order_id = f"order_{uuid.uuid4().hex[:12]}"
    calls = fake_http(monkeypatch, payments, lambda *a, **kw: FakeResponse(200, {"id": order_id}))
    async with committed() as s:
        pack = await seed_pack(s, prices=(("INR", "*", "499.00"),))

    r = await client.post(
        "/v1/purchases/checkout",
        json={
            "pack_id": str(pack.id),
            "gateway": "razorpay",
            "currency": "INR",
            "success_url": "https://katha.test/ok",
            "cancel_url": "https://katha.test/no",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order_id"] == order_id
    assert body["key_id"] == RAZORPAY_KEY_ID, "the client needs the publishable key to open Checkout.js"
    assert body["amount_minor"] == 49900 and body["amount"] == 499.0

    (call,) = calls
    assert call.url == "https://api.razorpay.com/v1/orders"
    assert call.init["auth"] == (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
    assert call.kwargs["json"]["amount"] == 49900 and call.kwargs["json"]["currency"] == "INR"
    assert call.kwargs["json"]["notes"]["purchase_id"] == body["purchase_id"]

    async with maker() as s:
        p = await s.get(Purchase, uuid.UUID(body["purchase_id"]))
        assert p.status is PurchaseStatus.pending and p.external_id == order_id


async def test_an_order_the_gateway_refuses_leaves_no_purchase_behind(client, committed, maker, gateways, monkeypatch):
    """A failed order must not leave a pending row that a later webhook could pair with."""
    fake_http(monkeypatch, payments, lambda *a, **kw: FakeResponse(500, {"error": "gateway down"}))
    async with committed() as s:
        pack = await seed_pack(s)

    r = await client.post(
        "/v1/purchases/checkout",
        json={
            "pack_id": str(pack.id),
            "gateway": "razorpay",
            "currency": "INR",
            "success_url": "https://katha.test/ok",
            "cancel_url": "https://katha.test/no",
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "gateway_error"
    async with maker() as s:
        assert await s.scalar(select(Purchase.id).where(Purchase.pack_id == pack.id)) is None


async def test_a_gateway_without_credentials_refuses_rather_than_half_charging(
    client, committed, gateways, monkeypatch
):
    async with committed() as s:
        pack = await seed_pack(s)
    monkeypatch.setattr(gateways, "stripe_secret_key", None, raising=False)
    monkeypatch.setattr(gateways, "razorpay_key_secret", None, raising=False)
    payload = {
        "pack_id": str(pack.id),
        "currency": "INR",
        "success_url": "https://katha.test/ok",
        "cancel_url": "https://katha.test/no",
    }
    for gateway in ("stripe", "razorpay"):
        r = await client.post("/v1/purchases/checkout", json={**payload, "gateway": gateway})
        assert r.status_code == 400, r.text
        assert r.json()["detail"]["code"] == "gateway_unavailable"


async def test_a_gateway_we_do_not_support_is_refused_at_both_layers(client, session, committed, gateways):
    """The schema rejects the spelling; the service rejects it again for anything that calls it directly."""
    async with committed() as s:
        pack = await seed_pack(s)
    r = await client.post(
        "/v1/purchases/checkout",
        json={
            "pack_id": str(pack.id),
            "gateway": "paypal",
            "currency": "INR",
            "success_url": "https://katha.test/ok",
            "cancel_url": "https://katha.test/no",
        },
    )
    assert r.status_code == 422

    user = await seed_user(session)
    local_pack = await seed_pack(session)
    with pytest.raises(AppError) as exc:
        await payments.create_purchase(
            session,
            user=user,
            pack_id=local_pack.id,
            gateway="paypal",
            currency="INR",
            country="*",
            success_url="https://katha.test/ok",
            cancel_url="https://katha.test/no",
            variant_map=None,
        )
    assert exc.value.detail["code"] == "bad_gateway"


# ---------------------------------------------------------------------------
# quotes, offers and coupons
# ---------------------------------------------------------------------------


async def test_a_quote_prices_the_pack_without_creating_anything(client, committed, maker):
    async with committed() as s:
        pack = await seed_pack(s, coins=100, bonus=10, prices=(("INR", "*", "499.00"), ("INR", "IN", "99.00")))

    r = await client.post(
        "/v1/purchases/quote", json={"pack_id": str(pack.id), "currency": "INR"}, headers={"cf-ipcountry": "IN"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 99.0 and body["list_amount"] == 99.0
    assert body["discount_pct"] is None and body["offer_id"] is None and body["coupon_code"] is None
    assert body["coins"] == 110, "the quote shows the bonus coins the pack actually grants"
    async with maker() as s:
        assert await s.scalar(select(Purchase.id).where(Purchase.pack_id == pack.id)) is None


async def test_a_coupon_discounts_the_quote_and_the_checkout_but_is_not_spent_until_the_money_arrives(
    client, committed, maker, gateways, monkeypatch
):
    fake_stripe_checkout(monkeypatch)
    code = f"HALF{uuid.uuid4().hex[:6].upper()}"
    async with committed() as s:
        pack = await seed_pack(s, prices=(("INR", "*", "499.00"),))
        offer = Offer(title="Half off", kind="coupon", discount_pct=50, is_active=True)
        s.add(offer)
        await s.flush()
        s.add(Coupon(code=code, offer_id=offer.id, max_uses=5))

    quoted = await client.post("/v1/purchases/quote", json={"pack_id": str(pack.id), "coupon_code": code})
    assert quoted.status_code == 200, quoted.text
    assert quoted.json()["list_amount"] == 499.0
    assert quoted.json()["amount"] == 249.5
    assert quoted.json()["discount_pct"] == 50 and quoted.json()["coupon_code"] == code

    bought = await client.post(
        "/v1/purchases/checkout",
        json={
            "pack_id": str(pack.id),
            "gateway": "stripe",
            "currency": "INR",
            "coupon_code": code,
            "success_url": "https://katha.test/ok",
            "cancel_url": "https://katha.test/no",
        },
    )
    assert bought.status_code == 200, bought.text
    assert bought.json()["amount"] == 249.5 and bought.json()["discount_pct"] == 50
    async with maker() as s:
        coupon = await s.scalar(select(Coupon).where(Coupon.code == code))
        assert coupon.used == 0, "a pending checkout has not redeemed the coupon"


async def test_an_offer_for_another_pack_and_an_offer_this_user_cannot_see_are_both_refused(
    client, committed, retired_offers
):
    async with committed() as s:
        pack = await seed_pack(s)
        other_pack = await seed_pack(s)
        # Scoped to one country so these committed rows never turn up in another test's eligible offers.
        tied = Offer(
            title="Other pack only",
            kind="bundle",
            pack_id=other_pack.id,
            discount_pct=25,
            is_active=True,
            eligibility={"countries": ["IN"]},
        )
        hidden = Offer(title="Code only", kind="coupon", discount_pct=90, is_active=True)
        s.add_all([tied, hidden])
        await s.flush()
    retired_offers.extend([tied.id, hidden.id])

    mismatched = await client.post(
        "/v1/purchases/quote", json={"pack_id": str(pack.id), "offer_id": str(tied.id)}, headers=INDIA
    )
    assert mismatched.status_code == 400
    assert mismatched.json()["detail"]["code"] == "offer_pack_mismatch"

    # A coupon-kind offer is never in `eligible()`, so naming its id directly must not apply its discount.
    by_id = await client.post(
        "/v1/purchases/quote", json={"pack_id": str(pack.id), "offer_id": str(hidden.id)}, headers=INDIA
    )
    assert by_id.status_code == 400
    assert by_id.json()["detail"]["code"] == "offer_unavailable"

    invented = await client.post(
        "/v1/purchases/quote", json={"pack_id": str(pack.id), "offer_id": str(uuid.uuid4())}, headers=INDIA
    )
    assert invented.status_code == 400
    assert invented.json()["detail"]["code"] == "offer_unavailable"


async def test_an_eligible_offer_applies_by_id(client, committed, retired_offers):
    """The other half of the rule above: an offer the user really is eligible for does discount the quote."""
    async with committed() as s:
        pack = await seed_pack(s, prices=(("INR", "*", "400.00"),))
        offer = Offer(
            title="First purchase",
            kind="first_purchase",
            pack_id=pack.id,
            discount_pct=25,
            is_active=True,
            eligibility={"countries": ["IN"]},
        )
        s.add(offer)
        await s.flush()
    retired_offers.append(offer.id)

    r = await client.post(
        "/v1/purchases/quote", json={"pack_id": str(pack.id), "offer_id": str(offer.id)}, headers=INDIA
    )
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 300.0 and r.json()["discount_pct"] == 25
    assert r.json()["offer_id"] == str(offer.id) and r.json()["offer_title"] == "First purchase"


async def test_a_pack_with_no_price_in_that_currency_is_refused(client, committed):
    async with committed() as s:
        pack = await seed_pack(s, prices=(("INR", "*", "499.00"),))
    r = await client.post("/v1/purchases/quote", json={"pack_id": str(pack.id), "currency": "EUR"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "no_price"


async def test_a_country_row_wins_over_the_world_row_and_a_missing_currency_raises(session):
    """`price_for` directly: the country override is preferred however the rows happen to be ordered."""
    pack = await seed_pack(session, prices=(("INR", "*", "499.00"), ("INR", "IN", "99.00"), ("USD", "*", "5.99")))
    assert (await payments.price_for(session, pack, "inr", "in")).amount == Decimal("99.00")
    assert (await payments.price_for(session, pack, "INR", "DE")).amount == Decimal("499.00")
    assert (await payments.price_for(session, pack, "usd", "IN")).amount == Decimal("5.99")
    with pytest.raises(AppError) as exc:
        await payments.price_for(session, pack, "GBP", "GB")
    assert exc.value.detail["code"] == "no_price"


async def test_an_unknown_or_deactivated_pack_cannot_be_quoted(client, committed):
    async with committed() as s:
        retired = await seed_pack(s, is_active=False)
    gone = await client.post("/v1/purchases/quote", json={"pack_id": str(uuid.uuid4())})
    assert gone.status_code == 404
    inactive = await client.post("/v1/purchases/quote", json={"pack_id": str(retired.id)})
    assert inactive.status_code == 404, "a deactivated pack is no longer for sale"


# ---------------------------------------------------------------------------
# webhooks: the only way a purchase becomes paid
# ---------------------------------------------------------------------------


async def test_a_client_cannot_declare_its_own_purchase_paid_but_a_verified_webhook_can(
    client, committed, maker, buyer, gateways
):
    """The whole rule in one test: the buyer's own requests never move the status, the webhook does."""
    async with committed() as s:
        pack = await seed_pack(s, coins=100, bonus=10)
        purchase = await seed_purchase(s, user=buyer, pack=pack, gateway="razorpay", amount="499.00")

    payment_id = f"pay_{uuid.uuid4().hex[:10]}"
    read_back = await client.get(f"/v1/purchases/{purchase.id}")
    assert read_back.status_code == 200 and read_back.json()["status"] == "pending"
    # There is deliberately no endpoint that sets a status, and PATCHing the resource is not one either.
    assert (await client.patch(f"/v1/purchases/{purchase.id}", json={"status": "paid"})).status_code == 405
    assert await balance(maker, buyer.id) == 0

    event = razorpay_captured(purchase.id, payment_id=payment_id, amount_minor=49900)
    r = await post_razorpay(client, event, event_id=f"evt-{uuid.uuid4().hex}")
    assert r.status_code == 200 and r.json() == {"result": "paid"}
    assert await balance(maker, buyer.id) == 110
    async with maker() as s:
        p = await s.get(Purchase, purchase.id)
        assert p.status is PurchaseStatus.paid and p.coins_granted == 110
        assert p.gateway_payment_id == payment_id and p.paid_at is not None


async def test_the_same_razorpay_event_delivered_twice_grants_once(client, committed, maker, gateways):
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=50, bonus=0)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay", amount="499.00")

    event = razorpay_captured(purchase.id, payment_id=f"pay_{uuid.uuid4().hex[:10]}", amount_minor=49900)
    event_id = f"evt-{uuid.uuid4().hex}"
    first = await post_razorpay(client, event, event_id=event_id)
    second = await post_razorpay(client, event, event_id=event_id)
    assert first.json() == {"result": "paid"}
    assert second.json() == {"result": "duplicate"}, "the inbox refuses a replay of an event already handled"
    assert await balance(maker, buyer_row.id) == 50


async def test_an_event_without_an_id_header_is_deduplicated_by_its_payload(client, committed, maker, gateways):
    """Older Razorpay accounts send no `x-razorpay-event-id`; a hash of the payload has to stand in for one."""
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=25, bonus=0)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay", amount="499.00")

    event = razorpay_captured(purchase.id, payment_id=f"pay_{uuid.uuid4().hex[:8]}", amount_minor=49900)
    assert (await post_razorpay(client, event)).json() == {"result": "paid"}
    assert (await post_razorpay(client, event)).json() == {"result": "duplicate"}
    assert await balance(maker, buyer_row.id) == 25


async def test_a_razorpay_webhook_without_a_valid_signature_changes_nothing(client, committed, maker, gateways):
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay")

    event = razorpay_captured(purchase.id, payment_id=f"pay_{uuid.uuid4().hex[:10]}", amount_minor=49900)
    r = await post_razorpay(client, event, signature="0" * 64)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_signature"
    async with maker() as s:
        assert (await s.get(Purchase, purchase.id)).status is PurchaseStatus.pending
    assert await balance(maker, buyer_row.id) == 0


async def test_the_razorpay_webhook_is_unavailable_until_its_secret_is_configured(client, gateways, monkeypatch):
    monkeypatch.setattr(gateways, "razorpay_webhook_secret", None, raising=False)
    r = await client.post("/v1/webhooks/razorpay", content=b"{}", headers={"x-razorpay-signature": "x"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "not_configured"


async def test_an_amount_the_gateway_reports_differently_fails_the_purchase_instead_of_granting(
    client, committed, maker, gateways
):
    """A signature proves the message came from the gateway, not that it is about the amount we quoted."""
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=100, bonus=0)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay", amount="499.00")

    event = razorpay_captured(
        purchase.id, payment_id=f"pay_{uuid.uuid4().hex[:10]}", amount_minor=100
    )  # ₹1 for a ₹499 pack
    r = await post_razorpay(client, event, event_id=f"evt-{uuid.uuid4().hex}")
    assert r.status_code == 200 and r.json() == {"result": "paid"}, "the event was handled"
    async with maker() as s:
        p = await s.get(Purchase, purchase.id)
        assert p.status is PurchaseStatus.failed, "but the purchase failed rather than granting coins"
        assert p.raw["failure"] == "amount_mismatch" and p.raw["reported"] == [100, "INR"]
    assert await balance(maker, buyer_row.id) == 0


async def test_a_currency_the_gateway_reports_differently_also_fails(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    purchase = await seed_purchase(session, user=user, pack=pack, amount="499.00", currency="INR")
    done = await payments.mark_paid(session, purchase.id, amount_minor=49900, currency="USD")
    assert done.status is PurchaseStatus.failed
    assert (await session.get(User, user.id)).coin_balance == 0


async def test_an_event_kind_we_do_not_act_on_is_ignored(client, committed, maker, gateways):
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay")

    event = {"event": "payment.authorized", "payload": {"payment": {"entity": {"id": "pay_auth"}}}}
    r = await post_razorpay(client, event, event_id=f"evt-{uuid.uuid4().hex}")
    assert r.status_code == 200 and r.json() == {"result": "ignored"}
    async with maker() as s:
        assert (await s.get(Purchase, purchase.id)).status is PurchaseStatus.pending
    assert await balance(maker, buyer_row.id) == 0


async def test_a_captured_payment_for_an_unknown_purchase_is_ignored_rather_than_crashing(client, gateways):
    """`notes.purchase_id` comes back from the gateway; a payment with none must not take the endpoint down."""
    event = {"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_x", "notes": {}}}}}
    r = await post_razorpay(client, event, event_id=f"evt-{uuid.uuid4().hex}")
    assert r.status_code == 200 and r.json() == {"result": "ignored"}


async def test_a_refund_event_reverses_the_coins_the_payment_granted(client, committed, maker, gateways):
    payment_id = f"pay_{uuid.uuid4().hex[:10]}"
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=100, bonus=10)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay", amount="499.00")

    paid = await post_razorpay(
        client,
        razorpay_captured(purchase.id, payment_id=payment_id, amount_minor=49900),
        event_id=f"e-{uuid.uuid4().hex}",
    )
    assert paid.json() == {"result": "paid"}
    assert await balance(maker, buyer_row.id) == 110

    refunded = await post_razorpay(client, razorpay_refunded(payment_id), event_id=f"e-{uuid.uuid4().hex}")
    assert refunded.json() == {"result": "refunded"}
    assert await balance(maker, buyer_row.id) == 0
    async with maker() as s:
        p = await s.get(Purchase, purchase.id)
        assert p.status is PurchaseStatus.refunded and p.refunded_at is not None
        assert p.raw["refund_event"]["event"] == "refund.processed"

    # A refund naming a payment we never recorded is ignored, not an error.
    stray = await post_razorpay(client, razorpay_refunded("pay_never_seen"), event_id=f"e-{uuid.uuid4().hex}")
    assert stray.json() == {"result": "ignored"}


async def test_a_delivery_whose_handler_failed_is_retried_rather_than_swallowed(
    client, committed, maker, gateways, monkeypatch
):
    """The inbox must not burn an event id on a transient failure.

    A database blip while applying `payment.captured` used to leave the row looking handled, so the gateway's
    retry was answered "duplicate" and the purchase stayed pending for ever. A failed delivery is recorded as
    an error instead, and the retry runs against it.
    """
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=100, bonus=0)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, gateway="razorpay", amount="499.00")

    event = razorpay_captured(purchase.id, payment_id=f"pay_{uuid.uuid4().hex[:10]}", amount_minor=49900)
    event_id = f"evt-{uuid.uuid4().hex}"

    real_apply = payments.apply_razorpay_event

    async def boom(db, payload):
        raise RuntimeError("connection reset while applying the event")

    monkeypatch.setattr(payments, "apply_razorpay_event", boom)
    failed = await post_razorpay(client, event, event_id=event_id)
    assert failed.status_code == 500
    async with maker() as s:
        row = await s.scalar(select(WebhookEvent).where(WebhookEvent.event_id == event_id))
        assert row.result == "error" and "connection reset" in row.error
    assert await balance(maker, buyer_row.id) == 0

    # Only the broken handler goes back, not the gateway credentials `undo()` would also revert.
    monkeypatch.setattr(payments, "apply_razorpay_event", real_apply)
    retried = await post_razorpay(client, event, event_id=event_id)
    assert retried.json() == {"result": "paid"}, "the gateway's retry is processed, not called a duplicate"
    assert await balance(maker, buyer_row.id) == 100
    async with maker() as s:
        row = await s.scalar(select(WebhookEvent).where(WebhookEvent.event_id == event_id))
        assert row.result == "paid" and row.error is None


# ---------------------------------------------------------------------------
# Stripe: verification at the route, and the event handler on its own
# ---------------------------------------------------------------------------


async def test_the_stripe_webhook_is_unavailable_until_its_secret_is_configured(client, gateways, monkeypatch):
    monkeypatch.setattr(gateways, "stripe_webhook_secret", None, raising=False)
    r = await client.post("/v1/webhooks/stripe", content=b"{}", headers={"stripe-signature": "t=1,v1=x"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "not_configured"


async def test_the_stripe_webhook_refuses_a_signature_it_cannot_verify(client, committed, maker, gateways):
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack)

    event = stripe_event(
        "checkout.session.completed",
        {"payment_status": "paid", "metadata": {"purchase_id": str(purchase.id)}, "amount_total": 49900},
    )
    body = json.dumps(event).encode()
    for header in ("", "t=1,v1=deadbeef", stripe_signature(body, "whsec_someone_elses")):
        r = await client.post("/v1/webhooks/stripe", content=body, headers={"stripe-signature": header})
        assert r.status_code == 400, r.text
        assert r.json()["detail"]["code"] == "bad_signature"
    async with maker() as s:
        assert (await s.get(Purchase, purchase.id)).status is PurchaseStatus.pending


async def test_a_correctly_signed_stripe_event_is_applied_and_pays_out(client, committed, maker, gateways):
    """A verified Stripe event settles the purchase and pays out, through the route rather than around it.

    This is the regression test for the one that mattered: the route used to do `dict(event)` on the
    `stripe.Event` it had just verified, which stripe-python 12 refuses, and the TypeError landed outside the
    except that turns a bad signature into a 400. Every genuine Stripe webhook became a 500 — no inbox row,
    no coins, and a purchase left pending for good — while `apply_stripe_event` underneath was correct all
    along. So the assertion that matters is that the money arrives *via the endpoint Stripe actually calls*.
    """
    async with committed() as s:
        buyer_row = await seed_user(s)
        pack = await seed_pack(s, coins=100, bonus=10)
        purchase = await seed_purchase(s, user=buyer_row, pack=pack, amount="499.00")

    event = stripe_event(
        "checkout.session.completed",
        {
            "payment_status": "paid",
            "metadata": {"purchase_id": str(purchase.id)},
            "amount_total": 49900,
            "currency": "inr",
            "payment_intent": f"pi_{uuid.uuid4().hex[:10]}",
        },
    )
    body = json.dumps(event).encode()
    r = await client.post("/v1/webhooks/stripe", content=body, headers={"stripe-signature": stripe_signature(body)})
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "paid"
    async with maker() as s:
        assert (await s.get(Purchase, purchase.id)).status is PurchaseStatus.paid
        # The inbox row is what makes a replay a no-op, so its absence was not a cosmetic part of the failure.
        assert await s.scalar(select(WebhookEvent.id).where(WebhookEvent.event_id == event["id"])) is not None
    assert await balance(maker, buyer_row.id) == 110

    # The same event again is recognised rather than paid twice.
    again = await client.post("/v1/webhooks/stripe", content=body, headers={"stripe-signature": stripe_signature(body)})
    assert again.status_code == 200
    assert again.json()["result"] == "duplicate"
    assert await balance(maker, buyer_row.id) == 110


async def test_the_stripe_event_handler_marks_a_completed_checkout_paid(session):
    """`apply_stripe_event` against the database directly: the cases the route test does not carry."""
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=10)
    purchase = await seed_purchase(session, user=user, pack=pack, amount="499.00")
    payment_intent = f"pi_{uuid.uuid4().hex[:10]}"

    unpaid = stripe_event(
        "checkout.session.completed",
        {"payment_status": "unpaid", "metadata": {"purchase_id": str(purchase.id)}},
    )
    assert await payments.apply_stripe_event(session, unpaid) == "ignored"
    assert (await session.get(Purchase, purchase.id)).status is PurchaseStatus.pending

    # No metadata: Stripe's own `client_reference_id` is the fallback, and it is set at checkout for this reason.
    completed = stripe_event(
        "checkout.session.completed",
        {
            "payment_status": "paid",
            "client_reference_id": str(purchase.id),
            "amount_total": 49900,
            "currency": "inr",
            "payment_intent": payment_intent,
        },
    )
    assert await payments.apply_stripe_event(session, completed) == "paid"
    p = await session.get(Purchase, purchase.id)
    assert p.status is PurchaseStatus.paid and p.gateway_payment_id == payment_intent
    assert p.raw["paid_event"]["type"] == "checkout.session.completed"
    assert (await session.get(User, user.id)).coin_balance == 110


async def test_the_stripe_event_handler_reverses_a_refunded_charge(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    payment_intent = f"pi_{uuid.uuid4().hex[:10]}"
    purchase = await seed_purchase(session, user=user, pack=pack, gateway_payment_id=payment_intent)
    await payments.mark_paid(session, purchase.id)
    assert (await session.get(User, user.id)).coin_balance == 100

    unknown = stripe_event("charge.refunded", {"payment_intent": "pi_not_ours"})
    assert await payments.apply_stripe_event(session, unknown) == "ignored"
    assert (await session.get(User, user.id)).coin_balance == 100

    assert (
        await payments.apply_stripe_event(session, stripe_event("charge.refunded", {"payment_intent": payment_intent}))
        == "refunded"
    )
    assert (await session.get(User, user.id)).coin_balance == 0
    assert (await session.get(Purchase, purchase.id)).status is PurchaseStatus.refunded


async def test_an_expired_checkout_session_fails_only_a_purchase_still_pending(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    pending = await seed_purchase(session, user=user, pack=pack)
    expired = stripe_event("checkout.session.expired", {"metadata": {"purchase_id": str(pending.id)}})
    assert await payments.apply_stripe_event(session, expired) == "expired"
    assert (await session.get(Purchase, pending.id)).status is PurchaseStatus.failed

    already_paid = await seed_purchase(session, user=user, pack=pack)
    await payments.mark_paid(session, already_paid.id)
    late = stripe_event("checkout.session.expired", {"metadata": {"purchase_id": str(already_paid.id)}})
    assert await payments.apply_stripe_event(session, late) == "ignored", "a paid purchase is not un-paid by a timer"
    assert (await session.get(Purchase, already_paid.id)).status is PurchaseStatus.paid

    # An expiry naming nothing, and one naming a purchase we do not have, are both ignored.
    assert await payments.apply_stripe_event(session, stripe_event("checkout.session.expired", {})) == "ignored"
    orphan = stripe_event("checkout.session.expired", {"metadata": {"purchase_id": str(uuid.uuid4())}})
    assert await payments.apply_stripe_event(session, orphan) == "ignored"


# ---------------------------------------------------------------------------
# the state machine itself
# ---------------------------------------------------------------------------


async def test_coins_move_only_through_the_ledger_and_only_once(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=10)
    purchase = await seed_purchase(session, user=user, pack=pack)

    await payments.mark_paid(session, purchase.id, gateway_payment_id="pi_1")
    rows = (
        await session.scalars(
            select(CoinLedger).where(CoinLedger.ref_type == "purchase", CoinLedger.ref_id == str(purchase.id))
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].delta == 110 and rows[0].kind is LedgerKind.purchase
    assert rows[0].idempotency_key == f"purchase:{purchase.id}"
    assert rows[0].balance_after == 110 == (await session.get(User, user.id)).coin_balance

    # Replaying the grant posts nothing further, whatever the gateway does.
    await payments.mark_paid(session, purchase.id, gateway_payment_id="pi_1")
    again = (
        await session.scalars(
            select(CoinLedger).where(CoinLedger.ref_type == "purchase", CoinLedger.ref_id == str(purchase.id))
        )
    ).all()
    assert len(again) == 1
    assert (await session.get(User, user.id)).coin_balance == 110


async def test_a_terminal_purchase_is_never_reopened(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)

    failed = await seed_purchase(session, user=user, pack=pack, status=PurchaseStatus.failed)
    assert (await payments.mark_paid(session, failed.id)).status is PurchaseStatus.failed
    assert (await session.get(User, user.id)).coin_balance == 0

    refunded = await seed_purchase(session, user=user, pack=pack, status=PurchaseStatus.refunded)
    assert (await payments.mark_paid(session, refunded.id)).status is PurchaseStatus.refunded
    assert (await session.get(User, user.id)).coin_balance == 0

    # And a refund only ever applies to something that was actually paid.
    pending = await seed_purchase(session, user=user, pack=pack)
    assert (await payments.mark_refunded(session, pending.id)).status is PurchaseStatus.pending
    assert (await session.get(User, user.id)).coin_balance == 0


async def test_an_event_about_a_purchase_we_do_not_have_is_not_found(session):
    missing = uuid.uuid4()
    with pytest.raises(NotFound):
        await payments.mark_paid(session, missing)
    with pytest.raises(NotFound):
        await payments.mark_refunded(session, missing)


async def test_a_vip_pack_grants_a_membership_extends_the_next_one_and_a_refund_ends_it(session):
    user = await seed_user(session)
    pack = await seed_pack(session, kind=PackKind.vip, coins=0, bonus=0, duration_days=30)
    first = await seed_purchase(session, user=user, pack=pack)
    start = datetime.now(UTC)  # a live window, so ending it is something a refund can observably do
    await payments.mark_paid(session, first.id, paid_at=start)

    memberships = (await session.scalars(select(VipMembership).where(VipMembership.user_id == user.id))).all()
    assert len(memberships) == 1
    assert memberships[0].ends_at == start + timedelta(days=30) and memberships[0].source == "purchase"
    assert (await session.get(User, user.id)).coin_balance == 0, "a VIP pack grants time, not coins"

    # Buying again while still a member stacks on the end of the current window rather than wasting it.
    second = await seed_purchase(session, user=user, pack=pack)
    await payments.mark_paid(session, second.id, paid_at=start)
    stacked = await session.scalar(select(VipMembership).where(VipMembership.purchase_id == second.id))
    assert stacked.starts_at == start + timedelta(days=30)
    assert stacked.ends_at == start + timedelta(days=60)

    # Refunding the stacked window, which has not begun yet, collapses it to nothing.
    await payments.mark_refunded(session, second.id)
    assert stacked.ends_at == stacked.starts_at

    # Refunding the window the viewer is inside ends it now rather than deleting time already watched.
    await payments.mark_refunded(session, first.id)
    assert start <= memberships[0].ends_at <= datetime.now(UTC)


async def test_a_vip_pack_without_a_duration_falls_back_to_a_month(session):
    user = await seed_user(session)
    pack = await seed_pack(session, kind=PackKind.vip, coins=0, bonus=0, duration_days=None)
    purchase = await seed_purchase(session, user=user, pack=pack)
    start = datetime(2026, 3, 1, tzinfo=UTC)
    await payments.mark_paid(session, purchase.id, paid_at=start)
    row = await session.scalar(select(VipMembership).where(VipMembership.purchase_id == purchase.id))
    assert row.ends_at == start + timedelta(days=30)


async def test_a_coupon_is_counted_when_the_money_actually_arrives(session):
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    offer = Offer(title="Ten off", kind="coupon", discount_pct=10, is_active=True)
    session.add(offer)
    await session.flush()
    code = f"USE{uuid.uuid4().hex[:6].upper()}"
    coupon = Coupon(code=code, offer_id=offer.id, max_uses=2)
    session.add(coupon)
    await session.flush()

    purchase = await seed_purchase(session, user=user, pack=pack, coupon_code=code, discount_pct=10)
    await payments.mark_paid(session, purchase.id)
    assert (await session.get(Coupon, coupon.id)).used == 1

    # A purchase naming a coupon that has since been deleted still grants; the count simply has nowhere to go.
    orphan = await seed_purchase(session, user=user, pack=pack, coupon_code="DELETEDCODE")
    await payments.mark_paid(session, orphan.id)
    assert (await session.get(Purchase, orphan.id)).status is PurchaseStatus.paid
    assert (await session.get(User, user.id)).coin_balance == 200


# ---------------------------------------------------------------------------
# referrals: a cheap pack plus a refund must not pay out
# ---------------------------------------------------------------------------


async def _referred_pair(session) -> tuple[User, User, Referral]:
    referrer = await seed_user(session)
    referee = await seed_user(session)
    ref = Referral(
        referrer_id=referrer.id, referee_id=referee.id, code=referrer.referral_code, created_at=datetime.now(UTC)
    )
    session.add(ref)
    await session.flush()
    return referrer, referee, ref


async def test_a_refund_takes_back_the_buyers_coins_and_the_referrers_reward(session):
    """Otherwise a pair of accounts buys the cheapest pack, collects the referral coins and refunds it."""
    referrer, referee, ref = await _referred_pair(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    purchase = await seed_purchase(session, user=referee, pack=pack, amount="10.00")

    await payments.mark_paid(session, purchase.id)
    assert (await session.get(User, referee.id)).coin_balance == 100
    assert (await session.get(User, referrer.id)).coin_balance == 100, "the referrer is paid on the first purchase"
    assert (await session.get(Referral, ref.id)).rewarded_at is not None

    await payments.mark_refunded(session, purchase.id)
    assert (await session.get(User, referee.id)).coin_balance == 0
    assert (await session.get(User, referrer.id)).coin_balance == 0, "the reward is reversed with the purchase"
    assert (await session.get(Referral, ref.id)).rewarded_at is None
    reversal = await session.scalar(
        select(CoinLedger).where(CoinLedger.idempotency_key == f"referral-reversal:{ref.id}:{purchase.id}")
    )
    assert reversal.delta == -100 and reversal.kind is LedgerKind.refund


async def test_a_genuine_purchase_after_a_refund_pays_the_referrer_again(session):
    """Reversing must not permanently disqualify the pair: the second, real purchase earns the reward once more."""
    referrer, referee, ref = await _referred_pair(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    first = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, first.id)
    await payments.mark_refunded(session, first.id)
    assert (await session.get(User, referrer.id)).coin_balance == 0

    second = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, second.id)
    assert (await session.get(User, referrer.id)).coin_balance == 100
    rows = (
        await session.scalars(
            select(CoinLedger).where(CoinLedger.kind == LedgerKind.referral, CoinLedger.ref_id == str(ref.id))
        )
    ).all()
    assert len(rows) == 2, "the second grant is a new ledger row under a new key, not a replayed one"


async def test_only_the_purchase_that_earned_a_legacy_reward_reverses_it(session):
    """Reward rows written before the key carried a purchase id fall back to the referee's earliest purchase.

    Without that, refunding *any* later purchase would claw back a reward the first one had earned.
    """
    referrer, referee, ref = await _referred_pair(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    first = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, first.id, paid_at=datetime(2026, 1, 1, tzinfo=UTC))
    second = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, second.id, paid_at=datetime(2026, 2, 1, tzinfo=UTC))
    assert (await session.get(User, referrer.id)).coin_balance == 100, "the referrer is paid once, not twice"

    # Rewrite the reward the way the old code keyed it: `referral:<id>`, with no purchase.
    await session.execute(
        update(CoinLedger)
        .where(CoinLedger.idempotency_key == f"referral:{ref.id}:{first.id}")
        .values(idempotency_key=f"referral:{ref.id}")
    )

    await payments.mark_refunded(session, second.id)
    assert (await session.get(User, referrer.id)).coin_balance == 100, "the later purchase did not earn this reward"
    assert (await session.get(Referral, ref.id)).rewarded_at is not None

    await payments.mark_refunded(session, first.id)
    assert (await session.get(User, referrer.id)).coin_balance == 0
    assert (await session.get(Referral, ref.id)).rewarded_at is None


async def test_a_refund_with_nothing_to_reverse_leaves_the_referral_alone(session):
    """Two quiet paths: no referral at all, and a referral marked rewarded with no reward row behind it."""
    lone = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    plain = await seed_purchase(session, user=lone, pack=pack)
    await payments.mark_paid(session, plain.id)
    await payments.mark_refunded(session, plain.id)
    assert (await session.get(User, lone.id)).coin_balance == 0

    referrer, referee, ref = await _referred_pair(session)
    ref.rewarded_at = datetime.now(UTC)  # marked paid, but no ledger row was ever written
    await session.flush()
    purchase = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, purchase.id)
    await payments.mark_refunded(session, purchase.id)
    assert (await session.get(User, referrer.id)).coin_balance == 0
    assert (await session.get(Referral, ref.id)).rewarded_at is not None, "nothing was reversed, so nothing is cleared"


async def test_turning_the_referral_reward_off_pays_nobody_but_still_closes_the_referral(session):
    # Rolled back with the session, so the rest of the suite keeps the default economics.
    row = await session.get(Setting, "referral")
    if row is None:
        session.add(Setting(namespace="referral", data={"referrer_coins": 0}, updated_at=datetime.now(UTC)))
    else:
        row.data = {**row.data, "referrer_coins": 0}
    await session.flush()
    referrer, referee, ref = await _referred_pair(session)
    pack = await seed_pack(session, coins=100, bonus=0)
    purchase = await seed_purchase(session, user=referee, pack=pack)
    await payments.mark_paid(session, purchase.id)
    assert (await session.get(User, referrer.id)).coin_balance == 0
    assert (await session.get(Referral, ref.id)).rewarded_at is not None
    assert (
        await session.scalar(
            select(CoinLedger.id).where(CoinLedger.kind == LedgerKind.referral, CoinLedger.ref_id == str(ref.id))
        )
    ) is None


# ---------------------------------------------------------------------------
# the buyer's own view of their purchases
# ---------------------------------------------------------------------------


async def test_a_buyer_sees_their_own_purchases_and_nobody_elses(client, committed, buyer):
    async with committed() as s:
        stranger = await seed_user(s)
        pack = await seed_pack(s, coins=100, bonus=0)
        mine = await seed_purchase(s, user=buyer, pack=pack, amount="499.00")
        theirs = await seed_purchase(s, user=stranger, pack=pack, amount="99.00")

    listed = await client.get("/v1/purchases")
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.json()}
    assert str(mine.id) in ids and str(theirs.id) not in ids

    ok = await client.get(f"/v1/purchases/{mine.id}")
    assert ok.status_code == 200 and ok.json()["amount"] == 499.0 and ok.json()["status"] == "pending"
    assert (await client.get(f"/v1/purchases/{theirs.id}")).status_code == 404
    assert (await client.get(f"/v1/purchases/{uuid.uuid4()}")).status_code == 404


# ---------------------------------------------------------------------------
# Google Play
# ---------------------------------------------------------------------------


def play_product_payload(*, state: int = 0, acknowledged: int = 0, micros: str | None = "99000000") -> dict:
    payload = {
        "orderId": "GPA.1234-5678",
        "purchaseState": state,
        "acknowledgementState": acknowledged,
        "priceCurrencyCode": "INR",
    }
    if micros is not None:
        payload["priceAmountMicros"] = micros
    return payload


@pytest.fixture
def play_api(monkeypatch, gateways):
    """Google's Play Developer API, faked at the httpx boundary, with a token that costs nothing to mint."""
    monkeypatch.setattr(store_billing, "_access_token", lambda: "ya29.fake-token")
    state = types.SimpleNamespace(routes={}, calls=[], responder=None)

    def handler(method, url, **kwargs):
        assert kwargs["headers"]["Authorization"] == "Bearer ya29.fake-token"
        if state.responder is not None:
            return state.responder(method, url, **kwargs)
        for suffix, response in state.routes.items():
            if url.endswith(suffix):
                return response
        return FakeResponse(200, {})

    state.calls = fake_http(monkeypatch, store_billing, handler)
    return state


async def test_a_play_purchase_grants_only_what_google_confirms_and_is_then_finalised(
    client, committed, maker, buyer, play_api
):
    token = f"play-token-{uuid.uuid4().hex}"
    product = f"coins_{uuid.uuid4().hex[:6]}"
    async with committed() as s:
        await seed_pack(s, coins=100, bonus=10, google_product_id=product)
    play_api.routes[f"tokens/{token}"] = FakeResponse(200, play_product_payload())

    r = await client.post("/v1/purchases/play/redeem", json={"product_id": product, "purchase_token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "paid" and body["coins_granted"] == 110
    assert body["gateway"] == "play"
    # Play is the source of truth for what was charged: 99_000_000 micros is ₹99.00.
    assert body["amount"] == 99.0 and body["currency"] == "INR"
    assert await balance(maker, buyer.id) == 110

    assert [c.method for c in play_api.calls] == ["GET", "POST"], "verify first, then tell Google"
    assert play_api.calls[1].url.endswith(f"purchases/products/{product}/tokens/{token}:consume")
    assert f"/{PLAY_PACKAGE}/" in play_api.calls[0].url

    async with maker() as s:
        p = await s.get(Purchase, uuid.UUID(body["id"]))
        assert p.external_id == token and p.gateway_payment_id == "GPA.1234-5678"
        assert p.raw["play"]["orderId"] == "GPA.1234-5678"


async def test_redeeming_the_same_play_token_twice_grants_once(client, committed, maker, buyer, play_api):
    token = f"play-token-{uuid.uuid4().hex}"
    product = f"coins_{uuid.uuid4().hex[:6]}"
    async with committed() as s:
        await seed_pack(s, coins=100, bonus=0, google_product_id=product)
    play_api.routes[f"tokens/{token}"] = FakeResponse(200, play_product_payload())

    first = await client.post("/v1/purchases/play/redeem", json={"product_id": product, "purchase_token": token})
    second = await client.post("/v1/purchases/play/redeem", json={"product_id": product, "purchase_token": token})
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert await balance(maker, buyer.id) == 100

    # The retry does not re-verify, but it does re-consume: an unacknowledged purchase is auto-refunded by
    # Google after three days, so the one thing a dropped response must not lose is telling Google.
    methods = [c.method for c in play_api.calls]
    assert methods == ["GET", "POST", "POST"]
    assert all(c.url.endswith(":consume") for c in play_api.calls if c.method == "POST")


async def test_a_play_purchase_google_says_is_incomplete_grants_nothing(client, committed, maker, buyer, play_api):
    token = f"play-token-{uuid.uuid4().hex}"
    product = f"coins_{uuid.uuid4().hex[:6]}"
    async with committed() as s:
        await seed_pack(s, coins=100, bonus=0, google_product_id=product)
    play_api.routes[f"tokens/{token}"] = FakeResponse(200, play_product_payload(state=2))  # 2 = pending

    r = await client.post("/v1/purchases/play/redeem", json={"product_id": product, "purchase_token": token})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "play_not_purchased"
    assert await balance(maker, buyer.id) == 0
    async with maker() as s:
        assert await s.scalar(select(Purchase.id).where(Purchase.external_id == token)) is None
    assert [c.method for c in play_api.calls] == ["GET"], "nothing was consumed, so Google can still refund it"


async def test_a_product_we_do_not_sell_is_not_found(client, buyer, play_api):
    r = await client.post("/v1/purchases/play/redeem", json={"product_id": "coins_unknown", "purchase_token": "x" * 20})
    assert r.status_code == 404
    assert play_api.calls == [], "an unknown product is refused before Google is asked anything"


async def test_google_not_recognising_a_token_is_a_400_and_an_api_failure_is_a_502(play_api):
    play_api.routes["tokens/gone"] = FakeResponse(404, {"error": {"message": "purchaseToken not found"}})
    play_api.routes["tokens/broken"] = FakeResponse(503, {"error": {"message": "backend error"}})

    with pytest.raises(AppError) as unknown:
        await store_billing.verify_product("coins_100", "gone")
    assert unknown.value.status_code == 400 and unknown.value.detail["code"] == "play_token_unknown"

    with pytest.raises(AppError) as failed:
        await store_billing.verify_product("coins_100", "broken")
    assert failed.value.status_code == 502 and failed.value.detail["code"] == "play_verify_failed"


async def test_what_google_reports_is_parsed_into_the_decision_this_module_makes(play_api):
    play_api.routes["tokens/ok"] = FakeResponse(200, play_product_payload(state=0, acknowledged=1, micros="249500000"))
    parsed = await store_billing.verify_product("coins_100", "ok")
    assert parsed.is_purchased and parsed.acknowledged
    assert parsed.price_minor == 24950, "micros are converted to the minor units the rest of the system speaks"
    assert parsed.currency == "INR"

    # A response with no price at all (Google omits it for some accounts) must not crash the parse.
    priceless = store_billing.parse_product({"purchaseState": 0})
    assert priceless.price_minor is None and priceless.order_id is None and priceless.is_purchased
    # And a response with nothing at all is not a purchase.
    assert not store_billing.parse_product({}).is_purchased


async def test_a_non_consumable_is_acknowledged_and_an_already_consumed_token_is_not_an_error(play_api):
    play_api.routes[":acknowledge"] = FakeResponse(200, {})
    await store_billing.finalize("vip_month", "tok", consumable=False)
    assert play_api.calls[-1].url.endswith("purchases/products/vip_month/tokens/tok:acknowledge")

    # 410 means Google already consumed it, which is the state we wanted; anything else is logged, not raised.
    play_api.routes[":consume"] = FakeResponse(410, {})
    await store_billing.finalize("coins_100", "tok", consumable=True)
    play_api.routes[":consume"] = FakeResponse(500, {"error": "nope"})
    await store_billing.finalize("coins_100", "tok", consumable=True)


async def test_two_redemptions_of_one_token_grant_once_and_both_get_the_same_row(session, maker, play_api, monkeypatch):
    """Two devices redeeming one token: the coins are granted once and both callers get the winner's row.

    The regression this pins is the recovery path, not the grant. `session.add` used to sit *outside* the
    savepoint it flushed inside, so when the unique index rejected the insert, the rollback left the object in
    the session as pending; the very `select` meant to find the winner then autoflushed it, the same violation
    fired with no savepoint to catch it, and the loser got a 500. The index always protected the money — one
    row, one grant — so this looked like a flake rather than a fault.

    The competing insert is committed from another session *while* verification is in flight, which is exactly
    the shape of two devices redeeming the same token at once.
    """
    token = f"play-token-{uuid.uuid4().hex}"
    product = f"coins_{uuid.uuid4().hex[:6]}"
    user = await seed_user(session)
    pack = await seed_pack(session, coins=100, bonus=0, google_product_id=product)
    await session.commit()

    winner_id: dict[str, uuid.UUID] = {}

    async def verify_and_race(product_id, purchase_token):
        async with maker() as other:
            row = await seed_purchase(other, user=user, pack=pack, gateway="play", external_id=purchase_token)
            await other.commit()
            winner_id["id"] = row.id
        return store_billing.parse_product(play_product_payload())

    monkeypatch.setattr(store_billing, "verify_product", verify_and_race)
    lost = await store_billing.redeem(session, user=user, product_id=product, purchase_token=token)
    assert lost.id == winner_id["id"], "the loser of the race gets the winner's row, not an error"

    async with maker() as s:
        rows = (await s.scalars(select(Purchase).where(Purchase.external_id == token))).all()
        assert [r.id for r in rows] == [winner_id["id"]], "the index held: one row, one grant"
        # The retry the client makes next finds that row and returns it, which is the path that works.
        retried = await store_billing.redeem(s, user=user, product_id=product, purchase_token=token)
        assert retried.id == winner_id["id"]


async def test_play_billing_that_is_not_configured_refuses_to_mint_a_token(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_play_package_name", None, raising=False)
    monkeypatch.setattr(s, "google_play_service_account_file", None, raising=False)
    assert store_billing.is_configured() is False
    with pytest.raises(AppError) as exc:
        store_billing._access_token()
    assert exc.value.detail["code"] == "gateway_unavailable"

    monkeypatch.setattr(s, "google_play_package_name", PLAY_PACKAGE, raising=False)
    monkeypatch.setattr(s, "google_play_service_account_file", "/tmp/does-not-exist.json", raising=False)
    assert store_billing.is_configured() is True


def test_the_play_credentials_are_built_from_the_configured_service_account(monkeypatch, tmp_path):
    """The key file names the account and the scope; both are what the Play API authorises against.

    The key is generated here rather than shipped, and nothing is refreshed, so this never leaves the process.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    path = tmp_path / "service-account.json"
    path.write_text(
        json.dumps(
            {
                "type": "service_account",
                "project_id": "katha-test",
                "private_key_id": "k1",
                "private_key": pem,
                "client_email": "play-billing@katha-test.iam.gserviceaccount.com",
                "client_id": "1",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
    )
    s = get_settings()
    monkeypatch.setattr(s, "google_play_package_name", PLAY_PACKAGE, raising=False)
    monkeypatch.setattr(s, "google_play_service_account_file", str(path), raising=False)

    creds = store_billing._credentials()
    assert creds.service_account_email == "play-billing@katha-test.iam.gserviceaccount.com"
    assert list(creds.scopes) == [store_billing.SCOPE], "a token for the wrong scope is refused by Google"


def test_a_play_api_token_is_minted_by_refreshing_those_credentials(monkeypatch):
    class _Creds:
        token = None

        def refresh(self, request):
            self.token = "ya29.minted"

    monkeypatch.setattr(store_billing, "_credentials", _Creds)
    assert store_billing._access_token() == "ya29.minted"


def test_a_vip_window_starts_when_it_is_granted():
    start, end = store_billing.vip_window(30, now=datetime(2026, 5, 1, tzinfo=UTC))
    assert start == datetime(2026, 5, 1, tzinfo=UTC) and end == datetime(2026, 5, 31, tzinfo=UTC)
    now_start, now_end = store_billing.vip_window(7)
    assert (now_end - now_start) == timedelta(days=7)


async def test_the_voided_purchase_poll_follows_every_page(play_api):
    """The safety net for refunds the push subscription missed. A half-read list is coins nobody takes back."""
    pages = [
        FakeResponse(
            200,
            {
                "voidedPurchases": [
                    {"purchaseToken": "t1", "orderId": "GPA.1", "voidedTimeMillis": "1757412000000", "voidedReason": 1},
                    {"orderId": "GPA.no-token"},  # skipped: nothing to reverse without a token
                ],
                "tokenPagination": {"nextPageToken": "page-2"},
            },
        ),
        FakeResponse(200, {"voidedPurchases": [{"purchaseToken": "t2", "voidedSource": 0}]}),
    ]

    play_api.responder = lambda method, url, **kwargs: pages[1] if "token=page-2" in url else pages[0]

    voided = await store_billing.list_voided()
    assert "startTime=" in play_api.calls[0].url, "the poll always names the window it is asking about"
    assert [v.purchase_token for v in voided] == ["t1", "t2"]
    assert voided[0].order_id == "GPA.1" and voided[0].voided_time_ms == 1757412000000 and voided[0].reason == 1
    assert voided[1].voided_time_ms is None and voided[1].source == 0


def test_a_poll_that_has_fallen_behind_starts_from_the_window_google_serves():
    now = datetime(2026, 6, 1, tzinfo=UTC)
    floor = int((now - store_billing.VOIDED_LOOKBACK).timestamp() * 1000)
    assert store_billing.voided_start_ms(None, now=now) == floor
    assert store_billing.voided_start_ms(0, now=now) == floor, "older than Google serves is clamped, not sent"
    recent = int((now - timedelta(days=1)).timestamp() * 1000)
    assert store_billing.voided_start_ms(recent, now=now) == recent


def test_the_default_rtdn_verifier_is_googles_own(monkeypatch):
    """`verify_play_rtdn` takes an injectable verifier for tests; the default must still be the real check."""
    from google.oauth2 import id_token

    seen: dict = {}

    def fake_verify(token, request, audience=None):
        seen.update(token=token, audience=audience)
        return {"email": PLAY_SERVICE_ACCOUNT, "email_verified": True}

    monkeypatch.setattr(id_token, "verify_oauth2_token", fake_verify)
    claims = store_billing.verify_play_rtdn(
        "jwt-from-pubsub", audience=PLAY_AUDIENCE, service_account_email=PLAY_SERVICE_ACCOUNT
    )
    assert claims["email"] == PLAY_SERVICE_ACCOUNT
    assert seen == {"token": "jwt-from-pubsub", "audience": PLAY_AUDIENCE}


async def test_an_authenticated_play_push_with_a_body_that_is_not_json_is_a_400(client, gateways, monkeypatch):
    monkeypatch.setattr(
        store_billing,
        "_google_oidc_verifier",
        lambda token, audience: {
            "email": PLAY_SERVICE_ACCOUNT,
            "email_verified": True,
        },
    )
    r = await client.post(
        "/v1/webhooks/play",
        content=b"not json at all",
        headers={"Authorization": "Bearer jwt", "content-type": "application/json"},
    )
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_request"


async def test_a_play_notification_that_reverses_nothing_is_ignored(session, gateways):
    """A test ping and a fresh purchase both arrive on the same subscription; neither takes coins back."""
    ping = {"packageName": PLAY_PACKAGE, "testNotification": {"version": "1.0"}}
    assert await store_billing.apply_rtdn(session, ping) == "ignored"
    bought = {
        "packageName": PLAY_PACKAGE,
        "oneTimeProductNotification": {
            "notificationType": store_billing.ONE_TIME_PRODUCT_PURCHASED,
            "purchaseToken": "t",
        },
    }
    assert await store_billing.apply_rtdn(session, bought) == "ignored"


# ---------------------------------------------------------------------------
# admin: packs, prices, tasks and the settings that move money
# ---------------------------------------------------------------------------


def pack_body(sku: str, **kw) -> dict:
    body = {
        "sku": sku,
        "name": "Popular",
        "kind": "coins",
        "coins": 500,
        "bonus_coins": 50,
        "is_active": True,
        "sort_order": 1,
        "prices": [
            {"currency": "INR", "country": "*", "amount": 499.0},
            {"currency": "INR", "country": "IN", "amount": 99.0},
        ],
    }
    body.update(kw)
    return body


async def test_a_pack_is_created_with_its_prices_and_its_sku_cannot_be_taken_twice(admin_client, maker):
    sku = f"sku-{uuid.uuid4().hex[:8]}"
    created = await admin_client.post("/v1/admin/packs", json=pack_body(sku))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["sku"] == sku and body["coins"] == 500 and body["bonus_coins"] == 50
    assert sorted((p["currency"], p["country"], p["amount"]) for p in body["prices"]) == [
        ("INR", "*", 499.0),
        ("INR", "IN", 99.0),
    ]

    clash = await admin_client.post("/v1/admin/packs", json=pack_body(sku, name="Copy"))
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "sku_taken"

    listed = await admin_client.get("/v1/admin/packs")
    assert listed.status_code == 200
    assert len([p for p in listed.json() if p["sku"] == sku]) == 1

    async with maker() as s:
        prices = (await s.scalars(select(PackPrice).where(PackPrice.pack_id == uuid.UUID(body["id"])))).all()
        assert len(prices) == 2


async def test_two_admins_creating_the_same_sku_at_once_get_a_conflict_not_a_crash(maker, committed):
    """The lookup before the insert is advisory; the unique index is the guard.

    The competing row is inserted but not yet committed, which is precisely the window the lookup cannot see
    into: our INSERT waits on the other transaction, and is rejected the moment it commits. The savepoint
    around the flush is what turns that into the same 409 an operator would have got a second earlier.
    """
    import asyncio

    from app.api.routers import admin_monetization as mon
    from app.core.errors import Conflict
    from app.schemas.admin import PackIn

    sku = f"sku-{uuid.uuid4().hex[:8]}"
    async with committed() as s:
        admin = await seed_admin(s, AdminRole.owner)

    async with maker() as blocker, maker() as mine:
        blocker.add(CoinPack(sku=sku, name="Theirs", kind=PackKind.coins, coins=100))
        await blocker.flush()  # the index entry is taken, and invisible to anyone else, until this commits
        racing = asyncio.create_task(
            mon.create_pack(body=PackIn(sku=sku, name="Ours", kind=PackKind.coins, coins=100), db=mine, admin=admin)
        )
        await asyncio.sleep(0.3)  # long enough for the handler to reach the INSERT and block there
        await blocker.commit()
        with pytest.raises(Conflict) as exc:
            await racing
        assert exc.value.detail["code"] == "sku_taken"

    async with maker() as s:
        assert len((await s.scalars(select(CoinPack).where(CoinPack.sku == sku))).all()) == 1


async def test_saving_a_namespace_for_the_first_time_creates_its_row(admin_client, maker):
    """There is no settings row until someone saves one, so the first save has to create it.

    The shared test database may already hold one, so this starts from "never saved" and puts back whatever
    was there — the rest of the suite reads these namespaces.
    """
    async with maker() as s:
        row = await s.get(Setting, "auth")
        previous = dict(row.data) if row is not None else None
        if row is not None:
            await s.delete(row)
            await s.commit()
    try:
        r = await admin_client.put("/v1/admin/settings/auth", json={"data": {"facebook": True}})
        assert r.status_code == 200, r.text
        assert r.json()["facebook"] is True
        assert r.json()["google"] is True, "keys nobody overrode still come from the defaults"
        async with maker() as s:
            assert (await s.get(Setting, "auth")).data == {"facebook": True}
    finally:
        async with maker() as s:
            row = await s.get(Setting, "auth")
            if previous is None:
                if row is not None:
                    await s.delete(row)
            else:
                row.data = previous
            await s.commit()


async def test_editing_a_packs_prices_changes_what_a_buyer_is_charged(admin_client, client, maker):
    """The price list is only real if it reaches checkout, so the quote is the assertion."""
    sku = f"sku-{uuid.uuid4().hex[:8]}"
    created = await admin_client.post("/v1/admin/packs", json=pack_body(sku))
    pack_id = created.json()["id"]

    india = await client.post("/v1/purchases/quote", json={"pack_id": pack_id}, headers={"cf-ipcountry": "IN"})
    assert india.status_code == 200 and india.json()["amount"] == 99.0

    # Drop the India override and cut the world price: one row updated, one deleted.
    edited = await admin_client.put(
        f"/v1/admin/packs/{pack_id}",
        json=pack_body(sku, name="Popular (cheaper)", prices=[{"currency": "INR", "country": "*", "amount": 299.0}]),
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Popular (cheaper)"
    assert [(p["country"], p["amount"]) for p in edited.json()["prices"]] == [("*", 299.0)]

    after = await client.post("/v1/purchases/quote", json={"pack_id": pack_id}, headers={"cf-ipcountry": "IN"})
    assert after.status_code == 200 and after.json()["amount"] == 299.0, "the removed override is really gone"

    # The audit trail is what answers "why did this cost what it cost on Tuesday".
    audit = await admin_client.get("/v1/admin/audit?limit=50")
    assert audit.status_code == 200
    actions = {(row["action"], row["target_id"]) for row in audit.json()["items"]}
    assert ("pack.create", pack_id) in actions and ("pack.update", pack_id) in actions


async def test_deleting_a_pack_deactivates_it_because_purchases_point_at_it(admin_client, client, maker):
    sku = f"sku-{uuid.uuid4().hex[:8]}"
    pack_id = (await admin_client.post("/v1/admin/packs", json=pack_body(sku))).json()["id"]
    gone = await admin_client.delete(f"/v1/admin/packs/{pack_id}")
    assert gone.status_code == 200 and gone.json() == {"ok": True}

    async with maker() as s:
        row = await s.get(CoinPack, uuid.UUID(pack_id))
        assert row is not None and row.is_active is False, "the row survives so old purchases still resolve"
    assert (await client.post("/v1/purchases/quote", json={"pack_id": pack_id})).status_code == 404


async def test_editing_or_deleting_a_pack_that_does_not_exist_is_not_found(admin_client):
    missing = uuid.uuid4()
    assert (await admin_client.put(f"/v1/admin/packs/{missing}", json=pack_body("x"))).status_code == 404
    assert (await admin_client.delete(f"/v1/admin/packs/{missing}")).status_code == 404


async def test_anything_that_sets_a_price_needs_the_finance_role(editor_client):
    """An editor runs the catalogue; what a pack costs is not theirs to change."""
    listing = await editor_client.get("/v1/admin/packs")
    assert listing.status_code == 200, "an editor may still see the price list"

    sku = f"sku-{uuid.uuid4().hex[:8]}"
    assert (await editor_client.post("/v1/admin/packs", json=pack_body(sku))).status_code == 403
    assert (await editor_client.put(f"/v1/admin/packs/{uuid.uuid4()}", json=pack_body(sku))).status_code == 403
    assert (await editor_client.delete(f"/v1/admin/packs/{uuid.uuid4()}")).status_code == 403


async def test_reward_tasks_are_created_edited_and_removed(admin_client, maker):
    body = {
        "platform": "android",
        "kind": "link",
        "title": "Follow us",
        "coins": 20,
        "url": "https://katha.test/follow",
        "timer_seconds": 15,
        "frequency": "once",
        "is_active": True,
        "sort_order": 3,
    }
    created = await admin_client.post("/v1/admin/reward-tasks", json=body)
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    assert created.json()["coins"] == 20 and created.json()["frequency"] == "once"

    edited = await admin_client.put(f"/v1/admin/reward-tasks/{task_id}", json={**body, "coins": 35, "is_active": False})
    assert edited.status_code == 200
    assert edited.json()["coins"] == 35 and edited.json()["is_active"] is False

    listed = await admin_client.get("/v1/admin/reward-tasks")
    assert any(t["id"] == task_id for t in listed.json())

    assert (await admin_client.delete(f"/v1/admin/reward-tasks/{task_id}")).status_code == 200
    assert not any(t["id"] == task_id for t in (await admin_client.get("/v1/admin/reward-tasks")).json())

    missing = uuid.uuid4()
    assert (await admin_client.put(f"/v1/admin/reward-tasks/{missing}", json=body)).status_code == 404
    assert (await admin_client.delete(f"/v1/admin/reward-tasks/{missing}")).status_code == 404
    # A task that pays nothing is a bug, not a configuration.
    assert (await admin_client.post("/v1/admin/reward-tasks", json={**body, "coins": 0})).status_code == 422


async def test_a_settings_namespace_reads_back_what_was_saved(admin_client):
    marker = f"coverage_{uuid.uuid4().hex[:8]}"
    saved = await admin_client.put("/v1/admin/settings/seo", json={"data": {marker: "on"}})
    assert saved.status_code == 200, saved.text
    assert saved.json()[marker] == "on"
    read_back = await admin_client.get("/v1/admin/settings/seo")
    assert read_back.status_code == 200 and read_back.json()[marker] == "on"


async def test_only_namespaces_the_console_owns_can_be_read_or_written(admin_client):
    assert (await admin_client.get("/v1/admin/settings/economy")).json()["coins_enabled"] is True
    assert (await admin_client.get("/v1/admin/settings/nonsense")).status_code == 404
    assert (await admin_client.put("/v1/admin/settings/nonsense", json={"data": {"x": 1}})).status_code == 404


async def test_a_secret_is_refused_wherever_it_is_nested(admin_client):
    """Settings are served to clients through /v1/config, so a secret saved here is a secret published."""
    r = await admin_client.put("/v1/admin/settings/payments", json={"data": {"stripe": {"secret_key": "sk_live_oops"}}})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "secret_in_settings"
    assert "stripe.secret_key" in r.json()["detail"]["message"]


async def test_a_value_the_economy_reads_as_a_number_must_be_one(admin_client):
    r = await admin_client.put("/v1/admin/settings/economy", json={"data": {"episode_price": "twenty"}})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_setting_value"
    too_big = await admin_client.put("/v1/admin/settings/economy", json={"data": {"free_episodes": 10_000}})
    assert too_big.status_code == 400 and too_big.json()["detail"]["code"] == "bad_setting_value"


async def test_economy_settings_are_finance_only_even_for_an_editor_who_may_edit_other_namespaces(editor_client):
    refused = await editor_client.put("/v1/admin/settings/economy", json={"data": {"coins_enabled": False}})
    assert refused.status_code == 403
    allowed = await editor_client.put("/v1/admin/settings/site", json={"data": {"name": "Katha"}})
    assert allowed.status_code == 200 and allowed.json()["name"] == "Katha"


async def test_the_purchase_list_counts_and_sums_the_whole_filtered_set(admin_client, committed):
    """A dispute arrives quoting one identifier; the console has to find it, and the money beside it has to
    be the total of what was asked for rather than of the page that happened to load."""
    payment_id = f"pi_dispute_{uuid.uuid4().hex[:10]}"
    async with committed() as s:
        buyer_row = await seed_user(s, email=f"disputes-{uuid.uuid4().hex[:6]}@katha-test.dev")
        pack = await seed_pack(s, coins=100, bonus=0)
        paid_inr = await seed_purchase(
            s, user=buyer_row, pack=pack, status=PurchaseStatus.paid, amount="499.00", gateway_payment_id=payment_id
        )
        await seed_purchase(s, user=buyer_row, pack=pack, status=PurchaseStatus.paid, amount="1.00", currency="USD")
        await seed_purchase(s, user=buyer_row, pack=pack, status=PurchaseStatus.pending, amount="99.00")

    mine = await admin_client.get(f"/v1/admin/purchases?q={buyer_row.public_id}&limit=50")
    assert mine.status_code == 200, mine.text
    page = mine.json()
    assert page["total"] == 3
    assert page["totals_by_currency"] == {"INR": 598.0, "USD": 1.0}
    assert {row["user_email"] for row in page["items"]} == {buyer_row.email}

    only_paid = await admin_client.get(f"/v1/admin/purchases?q={buyer_row.public_id}&status=paid")
    assert only_paid.json()["total"] == 2
    assert only_paid.json()["totals_by_currency"] == {"INR": 499.0, "USD": 1.0}

    by_payment_id = await admin_client.get(f"/v1/admin/purchases?q={payment_id}")
    assert [row["id"] for row in by_payment_id.json()["items"]] == [str(paid_inr.id)]

    by_uuid = await admin_client.get(f"/v1/admin/purchases?q={paid_inr.id}")
    assert [row["id"] for row in by_uuid.json()["items"]] == [str(paid_inr.id)]

    today = date.today()
    in_window = await admin_client.get(f"/v1/admin/purchases?q={buyer_row.public_id}&date_from={today}&date_to={today}")
    assert in_window.json()["total"] == 3, "the end date is inclusive of the day named"
    before = today - timedelta(days=2)
    outside = await admin_client.get(f"/v1/admin/purchases?q={buyer_row.public_id}&date_from={before}&date_to={before}")
    assert outside.json()["total"] == 0 and outside.json()["items"] == []


async def test_an_offer_kind_outside_the_four_the_product_defines_is_refused(admin_client, maker):
    """`Offer.kind` is a free-text column; the schema is the only thing stopping a typo becoming an offer
    that `offers.eligible` will never match and nobody will ever see."""
    # Scoped to a country nobody is in, and removed afterwards: a live offer is global, and these rows would
    # otherwise turn up in every other test's list of eligible offers.
    base = {"title": "Weekend", "discount_pct": 20, "is_active": True, "eligibility": {"countries": ["ZZ"]}}
    bad = await admin_client.post("/v1/admin/offers", json={**base, "kind": "flash_sale"})
    assert bad.status_code == 422
    created = []
    try:
        for kind in ("first_purchase", "bundle", "winback", "coupon"):
            ok = await admin_client.post("/v1/admin/offers", json={**base, "kind": kind})
            assert ok.status_code == 201, ok.text
            assert ok.json()["kind"] == kind
            created.append(uuid.UUID(ok.json()["id"]))
        # A discount has to be a discount, and not a giveaway.
        for pct in (0, 95):
            refused = await admin_client.post("/v1/admin/offers", json={**base, "kind": "bundle", "discount_pct": pct})
            assert refused.status_code == 422
    finally:
        async with maker() as s:
            for offer_id in created:
                await s.delete(await s.get(Offer, offer_id))
            await s.commit()
