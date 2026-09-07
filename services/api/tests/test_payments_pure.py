"""Pure payment helpers: signature verification and minor-unit conversion. No network, no DB."""

import hashlib
import hmac
import json
from decimal import Decimal

import pytest
import stripe

from app.core.errors import AppError
from app.services import payments


def test_minor_units():
    assert payments._minor_units(Decimal("99.00"), "INR") == 9900
    assert payments._minor_units(Decimal("1.99"), "USD") == 199
    assert payments._minor_units(Decimal("500"), "JPY") == 500


def test_razorpay_webhook_signature():
    body = json.dumps({"event": "payment.captured"}).encode()
    good = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
    assert payments.verify_razorpay(body, good, "whsec")["event"] == "payment.captured"
    with pytest.raises(AppError):
        payments.verify_razorpay(body, "0" * 64, "whsec")


def test_razorpay_checkout_handshake():
    sig = hmac.new(b"ks", b"order_1|pay_1", hashlib.sha256).hexdigest()
    assert payments.verify_razorpay_checkout("order_1", "pay_1", sig, "ks")
    assert not payments.verify_razorpay_checkout("order_1", "pay_2", sig, "ks")


def test_stripe_signature_rejects_garbage():
    with pytest.raises(stripe.SignatureVerificationError):
        payments.verify_stripe(b"{}", "t=1,v1=bad", "whsec_test")
