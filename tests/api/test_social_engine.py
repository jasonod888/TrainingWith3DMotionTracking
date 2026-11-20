"""Cross-Act discovery, deterministic recommendations and idempotent likes."""
import json
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import imported, login, register, system  # noqa: F401 - fixture
from apps.api.auth import now
from apps.api.config import ROOT
from apps.api.database import (Lesson, LessonAcceptance, LessonLike, LessonPublication,
                               LessonRevision, LessonTag)

FIXTURES = ROOT / 'packages' / 'lesson-schema'
BODY = json.loads((FIXTURES / 'fixture.json').read_text(encoding='utf-8'))
MUSIC = json.loads((FIXTURES / 'fixtures' / 'music-v2.json').read_text(encoding='utf-8'))


def owner_id(client):
    return client.get('/api/auth/session').json()['account']['id']


def other_client(app, mail):
    client = TestClient(app)
    client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1',
                           'X-Lesson-Formats': '1,2'})
    register(client, mail, email='other@example.test')
    login(client, email='other@example.test')
    return client


def seed(session, owner, *, act='full_body', subject='dance', family='body',
         instrument=None, title='Lesson', tags=(), roles=('interactive_data',),
         listed=True, hidden=False, animation=True, order=0):
    lesson_id, revision_id = uuid4().hex, uuid4().hex
    if family == 'music':
        manifest = {**MUSIC, 'lesson_id': lesson_id, 'revision_id': revision_id,
                    'title': title, 'subject': subject,
                    'instrument': {'instrument': subject}}
        family, instrument = 'music', subject
    else:
        manifest = {**BODY, 'lesson_id': lesson_id, 'revision_id': revision_id, 'title': title}
        if not animation:
            manifest.update({
                'engine': 'mediapipe', 'engine_version': 'mediapipe-pose-heavy-v1',
                'root_motion': 'hip-relative', 'animation': None,
                'source_video': {'key': f'lessons/{lesson_id}/source.mp4', 'mime': 'video/mp4',
                                 'bytes': 6, 'sha256': 'a' * 64},
                'focused_video': {'key': f'lessons/{lesson_id}/preview.mp4', 'mime': 'video/mp4',
                                  'bytes': 5, 'sha256': 'b' * 64},
            })
    stamp = now() + timedelta(seconds=order)
    session.add(Lesson(id=lesson_id, owner_id=owner, title=title, subject=subject,
                       experience_family=family, instrument=instrument, act_id=act,
                       published_revision_id=revision_id, distribution='public'))
    session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=1,
                               manifest=manifest, subject=subject,
                               experience_family=family, instrument=instrument, act_id=act))
    session.add(LessonAcceptance(id=uuid4().hex, lesson_id=lesson_id, revision_id=revision_id,
                                 account_id=owner, warnings=[], source='owner'))
    session.add(LessonPublication(lesson_id=lesson_id, revision_id=revision_id, title=title,
                                  creator_name='Creator', description='Public lesson',
                                  listed=listed, moderation_hidden=hidden,
                                  listed_at=stamp, roles=list(roles)))
    for tag in tags:
        session.add(LessonTag(lesson_id=lesson_id, tag=tag))
    return lesson_id


def test_cross_act_discovery_items(system):
    client, app, _settings, _mail, _store = system
    imported(system)  # sign in the owner
    with Session(app.state.engine) as session:
        body = seed(session, owner_id(client), title='Body 3D', order=1)
        video = seed(session, owner_id(client), title='Video only', animation=False,
                     roles=('playable_preview',), order=2)
        piano = seed(session, owner_id(client), act='piano', subject='piano', family='music',
                     title='Piano', roles=('reference',), order=3)
        guitar = seed(session, owner_id(client), act='guitar', subject='guitar', family='music',
                      title='Guitar', roles=('reference',), order=4)
        session.commit()

    response = client.get('/api/public/moves', params={'limit': 24})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['policy'] == 'deterministic-social-v1'
    moves = {item['lesson_id']: item for item in payload['moves']}
    assert set(moves) == {body, video, piano, guitar}

    assert moves[body]['act_id'] == 'full_body'
    assert moves[body]['roles'] == ['interactive_data']
    assert moves[body]['effective_actions']['practice'] is True
    assert moves[body]['effective_actions']['challenge'] is True
    assert moves[body]['creator'] == {'id': moves[body]['creator']['id'], 'display_name': 'Creator'}

    assert moves[video]['roles'] == ['playable_preview']
    assert moves[video]['effective_actions']['practice'] is False
    assert moves[video]['effective_actions']['challenge'] is False
    assert moves[piano]['act_id'] == 'piano'
    assert moves[guitar]['act_id'] == 'guitar'
    assert moves[piano]['subjects'][0]['id'] == 'piano'
    assert moves[guitar]['representations'] == ['interactive_notation']
    for item in moves.values():
        assert item['like_count'] == 0 and item['liked_by_viewer'] is False


