"""The transcription adapter emits an unreviewed draft and never fakes a model."""
import hashlib
import importlib.util
import json
import subprocess
import sys
from types import SimpleNamespace, ModuleType
from unittest.mock import patch
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def run_adapter(tmp_path, engine='fixture', job=None):
    source = tmp_path / 'clip.bin'
    source.write_bytes(b'not-media')
    audio = tmp_path / 'analysis.wav'
    audio.write_bytes(b'RIFF' + b'\0' * 64)
    job_path = tmp_path / 'job.json'
    job_path.write_text(json.dumps(job or {
        'id': 'a' * 32, 'subject': 'piano', 'instrument': 'piano', 'duration': 2.0,
        'pipeline_version': 'music-piano-v1'}), encoding='utf-8')
    output = tmp_path / 'out'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/music_transcription.py'),
                             '--engine', engine, '--input', str(audio), '--source', str(source),
                             '--job', str(job_path), '--output', str(output)],
                            capture_output=True, text=True, cwd=ROOT)
    return result, output


def test_fixture_adapter_returns_a_bounded_unreviewed_draft(tmp_path):
    result, output = run_adapter(tmp_path)
    assert result.returncode == 0, result.stderr
    payload = json.loads((output / 'result.json').read_text(encoding='utf-8'))
    draft = payload['draft']
    assert draft['draft_version'] == 1 and draft['subject'] == 'piano'
    assert 'reference_reviewed' not in draft
    assert 'manifest' not in payload
    assert 1 <= len(draft['events']) <= 20000
    assert all(0 <= event['onset'] <= draft['duration'] for event in draft['events'])
    assert draft['provenance']['engine'] == 'fixture'
    assert draft['provenance']['audio_sha256'] == hashlib.sha256((tmp_path / 'analysis.wav').read_bytes()).hexdigest()
    assert payload['files'] == {'reference': 'reference.json'}
    assert (output / 'reference.json').read_text(encoding='utf-8').startswith('{')


def test_basic_pitch_is_never_silently_substituted(tmp_path):
    if importlib.util.find_spec('basic_pitch') is not None:
        pytest.skip('basic-pitch is installed in this environment')
    result, _ = run_adapter(tmp_path, 'basic-pitch')
    assert result.returncode != 0
    assert 'not installed' in result.stderr


def test_adapter_refuses_an_incomplete_job(tmp_path):
    result, _ = run_adapter(tmp_path, job={'id': 'a', 'subject': 'piano', 'duration': 2.0})
    assert result.returncode == 2
    assert 'instrument' in result.stderr


def test_fractional_short_fixture_events_stay_inside_the_clip(tmp_path):
    from scripts.music_transcription import fixture_document
    audio=tmp_path/'analysis.wav';audio.write_bytes(b'fixture')
    document=fixture_document({'duration':.2008,'subject':'piano','instrument':'piano'},audio)
    assert all(event['onset']+(event['duration'] or 0)<=document['duration']+1e-6 for event in document['events'])


def test_optional_engine_handles_empty_and_out_of_bounds_notes_without_installing_a_model(tmp_path):
    from scripts.music_transcription import basic_pitch_document
    audio=tmp_path/'analysis.wav';audio.write_bytes(b'fixture')
    job={'duration':2,'subject':'piano','instrument':'piano'}
    package=ModuleType('basic_pitch');package.ICASSP_2022_MODEL_PATH='fixture-only'
    inference=ModuleType('basic_pitch.inference')
    midi=SimpleNamespace(instruments=[])
    inference.predict=lambda *args,**kwargs:(None,midi,[])
    with patch.dict(sys.modules,{'basic_pitch':package,'basic_pitch.inference':inference}), \
         patch('importlib.metadata.version',return_value='test-stub'):
        assert basic_pitch_document(job,audio)['events']==[]
        midi.instruments=[SimpleNamespace(notes=[SimpleNamespace(start=-1,end=3,pitch=60,velocity=100),
                                                 SimpleNamespace(start=3,end=4,pitch=62,velocity=100)])]
        events=basic_pitch_document(job,audio)['events']
        assert len(events)==1 and events[0]['onset']==0 and events[0]['duration']==2
