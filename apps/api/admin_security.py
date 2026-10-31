"""Platform administration primitives; never grant access to private lesson assets."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from uuid import uuid4

from sqlalchemy import update
from .database import AdminAudit, AdminControl

ADMIN_ROLES = ('admin', 'super_admin')


def lock_admin_control(session):
    # An upsert followed by an UPDATE also takes a write lock on SQLite.
    if session.bind.dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    session.execute(insert(AdminControl).values(id='platform', version=0, registration_enabled=True)
                    .on_conflict_do_nothing(index_elements=['id']))
    session.execute(update(AdminControl).where(AdminControl.id == 'platform').values(version=AdminControl.version + 1))
    return session.get(AdminControl, 'platform', populate_existing=True)


def audit(session, actor_id, action, target_id, reason, **details):
    session.add(AdminAudit(id=uuid4().hex, actor_id=actor_id, action=action,
                           target_id=target_id, reason=reason, details=details))


def account_view(account):
    return {'id': account.id, 'email': account.email, 'platform_role': account.platform_role,
            'status': account.status if account.status != 'active' or account.verified else 'pending_verification',
            'verified': account.verified, 'created_at': account.created_at,
            'last_login_at': account.last_login_at, 'deletion_requested_at': account.deletion_requested_at,
            'mfa_enrolled': bool(account.mfa_secret)}


def new_mfa_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode()


def totp(secret, counter):
    value = hmac.new(base64.b32decode(secret), struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = value[-1] & 15
    return str((struct.unpack('>I', value[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)


def matching_counter(secret, code, last_counter=-1):
    current = int(time.time()) // 30
    for counter in (current, current - 1, current + 1):
        if counter > last_counter and hmac.compare_digest(totp(secret, counter), code):
            return counter
    return None
