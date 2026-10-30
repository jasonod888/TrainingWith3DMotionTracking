"""Pinned processing routes and durable external submission receipts."""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = depends_on = None


def upgrade():
    for table in ('conversions', 'worker_credentials'):
        op.add_column(table, sa.Column('provider', sa.String(16), nullable=False, server_default='local'))
        op.add_column(table, sa.Column('pipeline_version', sa.String(80), nullable=False, server_default='sam-3d-body-v1'))
    for column in (sa.Column('provider_target', sa.String(200), nullable=False, server_default=''),
                   sa.Column('provider_request_id', sa.String(200)),
                   sa.Column('submission_state', sa.String(16), nullable=False, server_default='none'),
                   sa.Column('input_token_hash', sa.String(64))):
        op.add_column('conversions', column)
    op.create_index('ix_conversions_provider', 'conversions', ['provider'])


def downgrade():
    op.drop_index('ix_conversions_provider', table_name='conversions')
    for column in ('input_token_hash', 'submission_state', 'provider_request_id', 'provider_target'):
        op.drop_column('conversions', column)
    for table in ('conversions', 'worker_credentials'):
        op.drop_column(table, 'pipeline_version')
        op.drop_column(table, 'provider')
