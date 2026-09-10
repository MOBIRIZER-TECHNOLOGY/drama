"""The Play voided-purchases poll, with Google, the database and Redis faked.

Google is faked at the HTTP layer rather than at `list_voided`: the request the job sends is part of what is
under test (the `startTime` it asks for is what decides whether a void is ever seen), and pagination is the
kind of thing that works on the one-page happy path and silently drops the second page in production.
"""

import json
import time
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from app.models.wallet import PurchaseStatus
from app.services import store_billing

from worker.jobs import billing

PACKAGE = "app.katha.test"


class FakeSession:
    """Answers `scalar` from a token -> purchase map, the one query the job makes."""

    def __init__(self, purchases: dict[str, object]):
        self.purchases = purchases
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalar(self, stmt):
        # The token is the only string literal bound into the statement.
        params = stmt.compile().params
        token = next(v for v in params.values() if isinstance(v, str) and v != store_billing.GATEWAY)
        return self.purchases.get(token)

    async def commit(self):
        self.committed = True


class FakeRedis:
    def __init__(self, values: dict[str, str] | None = None):
        self.values = dict(values or {})

    async def get(self, key):
        v = self.values.get(key)
        return v.encode() if v is not None else None

    async def set(self, key, value):
        self.values[key] = str(value)


def _purchase(token: str, status=PurchaseStatus.paid):
    return SimpleNamespace(id=uuid.uuid4(), external_id=token, status=status)


def _google(monkeypatch, pages: list[dict]):
    """Serve `pages` in order from the voided-purchases endpoint; record every request."""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path.endswith(f"/applications/{PACKAGE}/purchases/voidedpurchases")
        assert request.headers["authorization"] == "Bearer test-token"
        page = parse_qs(urlparse(str(request.url)).query).get("token", [None])[0]
        index = 0 if page is None else int(page.removeprefix("page-"))
        return httpx.Response(200, json=pages[index])

    real_client = httpx.AsyncClient

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(store_billing.httpx, "AsyncClient", client)
    monkeypatch.setattr(store_billing, "_access_token", lambda: "test-token")
    settings = store_billing.get_settings()
    monkeypatch.setattr(settings, "google_play_package_name", PACKAGE, raising=False)
    monkeypatch.setattr(settings, "google_play_service_account_file", "/dev/null", raising=False)
    return requests


def _refunds(monkeypatch):
    calls: list[tuple] = []

    async def mark_refunded(db, purchase_id, *, raw=None):
        calls.append((purchase_id, raw))
        return SimpleNamespace(id=purchase_id, status=PurchaseStatus.refunded)

    monkeypatch.setattr(billing.payments, "mark_refunded", mark_refunded)
    return calls


async def test_skips_cleanly_when_play_is_not_configured(monkeypatch):
    settings = store_billing.get_settings()
    monkeypatch.setattr(settings, "google_play_package_name", None, raising=False)
    monkeypatch.setattr(settings, "google_play_service_account_file", None, raising=False)
    assert await billing.reconcile_play_voided({"redis": FakeRedis()}) == {"status": "not_configured"}


async def test_voided_purchases_are_refunded_across_pages_and_the_checkpoint_moves(monkeypatch):
    paid, already, other = _purchase("tok-paid"), _purchase("tok-done", PurchaseStatus.refunded), _purchase("tok-x")
    requests = _google(
        monkeypatch,
        [
            {
                "voidedPurchases": [
                    {"purchaseToken": "tok-paid", "orderId": "GPA.1", "voidedTimeMillis": "1700000000000"},
                    {"purchaseToken": "tok-done", "orderId": "GPA.2"},
                ],
                "tokenPagination": {"nextPageToken": "page-1"},
            },
            {"voidedPurchases": [{"purchaseToken": "tok-unknown", "orderId": "GPA.3"}]},
        ],
    )
    db = FakeSession({"tok-paid": paid, "tok-done": already, "tok-x": other})
    monkeypatch.setattr(billing, "SessionLocal", lambda: db)
    refunds = _refunds(monkeypatch)
    redis = FakeRedis()

    out = await billing.reconcile_play_voided({"redis": redis})

    assert out == {"status": "ok", "voided": 3, "refunded": 1, "unknown": 1}
    assert [pid for pid, _ in refunds] == [paid.id], "only the paid purchase is reversed; refunded is terminal"
    assert refunds[0][1]["source"] == "play_reconcile" and refunds[0][1]["order_id"] == "GPA.1"
    assert db.committed
    assert len(requests) == 2, "the second page was fetched"
    assert billing.CHECKPOINT_KEY in redis.values


async def test_the_next_run_starts_before_the_last_checkpoint(monkeypatch):
    """A void Google indexed late must still be seen: the poll rewinds by OVERLAP, and never beyond 30 days."""
    requests = _google(monkeypatch, [{"voidedPurchases": []}])
    monkeypatch.setattr(billing, "SessionLocal", lambda: FakeSession({}))
    _refunds(monkeypatch)

    now_ms = int(time.time() * 1000)
    checkpoint = now_ms - 3 * 60 * 60 * 1000  # three hours ago
    redis = FakeRedis({billing.CHECKPOINT_KEY: str(checkpoint)})
    await billing.reconcile_play_voided({"redis": redis})
    start = int(parse_qs(urlparse(str(requests[0].url)).query)["startTime"][0])
    assert start == checkpoint - int(billing.OVERLAP.total_seconds() * 1000)

    # A checkpoint from long ago is clamped to the window Google will actually serve.
    redis = FakeRedis({billing.CHECKPOINT_KEY: str(now_ms - 90 * 24 * 60 * 60 * 1000)})
    await billing.reconcile_play_voided({"redis": redis})
    start = int(parse_qs(urlparse(str(requests[1].url)).query)["startTime"][0])
    floor = now_ms - int(store_billing.VOIDED_LOOKBACK.total_seconds() * 1000)
    assert abs(start - floor) < 60_000


async def test_a_failed_fetch_leaves_the_checkpoint_alone(monkeypatch):
    def handler(request):
        return httpx.Response(500, text="boom")

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        store_billing.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    monkeypatch.setattr(store_billing, "_access_token", lambda: "test-token")
    settings = store_billing.get_settings()
    monkeypatch.setattr(settings, "google_play_package_name", PACKAGE, raising=False)
    monkeypatch.setattr(settings, "google_play_service_account_file", "/dev/null", raising=False)
    redis = FakeRedis({billing.CHECKPOINT_KEY: "123"})

    with pytest.raises(Exception, match="verify"):
        await billing.reconcile_play_voided({"redis": redis})
    assert redis.values[billing.CHECKPOINT_KEY] == "123"


def test_parse_voided_skips_rows_without_a_token():
    rows = store_billing.parse_voided(
        {"voidedPurchases": [{"orderId": "GPA.0"}, {"purchaseToken": "t", "voidedTimeMillis": "5", "voidedReason": 1}]}
    )
    assert len(rows) == 1 and rows[0].purchase_token == "t" and rows[0].voided_time_ms == 5 and rows[0].reason == 1
    assert json.dumps(rows[0].__dict__)  # audit payload has to be JSON-serialisable
