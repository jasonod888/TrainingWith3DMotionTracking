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
    paths['config.json'].write_bytes(b'config')
    paths['approval.json'].write_bytes(b'approval')
    profile = {'schema_version': 1, 'model': 'fixture-model', 'model_version': '1.0.0',
               'weights_sha256': hashlib.sha256(b'weights').hexdigest(),
               'code_sha256': hashlib.sha256(b'code').hexdigest(),
               'config_sha256': hashlib.sha256(b'config').hexdigest(),
               'commercial_evidence_sha256': hashlib.sha256(b'approval').hexdigest(),
               'sample_rate': 22050, 'preprocessing': 'mono 22.05 kHz', 'thresholds': {'onset': 0.5}}
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


def test_a_profiled_worker_records_profile_identity_on_the_draft(tmp_path):
    paths, profile_path, _ = files(tmp_path)
    profile = load(paths, profile_path)
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        upload(client, media(tmp_path, 'audio'))
        music_worker(app, 'profiled-worker', pipeline_version='music-piano-v1')
        worker = MusicWorker('http://localhost', 'profiled-worker', 'music-piano-v1',
                             draft_adapter(tmp_path), tmp_path / 'attempts', api=client,
                             heartbeat_seconds=.2, profile=profile)
        job = worker.claim()
        result = worker.run(job)
        assert result['draft'] is True
        with Session(app.state.engine) as session:
            provenance = session.query(MusicDraft).one().document['provenance']
            assert provenance['profile_sha256'] == profile['profile_sha256']
            assert provenance['model'] == 'fixture-model'
