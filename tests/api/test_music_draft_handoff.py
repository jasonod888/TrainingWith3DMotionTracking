"""Unreviewed draft handoff: stored separately, never a manifest, never publishable."""
import io
import json
import sys
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import Lesson, LessonRevision, MusicDraft
from apps.api.music_corrections import (VERIFIER_PATH, current_application_sha256,
                                       file_sha256, policy_sha256)
from apps.api.music_verification import proposal_sha256
from scripts.music_worker import MusicWorker
from support_multi import music_worker
from test_music_media_validation import media, real_media_app, upload


def claimed(client, app, base_url):
    headers = music_worker(app, 'draft-worker', pipeline_version='music-piano-v1')
    claim = client.post('/api/worker/claim', headers=headers, json={}).json()
    lease = {**headers, 'X-Job-Lease': claim['attempt_token']}
    base = f'/api/worker/jobs/{claim["id"]}'
    for stage in ('processing', 'exporting', 'verifying'):
        assert client.post(base + '/heartbeat', headers=lease, json={'stage': stage}).status_code == 200
    return claim, lease, base


def draft_payload(reference, sha, **changes):
    value = {
        'draft_version': 1,
        'subject': 'piano',
        'instrument': {'instrument': 'piano'},
        'duration': 2.0,
        'reference': reference,
        'events': [
            {'id': 'e1', 'onset': 0.5, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7},
            {'id': 'e2', 'onset': 1.0, 'duration': 0.4, 'pitch': 64, 'optional': True},
        ],
        'spans': [{'start': 0.2, 'end': 1.8}],
        'provenance': {
            'adapter': 'music-transcription', 'engine': 'fixture', 'model': None,
            'model_version': 'fixture-v1', 'code_version': 'music-transcription-v1',
            'audio_sha256': sha,
        },
        'warnings': ['Fixture transcription for tests.'],
    }
    value.update(changes)
    return value


