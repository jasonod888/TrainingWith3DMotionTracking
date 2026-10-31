"""Acceptance records and public listing state for the everyday workflow."""
from datetime import datetime, timezone
from uuid import uuid4

from alembic import context, op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = depends_on = None


def upgrade():
    op.create_table('lesson_acceptances',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('revision_id', sa.String(80), nullable=False),
        sa.Column('account_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('warnings', sa.JSON(), nullable=False),
        sa.Column('source', sa.String(16), nullable=False, server_default='owner'),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('lesson_id', 'revision_id', name='uq_lesson_acceptance_revision'))
    op.create_index('ix_lesson_acceptances_lesson_id', 'lesson_acceptances', ['lesson_id'])

    op.create_table('lesson_publications',
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('revision_id', sa.String(80)),
        sa.Column('title', sa.String(200), nullable=False, server_default=''),
        sa.Column('description', sa.String(500), nullable=False, server_default=''),
        sa.Column('creator_name', sa.String(80), nullable=False, server_default=''),
        sa.Column('listed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('rights_acknowledged_at', sa.DateTime(timezone=True)),
        sa.Column('listed_at', sa.DateTime(timezone=True)),
        sa.Column('withdrawn_at', sa.DateTime(timezone=True)))
    op.create_index('ix_lesson_publications_listed', 'lesson_publications', ['listed'])

    op.create_table('lesson_tags',
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), primary_key=True),
        sa.Column('tag', sa.String(40), primary_key=True))
    op.create_index('ix_lesson_tags_tag', 'lesson_tags', ['tag'])

    # Existing publications become legacy accepted releases; no acceptance is invented for private drafts.
    if context.is_offline_mode():
        op.execute(sa.text("INSERT INTO lesson_acceptances (id, lesson_id, revision_id, account_id, warnings, source, accepted_at) SELECT md5(l.id || ':' || l.published_revision_id), l.id, l.published_revision_id, l.owner_id, CAST('[]' AS JSON), 'legacy', CURRENT_TIMESTAMP FROM lessons l WHERE l.published_revision_id IS NOT NULL"))
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        'SELECT l.id, l.published_revision_id, l.owner_id FROM lessons l '
        'WHERE l.published_revision_id IS NOT NULL')).fetchall()
    if rows:
        table = sa.table('lesson_acceptances',
            sa.column('id', sa.String), sa.column('lesson_id', sa.String), sa.column('revision_id', sa.String),
            sa.column('account_id', sa.String), sa.column('warnings', sa.JSON), sa.column('source', sa.String),
            sa.column('accepted_at', sa.DateTime(timezone=True)))
        op.bulk_insert(table, [{
            'id': uuid4().hex, 'lesson_id': row[0], 'revision_id': row[1], 'account_id': row[2],
            'warnings': [], 'source': 'legacy', 'accepted_at': datetime.now(timezone.utc),
        } for row in rows])


def downgrade():
    op.drop_index('ix_lesson_tags_tag', table_name='lesson_tags')
    op.drop_table('lesson_tags')
    op.drop_index('ix_lesson_publications_listed', table_name='lesson_publications')
    op.drop_table('lesson_publications')
    op.drop_index('ix_lesson_acceptances_lesson_id', table_name='lesson_acceptances')
    op.drop_table('lesson_acceptances')
