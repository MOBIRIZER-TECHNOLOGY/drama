"""Time-based one-time passwords (RFC 6238), implemented against the standard library.

The console holds every lever in the product — coin grants, bans, takedowns, price changes — behind one
password and an eight-hour token. `AdminUser.totp_secret` has existed since the first migration and nothing
ever wrote to it.

This is a hundred lines rather than a dependency because RFC 6238 is short, exactly specified, and has
published test vectors that the suite checks against. The alternative was pulling a package into the image for
an HMAC and a base32 decode.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

# 30 seconds is the interval every authenticator app assumes; 6 digits is what they display.
STEP_SECONDS = 30
DIGITS = 6
# One step either side. Phone clocks drift, and refusing a code that is four seconds stale trains people to
# turn the feature off.
DEFAULT_WINDOW = 1


def random_secret(length: int = 20) -> str:
    """A fresh base32 secret. 20 bytes is the RFC 4226 recommendation and what authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int, *, digits: int = DIGITS, digest=hashlib.sha1) -> str:
    # Authenticator apps strip padding from the secret they show; accept it back either way.
    padded = secret.strip().replace(" ", "").upper()
    padded += "=" * (-len(padded) % 8)
    key = base64.b32decode(padded, casefold=True)
    mac = hmac.new(key, struct.pack(">Q", counter), digest).digest()
    offset = mac[-1] & 0x0F
    code = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def generate(secret: str, *, at: float | None = None, digits: int = DIGITS, digest=hashlib.sha1) -> str:
    """The code for one moment. Used by the tests and by nothing else — verification is what callers want."""
    now = time.time() if at is None else at
    return _hotp(secret, int(now // STEP_SECONDS), digits=digits, digest=digest)


def verify(secret: str, code: str, *, at: float | None = None, window: int = DEFAULT_WINDOW) -> bool:
    """Constant-time comparison across the accepted window.

    `hmac.compare_digest` rather than `==` because a timing difference here leaks how much of a guessed code
    was right, which turns six digits into a much smaller search.
    """
    if not secret or not code:
        return False
    cleaned = code.strip().replace(" ", "").replace("-", "")
    if not cleaned.isdigit() or len(cleaned) != DIGITS:
        return False
    now = time.time() if at is None else at
    counter = int(now // STEP_SECONDS)
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, counter + drift), cleaned):
            return True
    return False


def provisioning_uri(secret: str, *, account: str, issuer: str) -> str:
    """The otpauth:// URI an authenticator app scans.

    `issuer` appears twice on purpose: in the label for apps that only read the label, and as a parameter for
    apps that read parameters. Both are required for the entry to be named correctly across Google
    Authenticator, 1Password and Authy.
    """
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret}&issuer={quote(issuer, safe='')}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )
