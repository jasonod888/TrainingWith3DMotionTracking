"""Groups are an independent access reason and do not duplicate motion assets."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_accounts import system, imported
from test_sharing import learner
from apps.api.database import GroupMember


def accepted_move(owner, lesson):
    response = owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                          json={'revision_id': lesson.revision_id})
    assert response.status_code == 200, response.text


def group_token(mail, email):
    return next(token for recipient, purpose, token in reversed(mail) if recipient == email and purpose == 'group')


def test_group_members_share_an_accepted_move_and_lose_access_on_removal(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    accepted_move(owner, lesson)
    created = owner.post('/api/groups', json={'name': 'Tuesday practice', 'description': 'After class'})
    assert created.status_code == 201, created.text
    group = created.json()
    friend = learner(app, mail, 'friend@example.test')
    invitation = owner.post(f"/api/groups/{group['id']}/invitations", json={'email': 'friend@example.test'})
    assert invitation.status_code == 201, invitation.text
    token = group_token(mail, 'friend@example.test')
    joined = friend.post('/api/groups/join', json={'invite': token})
    assert joined.status_code == 200, joined.text
    assert joined.json()['role'] == 'member'

    added = owner.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id})
    assert added.status_code == 200, added.text
    assert friend.get(f"/api/lessons/{lesson.lesson_id}").status_code == 200
    assert friend.get(f"/api/lessons/{lesson.lesson_id}/assets/synthetic.glb").status_code == 200
    assert friend.get('/api/shared-lessons').json()[0]['lesson_id'] == lesson.lesson_id
    detail = friend.get(f"/api/groups/{group['id']}").json()
    assert detail['moves'][0]['lesson_id'] == lesson.lesson_id
    assert [member['email'] for member in detail['members']].count('friend@example.test') == 1

    account_id = friend.get('/api/auth/session').json()['account']['id']
    assert owner.request('DELETE', f"/api/groups/{group['id']}/members/{account_id}", json={}).status_code == 200
    assert friend.get(f"/api/lessons/{lesson.lesson_id}").status_code == 404
    assert friend.get(f"/api/groups/{group['id']}").status_code == 404
    assert friend.post('/api/groups/join', json={'invite': token}).status_code == 404
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 404


def test_sharing_to_a_group_requires_acceptance_and_membership(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    group = owner.post('/api/groups', json={'name': 'Sparring'}).json()
    assert owner.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id}).status_code == 409
    accepted_move(owner, lesson)
    assert owner.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id}).status_code == 200
    outsider = learner(app, mail, 'outsider@example.test')
    assert outsider.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id}).status_code == 404


def test_owner_transfer_and_member_leave_rules(system):
    owner, app, _, mail, _ = system
    imported(system)
    group = owner.post('/api/groups', json={'name': 'Adults'}).json()
    friend = learner(app, mail, 'friend@example.test')
    owner.post(f"/api/groups/{group['id']}/invitations", json={'email': 'friend@example.test'})
    friend.post('/api/groups/join', json={'invite': group_token(mail, 'friend@example.test')})
    owner_id = owner.get('/api/auth/session').json()['account']['id']
    friend_id = friend.get('/api/auth/session').json()['account']['id']
    assert owner.request('DELETE', f"/api/groups/{group['id']}/members/{owner_id}", json={}).status_code == 409
    assert owner.post(f"/api/groups/{group['id']}/transfer", json={'account_id': friend_id}).status_code == 200
    assert friend.get(f"/api/groups/{group['id']}").json()['role'] == 'owner'
    assert friend.request('DELETE', f"/api/groups/{group['id']}/members/{owner_id}", json={}).status_code == 200
    with Session(app.state.engine) as session:
        assert session.get(GroupMember, (group['id'], owner_id)) is None


def test_failed_group_email_is_retryable_and_pending_invites_are_manageable(system):
    from unittest.mock import patch
    imported(system)
    owner, app, _, mail, _ = system
    group = owner.post('/api/groups', json={'name': 'Friends'}).json()['id']
    path = f'/api/groups/{group}/invitations'
    with patch('apps.api.auth.send_account_mail', side_effect=RuntimeError('mail unavailable')):
        assert owner.post(path, json={'email': 'friend@example.test'}).status_code == 503
    assert owner.post(path, json={'email': 'friend@example.test'}).status_code == 201
    pending = owner.get(f'/api/groups/{group}').json()['invitations']
    assert len(pending) == 1
    assert owner.request('DELETE', path + '/' + pending[0]['id'], json={}).status_code == 200
    assert owner.get(f'/api/groups/{group}').json()['invitations'] == []


def test_public_collection_is_not_a_private_access_grant_and_owner_controls_contribution(system):
    from test_public import list_public
    lesson = imported(system)
    owner, app, _, mail, _ = system
    accepted_move(owner, lesson)
    assert list_public(owner, lesson).status_code == 200
    group = owner.post('/api/groups', json={'name': 'Collection'}).json()['id']
    friend = learner(app, mail, 'collector@example.test')
    owner.post(f'/api/groups/{group}/invitations', json={'email': 'collector@example.test'})
    friend.post('/api/groups/join', json={'invite': group_token(mail, 'collector@example.test')})
    assert owner.patch(f'/api/groups/{group}', json={'contribution_policy': 'managers'}).status_code == 200
    assert friend.post(f'/api/groups/{group}/lessons', json={'lesson_id': lesson.lesson_id, 'access_kind': 'collection'}).status_code == 403
    assert friend.patch(f'/api/groups/{group}', json={'contribution_policy': 'members'}).status_code == 403
    owner.patch(f'/api/groups/{group}', json={'contribution_policy': 'members'})
    assert friend.post(f'/api/groups/{group}/lessons', json={'lesson_id': lesson.lesson_id, 'access_kind': 'collection'}).status_code == 200
    move = friend.get(f'/api/groups/{group}').json()['moves'][0]
    assert move['title'] == 'Front kick'
    assert move['access_kind'] == 'collection'
    assert move['can_remove'] is True
    owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={'listed': False})
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 404
    assert friend.get(f'/api/groups/{group}').json()['moves'] == []
    assert friend.get('/api/shared-lessons').json() == []


def test_admin_invitation_cannot_be_replayed_after_leaving(system):
    imported(system)
    owner, app, _, mail, _ = system
    group = owner.post('/api/groups', json={'name': 'Team'}).json()['id']
    friend = learner(app, mail, 'admin@example.test')
    owner.post(f'/api/groups/{group}/invitations', json={'email': 'admin@example.test', 'role': 'admin'})
    token = group_token(mail, 'admin@example.test')
    assert friend.post('/api/groups/join', json={'invite': token}).status_code == 200
    assert friend.post('/api/groups/join', json={'invite': token}).status_code == 200
    account_id = friend.get('/api/auth/session').json()['account']['id']
    assert friend.request('DELETE', f'/api/groups/{group}/members/{account_id}', json={}).status_code == 200
    assert friend.post('/api/groups/join', json={'invite': token}).status_code == 404
    assert friend.get(f'/api/groups/{group}').status_code == 404
