"""Accounts, revocable sessions, assets and optimistic lesson revisions."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = depends_on = None


def upgrade():
    op.add_column('lessons', sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('lessons', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    # Preserve the latest version for any existing Phase 0 data.
    op.execute('UPDATE lessons SET version = COALESCE((SELECT MAX(version) FROM lesson_revisions WHERE lesson_id = lessons.id), 1)')
    op.create_unique_constraint('uq_lesson_revision_version', 'lesson_revisions', ['lesson_id', 'version'])
    op.create_table('accounts',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('email', sa.String(254), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(256), nullable=False),
        sa.Column('verified', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_table('login_sessions',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_login_sessions_account_id', 'login_sessions', ['account_id'])
    op.create_table('account_tokens',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('purpose', sa.String(16), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used', sa.Boolean(), nullable=False))
    op.create_index('ix_account_tokens_account_id', 'account_tokens', ['account_id'])
    op.create_table('auth_throttles',
        sa.Column('key', sa.String(64), primary_key=True),
        sa.Column('hits', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False))
    op.create_table('lesson_assets',
        sa.Column('key', sa.String(512), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('mime', sa.String(128), nullable=False),
        sa.Column('bytes', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.String(64), nullable=False))
    op.create_index('ix_lesson_assets_lesson_id', 'lesson_assets', ['lesson_id'])


def downgrade():
    for table in ('lesson_assets', 'auth_throttles', 'account_tokens', 'login_sessions', 'accounts'):
        op.drop_table(table)
    op.drop_constraint('uq_lesson_revision_version', 'lesson_revisions', type_='unique')
    op.drop_column('lessons', 'version')
    op.drop_column('lessons', 'archived')
