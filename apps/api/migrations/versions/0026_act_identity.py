"""Additive Act identity on lessons and revision snapshots.

Only two nullable columns are added. Stored revision JSON, reference hashes,
acceptances, publication pointers and releases are never touched. The backfill
uses the same deterministic subject -> Act mapping as ``apps.api.acts``:
``movement_other``/``dance``/``taekwondo``/``boxing`` -> ``full_body``,
``piano`` -> ``piano``, ``guitar`` -> ``guitar``.

Rows outside that mapping are deliberately left NULL instead of being guessed as
``full_body``; readers must resolve them explicitly and refuse unknown Acts.
"""
from alembic import op
import sqlalchemy as sa

revision = '0026'
down_revision = '0025'
branch_labels = depends_on = None

MOVEMENT = "('movement_other', 'dance', 'taekwondo', 'boxing')"


def _act_case(column: str) -> str:
    return (
        f"CASE "
        f"WHEN {column} = 'piano' THEN 'piano' "
        f"WHEN {column} = 'guitar' THEN 'guitar' "
        f"WHEN {column} IN {MOVEMENT} THEN 'full_body' "
        f"ELSE NULL END"
    )


def upgrade():
    op.add_column('lessons', sa.Column('act_id', sa.String(16), nullable=True))
    op.add_column('lesson_revisions', sa.Column('act_id', sa.String(16), nullable=True))

    # Bounded set-based backfill of the existing rows. Idempotent because it only
    # touches NULL values, so a restart or partial rollout is safe.
    op.execute(sa.text(
        f"UPDATE lessons SET act_id = {_act_case('subject')} WHERE act_id IS NULL"))
    op.execute(sa.text(
        f"UPDATE lesson_revisions SET act_id = {_act_case('subject')} WHERE act_id IS NULL"))


def downgrade():
    op.drop_column('lesson_revisions', 'act_id')
    op.drop_column('lessons', 'act_id')
