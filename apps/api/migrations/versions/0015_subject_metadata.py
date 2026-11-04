"""Subject metadata for multi-discipline lessons.

Additive only. Existing rows keep the movement defaults, so no stored manifest is
rewritten and no body behaviour changes. Revision snapshots stay nullable for
legacy revisions; readers fall back to the lesson row.
"""
from alembic import op
import sqlalchemy as sa

revision = '0015'
down_revision = '0014'
branch_labels = depends_on = None


def upgrade():
    op.add_column('lessons', sa.Column('subject', sa.String(32), nullable=False, server_default='movement_other'))
    op.add_column('lessons', sa.Column('experience_family', sa.String(16), nullable=False, server_default='body'))
    op.add_column('lessons', sa.Column('instrument', sa.String(16), nullable=True))
    op.create_index('ix_lessons_subject', 'lessons', ['subject'])
    op.add_column('lesson_revisions', sa.Column('subject', sa.String(32), nullable=True))
    op.add_column('lesson_revisions', sa.Column('experience_family', sa.String(16), nullable=True))
    op.add_column('lesson_revisions', sa.Column('instrument', sa.String(16), nullable=True))
    # Every stored revision predates subjects, so its true historical label is the
    # compatibility default. Backfilling here (rather than guessing later) is what stops
    # a published revision from inheriting a later relabel through the lesson row.
    op.execute("UPDATE lesson_revisions SET subject = 'movement_other', experience_family = 'body' "
               "WHERE subject IS NULL")


def downgrade():
    op.drop_column('lesson_revisions', 'instrument')
    op.drop_column('lesson_revisions', 'experience_family')
    op.drop_column('lesson_revisions', 'subject')
    op.drop_index('ix_lessons_subject', table_name='lessons')
    op.drop_column('lessons', 'instrument')
    op.drop_column('lessons', 'experience_family')
    op.drop_column('lessons', 'subject')
