"""Pinned publication, revocable lesson grants, email invitations and reports."""
from alembic import op
import sqlalchemy as sa
revision='0005'
down_revision='0004'
branch_labels=depends_on=None


def upgrade():
    for column in (sa.Column('published_revision_id',sa.String(80)),sa.Column('distribution',sa.String(16),nullable=False,server_default='private'),
        sa.Column('share_token_hash',sa.String(64)),sa.Column('share_generation',sa.Integer(),nullable=False,server_default='0'),
        sa.Column('share_expires_at',sa.DateTime(timezone=True)),sa.Column('disabled',sa.Boolean(),nullable=False,server_default=sa.false())):
        op.add_column('lessons',column)
    op.create_table('lesson_grants',sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),primary_key=True),
        sa.Column('account_id',sa.String(80),sa.ForeignKey('accounts.id'),primary_key=True),sa.Column('source',sa.String(16),nullable=False),
        sa.Column('generation',sa.Integer(),nullable=False),sa.Column('revoked',sa.Boolean(),nullable=False),sa.Column('invitation_id',sa.String(80)),
        sa.Column('accepted_at',sa.DateTime(timezone=True),nullable=False),sa.Column('last_active_at',sa.DateTime(timezone=True)))
    op.create_table('lesson_invitations',sa.Column('id',sa.String(80),primary_key=True),sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),
        sa.Column('email',sa.String(254),nullable=False),sa.Column('token_hash',sa.String(64),nullable=False,unique=True),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),sa.Column('revoked',sa.Boolean(),nullable=False),sa.Column('accepted_account_id',sa.String(80)))
    op.create_index('ix_lesson_invitations_lesson_id','lesson_invitations',['lesson_id'])
    op.create_table('lesson_reports',sa.Column('id',sa.String(80),primary_key=True),sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),
        sa.Column('account_id',sa.String(80),sa.ForeignKey('accounts.id'),nullable=False),sa.Column('reason',sa.String(500),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint('lesson_id','account_id',name='uq_lesson_reporter'))


def downgrade():
    for name in ('lesson_reports','lesson_invitations','lesson_grants'):op.drop_table(name)
    for name in ('disabled','share_expires_at','share_generation','share_token_hash','distribution','published_revision_id'):op.drop_column('lessons',name)
