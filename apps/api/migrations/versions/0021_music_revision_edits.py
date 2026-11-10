"""Audit record for explicit reviewed-music edits."""
from alembic import op
import sqlalchemy as sa

revision = '0021'
down_revision = '0020'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'music_revision_edits',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('base_revision_id', sa.String(80), sa.ForeignKey('lesson_revisions.id'), nullable=False),
        sa.Column('revision_id', sa.String(80), sa.ForeignKey('lesson_revisions.id'), nullable=False),
        sa.Column('editor_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('document', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_music_revision_edits_lesson_id', 'music_revision_edits', ['lesson_id'])
    op.create_index('ix_music_revision_edits_base_revision_id', 'music_revision_edits', ['base_revision_id'])
    op.create_index('ix_music_revision_edits_revision_id', 'music_revision_edits', ['revision_id'], unique=True)


def downgrade():
    op.drop_index('ix_music_revision_edits_revision_id', table_name='music_revision_edits')
    op.drop_index('ix_music_revision_edits_base_revision_id', table_name='music_revision_edits')
    op.drop_index('ix_music_revision_edits_lesson_id', table_name='music_revision_edits')
    op.drop_table('music_revision_edits')
