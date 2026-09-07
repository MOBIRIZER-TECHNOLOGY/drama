"""tranche 1: visibility, moderation, drip release, age gate, offers on purchases

Revision ID: 0003_world_class_t1
Revises: 0002_review_hardening
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_world_class_t1"
down_revision: Union[str, None] = "0002_review_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("series", sa.Column("visible_languages", postgresql.ARRAY(sa.String(length=10)), nullable=True))
    op.add_column("series", sa.Column("moderation_flags", postgresql.ARRAY(sa.String(length=40)), nullable=True))
    op.add_column("series", sa.Column("moderation_note", sa.Text(), nullable=True))
    op.add_column("episodes", sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("age_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("offers", sa.Column("title", sa.String(length=120), server_default="", nullable=False))
    op.add_column("purchases", sa.Column("offer_id", sa.UUID(), nullable=True))
    op.add_column("purchases", sa.Column("coupon_code", sa.String(length=32), nullable=True))
    op.add_column("purchases", sa.Column("discount_pct", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_purchases_offer", "purchases", "offers", ["offer_id"], ["id"])
    op.add_column("experiments", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("experiments", "description")
    op.drop_constraint("fk_purchases_offer", "purchases", type_="foreignkey")
    op.drop_column("purchases", "discount_pct")
    op.drop_column("purchases", "coupon_code")
    op.drop_column("purchases", "offer_id")
    op.drop_column("offers", "title")
    op.drop_column("users", "age_confirmed_at")
    op.drop_column("episodes", "scheduled_at")
    op.drop_column("series", "moderation_note")
    op.drop_column("series", "moderation_flags")
    op.drop_column("series", "visible_languages")
