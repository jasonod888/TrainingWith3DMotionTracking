"""Administrative permissions, MFA, recovery, revocation and moderation through HTTP."""
import time
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from test_accounts import system, imported, register, login
from test_sharing import learner
from test_public import list_public
from apps.api.auth import COOKIE, digest, now
from apps.api.admin_security import matching_counter, totp
from apps.api.database import Account, AdminAudit, Conversion, LessonReport, LoginSession
from scripts.manage_platform_admin import bootstrap, reset_mfa


def elevate(client, app, role='super_admin'):
    account_id = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        session.get(Account, account_id).platform_role = role
        session.commit()
    response = client.post('/api/auth/admin-mfa/setup', json={'password': 'a long test password'})
    assert response.status_code == 200, response.text
    secret = response.json()['secret']
    code = totp(secret, int(time.time()) // 30)
    assert client.post('/api/auth/admin-mfa/verify', json={'code': code}).status_code == 200
    return account_id, secret


def test_member_boundary_and_mfa_setup_expiry_replay(system):
    client, app, _, mail, _ = system
    assert client.get('/api/admin/accounts').status_code == 401
    register(client, mail)
    login(client)
    assert client.get('/api/admin/accounts').status_code == 403
    assert client.post('/api/auth/admin-mfa/setup', json={'password': 'a long test password'}).status_code == 403
    account_id = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        session.get(Account, account_id).platform_role = 'super_admin'
        session.commit()
    assert client.get('/api/admin/overview').status_code == 403
    assert client.post('/api/auth/admin-mfa/setup', json={'password': 'wrong password length'}).status_code == 401
    _, secret = elevate(client, app)
    assert client.get('/api/admin/overview').status_code == 200
    assert client.post('/api/auth/admin-mfa/setup', json={'password': 'a long test password'}).status_code == 409
    assert client.post('/api/auth/admin-mfa/verify', json={'code': totp(secret, int(time.time()) // 30)}).status_code == 400
    with Session(app.state.engine) as session:
        session.get(LoginSession, digest(client.cookies.get(COOKIE))).admin_verified_until = now() - timedelta(seconds=1)
        session.commit()
    assert client.get('/api/admin/accounts').status_code == 403
    with patch('apps.api.admin_security.time.time', return_value=time.time() + 30):
        code = totp(secret, int(time.time()) // 30)
        assert client.post('/api/auth/admin-mfa/verify', json={'code': code}).status_code == 200
    assert client.get('/api/admin/accounts').status_code == 200
    # A different password session never inherits the first session's second factor.
    with TestClient(app) as other:
        other.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        login(other)
        assert other.get('/api/admin/overview').status_code == 403


def test_admin_manages_members_but_cannot_promote_or_manage_admins(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    actor_id, _ = elevate(client, app, 'admin')
    member = learner(app, mail)
    member_id = member.get('/api/auth/session').json()['account']['id']
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'platform_role': 'admin', 'reason': 'Delegate support'}).status_code == 403
    assert client.patch(f'/api/admin/accounts/{actor_id}', json={'status': 'suspended', 'reason': 'Not permitted'}).status_code == 403
    assert client.get('/api/admin/settings').status_code == 403
    assert client.get('/api/admin/accounts?q=student').json()['total'] == 1
    assert client.get('/api/admin/accounts?q=%').json()['total'] == 0
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'status': 'suspended', 'reason': '   '}).status_code == 422
    old_cookie = member.cookies.get(COOKIE)
    result = client.patch(f'/api/admin/accounts/{member_id}', json={'status': 'suspended', 'reason': 'Abusive uploads'})
    assert result.status_code == 200, result.text
    assert member.get('/api/auth/session').status_code == 401
    member.cookies.set(COOKIE, old_cookie, domain='testserver.local', path='/')
    assert member.get('/api/lessons').status_code == 401
    assert member.post('/api/auth/login', json={'email': 'student@example.test', 'password': 'a long test password'}).status_code == 401
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'status': 'active', 'reason': 'Review completed'}).status_code == 200
    login(member, 'student@example.test')
    assert member.get('/api/lessons').status_code == 200
    entry = client.get('/api/admin/audit').json()['activity'][0]
    assert entry['action'] == 'account.update'
    assert entry['details']['before']['status'] == 'suspended'
    assert entry['details']['after']['status'] == 'active'
    assert client.request('DELETE', f"/api/admin/audit/{entry['id']}", json={}).status_code in (404, 405)


