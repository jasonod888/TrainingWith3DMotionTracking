"""Private, revision-bound practice resume state."""
from alembic import op
import sqlalchemy as sa
revision = '0003'
down_revision = '0002'
branch_labels = depends_on = None


def upgrade():
    op.create_table('practice_progress',
        sa.Column('account_id',sa.String(80),sa.ForeignKey('accounts.id'),primary_key=True),
        sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),primary_key=True),
        sa.Column('revision_id',sa.String(80),nullable=False),
        sa.Column('time',sa.Float(),nullable=False),
        sa.Column('speed',sa.Float(),nullable=False),
        sa.Column('mode',sa.String(16),nullable=False))


def downgrade():
    op.drop_table('practice_progress')
