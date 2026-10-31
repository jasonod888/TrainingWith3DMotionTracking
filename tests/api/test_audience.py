"""Overlapping audience reasons are additive and independent."""
from test_accounts import system, imported
from test_sharing import learner, publish, invite
from test_groups import group_token


def test_direct_group_and_public_access_are_independent(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    assert owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                      json={'revision_id': lesson.revision_id}).status_code == 200
    assert publish(owner, lesson).status_code == 200
    friend = learner(app, mail, 'friend@example.test')
    _, token = invite(owner, mail, f'/api/lessons/{lesson.lesson_id}', 'friend@example.test')
    assert friend.post('/api/shares/accept', json={'invite': token}).status_code == 200
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 200

    group = owner.post('/api/groups', json={'name': 'Overlap'}).json()
    owner.post(f"/api/groups/{group['id']}/invitations", json={'email': 'friend@example.test'})
    friend.post('/api/groups/join', json={'invite': group_token(mail, 'friend@example.test')})
    assert owner.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id}).status_code == 200
    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Overlap move', 'creator_name': 'Owner', 'tags': ['test'],
        'rights_acknowledged': True}).status_code == 200

    account_id = friend.get('/api/auth/session').json()['account']['id']
    assert owner.request('DELETE', f'/api/lessons/{lesson.lesson_id}/students/{account_id}', json={}).status_code == 200
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 200, 'group and public reasons remain'
    assert owner.request('DELETE', f"/api/groups/{group['id']}/members/{account_id}", json={}).status_code == 200
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 200, 'public reason remains'
    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={'listed': False}).status_code == 200
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').status_code == 404
