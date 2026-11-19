"""Synthetic full loop: prepared clip -> fixture worker draft -> review -> invitation -> learner."""
from fastapi.testclient import TestClient

from scripts.music_worker import MusicWorker
from support_multi import music_worker
from test_accounts import login, register
from test_music_draft_handoff import draft_adapter
from test_music_media_validation import media, real_media_app, upload
from test_music_review import review_body


def test_explicit_fixture_loop_reaches_a_private_learner(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        uploaded = upload(client, media(tmp_path, 'audio'))
        assert uploaded.json()['state'] == 'queued'
        music_worker(app, 'loop-worker', pipeline_version='music-piano-v1')
        worker = MusicWorker('http://localhost', 'loop-worker', 'music-piano-v1',
                             draft_adapter(tmp_path), tmp_path / 'attempts', api=client,
                             heartbeat_seconds=.2, fixture=True)
        lesson_id = worker.run(worker.claim())['lesson_id']

        view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        body = review_body(view)
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'], 'dimensions': ['pitch', 'timing'],
                              'rubric_version': 'piano-midi-v1'}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        manifest = reviewed.json()
        assert manifest['assessment']['assessment'] == 'notes'
        assert manifest['reference_reviewed'] is True

        published = client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': manifest['revision_id'], 'mode': 'invite',
            'reviewed': True, 'rights_acknowledged': True})
        assert published.status_code == 200, published.text
        assert client.post(f'/api/lessons/{lesson_id}/invitations',
                           json={'email': 'loop-learner@example.test'}).status_code == 201
        token = next(value for email, purpose, value in mail
                     if email == 'loop-learner@example.test' and purpose == 'invite')

        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1', 'X-Lesson-Formats': '1,2'})
            register(learner, mail, 'loop-learner@example.test')
            login(learner, 'loop-learner@example.test')
            accepted = learner.post('/api/shares/accept', json={'invite': token})
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()['schema_version'] == 2
            assert accepted.json()['reference']['sha256'] == manifest['reference']['sha256']
            detail = learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'})
            assert detail.status_code == 200
            assert detail.json()['schema_version'] == 2
