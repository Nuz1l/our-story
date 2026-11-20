"""Add age and social links to profiles.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("profiles", sa.Column("instagram_url", sa.String(length=300), nullable=True))
    op.add_column("profiles", sa.Column("tiktok_url", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("profiles", "tiktok_url")
    op.drop_column("profiles", "instagram_url")
    op.drop_column("profiles", "age")