def test_super_admin_role_changes_last_admin_and_deletion_pending(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    actor_id, _ = elevate(client, app)
    for changes in ({'platform_role': 'member'}, {'status': 'suspended'}, {'status': 'deletion_pending'}):
        assert client.patch(f'/api/admin/accounts/{actor_id}', json={**changes, 'reason': 'Last administrator test'}).status_code == 409
    member = learner(app, mail)
    member_id = member.get('/api/auth/session').json()['account']['id']
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'platform_role': 'admin', 'reason': 'Delegate support'}).status_code == 200
    assert member.get('/api/auth/session').status_code == 401
    login(member, 'student@example.test')
    assert member.get('/api/admin/accounts').status_code == 403  # Requires enrollment.
    result = client.patch(f'/api/admin/accounts/{member_id}', json={'platform_role': 'member', 'status': 'deletion_pending', 'reason': 'Deletion requested by account owner'})
    assert result.status_code == 200
    assert result.json()['deletion_requested_at']
    assert client.get('/api/admin/accounts').json()['total'] == 2
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'status': 'active', 'reason': 'Owner cancelled deletion'}).json()['deletion_requested_at'] is None
    assert client.patch(f'/api/admin/accounts/{member_id}', json={'platform_role': 'super_admin', 'reason': 'Appoint second platform owner'}).status_code == 200
    assert client.patch(f'/api/admin/accounts/{actor_id}', json={'platform_role': 'member', 'reason': 'Transfer platform responsibilities'}).status_code == 200
    assert client.get('/api/admin/accounts').status_code == 401


def test_bootstrap_is_verified_one_time_and_recovery_revokes_sessions(system):
    client, app, _, mail, _ = system
    client.post('/api/auth/register', json={'email': 'owner@example.test', 'password': 'a long test password'})
    with Session(app.state.engine) as session:
        with pytest.raises(ValueError, match='verify'):
            bootstrap(session, 'owner@example.test', 'Initial platform owner')
        session.rollback()
    assert client.post('/api/auth/verify', json={'token': mail[-1][2]}).status_code == 200
    login(client)
    with Session(app.state.engine) as session:
        actor_id = bootstrap(session, 'OWNER@example.test', 'Initial platform owner')
    assert client.get('/api/auth/session').status_code == 401
    with Session(app.state.engine) as session:
        with pytest.raises(ValueError, match='already exists'):
            bootstrap(session, 'owner@example.test', 'Duplicate bootstrap')
    login(client)
    elevate(client, app)
    with Session(app.state.engine) as session:
        reset_mfa(session, 'owner@example.test', 'Identity verified by platform operator')
        assert session.get(Account, actor_id).mfa_secret is None
        assert session.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == 'mfa.operator_reset')) == 1
    assert client.get('/api/admin/accounts').status_code == 401


def test_admin_can_inspect_metadata_without_private_asset_access(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    admin = learner(app, mail, 'admin@example.test')
    elevate(admin, app, 'admin')
    owner_id = owner.get('/api/auth/session').json()['account']['id']
    detail = admin.get(f'/api/admin/accounts/{owner_id}')
    assert detail.status_code == 200
    assert detail.json()['moves'][0]['id'] == lesson.lesson_id
    assert 'password_hash' not in detail.text and 'mfa_secret' not in detail.text
    assert admin.get(f'/api/lessons/{lesson.lesson_id}').status_code == 404
    assert admin.get(f'/api/lessons/{lesson.lesson_id}/assets/synthetic.glb').status_code == 404


def test_report_moderation_cannot_be_bypassed_by_relisting(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    assert list_public(owner, lesson).status_code == 200
    admin = learner(app, mail, 'admin@example.test')
    admin_id, _ = elevate(admin, app, 'admin')
    report_id = uuid4().hex
    with Session(app.state.engine) as session:
        session.add(LessonReport(id=report_id, lesson_id=lesson.lesson_id, account_id=admin_id, reason='Rights concern'))
        session.commit()
    path = f'/api/admin/reports/{report_id}/actions'
    assert admin.post(path, json={'action': 'hide', 'reason': 'Pending rights review'}).status_code == 200
    with TestClient(app) as anonymous:
        assert anonymous.get('/api/public/moves').json()['moves'] == []
        assert anonymous.get('/api/public/tags').json()['tags'] == []
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}').status_code == 404
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}/assets/synthetic.glb').status_code == 404
        assert list_public(owner, lesson).status_code == 200
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}').status_code == 404
        assert admin.get(f'/api/lessons/{lesson.lesson_id}').status_code == 404
        assert owner.get(f'/api/lessons/{lesson.lesson_id}').status_code == 200
        assert admin.post(path, json={'action': 'restore', 'reason': 'Rights confirmed'}).status_code == 200
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}').status_code == 200


