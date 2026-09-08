"""AdMob server-side verification, signed with a key generated here.

Rewarded ads were the one earn mechanic the product could not run: `AdEvent` and `consume_ad_event` existed
and nothing ever wrote a row, because the callback that proves someone watched an ad had no endpoint. Without
verification the alternative is trusting the client, which means anyone with a proxy can mint coins.

Google's real keys are not needed to test the verification — the algorithm is ECDSA-SHA256 over the query
string, so a locally generated P-256 key exercises exactly the same path. Pure; no database, no network.
"""

import base64
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.services import admob_ssv


@pytest.fixture
def keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private, pem


def sign(private, content: str) -> str:
    raw = private.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    # Google strips the padding, so the verifier must put it back.
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def callback(content: str, signature: str, key_id: str = "1") -> str:
    return f"{content}&signature={signature}&key_id={key_id}"


CONTENT = (
    "ad_network=5450213213286189855&ad_unit=1234&custom_data=task%3Aabc"
    "&reward_amount=10&reward_item=coins&timestamp=1700000000000"
    "&transaction_id=abc123&user_id=11111111-1111-1111-1111-111111111111"
)


def test_signed_content_stops_at_the_signature(keypair):
    query = callback(CONTENT, "sig", "7")
    assert admob_ssv.signed_content(query) == CONTENT


def test_a_callback_with_no_signature_is_refused():
    assert admob_ssv.signed_content("transaction_id=abc") is None
    assert admob_ssv.verify_with_pem("transaction_id=abc", "sig", "not a pem") is False


def test_a_genuine_signature_verifies(keypair):
    private, pem = keypair
    query = callback(CONTENT, sign(private, CONTENT))
    assert admob_ssv.verify_with_pem(query, sign(private, CONTENT), pem) is True


def test_one_altered_character_fails(keypair):
    """The whole point: a reward amount edited in flight must not verify."""
    private, pem = keypair
    signature = sign(private, CONTENT)
    tampered = CONTENT.replace("reward_amount=10", "reward_amount=99999")
    assert admob_ssv.verify_with_pem(callback(tampered, signature), signature, pem) is False


def test_a_signature_from_another_key_fails(keypair):
    _, pem = keypair
    other = ec.generate_private_key(ec.SECP256R1())
    signature = sign(other, CONTENT)
    assert admob_ssv.verify_with_pem(callback(CONTENT, signature), signature, pem) is False


def test_a_malformed_signature_is_false_not_an_exception(keypair):
    _, pem = keypair
    for bad in ["", "!!!!", "abc"]:
        assert admob_ssv.verify_with_pem(callback(CONTENT, bad), bad, pem) is False


def test_padding_stripped_signatures_are_accepted(keypair):
    """Google omits base64 padding; a verifier that does not restore it rejects real callbacks."""
    private, pem = keypair
    signature = sign(private, CONTENT)
    assert "=" not in signature
    assert admob_ssv.verify_with_pem(callback(CONTENT, signature), signature, pem) is True


def test_freshness_window():
    now = 1_700_000_000.0
    assert admob_ssv.is_fresh(int(now * 1000), now=now) is True
    assert admob_ssv.is_fresh(int((now - 30) * 1000), now=now) is True
    # An hour and a bit later is a replay, not a reward.
    assert admob_ssv.is_fresh(int((now - 3700) * 1000), now=now) is False
    # A little clock skew forwards is tolerated; a lot is not.
    assert admob_ssv.is_fresh(int((now + 60) * 1000), now=now) is True
    assert admob_ssv.is_fresh(int((now + 600) * 1000), now=now) is False
    assert admob_ssv.is_fresh(None) is False
    assert admob_ssv.is_fresh("not-a-number") is False


async def test_an_unknown_key_id_is_refused_not_guessed(keypair, monkeypatch):
    """Trying every key would keep accepting signatures from a retired one forever."""
    private, pem = keypair
    admob_ssv.reset_cache()

    async def keys(**_):
        return {"1": pem}

    monkeypatch.setattr(admob_ssv, "fetch_keys", keys)
    signature = sign(private, CONTENT)
    assert await admob_ssv.verify(callback(CONTENT, signature, "1"), signature, "1") is True
    assert await admob_ssv.verify(callback(CONTENT, signature, "99"), signature, "99") is False


async def test_keys_are_cached_between_calls(monkeypatch):
    admob_ssv.reset_cache()
    calls = {"n": 0}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": [{"keyId": 3, "pem": "-----BEGIN PUBLIC KEY-----\\nx\\n-----END PUBLIC KEY-----"}]}

    class FakeClient:
        async def get(self, _url):
            calls["n"] += 1
            return FakeResponse()

    now = time.time()
    client = FakeClient()
    first = await admob_ssv.fetch_keys(client=client, now=now)
    second = await admob_ssv.fetch_keys(client=client, now=now + 10)
    assert first == second
    assert calls["n"] == 1, "the key set is fetched once per TTL, not once per callback"

    # Past the TTL it is fetched again, so a rotation is picked up without a deploy.
    await admob_ssv.fetch_keys(client=client, now=now + admob_ssv.KEY_TTL_SECONDS + 1)
    assert calls["n"] == 2
    admob_ssv.reset_cache()


async def test_an_empty_key_set_raises_rather_than_verifying_nothing(monkeypatch):
    admob_ssv.reset_cache()

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": []}

    class FakeClient:
        async def get(self, _url):
            return FakeResponse()

    with pytest.raises(ValueError):
        await admob_ssv.fetch_keys(client=FakeClient())
    admob_ssv.reset_cache()
