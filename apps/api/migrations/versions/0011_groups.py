"""Simple groups: membership, invitations and a shared collection of accepted moves."""
from alembic import op
import sqlalchemy as sa

revision = '0011'
down_revision = '0010'
branch_labels = depends_on = None


def upgrade():
    op.create_table('groups',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('owner_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('description', sa.String(500), nullable=False, server_default=''),
        sa.Column('image_key', sa.String(512)),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_groups_owner_id', 'groups', ['owner_id'])

    op.create_table('group_members',
        sa.Column('group_id', sa.String(80), sa.ForeignKey('groups.id'), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), primary_key=True),
        sa.Column('role', sa.String(16), nullable=False, server_default='member'),
        sa.Column('invited_by', sa.String(80)),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_group_members_group_id', 'group_members', ['group_id'])
    op.create_index('ix_group_members_account_id', 'group_members', ['account_id'])

    op.create_table('group_invitations',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('group_id', sa.String(80), sa.ForeignKey('groups.id'), nullable=False),
        sa.Column('email', sa.String(254), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('role', sa.String(16), nullable=False, server_default='member'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked', sa.Boolean(), nullable=False),
        sa.Column('accepted_account_id', sa.String(80)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_group_invitations_group_id', 'group_invitations', ['group_id'])

    op.create_table('group_lessons',
        sa.Column('group_id', sa.String(80), sa.ForeignKey('groups.id'), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('added_by', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table('group_lessons')
    op.drop_index('ix_group_invitations_group_id', table_name='group_invitations')
    op.drop_table('group_invitations')
    op.drop_index('ix_group_members_account_id', table_name='group_members')
    op.drop_index('ix_group_members_group_id', table_name='group_members')
    op.drop_table('group_members')
    op.drop_index('ix_groups_owner_id', table_name='groups')
    op.drop_table('groups')
