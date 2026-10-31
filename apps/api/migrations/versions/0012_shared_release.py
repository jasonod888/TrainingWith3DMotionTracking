"""Consolidate existing public releases onto the shared release authority."""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = depends_on = None


def upgrade():
    op.add_column('groups', sa.Column('contribution_policy', sa.String(16), nullable=False, server_default='members'))
    op.create_table('group_public_moves',
        sa.Column('group_id', sa.String(80), sa.ForeignKey('groups.id'), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('added_by', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    # Retain an existing friends/groups release. Public-only moves adopt their accepted public release.
    op.execute(sa.text("UPDATE lessons SET published_revision_id = (SELECT revision_id FROM lesson_publications p WHERE p.lesson_id = lessons.id AND p.listed = true) WHERE published_revision_id IS NULL AND EXISTS (SELECT 1 FROM lesson_publications p WHERE p.lesson_id = lessons.id AND p.listed = true)"))
    op.execute(sa.text("UPDATE lesson_publications SET revision_id = (SELECT published_revision_id FROM lessons l WHERE l.id = lesson_publications.lesson_id) WHERE listed = true"))


def downgrade():
    # Release consolidation is intentionally not reversed: there is no safe way to infer old audience intent.
    op.drop_table('group_public_moves')
    op.drop_column('groups', 'contribution_policy')
