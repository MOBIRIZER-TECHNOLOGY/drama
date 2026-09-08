"""Recording who did what in the admin console.

One function, called from the handler that performs the action, in the same transaction. Writing the record in
the same transaction is the point: a ban that commits without its audit row is exactly the case the record
exists for.

Deliberately not a middleware. A generic "POST /admin/flags/x happened" row cannot say which value changed or
why, and the console's own review found the missing detail — not the missing request log — to be what made
incidents unanswerable.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity import AdminUser
from app.models.ops import AuditLog

# Actions worth a row. Anything that changes money, access, visibility or configuration; nothing that only reads.
Action = str


def _diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> tuple[dict | None, dict | None]:
    """Keep only the fields that actually changed, so a save does not archive an entire object every time."""
    if before is None or after is None:
        return before, after
    keys = {k for k in (*before, *after) if before.get(k) != after.get(k)}
    if not keys:
        return None, None
    return {k: before.get(k) for k in keys}, {k: after.get(k) for k in keys}


def record(
    session: AsyncSession,
    *,
    admin: AdminUser | None,
    action: Action,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    note: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip: str | None = None,
) -> AuditLog:
    """Add an audit row to the current transaction. The caller commits."""
    changed_before, changed_after = _diff(before, after)
    row = AuditLog(
        admin_id=admin.id if admin else None,
        admin_email=admin.email if admin else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        note=note,
        before=changed_before,
        after=changed_after,
        ip=ip,
        created_at=datetime.now(UTC),
    )
    session.add(row)
    return row


async def count(
    session: AsyncSession,
    *,
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
) -> int:
    """How many rows the same filters match. A log you can only page blindly through is not evidence."""
    stmt = select(func.count()).select_from(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    return await session.scalar(stmt) or 0


async def recent(
    session: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    return list((await session.scalars(stmt)).all())
