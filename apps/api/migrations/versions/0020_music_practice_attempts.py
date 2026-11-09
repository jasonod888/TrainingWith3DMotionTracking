"""Separate unscored, account-private music summary history."""
from alembic import op
import sqlalchemy as sa

revision = '0020'
down_revision = '0019'
branch_labels = depends_on = None


def upgrade():
    op.create_table('music_practice_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('revision_id', sa.String(80), sa.ForeignKey('lesson_revisions.id'), nullable=False),
        sa.Column('summary', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    for column in ('account_id', 'lesson_id'):
        op.create_index(f'ix_music_practice_attempts_{column}', 'music_practice_attempts', [column])


def downgrade():
    op.drop_table('music_practice_attempts')