def test_filters_and_pagination_apply_before_the_page(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    with Session(app.state.engine) as session:
        owner = owner_id(client)
        ids = []
        for index in range(12):
            ids.append(seed(session, owner, title=f'Dance {index}',
                            tags=('alpha',) if index % 2 == 0 else ('beta',),
                            order=index))
        piano = seed(session, owner, act='piano', subject='piano', family='music',
                     title='Piano scale', tags=('alpha',), roles=('reference',), order=20)
        session.commit()

    page = client.get('/api/public/moves', params={'act': 'full_body', 'limit': 5}).json()
    assert len(page['moves']) == 5
    assert page['next_offset'] == 5
    assert all(item['act_id'] == 'full_body' for item in page['moves'])
    ids_seen = [item['lesson_id'] for item in page['moves']]
    assert len(ids_seen) == len(set(ids_seen)), 'no duplicate cards'

    tag_page = client.get('/api/public/moves', params={'tag': 'alpha', 'limit': 50}).json()
    assert tag_page['moves']
    assert all('alpha' in item['tags'] for item in tag_page['moves'])
    assert piano in {item['lesson_id'] for item in tag_page['moves']}

    query = client.get('/api/public/moves', params={'q': 'Dance 3', 'limit': 50}).json()
    assert [item['title'] for item in query['moves']] == ['Dance 3']

    subject = client.get('/api/public/moves', params={'subject': 'piano'}).json()
    assert [item['lesson_id'] for item in subject['moves']] == [piano]

    newest = client.get('/api/public/moves', params={'limit': 3}).json()['moves']
    assert [item['lesson_id'] for item in newest][0] == piano


def test_private_hidden_and_unlisted_are_not_discovery(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    with Session(app.state.engine) as session:
        owner = owner_id(client)
        public = seed(session, owner, title='Public', order=1)
        unlisted = seed(session, owner, title='Unlisted', listed=False, order=2)
        hidden = seed(session, owner, title='Hidden', hidden=True, order=3)
        session.commit()

    public_ids = {item['lesson_id'] for item in
                  client.get('/api/public/moves', params={'limit': 50}).json()['moves']}
    assert public in public_ids
    assert unlisted not in public_ids and hidden not in public_ids

    owner_library = {item['lesson_id'] for item in
                     client.get('/api/lessons/summaries',
                                headers={'X-Lesson-Formats': '1,2'}).json()}
    assert {public, unlisted, hidden} <= owner_library, 'private search stays owner-only'

    assert client.get('/api/public/moves', params={'q': 'Unlisted'}).json()['moves'] == []
    assert client.get('/api/public/moves', params={'q': 'Hidden'}).json()['moves'] == []


def test_recommendations_are_deterministic_and_explainable(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    with Session(app.state.engine) as session:
        owner = owner_id(client)
        seed_id = seed(session, owner, title='Seed', tags=('kick', 'basics'), order=0)
        same_tags = seed(session, owner, title='Same tags', tags=('kick',), order=10)
        unrelated = seed(session, owner, title='Unrelated', tags=('spin',), order=30)
        piano_tags = seed(session, owner, act='piano', subject='piano', family='music',
                          title='Piano kick', tags=('kick',), roles=('reference',), order=20)
        seed(session, owner, title='Hidden kick', tags=('kick',), hidden=True, order=40)
        seed(session, owner, title='Unlisted kick', tags=('kick',), listed=False, order=50)
        session.commit()

    response = client.get('/api/public/recommendations',
                          params={'lesson_id': seed_id, 'limit': 3})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['policy'] == 'deterministic-social-v1'
    ids = [item['lesson_id'] for item in payload['items']]
    assert seed_id not in ids
    assert ids[0] == same_tags, 'shared tags and Act win'
    assert piano_tags in ids and unrelated in ids
    by_id = {item['lesson_id']: item for item in payload['items']}
    assert by_id[same_tags]['explanation']['reason'] == 'shared_tags'
    assert by_id[same_tags]['explanation']['policy'] == 'deterministic-social-v1'
    assert by_id[same_tags]['explanation']['matched']['tags'] == ['kick']

    repeat = client.get('/api/public/recommendations',
                        params={'lesson_id': seed_id, 'limit': 3}).json()
    assert [item['lesson_id'] for item in repeat['items']] == ids
    newest = [item['lesson_id'] for item in
              client.get('/api/public/moves', params={'limit': 3}).json()['moves']]
    assert ids != newest, 'recommendations are not just newest-first'

    cold = client.get('/api/public/recommendations', params={'limit': 3}).json()
    assert all(item['explanation']['reason'] == 'newest_fallback' for item in cold['items'])


def test_likes_are_idempotent_visible_and_scoped(system):
    client, app, _settings, mail, _store = system
    imported(system)
    with Session(app.state.engine) as session:
        owner = owner_id(client)
        lesson = seed(session, owner, title='Likeable', tags=('kick',), order=1)
        unlisted = seed(session, owner, title='No likes', listed=False, order=2)
        hidden = seed(session, owner, title='Hidden likes', hidden=True, order=3)
        session.commit()

    url = f'/api/social/moves/{lesson}/like'
    first = client.put(url, json={})
    assert first.status_code == 200, first.text
    assert first.json() == {'liked': True, 'like_count': 1}
    second = client.put(url, json={})
    assert second.status_code == 200
    assert second.json()['like_count'] == 1, 'repeated like is idempotent'
    with Session(app.state.engine) as session:
        assert session.query(LessonLike).filter(LessonLike.lesson_id == lesson).count() == 1

    viewed = client.get(f'/api/public/moves/{lesson}').json()
    assert viewed['liked_by_viewer'] is True and viewed['like_count'] == 1
    listed = client.get('/api/public/moves').json()['moves'][0]
    assert listed['like_count'] == 1 and listed['liked_by_viewer'] is True

    other = other_client(app, mail)
    assert other.put(url, json={}).json()['like_count'] == 2
    assert other.request('DELETE', url, json={}).json() == {'liked': False, 'like_count': 1}
    assert client.request('DELETE', url, json={}).json() == {'liked': False, 'like_count': 0}
    assert client.request('DELETE', url, json={}).json()['like_count'] == 0, 'unlike is idempotent'

    assert client.put(f'/api/social/moves/{unlisted}/like', json={}).status_code == 404
    assert client.put(f'/api/social/moves/{hidden}/like', json={}).status_code == 404
    hidden_ids = {item['lesson_id'] for item in
                  client.get('/api/public/moves', params={'limit': 50}).json()['moves']}
    assert hidden not in hidden_ids and unlisted not in hidden_ids
