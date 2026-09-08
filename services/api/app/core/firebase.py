"""Firebase Auth is the identity provider. ID tokens are verified against Google's published public keys.

Verifying an ID token is a signature check plus three claim checks. It needs the project id and Google's
public keys, both of which are public; it does not need a credential. The Admin SDK insists on one anyway —
`verify_id_token` raises `DefaultCredentialsError` before it looks at the token at all — which meant a private
service-account key had to be shipped to every environment purely to read a signature. That key can mint
tokens for the entire project, so requiring it here traded a real secret for nothing.

What is checked, and why each one matters:

  - the RS256 signature, against the key named by the token's `kid`, fetched from Google and rotated by them
  - `aud` equals the project id, so a token minted for a different Firebase project cannot be replayed here
  - `iss` is Google's issuer for this project, for the same reason
  - `exp` and `iat`, so an old token stops working
  - `sub` is present and non-empty, which Firebase guarantees and which becomes the account's identity

Revocation is not checked, which is the same behaviour as before (`check_revoked=False`): it is the one part
that does need a credential, and a five-minute window on a revoked token is what the short ID token lifetime
is for. Sessions here are our own JWTs, and revoking one of those is what actually signs a device out.
"""

from dataclasses import dataclass
from functools import lru_cache

import jwt
import structlog
from jwt import PyJWKClient

from app.core.config import get_settings
from app.core.errors import Unauthorized

# Google's public keys for Firebase ID tokens. Served with a Cache-Control max-age; PyJWKClient caches them
# in-process and refetches when it meets a `kid` it has not seen, which is what makes rotation a non-event.
JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"

log = structlog.get_logger()


@dataclass(frozen=True)
class FirebaseIdentity:
    uid: str
    email: str | None
    phone: str | None
    name: str | None
    picture: str | None
    provider: str


@lru_cache
def _jwks() -> PyJWKClient:
    return PyJWKClient(JWKS_URL, cache_keys=True, max_cached_keys=8)


def verify_id_token(id_token: str) -> FirebaseIdentity:
    project_id = get_settings().firebase_project_id
    if not project_id:
        raise Unauthorized("Sign-in is not configured on this server", code="firebase_not_configured")

    try:
        key = _jwks().get_signing_key_from_jwt(id_token).key
        decoded = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"https://securetoken.google.com/{project_id}",
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        # The reason is deliberately not passed on: "expired" and "wrong audience" are the same answer to
        # whoever is holding the token, and the difference is only useful to someone probing.
        raise Unauthorized("Sign-in token is not valid", code="invalid_id_token") from exc

    uid = decoded.get("sub")
    if not uid:
        raise Unauthorized("Sign-in token is not valid", code="invalid_id_token")

    firebase_claims = decoded.get("firebase") or {}
    return FirebaseIdentity(
        uid=uid,
        email=decoded.get("email"),
        phone=decoded.get("phone_number"),
        name=decoded.get("name"),
        picture=decoded.get("picture"),
        provider=firebase_claims.get("sign_in_provider", "unknown"),
    )


def delete_user(uid: str) -> bool:
    """Delete the Firebase account behind `uid`. Returns whether it actually happened.

    This is the one operation here that genuinely needs a credential: it changes state in the project rather
    than reading a signature. Without a service account the local account is still erased, but the Firebase
    record survives, and the same person signing in again would arrive as a brand new user rather than as
    someone whose data was deleted. That is a difference worth reporting rather than swallowing, so the caller
    gets a boolean and the reason is logged.
    """
    s = get_settings()
    if not s.firebase_service_account_file:
        log.warning("firebase.delete_skipped", uid=uid, reason="no_service_account")
        return False
    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth
        from firebase_admin import credentials

        app = _admin_app(firebase_admin, credentials, s)
        fb_auth.delete_user(uid, app=app)
        return True
    except Exception as exc:  # noqa: BLE001 - already gone, or Firebase unreachable; local deletion proceeds
        log.warning("firebase.delete_failed", uid=uid, error=str(exc))
        return False


@lru_cache
def _admin_app(firebase_admin, credentials, s):
    """The Admin SDK app, built only when a service account exists. Cached: initialising twice raises."""
    cred = credentials.Certificate(s.firebase_service_account_file)
    return firebase_admin.initialize_app(cred, {"projectId": s.firebase_project_id}, name="katha-admin")
