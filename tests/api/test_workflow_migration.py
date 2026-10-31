from importlib import import_module
from sqlalchemy import create_engine, text
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_shared_release_migration_preserves_existing_release_and_public_only_moves():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE lessons (id VARCHAR PRIMARY KEY, published_revision_id VARCHAR)'))
        connection.execute(text('CREATE TABLE lesson_publications (lesson_id VARCHAR PRIMARY KEY, revision_id VARCHAR, listed BOOLEAN)'))
        connection.execute(text('CREATE TABLE groups (id VARCHAR PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE group_lessons (group_id VARCHAR, lesson_id VARCHAR)'))
        connection.execute(text("INSERT INTO lessons VALUES ('shared', 'a'), ('public', NULL), ('private', NULL)"))
        connection.execute(text("INSERT INTO lesson_publications VALUES ('shared', 'b', true), ('public', 'c', true), ('private', 'd', false)"))
        migration = import_module('apps.api.migrations.versions.0012_shared_release')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert dict(connection.execute(text('SELECT id, published_revision_id FROM lessons')).all()) == {'shared': 'a', 'public': 'c', 'private': None}
        assert dict(connection.execute(text('SELECT lesson_id, revision_id FROM lesson_publications')).all()) == {'shared': 'a', 'public': 'c', 'private': 'd'}
        connection.execute(text("INSERT INTO groups (id) VALUES ('group')"))
        connection.execute(text("INSERT INTO group_lessons (group_id, lesson_id) VALUES ('group', 'shared')"))
        assert connection.execute(text('SELECT contribution_policy FROM groups')).scalar_one() == 'members'
        assert connection.execute(text('SELECT COUNT(*) FROM group_public_moves')).scalar_one() == 0
    engine.dispose()
