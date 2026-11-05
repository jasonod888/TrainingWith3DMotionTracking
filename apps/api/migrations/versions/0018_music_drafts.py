"""Owner-scoped unreviewed transcription drafts.

Drafts are stored apart from lesson revisions: a draft is not a publishable manifest and
must never be served as one. Additive only.
"""
from alembic import op
import sqlalchemy as sa

revision = '0018'
down_revision = '0017'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'music_drafts',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('job_id', sa.String(80), nullable=False),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('owner_id', sa.String(80), nullable=False),
        sa.Column('subject', sa.String(16), nullable=False),
        sa.Column('instrument', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='draft'),
        sa.Column('document', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_music_drafts_job_id', 'music_drafts', ['job_id'], unique=True)
    op.create_index('ix_music_drafts_lesson_id', 'music_drafts', ['lesson_id'])
    op.create_index('ix_music_drafts_owner_id', 'music_drafts', ['owner_id'])


def downgrade():
    op.drop_index('ix_music_drafts_owner_id', table_name='music_drafts')
    op.drop_index('ix_music_drafts_lesson_id', table_name='music_drafts')
    op.drop_index('ix_music_drafts_job_id', table_name='music_drafts')
    op.drop_table('music_drafts')
