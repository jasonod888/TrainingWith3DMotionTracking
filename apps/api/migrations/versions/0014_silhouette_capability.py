"""Dedicated silhouette capability flag for GPU workers."""
from alembic import op
import sqlalchemy as sa

revision = '0014'
down_revision = '0013'
branch_labels = depends_on = None


def upgrade():
    # Existing workers keep the capability off; enabling it is an operator action
    # after the silhouette worker has been verified on that machine.
    op.add_column('worker_credentials',
                  sa.Column('silhouettes', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('worker_credentials', 'silhouettes')
