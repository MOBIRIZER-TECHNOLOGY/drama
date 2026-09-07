"""Firebase Auth is the identity provider. We verify ID tokens with the Admin SDK
(signature + audience), never by calling the Identity Toolkit lookup endpoint."""

from dataclasses import dataclass
from functools import lru_cache

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials

from app.core.config import get_settings


@dataclass(frozen=True)
class FirebaseIdentity:
    uid: str
    email: str | None
    phone: str | None
    name: str | None
    picture: str | None
    provider: str


@lru_cache
def _app() -> firebase_admin.App:
    s = get_settings()
    if s.firebase_service_account_file:
        cred = credentials.Certificate(s.firebase_service_account_file)
        return firebase_admin.initialize_app(cred, {"projectId": s.firebase_project_id})
    # Application default credentials (GCP) or emulator.
    return firebase_admin.initialize_app(options={"projectId": s.firebase_project_id})


def verify_id_token(id_token: str) -> FirebaseIdentity:
    decoded = fb_auth.verify_id_token(id_token, app=_app(), check_revoked=False)
    firebase_claims = decoded.get("firebase", {})
    return FirebaseIdentity(
        uid=decoded["uid"],
        email=decoded.get("email"),
        phone=decoded.get("phone_number"),
        name=decoded.get("name"),
        picture=decoded.get("picture"),
        provider=firebase_claims.get("sign_in_provider", "unknown"),
    )
