"""Platform roles, administrative MFA, moderation and append-only application audit."""
from alembic import op
import sqlalchemy as sa

revision = '0013'
down_revision = '0012'
branch_labels = depends_on = None


def upgrade():
    for column in (
        sa.Column('platform_role', sa.String(16), nullable=False, server_default='member'),
        sa.Column('status', sa.String(24), nullable=False, server_default='active'),
        sa.Column('last_login_at', sa.DateTime(timezone=True)),
        sa.Column('deletion_requested_at', sa.DateTime(timezone=True)),
        sa.Column('mfa_secret', sa.String(64)),
        sa.Column('mfa_counter', sa.Integer(), nullable=False, server_default='-1'),
    ):
        op.add_column('accounts', column)
    op.add_column('login_sessions', sa.Column('admin_verified_until', sa.DateTime(timezone=True)))
    op.add_column('login_sessions', sa.Column('pending_mfa_secret', sa.String(64)))
    op.add_column('lesson_publications', sa.Column('moderation_hidden', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('lesson_reports', sa.Column('resolved_at', sa.DateTime(timezone=True)))
    op.create_table('admin_control', sa.Column('id', sa.String(16), primary_key=True),
                    sa.Column('version', sa.Integer(), nullable=False),
                    sa.Column('registration_enabled', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.execute(sa.text("INSERT INTO admin_control (id, version, registration_enabled) VALUES ('platform', 0, true)"))
    op.create_table('admin_audit', sa.Column('id', sa.String(80), primary_key=True),
                    sa.Column('actor_id', sa.String(80), sa.ForeignKey('accounts.id')),
                    sa.Column('action', sa.String(80), nullable=False),
                    sa.Column('target_id', sa.String(80), nullable=False),
                    sa.Column('reason', sa.String(500), nullable=False),
                    sa.Column('details', sa.JSON(), nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_admin_audit_actor_id', 'admin_audit', ['actor_id'])
    op.create_index('ix_admin_audit_target_id', 'admin_audit', ['target_id'])


def downgrade():
    op.drop_table('admin_audit')
    op.drop_table('admin_control')
    op.drop_column('lesson_reports', 'resolved_at')
    op.drop_column('lesson_publications', 'moderation_hidden')
    for name in ('pending_mfa_secret', 'admin_verified_until'):
        op.drop_column('login_sessions', name)
    for name in ('mfa_counter', 'mfa_secret', 'deletion_requested_at', 'last_login_at', 'status', 'platform_role'):
        op.drop_column('accounts', name)
