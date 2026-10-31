from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

from apps.api.database import Base, database_ready


def test_admin_migration_preserves_accounts_and_defaults_without_promoting_anyone():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE accounts (id VARCHAR PRIMARY KEY, email VARCHAR, password_hash VARCHAR, verified BOOLEAN, created_at DATETIME)'))
        connection.execute(text('CREATE TABLE login_sessions (token_hash VARCHAR PRIMARY KEY, account_id VARCHAR, expires_at DATETIME)'))
        connection.execute(text('CREATE TABLE lesson_publications (lesson_id VARCHAR PRIMARY KEY, listed BOOLEAN)'))
        connection.execute(text('CREATE TABLE lesson_reports (id VARCHAR PRIMARY KEY)'))
        connection.execute(text("INSERT INTO accounts (id, email, password_hash, verified, created_at) VALUES ('existing', 'owner@example.test', 'unchanged-hash', true, CURRENT_TIMESTAMP)"))
        migration = import_module('apps.api.migrations.versions.0013_platform_admin')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        account = connection.execute(text('SELECT platform_role, status, password_hash, mfa_counter, mfa_secret FROM accounts')).one()
        assert tuple(account) == ('member', 'active', 'unchanged-hash', -1, None)
        assert connection.execute(text('SELECT registration_enabled FROM admin_control')).scalar_one() == 1
        assert connection.execute(text('SELECT count(*) FROM admin_audit')).scalar_one() == 0
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert 'platform_role' not in {c['name'] for c in inspect(connection).get_columns('accounts')}
        assert connection.execute(text('SELECT password_hash FROM accounts')).scalar_one() == 'unchanged-hash'
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
    engine.dispose()


def test_readiness_includes_administrative_schema():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    database_ready(engine)
    engine.dispose()
