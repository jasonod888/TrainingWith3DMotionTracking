"""Initial lesson and immutable revision storage; identity arrives in phase 1."""
from alembic import op
import sqlalchemy as sa
revision = '0001'
down_revision = None
branch_labels = depends_on = None

def upgrade():
    op.create_table('lessons', sa.Column('id', sa.String(80), primary_key=True), sa.Column('owner_id',sa.String(80),nullable=False), sa.Column('title',sa.String(200),nullable=False), sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_lessons_owner_id','lessons',['owner_id'])
    op.create_table('lesson_revisions',sa.Column('id',sa.String(80),primary_key=True),sa.Column('lesson_id',sa.String(80),sa.ForeignKey('lessons.id'),nullable=False),sa.Column('manifest',sa.JSON(),nullable=False),sa.Column('version',sa.Integer(),nullable=False))
    op.create_index('ix_lesson_revisions_lesson_id','lesson_revisions',['lesson_id'])

def downgrade():
    op.drop_table('lesson_revisions')
    op.drop_table('lessons')
