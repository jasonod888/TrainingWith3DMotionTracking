"""Explicit public representation roles on a publication.

Additive: existing public listings were body 3D releases, so they are backfilled
with the interactive_data role. A music or video-only lesson has no roles until its
owner explicitly selects an approved representation.
"""
from alembic import op
import sqlalchemy as sa

revision = '0028'
down_revision = '0027'
branch_labels = depends_on = None


def upgrade():
    op.add_column('lesson_publications', sa.Column('roles', sa.JSON(), nullable=True))
    op.execute(sa.text(
        "UPDATE lesson_publications SET roles = '[\"interactive_data\"]' WHERE roles IS NULL"))


def downgrade():
    op.drop_column('lesson_publications', 'roles')
