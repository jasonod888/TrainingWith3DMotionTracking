"""Resumable private upload and leased conversion jobs."""
from alembic import op
import sqlalchemy as sa
revision='0004'
down_revision='0003'
branch_labels=depends_on=None


def upgrade():
    op.create_table('conversions',
        sa.Column('id',sa.String(80),primary_key=True),
        sa.Column('owner_id',sa.String(80),sa.ForeignKey('accounts.id'),nullable=False),
        sa.Column('title',sa.String(200),nullable=False),sa.Column('filename',sa.String(255),nullable=False),
        sa.Column('source_bytes',sa.Integer(),nullable=False),sa.Column('source_sha256',sa.String(64)),
        sa.Column('source_key',sa.String(512),nullable=False),sa.Column('upload_id',sa.String(512)),
        sa.Column('parts',sa.JSON(),nullable=False),sa.Column('start',sa.Float(),nullable=False),sa.Column('duration',sa.Float(),nullable=False),
        sa.Column('state',sa.String(32),nullable=False),sa.Column('attempts',sa.Integer(),nullable=False),
        sa.Column('attempt_token',sa.String(80)),sa.Column('worker_id',sa.String(80)),sa.Column('lease_until',sa.DateTime(timezone=True)),
        sa.Column('frames',sa.Integer(),nullable=False),sa.Column('error',sa.String(40)),sa.Column('lesson_id',sa.String(80)),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_conversions_owner_id','conversions',['owner_id'])
    op.create_index('ix_conversions_state','conversions',['state'])
    op.create_table('worker_credentials',sa.Column('id',sa.String(80),primary_key=True),
        sa.Column('token_hash',sa.String(64),nullable=False,unique=True),sa.Column('active',sa.Boolean(),nullable=False),
        sa.Column('last_seen',sa.DateTime(timezone=True)))


def downgrade():
    op.drop_table('worker_credentials')
    op.drop_table('conversions')
