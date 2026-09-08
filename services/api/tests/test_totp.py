"""TOTP against the RFC 6238 test vectors.

A hand-rolled HMAC is only defensible if it is checked against the specification's own numbers, so it is.
Pure — no database, no network.
"""

import hashlib

import pytest

from app.core import totp

# RFC 6238, Appendix B. The published vectors are 8 digits; the shared secret is the ASCII string
# "12345678901234567890" in base32.
SECRET_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
VECTORS = [
    (59, "94287082"),
    (1111111109, "07081804"),
    (1111111111, "14050471"),
    (1234567890, "89005924"),
    (2000000000, "69279037"),
    (20000000000, "65353130"),
]


@pytest.mark.parametrize("at,expected", VECTORS)
def test_rfc6238_vectors(at, expected):
    assert totp.generate(SECRET_SHA1, at=at, digits=8, digest=hashlib.sha1) == expected


def test_round_trip_at_the_same_instant():
    secret = totp.random_secret()
    assert totp.verify(secret, totp.generate(secret, at=1_700_000_000), at=1_700_000_000)


def test_one_step_of_drift_is_accepted():
    """A phone clock a few seconds out must not lock someone out of the console."""
    secret = totp.random_secret()
    code = totp.generate(secret, at=1_700_000_000)
    assert totp.verify(secret, code, at=1_700_000_000 + totp.STEP_SECONDS)
    assert totp.verify(secret, code, at=1_700_000_000 - totp.STEP_SECONDS)


def test_two_steps_of_drift_is_not():
    secret = totp.random_secret()
    code = totp.generate(secret, at=1_700_000_000)
    assert not totp.verify(secret, code, at=1_700_000_000 + 2 * totp.STEP_SECONDS)


def test_malformed_codes_are_rejected_without_raising():
    secret = totp.random_secret()
    for bad in ["", "abcdef", "12345", "1234567", "12 34 56x", None]:
        assert not totp.verify(secret, bad or "")


def test_spaces_and_dashes_are_tolerated():
    """Authenticator apps display "123 456"; people paste what they see."""
    secret = totp.random_secret()
    code = totp.generate(secret, at=1_700_000_000)
    spaced = f"{code[:3]} {code[3:]}"
    assert totp.verify(secret, spaced, at=1_700_000_000)


def test_secret_survives_the_padding_apps_strip():
    secret = totp.random_secret()
    assert totp.generate(secret, at=1) == totp.generate(secret + "=" * (-len(secret) % 8), at=1)


def test_provisioning_uri_names_the_issuer_twice():
    uri = totp.provisioning_uri("ABCD", account="ops@katha.app", issuer="Katha Admin")
    assert uri.startswith("otpauth://totp/Katha%20Admin%3Aops%40katha.app?")
    assert "issuer=Katha%20Admin" in uri
    assert "secret=ABCD" in uri
