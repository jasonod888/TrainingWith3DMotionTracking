"""Format negotiation, summary projection and per-capability availability."""
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from test_accounts import FakeStorage, imported, system
from apps.api.config import Settings
from apps.api.database import Base
from apps.api.main import create_app
from support_multi import import_music


def owner_of(system):
    lesson = imported(system)
    client, app, settings, _mail, _store = system
    return lesson, client, app, settings


@contextmanager
def app_with(tmp_path, store=None, **overrides):
    from test_conversions import MultipartStore
    store = store or MultipartStore()
    tmp_path.mkdir(parents=True, exist_ok=True)
    settings = Settings(database_url=f'sqlite:///{(tmp_path / "routes.db").as_posix()}',
                        public_url='http://testserver', demo_enabled=False,
                        web_dist_dir=tmp_path / 'no-web', _env_file=None, **overrides)
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    mail = []
    with patch('apps.api.auth.send_account_mail', side_effect=lambda s, e, p, t: mail.append((e, p, t))), \
         patch('apps.api.lessons.storage_client', return_value=store), \
         patch('apps.api.conversions.storage_client', return_value=store), \
         TestClient(app) as client:
        client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        from test_accounts import login, register
        register(client, mail)
        login(client)
        yield client, app, settings, mail, store


def test_body_library_stays_body_only(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    library = client.get('/api/lessons').json()
    assert [item['lesson_id'] for item in library] == [lesson.lesson_id]
    assert all(item['schema_version'] == 1 for item in library)
    # The music fixture exists but is not a body-shaped object.
    assert music.lesson_id != lesson.lesson_id


def test_summaries_are_filtered_by_advertised_formats(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    body_only = client.get('/api/lessons/summaries').json()
    assert [item['lesson_id'] for item in body_only] == [lesson.lesson_id]
    mixed = client.get('/api/lessons/summaries', headers={'X-Lesson-Formats': '1,2'}).json()
    assert {item['lesson_id'] for item in mixed} == {lesson.lesson_id, music.lesson_id}
    labels = {item['subject_label'] for item in mixed}
    assert labels == {'Full Body Movement', 'Piano'}
    piano = next(item for item in mixed if item['lesson_id'] == music.lesson_id)
    assert piano['summary_version'] == 1 and piano['experience_family'] == 'music'
    assert piano['capabilities']['live_input'] == 'none'  # music route is off by default


def test_v1_client_is_refused_a_music_lesson_with_recovery_guidance(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    refused = client.get(f'/api/lessons/{music.lesson_id}')
    assert refused.status_code == 406
    assert refused.headers['X-Lesson-Format-Required'] == '2'
    assert 'newer version' in refused.json()['detail']
    accepted = client.get(f'/api/lessons/{music.lesson_id}', headers={'X-Lesson-Formats': '1,2'})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['schema_version'] == 2
    # Body lessons are unaffected by negotiation.
    body = client.get(f'/api/lessons/{lesson.lesson_id}')
    assert body.status_code == 200 and body.json()['schema_version'] == 1


def test_music_assets_are_private_to_authorised_accounts(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    reference = client.get(f'/api/lessons/{music.lesson_id}/assets/reference.json')
    assert reference.status_code == 200 and reference.content
    from test_accounts import login, register
    mail = system[3]
    with TestClient(app) as other:
        other.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        register(other, mail, 'other@example.test')
        login(other, 'other@example.test')
        assert other.get(f'/api/lessons/{music.lesson_id}').status_code == 404
        assert other.get(f'/api/lessons/{music.lesson_id}/assets/reference.json').status_code == 404


def test_music_lessons_are_never_in_the_public_projection(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    public = client.get(f'/api/public/moves/{music.lesson_id}')
    assert public.status_code == 404
    published = client.post(f'/api/lessons/{music.lesson_id}/publish',
                            json={'revision_id': music.revision_id, 'mode': 'invite',
                                  'reviewed': True, 'rights_acknowledged': True})
    assert published.status_code == 409


def test_a_recipient_keeps_the_released_label_until_the_owner_publishes(system):
    lesson, client, app, settings = owner_of(system)
    published = client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                            json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                  'reviewed': True, 'rights_acknowledged': True})
    assert published.status_code == 200, published.text
    from test_accounts import login, register
    from sqlalchemy.orm import Session
    from apps.api.database import LessonGrant
    mail = system[3]
    with TestClient(app) as recipient:
        recipient.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        register(recipient, mail, 'label-recipient@example.test')
        login(recipient, 'label-recipient@example.test')
        account_id = recipient.get('/api/auth/session').json()['account']['id']
        with Session(app.state.engine) as session:
            session.add(LessonGrant(lesson_id=lesson.lesson_id, account_id=account_id, source='invite'))
            session.commit()

        def released_label():
            values = recipient.get('/api/shared-lessons/summaries',
                                   headers={'X-Lesson-Formats': '1,2'}).json()
            return next(item['subject_label'] for item in values if item['lesson_id'] == lesson.lesson_id)

        assert released_label() == 'Full Body Movement'
        assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'dance'}).status_code == 200
        # Unpublished relabel stays invisible to the recipient.
        assert released_label() == 'Full Body Movement'
        assert client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                           json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                 'reviewed': True, 'rights_acknowledged': True}).status_code == 200
        assert released_label() == 'Dance'


