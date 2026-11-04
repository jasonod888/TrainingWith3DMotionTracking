"""Subject routing and client-reported preparation provenance for conversions.

Additive only. Existing jobs keep the movement defaults and their pipeline version,
so no body job is reinterpreted and no stored row is rewritten.
"""
from alembic import op
import sqlalchemy as sa

revision = '0016'
down_revision = '0015'
branch_labels = depends_on = None


def upgrade():
    op.add_column('conversions', sa.Column('subject', sa.String(32), nullable=False, server_default='movement_other'))
    op.add_column('conversions', sa.Column('instrument', sa.String(16), nullable=True))
    op.add_column('conversions', sa.Column('preparation', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('conversions', 'preparation')
    op.drop_column('conversions', 'instrument')
    op.drop_column('conversions', 'subject')
