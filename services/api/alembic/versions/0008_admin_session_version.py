"""admin token version

Admin tokens are stateless and live for eight hours, so there was no way to end a session: a laptop left in a
taxi stayed signed in until the token expired on its own, and disabling the account was the only lever — which
also takes the person's access away when all you wanted was to kill their tokens.

Every admin token now carries the account's `token_version`; bumping the column invalidates all of them at
once. Companion to the TOTP enrolment that finally writes to `admin_users.totp_secret`, which has existed
unused since the first migration.

Revision ID: 0008_admin_session_version
Revises: 0007_ad_placements
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_admin_session_version"
down_revision: Union[str, None] = "0007_ad_placements"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("admin_users", "token_version")
