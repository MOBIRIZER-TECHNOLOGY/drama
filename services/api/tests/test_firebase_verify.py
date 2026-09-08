"""ID token verification, against tokens this test signs itself.

This is the front door: whatever `verify_id_token` accepts becomes a signed-in account. The checks that
matter are the ones an attacker would probe — a token signed by a key they control, a token minted for a
different Firebase project, one that has expired — so each is asserted separately rather than trusting that
one library call covers all three.

Pure: a keypair is generated here and the resolver is pointed at it, so nothing reaches the network.
"""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core import firebase
from app.core.errors import Unauthorized

PROJECT = "katha-test-project"
ISSUER = f"https://securetoken.google.com/{PROJECT}"


@pytest.fixture(scope="module")
def keys():
    good = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return good, attacker


@pytest.fixture(autouse=True)
def wired(monkeypatch, keys):
    """Point the project id at ours and the key resolver at the keypair, instead of at Google."""
    good, _ = keys
    monkeypatch.setattr(firebase.get_settings(), "firebase_project_id", PROJECT, raising=False)

    class _Key:
        key = good.public_key()

    class _Client:
        def get_signing_key_from_jwt(self, _token):
            return _Key()

    monkeypatch.setattr(firebase, "_jwks", lambda: _Client())


def _token(key, **overrides) -> str:
    now = int(time.time())
    claims = {
        "sub": "firebase-uid-1",
        "aud": PROJECT,
        "iss": ISSUER,
        "iat": now - 10,
        "exp": now + 3600,
        "email": "viewer@katha-test.dev",
        "name": "Test Viewer",
        "picture": "https://example.invalid/a.png",
        "phone_number": "+911234567890",
        "firebase": {"sign_in_provider": "password"},
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def test_a_valid_token_maps_every_claim_the_product_uses(keys):
    good, _ = keys
    identity = firebase.verify_id_token(_token(good))
    assert identity.uid == "firebase-uid-1"
    assert identity.email == "viewer@katha-test.dev"
    assert identity.phone == "+911234567890"
    assert identity.name == "Test Viewer"
    assert identity.provider == "password"


def test_a_token_signed_by_someone_elses_key_is_refused(keys):
    """The whole point of the signature: anyone can write these claims, only Google can sign them."""
    _, attacker = keys
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(attacker))


def test_a_token_for_a_different_firebase_project_is_refused(keys):
    """Audience is what stops a token from another project being replayed against this one."""
    good, _ = keys
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(good, aud="someone-elses-project"))


def test_a_token_from_a_different_issuer_is_refused(keys):
    good, _ = keys
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(good, iss="https://securetoken.google.com/other"))


def test_an_expired_token_is_refused(keys):
    good, _ = keys
    now = int(time.time())
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(good, iat=now - 7200, exp=now - 3600))


def test_a_token_without_a_subject_is_refused(keys):
    """`sub` becomes the account identity, so an empty one would collapse users together."""
    good, _ = keys
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(good, sub=""))


def test_the_algorithm_cannot_be_downgraded(keys):
    """`alg: none` is the classic JWT forgery; only RS256 is accepted."""
    unsigned = jwt.encode(
        {"sub": "x", "aud": PROJECT, "iss": ISSUER, "iat": int(time.time()), "exp": int(time.time()) + 60},
        key="",
        algorithm="none",
    )
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(unsigned)


def test_no_project_id_configured_is_a_clean_refusal(monkeypatch, keys):
    good, _ = keys
    monkeypatch.setattr(firebase.get_settings(), "firebase_project_id", None, raising=False)
    with pytest.raises(Unauthorized):
        firebase.verify_id_token(_token(good))
