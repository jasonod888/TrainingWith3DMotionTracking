"""Idempotent likes on stable lesson identity.

Additive: `(lesson_id, account_id)` is unique, so repeated PUT/POST is a no-op.
A like is only accepted while the lesson has a visible accepted release; that
visibility check lives in the route, not in this table.
"""
from alembic import op
import sqlalchemy as sa

revision = '0029'
down_revision = '0028'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'lesson_likes',
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('lesson_id', 'account_id', name='uq_lesson_like'),
    )
    op.create_index('ix_lesson_likes_account', 'lesson_likes', ['account_id'])


def downgrade():
    op.drop_index('ix_lesson_likes_account', table_name='lesson_likes')
    op.drop_table('lesson_likes')
