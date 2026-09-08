"""video asset encryption flag

Signed playback URLs decide who may start a stream and nothing after that: the segments they point at were
plain `.ts` files, so an unexpired URL, or anything between the CDN and the player, was the episode. For a
catalogue where episode three costs coins, that is the product itself sitting in the open.

Assets can now be packaged with AES-128. This column records which ones are, because the two kinds have to be
served differently: an encrypted asset is played through the API's manifest routes, which mint a per-viewer
key URL, while an unencrypted one keeps the direct signed CDN link. Defaulting to false is deliberate — every
asset that exists today was packaged in the clear, and claiming otherwise would hand out manifests promising
a key that no segment was encrypted with.

No key material is stored. Per-asset keys are derived from one master secret in the environment, so a dump of
this table decrypts nothing.

Revision ID: 0009_video_asset_encryption
Revises: 0008_admin_session_version
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_video_asset_encryption"
down_revision: Union[str, None] = "0008_admin_session_version"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "video_assets",
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("video_assets", "is_encrypted")
