"""Plan-scoped practice progress and the neutral attempt envelope.

Additive only: the legacy body ``practice_progress`` row and existing Act-specific
attempt tables are untouched. Progress is keyed by
(account, lesson, revision, plan) so a changed plan never resumes another plan's
position, and attempts store Act detail inside ``report`` rather than a shared
score.
"""
from alembic import op
import sqlalchemy as sa

revision = '0027'
down_revision = '0026'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'practice_plan_progress',
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('revision_id', sa.String(80), primary_key=True),
        sa.Column('plan_id', sa.String(160), primary_key=True),
        sa.Column('unit_id', sa.String(120), nullable=True),
        sa.Column('time', sa.Float(), nullable=False, server_default='0'),
        sa.Column('speed', sa.Float(), nullable=False, server_default='1'),
        sa.Column('mode', sa.String(16), nullable=False, server_default='sections'),
        sa.Column('loop', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('repetitions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('countdown_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('rest_seconds', sa.Float(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_table(
        'practice_attempts',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('revision_id', sa.String(80), nullable=False),
        sa.Column('act_id', sa.String(16), nullable=False),
        sa.Column('mode', sa.String(16), nullable=False),
        sa.Column('plan_id', sa.String(160), nullable=False),
        sa.Column('unit_id', sa.String(120), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('assessment_adapter', sa.String(80), nullable=True),
        sa.Column('rubric_version', sa.String(80), nullable=True),
        sa.Column('report', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_practice_attempts_account', 'practice_attempts', ['account_id'])
    op.create_index('ix_practice_attempts_lesson', 'practice_attempts', ['lesson_id'])
    op.create_index('ix_practice_attempts_revision', 'practice_attempts', ['revision_id'])


def downgrade():
    op.drop_index('ix_practice_attempts_revision', table_name='practice_attempts')
    op.drop_index('ix_practice_attempts_lesson', table_name='practice_attempts')
    op.drop_index('ix_practice_attempts_account', table_name='practice_attempts')
    op.drop_table('practice_attempts')
    op.drop_table('practice_plan_progress')
