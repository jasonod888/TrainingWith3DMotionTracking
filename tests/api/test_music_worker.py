"""Real transport/extraction with an explicitly reviewed synthetic adapter, not transcription."""
import json
import subprocess
import sys
from datetime import timedelta
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy.orm import Session

from apps.api.auth import now
from apps.api.database import Conversion, Lesson
from scripts.music_worker import MusicWorker, LeaseLost
from scripts.cleanup_saas_conversions import cleanup
from support_multi import music_worker
from test_music_media_validation import media, upload, real_media_app
from test_music_conversions import claimed, MUSIC_BODY, music_app, manifest_for_clip, upload_reference


def adapter(directory, *, slow=False, reviewed=True):
    file = directory/'fixture_adapter.py'
    file.write_text('''import argparse,json,shutil,time
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('input','source','job','output'):p.add_argument('--'+name)
a=p.parse_args();out=Path(a.output);job=json.loads(Path(a.job).read_text())
'''+('time.sleep(60)\n' if slow else '')+'''
(out/'reference.json').write_text('{"schema":1,"events":[]}')
shutil.copyfile(a.source,out/'source.mp4')
manifest=dict(schema_version=2,experience_family='music',lesson_id=job['id'],revision_id='fixture',
title='Reviewed fixture',subject=job['subject'],duration=job['duration'],instrument={'instrument':job['instrument']},
section_set=dict(id='sections',revision=1,duration=job['duration'],sections=[dict(id='all',label='Whole clip',start=0,end=job['duration'])]),
reference_reviewed='''+repr(reviewed)+''',assessment=dict(rubric_version='piano-midi-v1',assessment='notes',input_modes=['midi','microphone'],dimensions=['pitch','timing']),warnings=[])
(out/'result.json').write_text(json.dumps(dict(manifest=manifest,files={'reference':'reference.json','source_video':'source.mp4'})))
''', encoding='utf-8')
    return [sys.executable, str(file)]


def worker_for(client, app, directory, command, api=None, subject='piano'):
    pipeline = 'music-'+subject+'-v1'
    music_worker(app, 'isolated-music-worker', pipeline_version=pipeline)
    return MusicWorker('http://localhost', 'isolated-music-worker', pipeline, command,
                       directory/'attempts', api=api or client, heartbeat_seconds=.2, fixture=True)


@pytest.mark.parametrize('subject', ['piano', 'guitar'])
def test_worker_extracts_completes_and_cleans_private_attempt_after_lost_finish_response(tmp_path, subject):
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        response = upload(client, media(tmp_path, 'audio'), subject=subject)
        assert response.json()['state'] == 'queued'
        class UncertainFinish:
            lost = False
            calls = 0
            def __getattr__(self, name): return getattr(client, name)
            def post(self, url, **kwargs):
                result = client.post(url, **kwargs)
                if url.endswith('/finish'):
                    self.calls += 1
                    if not self.lost:
                        self.lost = True
                        raise httpx.ReadTimeout('Simulated lost finish response')
                return result
        api = UncertainFinish()
        worker = worker_for(client, app, tmp_path, adapter(tmp_path), api, subject)
        job = worker.claim()
        result = worker.run(job)
        assert result['lesson_id'] == job['id'] and api.calls == 2
        assert not list(worker.work_dir.iterdir())
        assert not any(key.startswith(('uploads/', 'attempts/')) for key in store.objects)
        with Session(app.state.engine) as session:
            assert session.get(Conversion, job['id']).state == 'ready_for_review'
            assert session.query(Lesson).count() == 1


def test_running_adapter_stops_on_owner_cancellation_without_publishing(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        upload(client, media(tmp_path, 'audio'))
        class CancelDuringProcessing:
            processing = 0
            finish = False
            def __getattr__(self, name): return getattr(client, name)
            def post(self, url, **kwargs):
                response = client.post(url, **kwargs)
                if url.endswith('/finish'): self.finish = True
                if url.endswith('/heartbeat') and kwargs['json']['stage'] == 'processing':
                    self.processing += 1
                    if self.processing == 2:
                        job_id = url.split('/')[-2]
                        assert client.post('/api/conversions/'+job_id+'/cancel', json={}).status_code == 200
                return response
        api = CancelDuringProcessing()
        worker = worker_for(client, app, tmp_path, adapter(tmp_path, slow=True), api)
        job = worker.claim()
        native_popen = subprocess.Popen
        with patch('scripts.music_worker.subprocess.Popen', wraps=native_popen) as processes:
            with pytest.raises(LeaseLost): worker.run(job)
        assert processes.call_count >= 2  # ffmpeg and the running adapter
        assert not api.finish and not list(worker.work_dir.iterdir())
        with Session(app.state.engine) as session:
            assert session.get(Conversion, job['id']).state == 'cancelled'
            assert session.query(Lesson).count() == 0


def test_worker_does_not_turn_a_draft_into_a_reviewed_reference(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        upload(client, media(tmp_path, 'audio'))
        worker = worker_for(client, app, tmp_path, adapter(tmp_path, reviewed=False))
        job = worker.claim()
        with pytest.raises(RuntimeError, match='requires review'): worker.run(job)
        assert not list(worker.work_dir.iterdir())
        with Session(app.state.engine) as session:
            assert session.query(Lesson).count() == 0


def test_music_attempt_cannot_upload_body_assets_or_reuse_an_expired_token(tmp_path):
    with music_app(tmp_path) as (client, app, settings, store, _mail):
        job, lease, base = claimed(client, app, MUSIC_BODY)
        assert client.put(base+'/files/reference.glb', headers=lease, content=b'body').status_code == 422
        manifest = manifest_for_clip()
        manifest['reference'] = upload_reference(client, base, lease)
        with Session(app.state.engine) as session:
            session.get(Conversion, job['id']).lease_until = now()-timedelta(seconds=1)
            session.commit()
        assert client.post(base+'/finish', headers=lease, json=manifest).status_code == 409
        renewed = client.post('/api/worker/claim', headers=lease, json={}).json()
        assert renewed['attempt_token'] != lease['X-Job-Lease']
        assert client.put(base+'/files/reference.json', headers=lease, content=b'late').status_code == 409
        assert client.post(base+'/finish', headers=lease, json=manifest).status_code == 409
        assert not any(key.startswith('lessons/') for key in store.objects)


def test_cancelled_staged_music_outputs_are_removed_by_retention_cleanup(tmp_path):
    with music_app(tmp_path) as (client, app, settings, store, _mail):
        job, lease, base = claimed(client, app, MUSIC_BODY)
        asset = upload_reference(client, base, lease)
        assert asset['key'] in store.objects
        assert client.post('/api/conversions/'+job['id']+'/cancel', json={}).status_code == 200
        assert client.post(base+'/finish', headers=lease, json=manifest_for_clip()).status_code == 409
        class Pages:
            def paginate(self, Bucket, Prefix):
                yield {'Contents':[{'Key':key} for key in store.objects if key.startswith(Prefix)]}
        with patch('scripts.cleanup_saas_conversions.storage_client',return_value=store), \
             patch.object(store,'get_paginator',return_value=Pages(),create=True):
            assert cleanup(app.state.engine,settings,apply=True) == 1
        assert not any(key.startswith(('uploads/','attempts/','lessons/')) for key in store.objects)
