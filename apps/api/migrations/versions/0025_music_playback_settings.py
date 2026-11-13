"""Playback settings and raw-model receipt for music drafts."""
from alembic import op
import sqlalchemy as sa

revision = '0025'
down_revision = '0024'
branch_labels = depends_on = None


def upgrade():
    op.add_column('music_drafts', sa.Column('playback', sa.JSON(), nullable=True))
    op.add_column('music_drafts', sa.Column('raw_model', sa.Boolean(), nullable=False,
                                            server_default=sa.false()))
    op.add_column('music_drafts', sa.Column('correction_operations', sa.Integer(),
                                            nullable=False, server_default='0'))


def downgrade():
    op.drop_column('music_drafts', 'correction_operations')
    op.drop_column('music_drafts', 'raw_model')
    op.drop_column('music_drafts', 'playback')