def test_group_controls_registration_settings_and_email_actions(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    elevate(client, app)
    member = learner(app, mail)
    member_id = member.get('/api/auth/session').json()['account']['id']
    group_id = member.post('/api/groups', json={'name': 'Practice class'}).json()['id']
    assert client.patch(f'/api/admin/groups/{group_id}', json={'archived': True, 'reason': 'Investigating group reports'}).status_code == 200
    assert member.get(f'/api/groups/{group_id}').status_code == 404
    assert client.patch(f'/api/admin/groups/{group_id}', json={'archived': False, 'reason': 'Group review completed'}).status_code == 200
    assert member.get(f'/api/groups/{group_id}').status_code == 200
    path = f'/api/admin/accounts/{member_id}/actions'
    assert client.post(path, json={'action': 'send_password_reset', 'reason': 'Owner requested reset assistance'}).status_code == 200
    assert mail[-1][1] == 'reset'
    assert client.post(path, json={'action': 'send_password_reset', 'reason': 'Duplicate reset assistance'}).status_code == 429
    assert client.post(path, json={'action': 'revoke_sessions', 'reason': 'Owner lost a device'}).status_code == 200
    assert member.get('/api/auth/session').status_code == 401
    assert client.patch('/api/admin/settings', json={'registration_enabled': False, 'reason': 'Temporarily pause registrations'}).status_code == 200
    assert member.post('/api/auth/register', json={'email': 'new@example.test', 'password': 'a long test password'}).status_code == 403
    assert client.patch('/api/admin/settings', json={'registration_enabled': True, 'reason': 'Registration reopened'}).status_code == 200
    assert member.post('/api/auth/register', json={'email': 'new@example.test', 'password': 'a long test password'}).status_code == 202


def test_processing_retry_safety_and_cancellation(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    account_id, _ = elevate(client, app)
    def job(job_id, **overrides):
        return Conversion(id=job_id, owner_id=account_id, title='Processing test', filename='clip.mp4', source_bytes=10,
            source_key='uploads/private', start=0, duration=2, **overrides)
    with Session(app.state.engine) as session:
        session.add_all([job('safe', state='failed', error='infrastructure', attempts=1),
                         job('ambiguous', state='failed', error='provider_submission_unknown', submission_state='unknown', provider='replicate'),
                         job('running', state='processing', attempt_token='old-lease', lease_until=now() + timedelta(minutes=2))])
        session.commit()
    assert len(client.get('/api/admin/jobs').json()['jobs']) == 3
    assert client.post('/api/admin/jobs/ambiguous/actions', json={'action': 'retry', 'reason': 'Cannot duplicate provider work'}).status_code == 409
    assert client.post('/api/admin/jobs/safe/actions', json={'action': 'retry', 'reason': 'Infrastructure issue resolved'}).status_code == 200
    assert client.post('/api/admin/jobs/running/actions', json={'action': 'cancel', 'reason': 'Owner requested cancellation'}).status_code == 200
    with Session(app.state.engine) as session:
        cancelled = session.get(Conversion, 'running')
        assert cancelled.state == 'cancelled' and cancelled.attempt_token is None and cancelled.lease_until is None
    assert client.post('/api/admin/jobs/running/actions', json={'action': 'retry', 'reason': 'Cancelled jobs cannot retry'}).status_code == 409


def test_totp_matches_rfc6238_vector_and_rejects_replay():
    # RFC 6238 SHA-1 secret, truncated to this application's six digits.
    secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    assert totp(secret, 1) == '287082'
    with patch('apps.api.admin_security.time.time', return_value=59):
        assert matching_counter(secret, '287082') == 1
        assert matching_counter(secret, '287082', 1) is None
