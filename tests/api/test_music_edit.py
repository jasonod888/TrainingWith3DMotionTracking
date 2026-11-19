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
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
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
                'assessment': {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                               'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'},
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


def test_editing_preserves_creator_off_when_the_partial_body_omits_it(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        lesson_id,view,*_=proposal(client,app,media(tmp_path,'audio'))
        body=review_body(view);body['feedback_enabled']=False
        reviewed=client.post(f'/api/lessons/{lesson_id}/music-draft/review',json=body)
        assert reviewed.status_code==200,reviewed.text
        first=reviewed.json()
        edit={'base_revision_id':first['revision_id'],'title':'Still off',
              'events':body['events'],'spans':body['spans'],'sections':body['sections'],
              'assessment':body['assessment'],'confirm_reviewed':True}
        with patch('apps.api.music_edit.storage_client',return_value=store):
            saved=client.post(f'/api/lessons/{lesson_id}/music-revision',json=edit)
        assert saved.status_code==200,saved.text
        second=saved.json()
        assert second['feedback_enabled'] is False
        assert second['assessment']['assessment']=='notes'
        assert client.get(f'/api/lessons/{lesson_id}',headers={'X-Lesson-Formats':'1,2'}).json()['feedback_enabled'] is False
        enabled={**edit,'base_revision_id':second['revision_id'],'feedback_enabled':True}
        with patch('apps.api.music_edit.storage_client',return_value=store):
            on=client.post(f'/api/lessons/{lesson_id}/music-revision',json=enabled)
        assert on.status_code==200,on.text
        assert on.json()['feedback_enabled'] is True


def _notation_for(events, duration=2.0, bpm=120):
    """A minimal but complete notation document matching the reviewed performance."""
    ppq = 480
    grid = 120
    seconds_per_tick = 60 / (bpm * ppq)
    measures = [{'id': 'measure-1', 'index': 0, 'start': 0, 'duration': 1920}]
    noted = []
    for index, event in enumerate(sorted(events, key=lambda item: (item['onset'], item['pitch']))):
        start = max(0, round(event['onset'] / seconds_per_tick / grid) * grid)
        end = max(start + grid, round((event['onset'] + (event.get('duration') or 0.25)) / seconds_per_tick / grid) * grid)
        noted.append({
            'id': f'score-{index}', 'staff': 'treble', 'voice': 1, 'start': start,
            'duration': max(grid, end - start), 'rest': False, 'source': 'performance',
            'notes': [{'id': f'note-{index}', 'pitch': event['pitch'],
                       'spelling': {60: 'C4', 64: 'E4', 65: 'F4'}.get(event['pitch'], 'C4'),
                       'accidental': 'natural', 'performance_ids': [event['id']]}],
        })
    return {
        'notation_version': 1, 'subject': 'piano', 'duration': duration, 'ppq': ppq,
        'tempo': {'bpm': bpm, 'beat_unit': 4, 'mode': 'notation', 'source': 'estimated'},
        'time_signature': {'numerator': 4, 'denominator': 4}, 'key_signature': 'C',
        'staff_split_pitch': 60, 'measures': measures, 'events': noted,
        'segments': [], 'ties': [], 'performance': [dict(event) for event in events],
        'performance_map': {}, 'created_from': 'performance',
    }


def test_edit_persists_notation_and_refuses_a_mismatched_performance(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        first = reviewed.json()
        edit = {'base_revision_id': first['revision_id'], 'title': 'Notated piano',
                'events': body['events'], 'notation': _notation_for(body['events']),
                'spans': body['spans'], 'sections': body['sections'], 'assessment': body['assessment'],
                'confirm_reviewed': True}
        with patch('apps.api.music_edit.storage_client', return_value=store):
            saved = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert saved.status_code == 200, saved.text
        reference = json.loads(store.objects[saved.json()['reference']['key']])
        assert reference['notation']['notation_version'] == 1
        assert reference['notation']['measures'][0]['duration'] == 1920
        assert reference['notation']['events'][0]['notes'][0]['pitch'] in (60, 64)
        assert reference['notation']['performance'][0]['velocity'] == body['events'][0]['velocity']
        assert reference['events'][0]['velocity'] == body['events'][0]['velocity']

        # The stored notation must not claim a different performance than the review.
        bad = json.loads(json.dumps(edit))
        bad['base_revision_id'] = saved.json()['revision_id']
        bad['notation']['performance'][0]['pitch'] = 127
        with patch('apps.api.music_edit.storage_client', return_value=store):
            refused = client.post(f'/api/lessons/{lesson_id}/music-revision', json=bad)
        assert refused.status_code == 422
        assert 'performance' in refused.text


def test_title_only_edit_preserves_velocity_and_confidence(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['events'][0]['velocity'] = 0.5
        body['events'][0]['confidence'] = 0.9
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
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
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
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
