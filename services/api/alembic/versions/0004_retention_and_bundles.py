"""push notifications, series bundles, release promise

Adds the columns behind three things the product could not do before: reach a viewer who is not currently in
the app (notification preferences plus an index that makes token lookup cheap), sell the rest of a series as one
purchase (per-series bundle discount), and state the next-episode promise a dripping catalogue lives on.

Revision ID: 0004_retention_and_bundles
Revises: 0003_world_class_t1
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_retention_and_bundles"
down_revision: Union[str, None] = "0003_world_class_t1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("notification_prefs", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("series", sa.Column("bundle_discount_pct", sa.Integer(), nullable=True))
    op.add_column("series", sa.Column("completion_status", sa.String(length=16), nullable=True))
    op.add_column("series", sa.Column("release_note", sa.String(length=120), nullable=True))
    # Every push send starts by finding live tokens for a set of users. Without this the streak job scans the
    # whole sessions table once a day, and that table only grows.
    op.create_index(
        "ix_sessions_push_token",
        "sessions",
        ["user_id"],
        unique=False,
        postgresql_where=sa.text("push_token IS NOT NULL AND revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_push_token", table_name="sessions")
    op.drop_column("series", "release_note")
    op.drop_column("series", "completion_status")
    op.drop_column("series", "bundle_discount_pct")
    op.drop_column("users", "notification_prefs")
