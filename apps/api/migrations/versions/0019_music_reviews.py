"""Immutable owner review provenance for music draft finalisation."""
from alembic import op
import sqlalchemy as sa

revision = '0019'
down_revision = '0018'
branch_labels = depends_on = None


def upgrade():
    op.create_table('music_reviews',
        sa.Column('id',sa.String(80),primary_key=True),
        sa.Column('draft_id',sa.String(80),sa.ForeignKey('music_drafts.id'),nullable=False,unique=True),
        sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),
        sa.Column('revision_id',sa.String(80),sa.ForeignKey('lesson_revisions.id'),nullable=False,unique=True),
        sa.Column('reviewer_id',sa.String(80),nullable=False),
        sa.Column('reviewed_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('document',sa.JSON(),nullable=False))
    op.create_index('ix_music_reviews_lesson_id','music_reviews',['lesson_id'])


def downgrade():
    op.drop_index('ix_music_reviews_lesson_id',table_name='music_reviews')
    op.drop_table('music_reviews')