def test_capability_and_limit_responses_are_per_route(system):
    lesson, client, app, settings = owner_of(system)
    limits = client.get('/api/conversions/limits').json()
    assert limits['processing']['available'] is True
    assert limits['routes']['body-default']['available'] is True
    assert limits['routes']['music-piano']['available'] is False
    assert limits['routes']['music-guitar']['available'] is False
    assert limits['capabilities'] == {'conversion': True, 'music_piano': False, 'music_guitar': False}
    assert {item['id'] for item in limits['subjects']} == {
        'movement_other', 'dance', 'taekwondo', 'boxing', 'piano', 'guitar'}


def test_a_music_route_does_not_change_body_availability(tmp_path):
    with app_with(tmp_path / 'music-on', music_piano_conversion_provider='local',
                  music_guitar_conversion_provider='local') as (client, _app, _settings, _mail, _store):
        limits = client.get('/api/conversions/limits').json()
        assert limits['capabilities'] == {'conversion': True, 'music_piano': True, 'music_guitar': True}
        assert limits['routes']['body-default']['available'] is True


def test_piano_can_be_enabled_while_guitar_stays_off(tmp_path):
    with app_with(tmp_path / 'piano-only', music_piano_conversion_provider='local') as (client, _app, _settings, _mail, _store):
        limits = client.get('/api/conversions/limits').json()
        assert limits['capabilities'] == {'conversion': True, 'music_piano': True, 'music_guitar': False}
        assert limits['routes']['music-piano']['available'] is True
        assert limits['routes']['music-guitar']['available'] is False
        piano = {'title': 'Piano', 'filename': 'a.mp4', 'bytes': 10, 'start': 0, 'duration': 2, 'subject': 'piano'}
        guitar = {**piano, 'subject': 'guitar'}
        assert client.post('/api/conversions', json=piano).status_code == 201
        assert client.post('/api/conversions', json=guitar).status_code == 503


def test_shared_library_never_returns_a_music_manifest(system):
    lesson, client, app, settings = owner_of(system)
    music = import_music(system)
    from test_accounts import login, register
    from sqlalchemy.orm import Session
    from apps.api.database import Lesson, LessonAcceptance, LessonGrant
    mail = system[3]
    with TestClient(app) as other:
        other.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        register(other, mail, 'recipient@example.test')
        login(other, 'recipient@example.test')
        recipient = other.get('/api/auth/session').json()['account']['id']
        # Music cannot be published in Phase 1. Simulate a released music revision and a
        # grant so the body-shaped endpoint is proved not to leak a v2 object if that
        # becomes possible later.
        with Session(app.state.engine) as session:
            row = session.get(Lesson, music.lesson_id)
            row.published_revision_id = music.revision_id
            row.distribution = 'invite'
            session.add(LessonGrant(lesson_id=music.lesson_id, account_id=recipient, source='invite'))
            session.add(LessonAcceptance(id='music-review-' + music.revision_id, lesson_id=music.lesson_id,
                                         revision_id=music.revision_id, account_id=recipient,
                                         warnings=[], source='music-review'))
            session.commit()
        assert other.get('/api/shared-lessons').json() == []
        summaries = other.get('/api/shared-lessons/summaries', headers={'X-Lesson-Formats': '1,2'}).json()
        assert [item['lesson_id'] for item in summaries] == [music.lesson_id]
        assert other.get(f'/api/lessons/{music.lesson_id}').status_code == 406
        assert other.get(f'/api/lessons/{music.lesson_id}', headers={'X-Lesson-Formats': '1,2'}).status_code == 200


def test_a_disabled_body_route_does_not_claim_music_availability(tmp_path):
    with app_with(tmp_path / 'body-off', conversion_provider='disabled') as (client, _app, _settings, _mail, _store):
        limits = client.get('/api/conversions/limits').json()
        assert limits['capabilities'] == {'conversion': False, 'music_piano': False, 'music_guitar': False}
        body = client.post('/api/conversions', json={'title': 'Move', 'filename': 'a.mp4', 'bytes': 10,
                                                     'start': 0, 'duration': 2})
        assert body.status_code == 503
        music = client.post('/api/conversions', json={'title': 'Piano', 'filename': 'a.mp4', 'bytes': 10,
                                                      'start': 0, 'duration': 2, 'subject': 'piano'})
        assert music.status_code == 503


def test_shared_summaries_endpoint_matches_the_shared_library(system):
    lesson, client, app, settings = owner_of(system)
    assert client.get('/api/shared-lessons').json() == []
    summaries = client.get('/api/shared-lessons/summaries', headers={'X-Lesson-Formats': '1,2'})
    assert summaries.status_code == 200 and summaries.json() == []
