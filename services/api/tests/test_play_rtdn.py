"""Google Play real-time developer notifications: envelope decoding, token checks and the route's front door.

Pure: the Google verifier is replaced with a function under the test's control, so nothing reaches the
network, and the route is exercised only as far as authentication — what happens to a verified notification
is a database matter and lives in `test_play_rtdn_db.py`.
"""

import base64
import json

import pytest

from app.core.config import get_settings
from app.core.errors import AppError, Unauthorized
from app.services import store_billing

PACKAGE = "app.katha.test"
AUDIENCE = "https://api.katha.test/v1/webhooks/play"
SERVICE_ACCOUNT = "play-rtdn@katha-test.iam.gserviceaccount.com"


def envelope(notification: dict, message_id: str = "msg-1") -> dict:
    data = base64.b64encode(json.dumps(notification).encode()).decode()
    return {
        "message": {"data": data, "messageId": message_id, "publishTime": "2026-09-09T10:00:00.000Z"},
        "subscription": "projects/katha-test/subscriptions/play-rtdn",
    }


def voided(token: str = "tok-1", package: str = PACKAGE) -> dict:
    return {
        "version": "1.0",
        "packageName": package,
        "eventTimeMillis": "1757412000000",
        "voidedPurchaseNotification": {"purchaseToken": token, "orderId": "GPA.1", "productType": 1, "refundType": 1},
    }


def one_time(notification_type: int, token: str = "tok-1", package: str = PACKAGE) -> dict:
    return {
        "version": "1.0",
        "packageName": package,
        "eventTimeMillis": "1757412000000",
        "oneTimeProductNotification": {
            "version": "1.0",
            "notificationType": notification_type,
            "purchaseToken": token,
            "sku": "coins_100",
        },
    }


def good_claims(token: str, audience: str) -> dict:
    assert audience == AUDIENCE, "the verifier has to be handed the configured audience"
    return {"iss": "https://accounts.google.com", "aud": audience, "email": SERVICE_ACCOUNT, "email_verified": True}


# ---- decoding ----


def test_decode_unwraps_the_pubsub_envelope():
    message_id, notification = store_billing.decode_rtdn(envelope(voided(), message_id="abc123"))
    assert message_id == "abc123"
    assert notification["packageName"] == PACKAGE
    assert notification["voidedPurchaseNotification"]["purchaseToken"] == "tok-1"


def test_decode_accepts_the_snake_case_message_id_too():
    body = envelope(voided())
    body["message"]["message_id"] = body["message"].pop("messageId")
    assert store_billing.decode_rtdn(body)[0] == "msg-1"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"message": "nope"},
        {"message": {"data": "e30="}},  # no id
        {"message": {"messageId": "1"}},  # no data
        {"message": {"messageId": "1", "data": "not base64!"}},
        {"message": {"messageId": "1", "data": base64.b64encode(b"[1, 2]").decode()}},
        {"message": {"messageId": "1", "data": base64.b64encode(b"\xff\xfe").decode()}},
    ],
)
def test_decode_refuses_what_is_not_a_pubsub_push(body):
    with pytest.raises(AppError) as exc:
        store_billing.decode_rtdn(body)
    assert exc.value.status_code == 400


# ---- which notifications reverse a purchase ----


def test_a_void_names_its_purchase_token():
    assert store_billing.refund_token(voided("t-void")) == "t-void"
    assert store_billing.rtdn_kind(voided()) == "voidedPurchaseNotification"


def test_a_cancelled_one_time_product_names_its_token_and_a_purchase_does_not():
    assert store_billing.refund_token(one_time(store_billing.ONE_TIME_PRODUCT_CANCELED, "t-c")) == "t-c"
    assert store_billing.refund_token(one_time(store_billing.ONE_TIME_PRODUCT_PURCHASED, "t-p")) is None
    assert store_billing.rtdn_kind(one_time(1)) == "oneTimeProductNotification"


def test_subscription_and_test_notifications_reverse_nothing():
    sub = {"packageName": PACKAGE, "subscriptionNotification": {"notificationType": 4, "purchaseToken": "s"}}
    test = {"packageName": PACKAGE, "testNotification": {"version": "1.0"}}
    assert store_billing.refund_token(sub) is None and store_billing.rtdn_kind(sub) == "subscriptionNotification"
    assert store_billing.refund_token(test) is None and store_billing.rtdn_kind(test) == "testNotification"
    assert store_billing.rtdn_kind({"packageName": PACKAGE}) is None


# ---- token verification ----


def test_the_expected_service_account_is_accepted():
    claims = store_billing.verify_play_rtdn(
        "jwt", audience=AUDIENCE, service_account_email=SERVICE_ACCOUNT.upper(), verifier=good_claims
    )
    assert claims["email"] == SERVICE_ACCOUNT


def test_a_token_from_another_google_account_is_refused():
    """Any Pub/Sub topic anywhere can push a Google-signed token at a public URL; only ours may act."""

    def other(token, audience):
        return {**good_claims(token, audience), "email": "someone-else@example.iam.gserviceaccount.com"}

    with pytest.raises(Unauthorized):
        store_billing.verify_play_rtdn("jwt", audience=AUDIENCE, service_account_email=SERVICE_ACCOUNT, verifier=other)


def test_an_unverified_email_claim_is_refused():
    def unverified(token, audience):
        return {**good_claims(token, audience), "email_verified": False}

    with pytest.raises(Unauthorized):
        store_billing.verify_play_rtdn(
            "jwt", audience=AUDIENCE, service_account_email=SERVICE_ACCOUNT, verifier=unverified
        )


def test_a_failed_signature_check_is_a_401_not_a_500():
    def broken(token, audience):
        raise ValueError("Token has wrong audience")

    with pytest.raises(Unauthorized):
        store_billing.verify_play_rtdn("jwt", audience=AUDIENCE, service_account_email=SERVICE_ACCOUNT, verifier=broken)


# ---- the route, up to authentication ----


@pytest.fixture
def configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_play_package_name", PACKAGE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_audience", AUDIENCE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_service_account_email", SERVICE_ACCOUNT, raising=False)


async def test_the_route_is_503_until_both_settings_are_present(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_play_rtdn_audience", AUDIENCE, raising=False)
    monkeypatch.setattr(s, "google_play_rtdn_service_account_email", None, raising=False)
    r = await client.post("/v1/webhooks/play", json=envelope(voided()), headers={"Authorization": "Bearer x"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "not_configured"


async def test_the_route_refuses_a_missing_or_malformed_bearer(client, configured):
    r = await client.post("/v1/webhooks/play", json=envelope(voided()))
    assert r.status_code == 401
    r = await client.post("/v1/webhooks/play", json=envelope(voided()), headers={"Authorization": "Basic abc"})
    assert r.status_code == 401


async def test_the_route_refuses_a_token_google_will_not_vouch_for(client, configured, monkeypatch):
    def broken(token, audience):
        raise ValueError("bad signature")

    monkeypatch.setattr(store_billing, "_google_oidc_verifier", broken)
    r = await client.post("/v1/webhooks/play", json=envelope(voided()), headers={"Authorization": "Bearer jwt"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "bad_signature"


async def test_an_authenticated_non_pubsub_body_is_a_400(client, configured, monkeypatch):
    monkeypatch.setattr(store_billing, "_google_oidc_verifier", good_claims)
    r = await client.post("/v1/webhooks/play", json={"hello": "world"}, headers={"Authorization": "Bearer jwt"})
    assert r.status_code == 400
