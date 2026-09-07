"""audit log

Who did what, to what, and why. Nothing in the console recorded a privilege change, a ban, a cleared moderation
flag, a price edit or a settings save, so after an incident nobody could say who flipped a production kill
switch, and a takedown dispute had no record of the decision behind it.

Revision ID: 0005_audit_log
Revises: 0004_retention_and_bundles
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_audit_log"
down_revision: Union[str, None] = "0004_retention_and_bundles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_id", postgresql.UUID(as_uuid=True), nullable=True),
        # Denormalised so the row still reads after the admin account is deleted, which is exactly when it matters.
        sa.Column("admin_email", sa.String(length=320), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_created", "audit_log", ["created_at"], unique=False)
    op.create_index("ix_audit_target", "audit_log", ["target_type", "target_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_target", table_name="audit_log")
    op.drop_index("ix_audit_created", table_name="audit_log")
    op.drop_table("audit_log")
