"""Reviewed music editing: new immutable revision; learner keeps the old release until update."""
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import Lesson, LessonAcceptance, MusicRevisionEdit
from test_accounts import login, register
from test_music_media_validation import media, real_media_app
from test_music_review import proposal, review_body


def test_editing_creates_a_new_revision_without_touching_the_shared_release(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['assessment'] = {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                              'rubric_version': 'music-watch-v1'}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        first = reviewed.json()
        assert client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': first['revision_id'], 'mode': 'invite', 'reviewed': True,
            'rights_acknowledged': True}).status_code == 200
        assert client.post(f'/api/lessons/{lesson_id}/invitations',
                           json={'email': 'learner@example.test'}).status_code == 201
        token = next(value for email, purpose, value in mail
                     if email == 'learner@example.test' and purpose == 'invite')

        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1',
                                    'X-Lesson-Formats': '1,2'})
            register(learner, mail, 'learner@example.test')
            login(learner, 'learner@example.test')
            assert learner.post('/api/shares/accept', json={'invite': token}).status_code == 200
            before = learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'}).json()
            assert before['revision_id'] == first['revision_id']

        edit = {'base_revision_id': first['revision_id'], 'title': 'Edited piano',
                'events': [{**event, 'pitch': 65} for event in body['events']],
                'spans': [{'start': 0, 'end': 1, 'kind': 'explanation'},
                          {'start': 1, 'end': 2, 'kind': 'playing'}],
                'sections': body['sections'],
                'assessment': {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                               'rubric_version': 'music-watch-v1'},
                'confirm_reviewed': True}
        with patch('apps.api.music_edit.storage_client', return_value=store):
            overlap = {**edit, 'spans': [{'start': 0, 'end': 2, 'kind': 'playing'},
                                       {'start': 1, 'end': 3, 'kind': 'explanation'}]}
        with patch('apps.api.music_edit.storage_client', return_value=store):
            assert client.post(f'/api/lessons/{lesson_id}/music-revision', json=overlap).status_code == 422
        with patch('apps.api.music_edit.storage_client', return_value=store):
            edited = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert edited.status_code == 200, edited.text
        second = edited.json()
        assert second['revision_id'] != first['revision_id']
        assert second['reference']['sha256'] != first['reference']['sha256']
        assert second['title'] == 'Edited piano'
        reference = json.loads(store.objects[second['reference']['key']])
        assert {span['kind'] for span in reference['spans']} == {'playing', 'explanation'}
        assert reference['review']['edited_from_revision'] == first['revision_id']
        with Session(app.state.engine) as session:
            lesson = session.get(Lesson, lesson_id)
            assert lesson.published_revision_id == first['revision_id']
            assert session.query(LessonAcceptance).count() == 2
            assert session.query(MusicRevisionEdit).count() == 1

        # The learner still sees the shared release; an idempotent retry returns the same revision.
        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1',
                                    'X-Lesson-Formats': '1,2'})
            login(learner, 'learner@example.test')
            current = learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'}).json()
            assert current['revision_id'] == first['revision_id']
        assert client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit).json()['revision_id'] == second['revision_id']
        changed = {**edit, 'title': 'Changed again'}
        assert client.post(f'/api/lessons/{lesson_id}/music-revision', json=changed).status_code == 409

        # Explicit update of the shared version.
        assert client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': second['revision_id'], 'mode': 'invite', 'reviewed': True,
            'rights_acknowledged': True}).status_code == 200
        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1',
                                    'X-Lesson-Formats': '1,2'})
            login(learner, 'learner@example.test')
            updated = learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'}).json()
            assert updated['revision_id'] == second['revision_id']


def test_title_only_edit_preserves_velocity_and_confidence(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['events'][0]['velocity'] = 0.5
        body['events'][0]['confidence'] = 0.9
        body['assessment'] = {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                              'rubric_version': 'music-watch-v1'}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        first = reviewed.json()
        edit = {'base_revision_id': first['revision_id'], 'title': 'Renamed only',
                'events': body['events'], 'spans': body['spans'], 'sections': body['sections'],
                'assessment': body['assessment'], 'confirm_reviewed': True}
        with patch('apps.api.music_edit.storage_client', return_value=store):
            edited = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert edited.status_code == 200, edited.text
        reference = json.loads(store.objects[edited.json()['reference']['key']])
        assert reference['events'][0]['velocity'] == 0.5
        assert reference['events'][0]['confidence'] == 0.9


def test_edit_persists_reviewed_positions_and_chords(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['assessment'] = {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                              'rubric_version': 'music-watch-v1'}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        first = reviewed.json()
        edit = {'base_revision_id': first['revision_id'], 'title': 'Guitar choices',
                'events': [{**body['events'][0], 'pitch': 60, 'string': 2, 'fret': 1},
                           {**body['events'][1], 'string': None, 'fret': None}],
                'spans': body['spans'], 'sections': body['sections'], 'assessment': body['assessment'],
                'guitar_chords': [{'id': 'chord-c', 'name': 'C', 'start': 0,
                                   'frets': [-1, 3, 2, 0, 1, 0], 'position': 1}],
                'confirm_reviewed': True}
        bad = {**edit, 'events': [{**edit['events'][0], 'string': 2, 'fret': 2}]}
        with patch('apps.api.music_edit.storage_client', return_value=store):
            assert client.post(f'/api/lessons/{lesson_id}/music-revision', json=bad).status_code == 422
            edited = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert edited.status_code == 200, edited.text
        reference = json.loads(store.objects[edited.json()['reference']['key']])
        assert reference['events'][0]['string'] == 2 and reference['events'][0]['fret'] == 1
        assert reference['guitar_chords'][0]['name'] == 'C' and reference['guitar_chords'][0]['frets'][1] == 3
