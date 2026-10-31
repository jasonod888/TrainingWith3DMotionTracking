"""Clip replacement targets an existing move instead of creating a duplicate lesson."""
from alembic import op
import sqlalchemy as sa

revision = '0010'
down_revision = '0009'
branch_labels = depends_on = None


def upgrade():
    op.add_column('conversions', sa.Column('target_lesson_id', sa.String(80)))
    op.create_index('ix_conversions_target_lesson_id', 'conversions', ['target_lesson_id'])


def downgrade():
    op.drop_index('ix_conversions_target_lesson_id', table_name='conversions')
    op.drop_column('conversions', 'target_lesson_id')
