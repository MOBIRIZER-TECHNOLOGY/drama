"""The Play reconcile with no Redis attached: the one path tests/test_billing.py does not take.

A worker started without a queue connection (and arq's own `--check`) still has to be able to run this job,
because the checkpoint is an optimisation, not a correctness condition - Google is asked for the full lookback
window instead, and `mark_refunded` is terminal, so seeing the same void twice reverses it once.
"""

import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
from app.models.wallet import PurchaseStatus
from app.services import store_billing

from worker.jobs import billing

PACKAGE = "app.katha.test"


class FakeSession:
    def __init__(self, purchase=None):
        self.purchase = purchase
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def scalar(self, stmt):
        return self.purchase

    async def commit(self):
        self.committed = True


def _google(monkeypatch, payload: dict):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=payload)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        store_billing.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    monkeypatch.setattr(store_billing, "_access_token", lambda: "test-token")
    settings = store_billing.get_settings()
    monkeypatch.setattr(settings, "google_play_package_name", PACKAGE, raising=False)
    monkeypatch.setattr(settings, "google_play_service_account_file", "/dev/null", raising=False)
    return requests


async def test_without_redis_the_poll_covers_the_whole_lookback_window(monkeypatch):
    """No checkpoint to rewind from, so the floor Google will serve is the start time asked for."""
    purchase = SimpleNamespace(id="p1", external_id="tok", status=PurchaseStatus.paid)
    requests = _google(monkeypatch, {"voidedPurchases": [{"purchaseToken": "tok", "orderId": "GPA.9"}]})
    db = FakeSession(purchase)
    monkeypatch.setattr(billing, "SessionLocal", lambda: db)
    refunds: list = []

    async def mark_refunded(session, purchase_id, *, raw=None):
        refunds.append((purchase_id, raw))
        return SimpleNamespace(id=purchase_id, status=PurchaseStatus.refunded)

    monkeypatch.setattr(billing.payments, "mark_refunded", mark_refunded)

    out = await billing.reconcile_play_voided({})

    assert out == {"status": "ok", "voided": 1, "refunded": 1, "unknown": 0}
    assert [pid for pid, _ in refunds] == ["p1"]
    assert db.committed
    start = int(parse_qs(urlparse(str(requests[0].url)).query)["startTime"][0])
    floor = int(time.time() * 1000) - int(store_billing.VOIDED_LOOKBACK.total_seconds() * 1000)
    assert abs(start - floor) < 60_000


async def test_reading_a_checkpoint_without_redis_returns_nothing_rather_than_raising():
    assert await billing._checkpoint(None) is None
