"""Exact run-profile verification and profile provenance on a worker draft."""
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from apps.api.database import MusicDraft
from scripts.music_run_profile import load_profile
from scripts.music_worker import MusicWorker
from support_multi import music_worker
from test_music_draft_handoff import draft_adapter
from test_music_media_validation import media, real_media_app, upload


def files(tmp_path):
    paths = {name: tmp_path / name for name in ('weights.bin', 'code.lock', 'config.json', 'approval.json')}
    paths['weights.bin'].write_bytes(b'weights')
    paths['code.lock'].write_bytes(b'code')
    configuration = {'sample_rate': 22050, 'preprocessing': 'mono-pcm-s16le', 'thresholds': {'onset': 0.5}}
    paths['config.json'].write_text(json.dumps(configuration), encoding='utf-8')
    paths['approval.json'].write_bytes(b'approval')
    profile = {'schema_version': 1, 'model': 'fixture-model', 'model_version': '1.0.0',
               'weights_sha256': hashlib.sha256(b'weights').hexdigest(),
               'code_sha256': hashlib.sha256(b'code').hexdigest(),
               'config_sha256': hashlib.sha256(paths['config.json'].read_bytes()).hexdigest(),
               'commercial_evidence_sha256': hashlib.sha256(b'approval').hexdigest(),
               'sample_rate': 22050, 'preprocessing': 'mono-pcm-s16le', 'thresholds': {'onset': 0.5}}
    (tmp_path / 'profile.json').write_text(json.dumps(profile))
    return paths, tmp_path / 'profile.json', profile


def load(paths, profile_path):
    return load_profile(profile_path, weights=paths['weights.bin'], code=paths['code.lock'],
                        config=paths['config.json'], approval=paths['approval.json'])


def test_profile_binds_installed_bytes_and_is_deterministic(tmp_path):
    paths, profile_path, _ = files(tmp_path)
    first = load(paths, profile_path)
    second = load(paths, profile_path)
    assert first['profile_sha256'] == second['profile_sha256']
    assert len(first['profile_sha256']) == 64
    paths['weights.bin'].write_bytes(b'tampered')
    with pytest.raises(ValueError, match='weights bytes'):
        load(paths, profile_path)


def test_profile_refuses_missing_or_unknown_fields_and_bad_thresholds(tmp_path):
    paths, profile_path, profile = files(tmp_path)
    broken = {key: value for key, value in profile.items() if key != 'code_sha256'}
    profile_path.write_text(json.dumps(broken))
    with pytest.raises(ValueError, match='missing'):
        load(paths, profile_path)
    profile_path.write_text(json.dumps({**profile, 'extra': True}))
    with pytest.raises(ValueError, match='unknown fields'):
        load(paths, profile_path)
    profile_path.write_text(json.dumps({**profile, 'thresholds': {'onset': 'high'}}))
    with pytest.raises(ValueError, match='numeric'):
        load(paths, profile_path)
    profile_path.write_text(json.dumps({**profile, 'sample_rate': 10}))
    with pytest.raises(ValueError, match='Sample rate'):
        load(paths, profile_path)


def test_worker_requires_a_profile_or_explicit_fixture(tmp_path):
    with pytest.raises(ValueError, match='exact run profile'):
        MusicWorker('http://localhost', 'token', 'music-piano-v1', ['python', 'adapter.py'], tmp_path)
    with pytest.raises(ValueError, match='either'):
        MusicWorker('http://localhost', 'token', 'music-piano-v1', ['python', 'adapter.py'], tmp_path,
                    fixture=True, profile={'profile_sha256': 'a' * 64})
    MusicWorker('http://localhost', 'token', 'music-piano-v1', ['python', 'adapter.py'], tmp_path, fixture=True)


def test_profiled_worker_does_not_relabel_fixture_output_as_model_inference(tmp_path):
    paths, profile_path, _ = files(tmp_path)
    adapter = draft_adapter(tmp_path)
    paths['code.lock'] = Path(adapter[1])
    data = json.loads(profile_path.read_text())
    data['code_sha256'] = hashlib.sha256(paths['code.lock'].read_bytes()).hexdigest()
    profile_path.write_text(json.dumps(data))
    profile = load(paths, profile_path)
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        upload(client, media(tmp_path, 'audio'))
        music_worker(app, 'profiled-worker', pipeline_version='music-piano-v1')
        worker = MusicWorker('http://localhost', 'profiled-worker', 'music-piano-v1',
                             adapter, tmp_path / 'attempts', api=client,
                             heartbeat_seconds=.2, profile=profile)
        job = worker.claim()
        with pytest.raises(ValueError, match='did not confirm'):
            worker.run(job)
        with Session(app.state.engine) as session:
            assert session.query(MusicDraft).count() == 0


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')])
def test_profile_refuses_nonfinite_thresholds(tmp_path, value):
    paths, profile_path, profile = files(tmp_path)
    profile['thresholds']['onset'] = value
    profile_path.write_text(json.dumps(profile))
    with pytest.raises(ValueError, match='Non-finite'):
        load(paths, profile_path)


