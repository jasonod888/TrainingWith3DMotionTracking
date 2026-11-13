"""Owner decisions on diagnostic transcription-verification findings.

The draft document remains the immutable baseline; decisions store complete edit
snapshots and the working proposal is reconstructed from them even after the analysis
archive expires. Additive only.
"""
from alembic import op
import sqlalchemy as sa

revision = '0022'
down_revision = '0021'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'music_verification_decisions',
        sa.Column('id', sa.String(80), primary_key=True),
        sa.Column('draft_id', sa.String(80), sa.ForeignKey('music_drafts.id'), nullable=False),
        sa.Column('lesson_id', sa.String(80), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('finding_id', sa.String(40), nullable=False),
        sa.Column('decision', sa.String(16), nullable=False),
        sa.Column('proposal_sha256', sa.String(64), nullable=False),
        sa.Column('reviewer_id', sa.String(80), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('document', sa.JSON(), nullable=False),
        sa.UniqueConstraint('draft_id', 'finding_id', name='uq_music_verification_decision'),
    )
    op.create_index('ix_music_verification_decisions_draft_id', 'music_verification_decisions', ['draft_id'])
    op.create_index('ix_music_verification_decisions_lesson_id', 'music_verification_decisions', ['lesson_id'])


def downgrade():
    op.drop_index('ix_music_verification_decisions_lesson_id', table_name='music_verification_decisions')
    op.drop_index('ix_music_verification_decisions_draft_id', table_name='music_verification_decisions')
    op.drop_table('music_verification_decisions')
