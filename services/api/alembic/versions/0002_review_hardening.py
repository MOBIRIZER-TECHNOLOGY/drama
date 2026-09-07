"""review hardening: webhook inbox, gateway payment id, refresh reuse detection

Revision ID: 0002_review_hardening
Revises: 0001_initial
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_review_hardening"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhook_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("gateway", sa.String(length=32), nullable=False),
        sa.Column("event_id", sa.String(length=200), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gateway", "event_id", name="uq_webhook_event"),
    )
    op.add_column("purchases", sa.Column("gateway_payment_id", sa.String(length=160), nullable=True))
    op.create_index("ix_purchases_gateway_payment", "purchases", ["gateway", "gateway_payment_id"])
    op.add_column("sessions", sa.Column("previous_token_hash", sa.String(length=128), nullable=True))
    op.add_column("ad_events", sa.Column("reward_coins", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ad_events", "reward_coins")
    op.drop_column("sessions", "previous_token_hash")
    op.drop_index("ix_purchases_gateway_payment", table_name="purchases")
    op.drop_column("purchases", "gateway_payment_id")
    op.drop_table("webhook_events")
