"""reshape ad placements

The table shipped as one row per (platform, slot, network) with an `enabled` flag and a `weight`, and nothing
ever read or wrote it — the console screen built against it ran on an in-memory stub, so an operator could set
a rewarded-ad value, refresh, and find it gone.

The shape it needed: a placement spans the platforms it applies to (the same AdMob unit should not be entered
three times), carries the coins a completed rewarded view is worth, and carries the seconds a viewer must wait
before seeing it again. Those last two are the numbers that decide whether rewarded ads strangle coin revenue,
and the old table had nowhere to put either.

Dropped and recreated rather than migrated: nothing reads the old columns and no environment has rows worth
preserving.

Revision ID: 0007_ad_placements
Revises: 0006_category_translations
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_ad_placements"
down_revision: Union[str, None] = "0006_category_translations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("ad_placements")
    op.create_table(
        "ad_placements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slot", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("unit_id", sa.String(length=160), nullable=False),
        sa.Column("platforms", postgresql.ARRAY(sa.String(length=16)), nullable=False),
        sa.Column("reward_coins", sa.Integer(), nullable=True),
        sa.Column("frequency_cap_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slot", "provider", "unit_id", name="uq_ad_placement"),
    )
    # /v1/config asks for "active placements for this platform" on every cold start.
    op.create_index("ix_ad_placements_active", "ad_placements", ["is_active", "sort_order"])


def downgrade() -> None:
    op.drop_index("ix_ad_placements_active", table_name="ad_placements")
    op.drop_table("ad_placements")
    op.create_table(
        "ad_placements",
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column("slot", sa.String(length=32), nullable=False),
        sa.Column("network", sa.String(length=32), nullable=False),
        sa.Column("unit_id", sa.String(length=160), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("platform", "slot", "network", name="uq_ad_placement"),
    )
