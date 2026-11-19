"""Rollout flags and cross-audience access-loss acceptance."""
import json
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import imported, register, system  # noqa: F401 - fixture
from apps.api.auth import now
from apps.api.config import ROOT
from apps.api.database import (Lesson, LessonAcceptance, LessonLike, LessonPublication,
                               LessonRevision)

MUSIC = json.loads((ROOT / 'packages' / 'lesson-schema' / 'fixtures' / 'music-v2.json')
                   .read_text(encoding='utf-8'))


def learner(app, mail, email='learner@example.test'):
    client = TestClient(app)
    client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
    register(client, mail, email)
    from test_accounts import login
    login(client, email)
    return client


def publish(client, lesson, mode='invite'):
    return client.post(f'/api/lessons/{lesson.lesson_id}/publish', json={
        'revision_id': lesson.revision_id, 'mode': mode, 'reviewed': True,
        'rights_acknowledged': True})


def invite(client, mail, path, email='learner@example.test'):
    response = client.post(path + '/invitations', json={'email': email})
    assert response.status_code == 201, response.text
    token = next(t for recipient, purpose, t in reversed(mail)
                 if recipient == email and purpose == 'invite')
    return response.json()['id'], token


def create_and_publish_drawing(client):
    created = client.post('/api/drawing/lessons', json={
        'title': 'Draw a cube', 'medium': 'pencil',
        'steps': [{'id': 's1', 'title': 'Box', 'instruction': 'Draw a box.'}],
    })
    assert created.status_code == 201, created.text
    drawing = created.json()
    accepted = client.post(f"/api/workflow/lessons/{drawing['lesson_id']}/accept",
                           json={'revision_id': drawing['revision_id']})
    assert accepted.status_code == 200, accepted.text
    listed = client.patch(f"/api/public/lessons/{drawing['lesson_id']}", json={
        'listed': True, 'title': 'Draw a cube', 'creator_name': 'Ari', 'tags': ['drawing'],
        'rights_acknowledged': True, 'public_roles': ['reference']})
    assert listed.status_code == 200, listed.text
    return drawing


def test_rollout_flags_gate_surfaces_without_mutating_releases(system, monkeypatch):
    owner, app, _settings, mail, _store = system
    imported(system)
    drawing = create_and_publish_drawing(owner)
    lesson_id = drawing['lesson_id']
    assert owner.get(f'/api/lessons/{lesson_id}',
                     headers={'X-Lesson-Formats': '1,2,3'}).status_code == 200
    assert owner.put(f'/api/social/moves/{lesson_id}/like', json={}).status_code == 200

    capabilities = owner.get('/api/capabilities').json()
    assert capabilities['phase'] == 9
    assert capabilities['rollout']['act_drawing_enabled'] is True
    assert any(flag['name'] == 'social_likes_enabled' and flag['remove_when']
               for flag in capabilities['rollout_flags'])

    monkeypatch.setenv('ACT_DRAWING_ENABLED', '0')
    assert owner.get(f'/api/lessons/{lesson_id}',
                     headers={'X-Lesson-Formats': '1,2,3'}).status_code == 404
    assert owner.get(f'/api/public/moves/{lesson_id}').status_code == 404
    assert owner.get('/api/public/moves', params={'act': 'drawing'}).status_code == 404
    assert all(item['lesson_id'] != lesson_id for item in
               owner.get('/api/public/moves').json()['moves'])
    assert owner.post('/api/drawing/lessons', json={
        'title': 'Blocked', 'medium': 'pencil',
        'steps': [{'id': 's1', 'title': 'Box', 'instruction': 'No.'}]}).status_code == 404
    assert owner.put(f'/api/social/moves/{lesson_id}/like', json={}).status_code == 404
    assert not any(item['name'] == 'act_drawing_enabled' and item['enabled']
                   for item in owner.get('/api/capabilities').json()['rollout_flags'])

    with Session(app.state.engine) as session:
        assert session.get(LessonRevision, drawing['revision_id']) is not None
        publication = session.get(LessonPublication, lesson_id)
        assert publication is not None and publication.listed is True
        assert session.query(LessonLike).filter_by(lesson_id=lesson_id).count() == 1

    monkeypatch.setenv('ACT_DRAWING_ENABLED', '1')
    assert owner.get(f'/api/public/moves/{lesson_id}').status_code == 200
    assert owner.put(f'/api/social/moves/{lesson_id}/like', json={}).json()['like_count'] == 1

    monkeypatch.setenv('SOCIAL_LIKES_ENABLED', '0')
    assert owner.put(f'/api/social/moves/{lesson_id}/like', json={}).status_code == 404
    monkeypatch.setenv('SOCIAL_LIKES_ENABLED', '1')
    assert owner.put(f'/api/social/moves/{lesson_id}/like', json={}).json()['like_count'] == 1

    monkeypatch.setenv('SOCIAL_RECOMMENDATIONS_ENABLED', '0')
    assert owner.get('/api/public/recommendations').status_code == 404
    monkeypatch.setenv('SOCIAL_RECOMMENDATIONS_ENABLED', '1')
    assert owner.get('/api/public/recommendations').status_code == 200

    # A released music row is retained, but its public surface can be hidden.
    account_id = owner.get('/api/auth/session').json()['account']['id']
    music_id, music_revision = uuid4().hex, uuid4().hex
    manifest = {**MUSIC, 'lesson_id': music_id, 'revision_id': music_revision,
                'title': 'Public piano'}
    with Session(app.state.engine) as session:
        session.add(Lesson(id=music_id, owner_id=account_id, title='Public piano',
                           subject='piano', experience_family='music', instrument='piano',
                           act_id='piano', published_revision_id=music_revision))
        session.add(LessonRevision(id=music_revision, lesson_id=music_id, version=1,
                                   manifest=manifest, subject='piano',
                                   experience_family='music', instrument='piano', act_id='piano'))
        session.add(LessonAcceptance(id=uuid4().hex, lesson_id=music_id,
                                     revision_id=music_revision, account_id=account_id,
                                     warnings=[], source='owner'))
        session.add(LessonPublication(lesson_id=music_id, revision_id=music_revision,
                                      title='Public piano', creator_name='Ari', listed=True,
                                      listed_at=now(), roles=['reference']))
        session.commit()

    assert owner.get(f'/api/public/moves/{music_id}').status_code == 200
    monkeypatch.setenv('PUBLIC_MUSIC_ENABLED', '0')
    assert owner.get(f'/api/public/moves/{music_id}').status_code == 404
    music_listing = owner.get('/api/public/moves', params={'act': 'piano'}).json()['moves']
    assert music_id not in {item['lesson_id'] for item in music_listing}
    monkeypatch.setenv('PUBLIC_MUSIC_ENABLED', '1')
    assert owner.get(f'/api/public/moves/{music_id}').status_code == 200
    with Session(app.state.engine) as session:
        assert session.get(LessonRevision, music_revision) is not None


