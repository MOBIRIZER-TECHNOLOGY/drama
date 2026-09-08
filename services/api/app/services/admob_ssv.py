"""Verifying AdMob's server-side reward callback.

Rewarded ads were the one earn mechanic the product could not actually run: `AdEvent` and `consume_ad_event`
were built and nothing ever wrote a row, because the callback that proves someone watched an ad had no
endpoint. Without verification the alternative is trusting the client, which means anyone with a proxy can
mint coins.

Google signs the callback with ECDSA over the query string and publishes the public keys. The rules that
matter, and are easy to get wrong:

* the signed content is the raw query string up to and including `&signature=` being removed — the exact bytes
  as sent, not a re-encoded dictionary, because re-encoding changes escaping and the signature stops matching;
* `signature` is base64url with padding stripped;
* the key is chosen by `key_id`, so keys can be rotated without a deploy;
* an unrecognised `key_id` is a rejection, never a fallback to "any key".

The key set is fetched over HTTPS and cached; a fetch failure fails the verification rather than skipping it.
"""

import base64
import time
from dataclasses import dataclass

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed  # noqa: F401  (documents the alternative)

KEY_URL = "https://gstatic.com/admob/reward/verifier-keys.json"
# Google rotates rarely; an hour keeps a rotation from breaking rewards for long without hammering the endpoint.
KEY_TTL_SECONDS = 3600
# Callbacks older than this are refused: a captured URL replayed weeks later is not a fresh reward.
MAX_AGE_SECONDS = 60 * 60


@dataclass
class _KeyCache:
    keys: dict[str, str]
    fetched_at: float


_cache: _KeyCache | None = None


def signed_content(query_string: str) -> str | None:
    """The part of the query string Google signed: everything before `&signature=`.

    Returns None when the callback carries no signature at all, which is a rejection rather than an error.
    """
    marker = "&signature="
    index = query_string.find(marker)
    if index < 0:
        # A callback whose only parameter is the signature is malformed either way.
        return None
    return query_string[:index]


def _decode_signature(raw: str) -> bytes:
    """base64url with the padding Google omits."""
    padded = raw + "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(padded)


async def fetch_keys(*, client: httpx.AsyncClient | None = None, now: float | None = None) -> dict[str, str]:
    """`{key_id: pem}`, cached. Raises on a failed fetch: unverifiable is not the same as valid."""
    global _cache
    moment = time.time() if now is None else now
    if _cache and moment - _cache.fetched_at < KEY_TTL_SECONDS:
        return _cache.keys

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=5.0)
    try:
        response = await client.get(KEY_URL)
        response.raise_for_status()
        payload = response.json()
    finally:
        if owns_client:
            await client.aclose()

    keys = {str(k["keyId"]): k["pem"] for k in payload.get("keys", []) if k.get("keyId") and k.get("pem")}
    if not keys:
        raise ValueError("AdMob key set was empty")
    _cache = _KeyCache(keys=keys, fetched_at=moment)
    return keys


def reset_cache() -> None:
    """Used by tests, and by nothing else."""
    global _cache
    _cache = None


def verify_with_pem(query_string: str, signature: str, pem: str) -> bool:
    """ECDSA-SHA256 over the signed portion of the query string."""
    content = signed_content(query_string)
    if content is None:
        return False
    try:
        key = serialization.load_pem_public_key(pem.encode())
        if not isinstance(key, ec.EllipticCurvePublicKey):
            return False
        key.verify(_decode_signature(signature), content.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        # A malformed signature, a key that will not parse and a genuine mismatch are all the same answer here.
        return False


def is_fresh(timestamp_ms: str | int | None, *, now: float | None = None) -> bool:
    """AdMob sends milliseconds. A callback from an hour ago is a replay, not a reward."""
    if timestamp_ms is None:
        return False
    try:
        sent = int(timestamp_ms) / 1000
    except (TypeError, ValueError):
        return False
    moment = time.time() if now is None else now
    # A little slack forwards for clock skew between Google and us.
    return -300 <= (moment - sent) <= MAX_AGE_SECONDS


async def verify(query_string: str, signature: str, key_id: str, *, client: httpx.AsyncClient | None = None) -> bool:
    keys = await fetch_keys(client=client)
    pem = keys.get(str(key_id))
    # An unknown key id is a rejection. Trying every key would accept a signature from a retired key forever.
    if pem is None:
        return False
    return verify_with_pem(query_string, signature, pem)