def test_qualified_corrections_are_applied_before_the_owner_opens_the_draft(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        completed = upload(client, media(tmp_path, 'audio'))
        assert completed.json()['state'] == 'queued'
        claim, lease, base = claimed(client, app, 'http://localhost')
        reference = client.put(base + '/files/reference.json', headers=lease,
                               content=b'{"draft":1,"events":[]}').json()
        events = [
            {'id': 'e1', 'onset': 0.7, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7},
            {'id': 'e2', 'onset': 1.0, 'duration': 0.4, 'pitch': 64, 'optional': True},
        ]
        finding = {'id': 'vf-1', 'kind': 'onset_shift', 'status': 'suggested',
                   'correction_status': 'qualified', 'time_range': [0.5, 0.9],
                   'event_ids': ['e1'], 'pitch': 60, 'explanation': 'Timing.',
                   'evidence': {}, 'alternatives': [], 'ambiguous': False,
                   'ambiguity_reasons': [],
                   'proposed_edits': [{'op': 'set_onset', 'event_ids': ['e1'],
                                       'before': {'onset': 0.7}, 'after': {'onset': 0.5},
                                       'reason': 'Attack evidence.'}]}
        implementation = {'verifier_code_sha256': file_sha256(VERIFIER_PATH),
                          'settings_sha256': 'a' * 64, 'weights_sha256': 'b' * 64,
                          'model': 'basic-pitch', 'model_version': '0.4.0',
                          'decoder': 'basic-pitch-0.4.0/piano-peaks-v1',
                          'decoder_sha256': 'd' * 64,
                          'application_code_sha256': current_application_sha256()}
        report = {'schema_version': 1, 'verifier_version': 'piano-verifier-1',
                  'mode': 'qualified', 'status': 'complete',
                  'source': {'audio_sha256': claim['sha256'], 'duration': 2.0,
                             'proposal_sha256': proposal_sha256(events),
                             'verifier_code_sha256': implementation['verifier_code_sha256'],
                             'model': implementation['model'],
                             'model_version': implementation['model_version'],
                             'decoder': implementation['decoder'],
                             'decoder_sha256': implementation['decoder_sha256'],
                             'weights_sha256': implementation['weights_sha256']},
                  'settings_sha256': implementation['settings_sha256'],
                  'findings': [finding], 'edits': finding['proposed_edits'],
                  'correction_policy': {'mode': 'qualified', 'policy_version': 'piano-corrections-1',
                                        'policy': {'policy_version': 'piano-corrections-1',
                                                   'status': 'qualified',
                                                   'implementation': implementation,
                                                   'categories': {'onset_shift': {'enabled': True}}},
                                        'policy_sha256': policy_sha256({
                                            'policy_version': 'piano-corrections-1',
                                            'status': 'qualified',
                                            'implementation': implementation,
                                            'categories': {'onset_shift': {'enabled': True}}}),
                                        'enabled_categories': ['onset_shift'], 'withheld_count': 0},
                  'summary': {'finding_count': 1, 'suggested_count': 1}}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('verification.json', json.dumps(report))
        analysis = client.put(base + '/files/analysis.zip', headers=lease,
                              content=buffer.getvalue()).json()
        response = client.post(base + '/draft', headers=lease,
                               json=draft_payload(reference, claim['sha256'], events=events,
                                                  analysis=analysis))
        assert response.status_code == 200, response.text
        with Session(app.state.engine) as session:
            draft = session.query(MusicDraft).one()
            assert draft.document['events'][0]['onset'] == 0.7
            assert draft.working_document['events'][0]['onset'] == 0.5
            assert draft.correction_history[0]['finding_id'] == 'vf-1'
            assert any(item.get('source') == 'automatic' for item in draft.correction_history)
        view = client.get(f"/api/lessons/{response.json()['lesson_id']}/music-draft").json()
        assert view['working_corrected'] is True
        assert view['events'][0]['onset'] == 0.5
        assert view['baseline_events'][0]['onset'] == 0.7


def test_draft_handoff_is_stored_apart_and_never_publishable(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        completed = upload(client, media(tmp_path, 'audio'))
        assert completed.json()['state'] == 'queued'
        claim, lease, base = claimed(client, app, 'http://localhost')
        reference = client.put(base + '/files/reference.json', headers=lease,
                               content=b'{"draft":1,"events":[]}').json()

        wrong = client.post(base + '/draft', headers=lease,
                            json=draft_payload(reference, claim['sha256'], subject='guitar',
                                               instrument={'instrument': 'guitar'}))
        assert wrong.status_code == 422

        response = client.post(base + '/draft', headers=lease,
                               json=draft_payload(reference, claim['sha256']))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['draft'] is True and body['lesson_id'] == claim['id']

        with Session(app.state.engine) as session:
            draft = session.query(MusicDraft).one()
            assert draft.status == 'draft' and draft.job_id == claim['id']
            assert draft.document['events'][0]['pitch'] == 60
            assert session.query(Lesson).filter(Lesson.id == body['lesson_id']).count() == 1
            assert session.query(LessonRevision).filter(LessonRevision.lesson_id == body['lesson_id']).count() == 0

        # A draft is not a readable lesson, never public, and cannot be shared.
        assert client.get(f"/api/lessons/{body['lesson_id']}").status_code == 409
        assert client.get(f"/api/public/moves/{body['lesson_id']}").status_code == 404
        assert client.post(f"/api/lessons/{body['lesson_id']}/publish",
                           json={'revision_id': 'none', 'mode': 'invite',
                                 'reviewed': True, 'rights_acknowledged': True}).status_code == 409

        # The owner can read the proposal, including its review metadata.
        proposal = client.get(f"/api/lessons/{body['lesson_id']}/music-draft")
        assert proposal.status_code == 200, proposal.text
        assert proposal.json()['status'] == 'draft'
        assert len(proposal.json()['events']) == 2
        assert proposal.json()['reference']['key'].startswith(f"lessons/{body['lesson_id']}/")

        from test_accounts import login, register
        with TestClient(app) as other:
            other.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
            register(other, mail, 'draft-recipient@example.test')
            login(other, 'draft-recipient@example.test')
            assert other.get(f"/api/lessons/{body['lesson_id']}/music-draft").status_code == 404


def draft_adapter(directory: Path) -> list[str]:
    script = directory / 'draft_adapter.py'
    script.write_text('''import argparse, hashlib, json
from pathlib import Path
p = argparse.ArgumentParser()
for name in ('input', 'source', 'job', 'output'):
    p.add_argument('--' + name)
a = p.parse_args()
job = json.loads(Path(a.job).read_text())
out = Path(a.output)
(out / 'reference.json').write_text('{"draft":1}')
draft = {
    'draft_version': 1,
    'subject': job['subject'],
    'instrument': {'instrument': job['instrument']},
    'duration': job['duration'],
    'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64},
    'events': [{'id': 'w1', 'onset': 0.5, 'pitch': 60}],
    'spans': [{'start': 0.2, 'end': max(0.25, job['duration'])}],
    'provenance': {'adapter': 'music-transcription', 'engine': 'fixture', 'model': None,
                   'model_version': 'fixture-v1', 'code_version': 'music-transcription-v1',
                   'audio_sha256': hashlib.sha256(Path(a.input).read_bytes()).hexdigest()},
    'warnings': [],
}
(out / 'result.json').write_text(json.dumps({'draft': draft, 'files': {'reference': 'reference.json'}}))
''', encoding='utf-8')
    return [sys.executable, str(script)]


def test_worker_hands_off_an_unreviewed_draft(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        upload(client, media(tmp_path, 'audio'))
        music_worker(app, 'isolated-draft-worker', pipeline_version='music-piano-v1')
        worker = MusicWorker('http://localhost', 'isolated-draft-worker', 'music-piano-v1',
                             draft_adapter(tmp_path), tmp_path / 'attempts', api=client,
                             heartbeat_seconds=.2, fixture=True)
        job = worker.claim()
        result = worker.run(job)
        assert result['draft'] is True and result['lesson_id'] == job['id']
        with Session(app.state.engine) as session:
            assert session.query(MusicDraft).count() == 1
            assert session.query(LessonRevision).count() == 0
        assert not any(key.startswith(('uploads/', 'attempts/')) for key in store.objects)
