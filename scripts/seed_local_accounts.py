"""Create three verified local development accounts and print their generated passwords once."""
import json
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.api.admin_security import audit, lock_admin_control
from apps.api.auth import password_hash, password_matches
from apps.api.config import Settings
from apps.api.database import Account, database_ready, make_engine

SEED_ACCOUNTS = (
    ('superadmin@local.test', 'super_admin'),
    ('admin@local.test', 'admin'),
    ('member@local.test', 'member'),
)


def main():
    settings = Settings()
    database = make_url(settings.sqlalchemy_url)
    local_hosts = {'localhost', '127.0.0.1', '::1'}
    if (settings.environment != 'development' or database.host not in local_hosts
            or not database.drivername.startswith('postgresql')
            or urlparse(settings.public_url).hostname not in local_hosts):
        raise SystemExit('This command only seeds a local development PostgreSQL database and local app.')
    engine = make_engine(settings.sqlalchemy_url)
    try:
        database_ready(engine)
        credentials = []
        with Session(engine) as session:
            lock_admin_control(session)
            existing = session.scalars(select(Account.email).where(Account.email.in_([email for email, _ in SEED_ACCOUNTS]))).all()
            if existing:
                raise SystemExit('No accounts changed. These seed emails already exist: ' + ', '.join(existing))
            for email, role in SEED_ACCOUNTS:
                password = secrets.token_urlsafe(18)
                hashed = password_hash(password)
                if not password_matches(password, hashed):
                    raise RuntimeError('Password verification failed; no accounts were created.')
                account = Account(id=uuid4().hex, email=email, password_hash=hashed,
                                  verified=True, status='active', platform_role=role)
                session.add(account)
                session.flush()
                audit(session, None, 'account.local_seed', account.id,
                      'User requested local development accounts for all three platform roles.',
                      platform_role=role, source='local_seed_cli')
                credentials.append({'username': email, 'password': password, 'role': role})
            session.commit()
        # Passwords are intentionally returned to the operator, never written to a file or audit entry.
        print(json.dumps({'accounts': credentials, 'verified': True, 'authenticator_setup_required': ['super_admin', 'admin']}, indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
