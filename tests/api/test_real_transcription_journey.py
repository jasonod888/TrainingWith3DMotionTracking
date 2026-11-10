"""The Basic Pitch draft travels through review, private release and learner fetch."""
import json
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from support_multi import music_worker
from test_accounts import login, register
from test_music_draft_handoff import claimed, draft_payload
from test_music_media_validation import real_media_app

DRAFT = Path(__file__).resolve().parents[2] / 'docs/qualification/basic-pitch-draft-2026-11-10.json'


def long_media(directory: Path) -> Path:
    target = directory / 'twelve-seconds.mp4'
    subprocess.run(['ffmpeg', '-v', 'error',
                    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=15:d=12',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
                    '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', str(target)], check=True)
    return target


def test_real_basic_pitch_draft_reaches_a_learner(tmp_path):
    source = long_media(tmp_path)
    draft = json.loads(DRAFT.read_text(encoding='utf-8'))
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        data = source.read_bytes()
        created = client.post('/api/conversions', json={'title': 'Bach excerpt', 'filename': source.name,
            'bytes': len(data), 'start': 0, 'duration': 12, 'subject': 'piano', 'instrument': 'piano'})
        assert created.status_code == 201, created.text
        job = created.json()
        assert client.put(f"/api/conversions/{job['id']}/parts/1", content=data,
                          headers={'Content-Type': 'application/octet-stream'}).status_code == 200
        assert client.post(f"/api/conversions/{job['id']}/complete", json={}).status_code == 200
        claim, lease, base = claimed(client, app, 'basic-pitch-worker')
        reference = client.put(base + '/files/reference.json', headers=lease, content=b'{"proposal":true}').json()
        payload = draft_payload(reference, draft['provenance']['audio_sha256'], duration=12.0,
                                events=draft['events'], spans=[{'start': 0, 'end': 12, 'kind': 'playing'}],
                                provenance=draft['provenance'],
                                warnings=['Basic Pitch proposal; every note requires instructor review.'])
        handoff = client.post(base + '/draft', headers=lease, json=payload)
        assert handoff.status_code == 200, handoff.text
        lesson_id = handoff.json()['lesson_id']
        view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        assert view['duration'] == 12 and len(view['events']) == len(draft['events'])
        body = {'draft_id': view['draft_id'], 'reference_sha256': view['reference']['sha256'],
                'title': 'Bach excerpt', 'events': view['events'],
                'spans': [{'start': 0, 'end': 12, 'kind': 'playing'}],
                'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 12}],
                'assessment': {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                               'rubric_version': 'music-watch-v1'}, 'confirm_reviewed': True}
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        manifest = reviewed.json()
        assert len(json.loads(store.objects[manifest['reference']['key']])['events']) == len(draft['events'])
        shared = client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': manifest['revision_id'], 'mode': 'invite', 'reviewed': True,
            'rights_acknowledged': True})
        assert shared.status_code == 200, shared.text
        invited = client.post(f'/api/lessons/{lesson_id}/invitations',
                              json={'email': 'learner@example.test'})
        assert invited.status_code == 201, invited.text
        token = next(token for email, purpose, token in mail
                     if email == 'learner@example.test' and purpose == 'invite')
        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1',
                                    'X-Lesson-Formats': '1,2'})
            register(learner, mail, 'learner@example.test')
            login(learner, 'learner@example.test')
            inspected = learner.post('/api/shares/inspect', json={'invite': token})
            assert inspected.status_code == 200, inspected.text
            accepted = learner.post('/api/shares/accept', json={'invite': token})
            assert accepted.status_code == 200, accepted.text
            opened = learner.get(f'/api/lessons/{lesson_id}')
            assert opened.status_code == 200, opened.text
            assert opened.json()['title'] == 'Bach excerpt'
            reference = learner.get(f"/api/lessons/{lesson_id}/assets/{manifest['reference']['key'].split('/')[-1]}")
            assert reference.status_code == 200
            events = json.loads(reference.content)['events']
            assert len(events) == len(draft['events'])
            assert events[0]['pitch'] == draft['events'][0]['pitch']
            assert learner.get(f"/api/lessons/{lesson_id}/assets/{manifest['source_video']['key'].split('/')[-1]}").status_code == 200
