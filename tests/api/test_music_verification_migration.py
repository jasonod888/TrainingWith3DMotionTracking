from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_verification_decision_migration_is_additive_and_reversible():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE accounts (id VARCHAR PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE lessons (id VARCHAR PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE music_drafts (id VARCHAR PRIMARY KEY)'))
        connection.execute(text("INSERT INTO music_drafts (id) VALUES ('draft-1')"))
        migration = import_module('apps.api.migrations.versions.0022_music_verification_decisions')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        columns = {column['name'] for column in inspect(connection).get_columns('music_verification_decisions')}
        assert {'draft_id', 'finding_id', 'decision', 'document', 'report_sha256'} - columns == {'report_sha256'}
        assert 'music_drafts' in inspect(connection).get_table_names()
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert 'music_verification_decisions' not in inspect(connection).get_table_names()
        assert 'music_drafts' in inspect(connection).get_table_names()
    engine.dispose()


def test_working_draft_migration_is_additive_and_reversible():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE music_drafts (id VARCHAR PRIMARY KEY, document JSON)'))
        connection.execute(text("INSERT INTO music_drafts (id, document) VALUES ('draft-1', '{}')"))
        migration = import_module('apps.api.migrations.versions.0023_music_draft_corrections')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        columns = {column['name'] for column in inspect(connection).get_columns('music_drafts')}
        assert {'working_document', 'correction_history'} <= columns
        assert connection.execute(text("SELECT document FROM music_drafts WHERE id='draft-1'")).scalar_one() == '{}'
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert not {'working_document', 'correction_history'} & {
            column['name'] for column in inspect(connection).get_columns('music_drafts')}
    engine.dispose()
