"""Music conversion routing, binding, provenance and the separate completion contract."""
import json
from contextlib import contextmanager
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import login, register
from test_conversions import MultipartStore
from apps.api.config import ROOT, Settings
from apps.api.database import Base, Conversion, Lesson, LessonRevision
from apps.api.main import create_app
from apps.api.processing import ENGINE_VERSION
from support_multi import music_manifest, music_worker

SOURCE = b'prepared-clip'
MUSIC_BODY = {'title': 'Piano test', 'filename': 'piano-clip.mp4', 'start': 0, 'duration': 2,
              'subject': 'piano', 'instrument': 'piano',
              'preparation': {'preparation_version': 'music-clip-v1',
                              'selection_start': 1.5, 'selection_end': 3.5}}


@contextmanager
def music_app(tmp_path, music_piano_conversion_provider='local', music_guitar_conversion_provider='local', **overrides):
    store = MultipartStore()
    tmp_path.mkdir(parents=True, exist_ok=True)
    settings = Settings(database_url=f'sqlite:///{(tmp_path / "music.db").as_posix()}',
                        public_url='http://testserver', demo_enabled=False,
                        web_dist_dir=tmp_path / 'no-web',
                        music_piano_conversion_provider=music_piano_conversion_provider,
                        music_guitar_conversion_provider=music_guitar_conversion_provider,
                        _env_file=None, **overrides)
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    mail = []
    with patch('apps.api.auth.send_account_mail', side_effect=lambda s, e, p, t: mail.append((e, p, t))), \
         patch('apps.api.lessons.storage_client', return_value=store), \
         patch('apps.api.conversions.storage_client', return_value=store), \
         patch('apps.api.conversions.probe_audio_media', return_value={'audio': True, 'video': True, 'findings': []}), \
         TestClient(app) as client:
        client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        register(client, mail)
        login(client)
        yield client, app, settings, store, mail


def start_job(client, body):
    response = client.post('/api/conversions', json={**body, 'bytes': len(SOURCE)})
    assert response.status_code == 201, response.text
    job = response.json()
    path = '/api/conversions/' + job['id']
    assert client.put(path + '/parts/1', content=SOURCE,
                      headers={'Content-Type': 'application/octet-stream'}).status_code == 200
    assert client.post(path + '/complete', json={}).status_code == 200
    return job, path


def claimed(client, app, body, pipeline='music-piano-v1', token='music-worker-token'):
    job, _path = start_job(client, body)
    headers = music_worker(app, token, pipeline_version=pipeline)
    claim = client.post('/api/worker/claim', headers=headers, json={}).json()
    assert claim and claim['pipeline_version'] == pipeline
    lease = {**headers, 'X-Job-Lease': claim['attempt_token']}
    base = '/api/worker/jobs/' + job['id']
    for stage in ('processing', 'exporting', 'verifying'):
        assert client.post(base + '/heartbeat', headers=lease, json={'stage': stage}).status_code == 200
    return job, lease, base


def manifest_for_clip(duration=2.0, subject='piano'):
    """A music manifest that matches the requested clip, for a successful completion."""
    value = music_manifest(subject)
    value['duration'] = duration
    value['section_set']['duration'] = duration
    value['section_set']['sections'] = [{'id': 'all', 'label': 'Whole clip', 'start': 0, 'end': duration}]
    return value


def upload_reference(client, base, lease):
    return client.put(base + '/files/reference.json', headers=lease,
                      content=b'{"schema":1,"events":[]}').json()


