from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

from apps.api.database import PianoComparison, PianoComparisonSource, PianoModelRun


def test_comparison_migration_matches_models_and_preserves_existing_lessons():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE lessons (id VARCHAR PRIMARY KEY, title VARCHAR)'))
        connection.execute(text("INSERT INTO lessons VALUES ('owner-lesson', 'Keep this lesson')"))
        migration = import_module('apps.api.migrations.versions.0024_piano_model_comparisons')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        inspector = inspect(connection)
        for model in (PianoComparisonSource, PianoComparison, PianoModelRun):
            actual = {c['name']: c['nullable'] for c in inspector.get_columns(model.__tablename__)}
            expected = {c.name: c.nullable for c in model.__table__.columns}
            assert actual == expected
            assert {i['name'] for i in inspector.get_indexes(model.__tablename__)} == {
                i.name for i in model.__table__.indexes}
        assert inspector.get_unique_constraints('piano_model_runs')[0]['column_names'] == [
            'comparison_id', 'variant']
        assert inspector.get_foreign_keys('piano_comparisons')[0]['referred_table'] == 'piano_comparison_sources'
        assert inspector.get_foreign_keys('piano_model_runs')[0]['referred_table'] == 'piano_comparisons'
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert inspect(connection).get_table_names() == ['lessons']
        assert connection.execute(text('SELECT title FROM lessons')).scalar_one() == 'Keep this lesson'
    engine.dispose()
