"""Owner-scoped raw-model comparison sources, parents and child attempts."""
from alembic import op
import sqlalchemy as sa

revision = '0024'
down_revision = '0023'
branch_labels = depends_on = None


def upgrade():
    op.create_table('piano_comparison_sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(80), nullable=False),
        sa.Column('lesson_id', sa.String(80)),
        sa.Column('label', sa.String(200), nullable=False),
        sa.Column('path', sa.String(1024), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False),
        sa.Column('seconds', sa.Float(), nullable=False),
        sa.Column('reference_path', sa.String(1024)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_piano_comparison_sources_owner_id', 'piano_comparison_sources', ['owner_id'])
    op.create_index('ix_piano_comparison_sources_lesson_id', 'piano_comparison_sources', ['lesson_id'])
    op.create_table('piano_comparisons',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(80), nullable=False),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('piano_comparison_sources.id'), nullable=False),
        sa.Column('lesson_id', sa.String(80)),
        sa.Column('interval_start', sa.Float(), nullable=False),
        sa.Column('interval_end', sa.Float(), nullable=False),
        sa.Column('variants', sa.JSON(), nullable=False),
        sa.Column('registry_sha256', sa.String(64), nullable=False),
        sa.Column('status', sa.String(24), nullable=False, server_default='queued'),
        sa.Column('cancel_requested', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('result', sa.JSON()),
        sa.Column('error', sa.String(500)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False))
    for column in ('owner_id', 'source_id', 'lesson_id'):
        op.create_index(f'ix_piano_comparisons_{column}', 'piano_comparisons', [column])
    op.create_table('piano_model_runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('comparison_id', sa.String(36), sa.ForeignKey('piano_comparisons.id'), nullable=False),
        sa.Column('variant', sa.String(64), nullable=False),
        sa.Column('family', sa.String(32), nullable=False),
        sa.Column('status', sa.String(24), nullable=False, server_default='queued'),
        sa.Column('attempt', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('lease_token', sa.String(36)),
        sa.Column('run_dir', sa.String(1024)),
        sa.Column('receipt', sa.JSON()),
        sa.Column('blocked_reasons', sa.JSON(), nullable=False),
        sa.Column('error', sa.String(500)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('comparison_id', 'variant', name='uq_piano_run_variant'))
    op.create_index('ix_piano_model_runs_comparison_id', 'piano_model_runs', ['comparison_id'])


def downgrade():
    op.drop_table('piano_model_runs')
    op.drop_table('piano_comparisons')
    op.drop_table('piano_comparison_sources')