def test_body_job_keeps_the_default_route(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        job, _path = start_job(client, {'title': 'New lesson', 'filename': 'demo.mp4',
                                        'start': 0, 'duration': 2})
        assert job['pipeline_version'] == 'sam-3d-body-v1'
        assert job['subject'] == 'movement_other' and job['instrument'] is None


def test_music_job_uses_its_own_route_and_records_provenance(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        job, _path = start_job(client, MUSIC_BODY)
        assert job['pipeline_version'] == 'music-piano-v1'
        assert job['subject'] == 'piano' and job['instrument'] == 'piano'
        with Session(app.state.engine) as session:
            record = session.get(Conversion, job['id'])
            assert record.preparation == {'preparation_version': 'music-clip-v1',
                                          'selection_start': 1.5, 'selection_end': 3.5}


def test_contradictory_selections_are_refused(tmp_path):
    with music_app(tmp_path) as (client, _app, _settings, _store, _mail):
        for body in ({**MUSIC_BODY, 'instrument': 'guitar'},
                     {**MUSIC_BODY, 'subject': 'dance', 'instrument': 'piano'},
                     {**MUSIC_BODY, 'subject': 'violin'}):
            assert client.post('/api/conversions', json={**body, 'bytes': len(SOURCE)}).status_code == 422
        accepted = client.post('/api/conversions', json={**MUSIC_BODY, 'instrument': None, 'bytes': len(SOURCE)})
        assert accepted.status_code == 201, accepted.text


def test_a_disabled_music_route_refuses_without_creating_a_job(tmp_path):
    with music_app(tmp_path, music_piano_conversion_provider='disabled',
                   music_guitar_conversion_provider='disabled') as (client, app, _settings, _store, _mail):
        response = client.post('/api/conversions', json={**MUSIC_BODY, 'bytes': len(SOURCE)})
        assert response.status_code == 503
        assert client.get('/api/conversions').json()['jobs'] == []


def test_music_route_off_leaves_body_creation_working(tmp_path):
    with music_app(tmp_path, music_piano_conversion_provider='disabled',
                   music_guitar_conversion_provider='disabled') as (client, app, _settings, _store, _mail):
        job, _path = start_job(client, {'title': 'Move', 'filename': 'a.mp4', 'start': 0, 'duration': 2})
        assert job['pipeline_version'] == 'sam-3d-body-v1'


def test_piano_and_guitar_are_enabled_independently(tmp_path):
    with music_app(tmp_path, music_piano_conversion_provider='local',
                   music_guitar_conversion_provider='disabled') as (client, app, _settings, _store, _mail):
        piano = {'title': 'Piano', 'filename': 'a.mp4', 'start': 0, 'duration': 2, 'subject': 'piano'}
        guitar = {**piano, 'subject': 'guitar'}
        assert client.post('/api/conversions', json={**piano, 'bytes': len(SOURCE)}).status_code == 201
        assert client.post('/api/conversions', json={**guitar, 'bytes': len(SOURCE)}).status_code == 503
        limits = client.get('/api/conversions/limits').json()
        assert limits['capabilities'] == {'conversion': True, 'music_piano': True, 'music_guitar': False}


def test_a_body_worker_cannot_claim_a_music_job(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        start_job(client, {**MUSIC_BODY, 'bytes': len(SOURCE)})
        body_worker = music_worker(app, 'body-worker-token', pipeline_version='sam-3d-body-v1')
        assert client.post('/api/worker/claim', headers=body_worker, json={}).json() is None
        music_headers = music_worker(app, 'music-worker-token')
        claim = client.post('/api/worker/claim', headers=music_headers, json={}).json()
        assert claim and claim['pipeline_version'] == 'music-piano-v1'


def test_music_finish_uses_the_typed_music_contract(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        job, lease, base = claimed(client, app, MUSIC_BODY)
        manifest = manifest_for_clip()
        manifest['reference'] = upload_reference(client, base, lease)

        body_manifest = json.loads((ROOT / 'packages' / 'lesson-schema' / 'fixture.json').read_text(encoding='utf-8'))
        assert client.post(base + '/finish', headers=lease, json=body_manifest).status_code == 422

        finished = client.post(base + '/finish', headers=lease, json=manifest)
        assert finished.status_code == 200, finished.text
        lesson_id = finished.json()['lesson_id']
        assert client.post(base + '/finish', headers=lease, json=manifest).json() == finished.json()

        with Session(app.state.engine) as session:
            lesson = session.get(Lesson, lesson_id)
            assert (lesson.subject, lesson.experience_family, lesson.instrument) == ('piano', 'music', 'piano')
            revision = session.query(LessonRevision).filter(LessonRevision.lesson_id == lesson_id).one()
            assert revision.manifest['schema_version'] == 2
            assert revision.subject == 'piano' and revision.experience_family == 'music'

        detail = client.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'})
        assert detail.status_code == 200 and detail.json()['schema_version'] == 2
        assert client.get(f'/api/lessons/{lesson_id}').status_code == 406


def test_music_completion_is_bound_to_the_requested_subject(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        job, lease, base = claimed(client, app, MUSIC_BODY)
        reference = upload_reference(client, base, lease)

        guitar = manifest_for_clip(subject='guitar')
        guitar['reference'] = reference
        assert client.post(base + '/finish', headers=lease, json=guitar).status_code == 422

        longer = manifest_for_clip()
        longer['reference'] = reference
        longer['duration'] = 8
        longer['section_set']['duration'] = 8
        longer['section_set']['sections'] = [{'id': 'all', 'label': 'All', 'start': 0, 'end': 8}]
        assert client.post(base + '/finish', headers=lease, json=longer).status_code == 422

        good = manifest_for_clip()
        good['reference'] = reference
        assert client.post(base + '/finish', headers=lease, json=good).status_code == 200


def test_body_conversion_keeps_the_selected_subject(tmp_path):
    with music_app(tmp_path) as (client, app, _settings, _store, _mail):
        job, lease, base = claimed(client, app,
                                   {'title': 'Taekwondo lesson', 'filename': 'a.mp4', 'start': 0, 'duration': 2,
                                    'subject': 'taekwondo'},
                                   pipeline='sam-3d-body-v1', token='body-worker')
        manifest = json.loads((ROOT / 'packages' / 'lesson-schema' / 'fixture.json').read_text(encoding='utf-8'))
        manifest['engine'] = 'sam-3d-body'
        manifest['engine_version'] = ENGINE_VERSION
        manifest['section_set']['sections'] = [{'id': 'whole', 'label': 'Full movement', 'start': 0, 'end': 2}]
        for field, name, data in [('animation', 'reference.glb', (ROOT / 'packages' / 'lesson-schema' / 'synthetic.glb').read_bytes()),
                                  ('landmarks', 'reference.json', b'{}'),
                                  ('source_video', 'preview.mp4', b'preview'),
                                  ('thumbnail', 'thumbnail.jpg', b'image')]:
            result = client.put(base + '/files/' + name, headers=lease, content=data)
            assert result.status_code == 200, result.text
            manifest[field] = result.json()
        finished = client.post(base + '/finish', headers=lease, json=manifest)
        assert finished.status_code == 200, finished.text
        lesson_id = finished.json()['lesson_id']
        with Session(app.state.engine) as session:
            lesson = session.get(Lesson, lesson_id)
            assert (lesson.subject, lesson.experience_family, lesson.instrument) == ('taekwondo', 'body', None)
            revision = session.query(LessonRevision).filter(LessonRevision.lesson_id == lesson_id).one()
            assert revision.subject == 'taekwondo' and revision.experience_family == 'body'
        status = client.get(f'/api/workflow/lessons/{lesson_id}').json()
        assert status['subject_label'] == 'Taekwondo'
