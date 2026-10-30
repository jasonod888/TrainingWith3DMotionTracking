"""Revocable, account-bound capture/receiver sessions."""
from alembic import op
import sqlalchemy as sa
revision='0007'
down_revision='0006'
branch_labels=depends_on=None
def upgrade():
    op.create_table('mimic_pairs',
        sa.Column('id',sa.String(80),primary_key=True),
        sa.Column('account_id',sa.String(80),sa.ForeignKey('accounts.id'),nullable=False),
        sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),
        sa.Column('revision_id',sa.String(80),nullable=False),
        sa.Column('code_hash',sa.String(64),unique=True,nullable=False),
        sa.Column('capture_hash',sa.String(64),nullable=False),
        sa.Column('receiver_hash',sa.String(64)),
        sa.Column('approved',sa.Boolean(),nullable=False),sa.Column('revoked',sa.Boolean(),nullable=False),
        sa.Column('sequence',sa.Integer(),nullable=False),
        sa.Column('snapshot',sa.JSON(),nullable=False),sa.Column('commands',sa.JSON(),nullable=False),sa.Column('signals',sa.JSON(),nullable=False),
        sa.Column('receiver_seen',sa.DateTime(timezone=True)),sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_mimic_pairs_account_id','mimic_pairs',['account_id'])
def downgrade():
    op.drop_table('mimic_pairs')
