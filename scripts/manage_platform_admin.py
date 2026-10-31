"""Bootstrap the first Super Admin or recover an administrator's authenticator locally."""
import argparse
import sys
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.api.admin import revoke_sessions
from apps.api.admin_security import ADMIN_ROLES, audit, lock_admin_control
from apps.api.config import Settings
from apps.api.database import Account, make_engine


def bootstrap(session, email, reason):
    lock_admin_control(session)
    if session.scalar(select(func.count()).select_from(Account).where(Account.platform_role == 'super_admin')):
        raise ValueError('A Super Admin already exists. Use Administration to change roles.')
    account = session.scalar(select(Account).where(Account.email == email.strip().lower()))
    if not account or not account.verified or account.status != 'active':
        raise ValueError('Create and verify an active account with this email first.')
    account.platform_role = 'super_admin'
    revoke_sessions(session, account.id)
    audit(session, None, 'account.bootstrap', account.id, reason, platform_role='super_admin', source='operator_cli')
    session.commit()
    return account.id


def reset_mfa(session, email, reason):
    lock_admin_control(session)
    account = session.scalar(select(Account).where(Account.email == email.strip().lower()))
    if not account or account.platform_role not in ADMIN_ROLES:
        raise ValueError('An administrative account with this email is required.')
    account.mfa_secret = None
    account.mfa_counter = -1
    revoke_sessions(session, account.id)
    audit(session, None, 'mfa.operator_reset', account.id, reason, source='operator_cli')
    session.commit()
    return account.id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('bootstrap', 'reset-mfa'))
    parser.add_argument('--email', required=True)
    parser.add_argument('--reason', required=True)
    args = parser.parse_args()
    if not 3 <= len(args.reason.strip()) <= 500:
        parser.error('Provide a reason between 3 and 500 characters.')
    engine = make_engine(Settings().sqlalchemy_url)
    try:
        with Session(engine) as session:
            try:
                account_id = (bootstrap if args.action == 'bootstrap' else reset_mfa)(session, args.email, args.reason.strip())
            except ValueError as exc:
                parser.error(str(exc))
        print(f'Updated account {account_id}. Sign in and enroll your authenticator in Administration.')
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
