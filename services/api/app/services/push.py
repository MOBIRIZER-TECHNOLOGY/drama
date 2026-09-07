"""Push delivery through Expo, which relays to FCM and APNs with one token format.

Tokens live on the session row, so a sign-out or a session revoke removes the device from delivery without any
extra bookkeeping. Expo tells us when a token is dead (`DeviceNotRegistered`); those are cleared immediately,
because a push service that keeps retrying dead tokens quietly loses its sending reputation.

Every send goes through `deliver`, which is the only place that decides who is eligible: an active user, an
un-revoked session, a real token, and no opt-out for that channel.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx
import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.identity import Session, User, UserStatus

log = structlog.get_logger()

# Channels a viewer can turn off individually. `transactional` is deliberately absent: a purchase confirmation
# is not marketing and is never suppressed.
CHANNELS = ("new_episode", "streak", "resume", "offer", "announcement")

EXPO_BATCH = 100  # Expo's documented maximum per request


def wants(user: User, channel: str) -> bool:
    """Opt-out model: a channel is on unless the viewer explicitly turned it off."""
    if channel not in CHANNELS:
        return True
    prefs = user.notification_prefs or {}
    return prefs.get(channel, True) is not False


@dataclass
class Message:
    token: str
    title: str
    body: str
    data: dict = field(default_factory=dict)


@dataclass
class SendResult:
    delivered: int = 0
    failed: int = 0
    dead_tokens: list[str] = field(default_factory=list)


def is_expo_token(token: str | None) -> bool:
    return bool(token) and token.startswith(("ExponentPushToken[", "ExpoPushToken["))


async def send(messages: list[Message]) -> SendResult:
    """Post to Expo in batches. Never raises: a push failure must not roll back the work that triggered it."""
    result = SendResult()
    if not messages:
        return result
    s = get_settings()
    headers = {"accept": "application/json", "content-type": "application/json"}
    if s.expo_access_token:
        headers["authorization"] = f"Bearer {s.expo_access_token}"
    async with httpx.AsyncClient(timeout=20) as client:
        for start in range(0, len(messages), EXPO_BATCH):
            batch = messages[start : start + EXPO_BATCH]
            payload = [
                {
                    "to": m.token,
                    "title": m.title,
                    "body": m.body,
                    "data": m.data,
                    "sound": "default",
                    "channelId": "default",
                    "priority": "high",
                }
                for m in batch
            ]
            try:
                r = await client.post(s.expo_push_url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                log.warning("push.transport_error", error=str(exc), count=len(batch))
                result.failed += len(batch)
                continue
            if r.status_code >= 300:
                log.warning("push.http_error", status=r.status_code, body=r.text[:300], count=len(batch))
                result.failed += len(batch)
                continue
            tickets = (r.json() or {}).get("data") or []
            for message, ticket in zip(batch, tickets, strict=False):
                if ticket.get("status") == "ok":
                    result.delivered += 1
                    continue
                result.failed += 1
                if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    result.dead_tokens.append(message.token)
            # Expo returns fewer tickets than messages only on a malformed batch; count the remainder as failed.
            result.failed += max(0, len(batch) - len(tickets))
    return result


async def tokens_for(session: AsyncSession, user_ids: list[uuid.UUID], channel: str) -> dict[uuid.UUID, list[str]]:
    """Live push tokens per user, filtered by account status and the viewer's own channel preference."""
    if not user_ids:
        return {}
    now = datetime.now(UTC)
    rows = (
        await session.execute(
            select(Session.user_id, Session.push_token, User)
            .join(User, User.id == Session.user_id)
            .where(
                Session.user_id.in_(user_ids),
                Session.push_token.is_not(None),
                Session.revoked_at.is_(None),
                Session.expires_at > now,
                User.status == UserStatus.active,
            )
        )
    ).all()
    out: dict[uuid.UUID, list[str]] = {}
    for user_id, token, user in rows:
        if not is_expo_token(token) or not wants(user, channel):
            continue
        bucket = out.setdefault(user_id, [])
        if token not in bucket:  # the same device can appear on more than one session row
            bucket.append(token)
    return out


async def clear_dead_tokens(session: AsyncSession, tokens: list[str]) -> None:
    if not tokens:
        return
    await session.execute(update(Session).where(Session.push_token.in_(tokens)).values(push_token=None))


async def deliver(
    session: AsyncSession,
    *,
    user_ids: list[uuid.UUID],
    channel: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> SendResult:
    """Resolve tokens, send, and prune whatever Expo says is dead. The caller commits."""
    by_user = await tokens_for(session, user_ids, channel)
    messages = [
        Message(token=token, title=title, body=body, data={**(data or {}), "channel": channel})
        for tokens in by_user.values()
        for token in tokens
    ]
    result = await send(messages)
    await clear_dead_tokens(session, result.dead_tokens)
    log.info("push.sent", channel=channel, delivered=result.delivered, failed=result.failed, users=len(by_user))
    return result
