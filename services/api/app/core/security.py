import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

_pw = PasswordHash.recommended()

TokenKind = Literal["access", "refresh", "admin"]


def hash_password(raw: str) -> str:
    return _pw.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return _pw.verify(raw, hashed)


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def mint_token(
    subject: str,
    kind: TokenKind,
    *,
    session_id: str | None = None,
    ttl: int | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    if ttl is None:
        ttl = s.access_token_ttl_seconds if kind != "refresh" else s.refresh_token_ttl_seconds
    payload: dict[str, Any] = {
        "iss": s.jwt_issuer,
        "sub": subject,
        "kind": kind,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    if session_id:
        payload["sid"] = session_id
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_kind: TokenKind) -> dict[str, Any]:
    s = get_settings()
    payload = jwt.decode(token, s.jwt_secret, algorithms=["HS256"], issuer=s.jwt_issuer)
    if payload.get("kind") != expected_kind:
        raise jwt.InvalidTokenError("wrong token kind")
    return payload