def test_profile_configuration_and_actual_entry_point_are_bound(tmp_path):
    paths, profile_path, profile = files(tmp_path)
    config = json.loads(paths['config.json'].read_text())
    config['sample_rate'] = 16000
    paths['config.json'].write_text(json.dumps(config))
    profile['config_sha256'] = hashlib.sha256(paths['config.json'].read_bytes()).hexdigest()
    profile_path.write_text(json.dumps(profile))
    with pytest.raises(ValueError, match='configuration must match'):
        load(paths, profile_path)
    paths, profile_path, profile = files(tmp_path)
    verified = load(paths, profile_path)
    with pytest.raises(ValueError, match='executed adapter'):
        MusicWorker('http://localhost', 'token', 'music-piano-v1', ['python', 'unrelated.py'], tmp_path, profile=verified)
    paths['weights.bin'].write_bytes(b'changed after startup')
    with pytest.raises(ValueError, match='changed after verification'):
        verified.reverify()


def test_profiled_worker_uses_declared_audio_rate_and_requires_adapter_receipt(tmp_path):
    import sys
    code = tmp_path / 'profile_adapter.py'
    code.write_text("""import os,json,hashlib,wave
from pathlib import Path
import argparse
p=argparse.ArgumentParser()
for name in ('input','source','job','output'): p.add_argument('--'+name)
a=p.parse_args();job=json.loads(Path(a.job).read_text());profile=json.loads(os.environ['MUSIC_RUN_PROFILE'])
with wave.open(a.input) as audio: assert audio.getframerate()==16000 and audio.getnchannels()==1
assert hashlib.sha256(Path(os.environ['MUSIC_MODEL_WEIGHTS']).read_bytes()).hexdigest()==profile['weights_sha256']
draft={'draft_version':1,'subject':'piano','instrument':{'instrument':'piano'},'duration':job['duration'],
'reference':{'key':'reference.json','mime':'application/json','bytes':0,'sha256':'0'*64},'events':[],'spans':[],
'provenance':{'adapter':'test-receipt','engine':'test-stub','model':profile['model'],'model_version':profile['model_version'],
'profile_sha256':profile['profile_sha256'],'code_version':'test','audio_sha256':hashlib.sha256(Path(a.input).read_bytes()).hexdigest()}}
out=Path(a.output);(out/'reference.json').write_text(json.dumps(draft));(out/'result.json').write_text(json.dumps({'draft':draft,'files':{'reference':'reference.json'}}))
""", encoding='utf-8')
    paths, profile_path, profile = files(tmp_path)
    paths['code.lock'] = code
    profile['code_sha256'] = hashlib.sha256(code.read_bytes()).hexdigest()
    profile['sample_rate'] = 16000
    config = {key:profile[key] for key in ('sample_rate','preprocessing','thresholds')}
    paths['config.json'].write_text(json.dumps(config))
    profile['config_sha256'] = hashlib.sha256(paths['config.json'].read_bytes()).hexdigest()
    profile_path.write_text(json.dumps(profile))
    verified = load(paths, profile_path)
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        settings.music_require_run_profile = True
        settings.music_allowed_run_profiles = verified['profile_sha256']
        upload(client, media(tmp_path, 'audio'))
        music_worker(app, 'receipt-worker', pipeline_version='music-piano-v1')
        worker = MusicWorker('http://localhost', 'receipt-worker', 'music-piano-v1',
                             [sys.executable, str(code)], tmp_path/'jobs', api=client,
                             heartbeat_seconds=.2, profile=verified)
        assert worker.run(worker.claim())['draft'] is True
        with Session(app.state.engine) as session:
            assert session.query(MusicDraft).one().document['provenance']['profile_sha256'] == verified['profile_sha256']


def test_server_profile_gate_refuses_unknown_hashes_and_fixture_engine(tmp_path):
    from test_music_draft_handoff import claimed, draft_payload
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        settings.music_require_run_profile = True
        settings.music_allowed_run_profiles = 'a'*64
        upload(client, media(tmp_path, 'audio'))
        job, lease, base = claimed(client, app, 'http://localhost')
        direct = client.post(base+'/finish', headers=lease, json={})
        assert direct.status_code == 422 and 'unreviewed draft' in direct.json()['detail']
        reference = client.put(base+'/files/reference.json', headers=lease, content=b'{}').json()
        body = draft_payload(reference, job['sha256'])
        for digest, engine in ((None,'basic-pitch'), ('b'*64,'basic-pitch'), ('a'*64,'fixture')):
            body['provenance'].update(profile_sha256=digest, engine=engine)
            response = client.post(base+'/draft', headers=lease, json=body)
            assert response.status_code == 422, response.text
        settings.music_allowed_run_profiles = ''
        body['provenance'].update(profile_sha256='a'*64,engine='basic-pitch')
        assert client.post(base+'/draft', headers=lease,json=body).status_code == 422


def test_verified_profile_cannot_silently_change_settings(tmp_path):
    paths, profile_path, profile = files(tmp_path)
    verified = load(paths, profile_path)
    verified['sample_rate'] = 16000
    with pytest.raises(ValueError, match='settings changed'):
        verified.reverify()
