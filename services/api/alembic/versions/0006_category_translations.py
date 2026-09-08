"""category translations

Genre names were a single column, so a viewer browsing an otherwise fully localised catalogue in Hindi or Tamil
still met "Revenge", "Billionaire" and "Werewolf" in English — on the home rails and filter chips that decide
what they open. This gives a category one name per language, falling back to the admin's own name.

Revision ID: 0006_category_translations
Revises: 0005_audit_log
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_category_translations"
down_revision: Union[str, None] = "0005_audit_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "category_translations",
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("category_id", "lang"),
    )
    op.create_index("ix_category_translations_lang", "category_translations", ["lang"])


def downgrade() -> None:
    op.drop_index("ix_category_translations_lang", table_name="category_translations")
    op.drop_table("category_translations")
