"""Working draft and automatic correction history.

The baseline ``music_drafts.document`` remains immutable. Qualified corrections are
applied to ``working_document``; ``correction_history`` keeps the applied edits and
rollback audit so the owner can restore the original notes.
"""
from alembic import op
import sqlalchemy as sa

revision = '0023'
down_revision = '0022'
branch_labels = depends_on = None


def upgrade():
    op.add_column('music_drafts', sa.Column('working_document', sa.JSON(), nullable=True))
    op.add_column('music_drafts', sa.Column('correction_history', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('music_drafts', 'correction_history')
    op.drop_column('music_drafts', 'working_document')
