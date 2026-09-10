"""review fixes: search and lookup indexes

Three indexes the review found missing, each behind a query that already runs on every page of its screen:

* `series_translations.title` — the catalogue search is `ILIKE '%…%'`, a contains-match no b-tree can serve. A
  trigram GIN index is the one structure Postgres has for it. Built without CONCURRENTLY on purpose: the table
  holds one row per series per language, so the build takes milliseconds and the lock is invisible, whereas a
  concurrent build cannot run inside the migration's transaction and cannot be rolled back with it if a later
  statement fails. If the table ever grows to where a blocking build matters, that is the moment to split it
  into its own migration under `autocommit_block()`.
* `purchases.user_id` — the support drawer and the account export both read one user's purchases.
* `episode_unlocks.series_id` — the dashboard's top-series join and the "may this be deleted" checks look
  unlocks up by series.

Revision ID: 0010_review_fixes
Revises: 0009_video_asset_encryption
Create Date: 2026-09-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010_review_fixes"
down_revision: str | None = "0009_video_asset_encryption"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pg_trgm was created in 0001; repeated here so a database restored without extensions still migrates.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_series_translations_title_trgm",
        "series_translations",
        ["title"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.create_index("ix_purchases_user", "purchases", ["user_id"], unique=False)
    op.create_index("ix_episode_unlocks_series", "episode_unlocks", ["series_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_episode_unlocks_series", table_name="episode_unlocks")
    op.drop_index("ix_purchases_user", table_name="purchases")
    op.drop_index("ix_series_translations_title_trgm", table_name="series_translations")