def test_mid_session_access_loss_across_audiences(system, monkeypatch):
    owner, app, _settings, mail, store = system
    # Asset reads go through the deployment storage client; use the test FakeStorage.
    monkeypatch.setattr('apps.api.public.storage_client', lambda _settings: store)
    lesson = imported(system)
    path = f'/api/lessons/{lesson.lesson_id}'

    # Invited learner: revocation removes detail and asset access immediately.
    assert publish(owner, lesson, 'invite').status_code == 200
    student = learner(app, mail)
    invitation_id, token = invite(owner, mail, path)
    student_account = student.get('/api/auth/session').json()['account']['id']
    assert student.post('/api/shares/accept', json={'invite': token}).status_code == 200
    assert student.get(path).status_code == 200
    assert student.get(path + '/assets/synthetic.glb').status_code == 200
    assert owner.request('DELETE', f'{path}/students/{student_account}', json={}).status_code == 200
    assert student.get(path).status_code == 404
    assert student.get(path + '/assets/synthetic.glb').status_code == 404

    # A clean unpublish between the invite and link journeys avoids stale grants.
    assert owner.post(f'{path}/unpublish', json={}).status_code == 200

    # Linked recipient: unpublishing removes the link grant.
    link = publish(owner, lesson, 'link').json()['link']
    key = parse_qs(urlparse(link).fragment)['key'][0]
    recipient = learner(app, mail, 'recipient@example.test')
    assert recipient.post('/api/shares/accept', json={
        'lesson_id': lesson.lesson_id, 'key': key}).status_code == 200
    assert recipient.get(path).status_code == 200
    assert owner.post(f'{path}/unpublish', json={}).status_code == 200
    assert recipient.get(path).status_code == 404

    # Group member: removing membership revokes the independent group reason.
    assert publish(owner, lesson, 'invite').status_code == 200
    group = owner.post('/api/groups', json={'name': 'Acceptance group'}).json()['id']
    assert owner.post(f'/api/groups/{group}/invitations',
                      json={'email': 'member@example.test'}).status_code == 201
    group_token = next(token for recipient, purpose, token in reversed(mail)
                       if recipient == 'member@example.test' and purpose == 'group')
    member = learner(app, mail, 'member@example.test')
    assert member.post('/api/groups/join', json={'invite': group_token}).status_code == 200
    assert owner.post(f'/api/groups/{group}/lessons',
                      json={'lesson_id': lesson.lesson_id}).status_code == 200
    assert member.get(path).status_code == 200
    member_id = member.get('/api/auth/session').json()['account']['id']
    assert owner.request('DELETE', f'/api/groups/{group}/members/{member_id}',
                         json={}).status_code == 200
    assert member.get(path).status_code == 404

    # Public visitor: unlisting and moderator hiding deny detail, assets and likes.
    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': lesson.title, 'creator_name': 'Ari', 'tags': ['acceptance'],
        'rights_acknowledged': True, 'public_roles': ['interactive_data']}).status_code == 200
    visitor = TestClient(app)
    public_path = f'/api/public/moves/{lesson.lesson_id}'
    assert visitor.get(public_path).status_code == 200
    assert visitor.get(public_path + '/assets/synthetic.glb').status_code == 200
    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}',
                       json={'listed': False}).status_code == 200
    assert visitor.get(public_path).status_code == 404
    assert visitor.get(public_path + '/assets/synthetic.glb').status_code == 404
    assert student.put(f'/api/social/moves/{lesson.lesson_id}/like',
                       json={}).status_code == 404

    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}',
                       json={'listed': True, 'rights_acknowledged': True,
                             'public_roles': ['interactive_data']}).status_code == 200
    with Session(app.state.engine) as session:
        session.get(LessonPublication, lesson.lesson_id).moderation_hidden = True
        session.commit()
    assert visitor.get(public_path).status_code == 404
    assert owner.get(path).status_code == 200, 'owner keeps access to an immutable revision'
    with Session(app.state.engine) as session:
        session.get(LessonPublication, lesson.lesson_id).moderation_hidden = False
        session.commit()
    assert visitor.get(public_path).status_code == 200

    # The accepted revision never changed through any access transition.
    with Session(app.state.engine) as session:
        stored = session.get(LessonRevision, lesson.revision_id)
        assert stored is not None and stored.manifest['lesson_id'] == lesson.lesson_id
        assert session.get(Lesson, lesson.lesson_id).published_revision_id == lesson.revision_id
