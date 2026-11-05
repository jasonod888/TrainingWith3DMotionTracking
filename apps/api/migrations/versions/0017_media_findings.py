"""Server-measured media findings for conversions.

Additive only: movement jobs keep an empty value and their validation path is unchanged.
"""
from alembic import op
import sqlalchemy as sa

revision = '0017'
down_revision = '0016'
branch_labels = depends_on = None


def upgrade():
    op.add_column('conversions', sa.Column('media_findings', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('conversions', 'media_findings')
