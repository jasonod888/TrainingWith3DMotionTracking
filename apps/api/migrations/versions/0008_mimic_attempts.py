"""Opt-in personal attempt summaries, without learner video."""
from alembic import op
import sqlalchemy as sa
revision='0008'
down_revision='0007'
branch_labels=depends_on=None
def upgrade():
    op.create_table('mimic_attempts',sa.Column('id',sa.String(80),primary_key=True),sa.Column('account_id',sa.String(80),sa.ForeignKey('accounts.id'),nullable=False),sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),sa.Column('revision_id',sa.String(80),nullable=False),sa.Column('summary',sa.JSON(),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_mimic_attempts_account_id','mimic_attempts',['account_id'])
    op.create_index('ix_mimic_attempts_lesson_id','mimic_attempts',['lesson_id'])
def downgrade():op.drop_table('mimic_attempts')
