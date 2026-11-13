"""Kong run profile and raw adapter/draft bridge."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from unittest.mock import patch

from apps.api.contracts import MusicDraftDocument
from scripts import music_kong_adapter as kong
from scripts import music_run_profile as profiles


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

@pytest.fixture(autouse=True)
def runtime_identity():
    with patch.object(profiles,'kong_runtime_versions',return_value={'torch':'test'}):
        yield


def profile_files(tmp_path):
    weights = tmp_path / 'piano.pth'
    code = tmp_path / 'adapter.py'
    config = tmp_path / 'config.json'
    approval = tmp_path / 'LICENSE'
    package = tmp_path / 'package'
    package.mkdir()
    (package/'piano_transcription_inference').mkdir()
    (package/'piano_transcription_inference'/'__init__.py').write_text('# package')
    info=package/'piano_transcription_inference-0.0.6.dist-info'
    info.mkdir()
    (info/'METADATA').write_text('Version: 0.0.6\n')
    weights.write_bytes(b'weights')
    code.write_bytes(b'code')
    config.write_bytes(b'{"onset_threshold":0.3}')
    approval.write_bytes(b'license')
    profile = {'schema_version': 1, 'model': 'kong', 'model_version': '0.0.6',
               'weights_sha256': digest(weights.read_bytes()),
               'code_sha256': digest(code.read_bytes()),
               'config_sha256': digest(config.read_bytes()),
               'commercial_evidence_sha256': digest(approval.read_bytes()),
               'sample_rate': 16000, 'preprocessing': 'mono-pcm-s16le',
               'package_path': str(package), 'package_version': '0.0.6',
               'device': 'cpu', 'config': {'onset_threshold': 0.3},
               'package_sha256':profiles.tree_sha256(package),
               'implementation_sha256':profiles.kong_implementation_sha256(),
               'runtime_versions':{'torch':'test'}}
    path = tmp_path / 'profile.json'
    path.write_text(json.dumps(profile), encoding='utf-8')
    return path, weights, code, config, approval


def test_kong_profile_verifies_and_freezes_identity(tmp_path):
    path, weights, code, config, approval = profile_files(tmp_path)
    loaded = profiles.load_kong_profile(path, weights=weights, code=code,
                                        config=config, approval=approval)
    assert loaded['model'] == 'kong'
    assert len(loaded['profile_sha256']) == 64
    assert loaded.paths['weights'] == weights
    loaded.reverify()

def test_kong_package_mutation_invalidates_loaded_profile(tmp_path):
    path,weights,code,config,approval=profile_files(tmp_path)
    loaded=profiles.load_kong_profile(path,weights=weights,code=code,config=config,approval=approval)
    (Path(loaded['package_path'])/'piano_transcription_inference'/'__init__.py').write_text('# changed')
    with pytest.raises(ValueError,match='package bytes'):
        loaded.reverify()

def test_kong_config_disagreement_and_unknown_parameters_are_rejected(tmp_path):
    path,weights,code,config,approval=profile_files(tmp_path)
    data=json.loads(path.read_text());data['config']={'onset_threshold':.99};path.write_text(json.dumps(data))
    with pytest.raises(ValueError,match='match the profile'):
        profiles.load_kong_profile(path,weights=weights,code=code,config=config,approval=approval)
    data['config']={'unknown':.3};path.write_text(json.dumps(data));config.write_text(json.dumps(data['config']))
    with pytest.raises(ValueError,match='Unsupported Kong'):
        profiles.load_kong_profile(path,weights=weights,code=code,config=config,approval=approval)

def test_kong_configuration_is_applied_to_inference(tmp_path,monkeypatch):
    class Model:
        def __init__(self,**kwargs):pass
        def transcribe(self,audio,_):
            assert self.onset_threshold==.45
            assert self.offset_threshod==.25
            return {'est_note_events':[]}
    monkeypatch.setattr(kong,'_load_package',lambda path:(Model,16000))
    monkeypatch.setattr(kong.harness,'read_wav',lambda path:(np.zeros(1600),16000))
    kong.transcribe('unused',{'sample_rate':16000,'package_path':'unused','config':{'onset_threshold':.45,'offset_threshold':.25}},'unused','cpu')


def test_kong_profile_rejects_a_basic_pitch_file_and_bad_digest(tmp_path):
    path, weights, code, config, approval = profile_files(tmp_path)
    data = json.loads(path.read_text(encoding='utf-8'))
    data['model'] = 'basic-pitch'
    path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(ValueError, match='not a Kong'):
        profiles.load_kong_profile(path, weights=weights, code=code,
                                   config=config, approval=approval)
    data['model'] = 'kong'
    data['weights_sha256'] = '0' * 64
    path.write_text(json.dumps(data), encoding='utf-8')
    with pytest.raises(ValueError, match='weights bytes'):
        profiles.load_kong_profile(path, weights=weights, code=code,
                                   config=config, approval=approval)


def test_raw_adapter_builds_a_valid_draft_and_preview(tmp_path):
    path, weights, code, config, approval = profile_files(tmp_path)
    profile = profiles.load_kong_profile(path, weights=weights, code=code,
                                         config=config, approval=approval)
    result = {'est_note_events': [
        {'onset_time': 0.10, 'offset_time': 0.45, 'midi_note': 60, 'velocity': 100},
        {'onset_time': 0.60, 'offset_time': 1.20, 'midi_note': 64, 'velocity': 40}],
        'est_pedal_events': [{'onset_time': 0.2, 'offset_time': 1.1}]}
    draft, native = kong.build(2.0, result, profile, 'a' * 64, 'b' * 64)
    MusicDraftDocument.model_validate(draft)
    assert [event['pitch'] for event in draft['events']] == [60, 64]
    assert draft['events'][0]['velocity'] == pytest.approx(100 / 127, abs=1e-6)
    assert draft['playback'] == {'sync_offset_seconds': 0.0, 'revision': 1}
    assert draft['piano_preview']['mime'] == 'audio/wav'
    assert draft['pedal'] == [{'onset': 0.2, 'offset': 1.1, 'type': 'sustain'}]
    audio = tmp_path / 'input.wav'
    from scripts import piano_reconstruction_harness as harness
    harness.write_wav(audio, np.zeros(32000, dtype=np.float32), 16000, bit_depth=16)
    entry = kong.render_preview(draft, native, audio, tmp_path / 'preview.wav')
    assert entry['clipping'] is False
    assert entry['mapping']['native_offsets']['notes'] == 2
    assert entry['renderer'] == 'additive-reference-1'
    assert len(entry['preview_identity']) == 64
    draft['preview_identity'] = entry['preview_identity']
    MusicDraftDocument.model_validate(draft)
    assert Path(tmp_path / 'preview.wav').is_file()


def test_kong_route_is_the_default_for_new_piano_uploads():
    from apps.api import processing_routes
    from apps.api.config import Settings
    assert Settings(_env_file=None).music_piano_default_model == 'kong'
    assert processing_routes.route_for(
        'piano', piano_model='kong').pipeline_version == 'music-piano-kong-v1'
    assert processing_routes.route_for(
        'piano', piano_model='basic-pitch').pipeline_version == 'music-piano-v1'
    assert processing_routes.route_for_pipeline('music-piano-kong-v1') is not None

def test_main_retains_numpy_native_events_without_breaking_handoff(tmp_path,monkeypatch):
    import zipfile
    audio=tmp_path/'input.wav'
    kong.harness.write_wav(audio,np.zeros(32000,dtype=np.float32),16000,bit_depth=16)
    checkpoint=tmp_path/'checkpoint';checkpoint.write_bytes(b'weights')
    job=tmp_path/'job.json';job.write_text('{"duration":2}')
    monkeypatch.setenv('MUSIC_RUN_PROFILE',json.dumps({'sample_rate':16000,'model_version':'0.0.6','profile_sha256':'a'*64}))
    monkeypatch.setenv('MUSIC_MODEL_WEIGHTS',str(checkpoint))
    result={'est_note_events':[{'onset_time':np.float32(.1),'offset_time':np.float32(.7),'midi_note':60,'velocity':70}],
            'est_pedal_events':[{'onset_time':np.float32(.2),'offset_time':np.float32(1.2)}]}
    monkeypatch.setattr(kong,'transcribe',lambda *args:(result,np.zeros(32000)))
    output=tmp_path/'output'
    assert kong.main(['--input',str(audio),'--source',str(audio),'--job',str(job),'--output',str(output)])==0
    handoff=json.loads((output/'result.json').read_text())
    assert handoff['files']['analysis']=='analysis.zip'
    with zipfile.ZipFile(output/'analysis.zip') as archive:
        raw=json.loads(archive.read('raw-note-events.json'))
        assert raw['notes'][0]['velocity']==70
        assert json.loads(archive.read('metadata.json'))['correction_operations']==0
