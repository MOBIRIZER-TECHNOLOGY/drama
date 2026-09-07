"""Push delivery through Expo push (FCM + APNs) and web push. Wired in phase 2."""

import structlog

log = structlog.get_logger()


async def send_push(ctx: dict, notification_id: str) -> dict:
    log.info("push.todo", notification_id=notification_id)
    return {"status": "todo", "notification_id": notification_id}
