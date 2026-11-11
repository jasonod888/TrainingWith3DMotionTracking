import hashlib
import json
import pytest
from test_music_run_profile import files, load


def piano_profile(tmp_path):
    paths, path, profile = files(tmp_path)
    profile.update(model='basic-pitch', model_version='0.4.0', thresholds={
        'onset_threshold': .6, 'frame_threshold': .3, 'minimum_note_length': 80,
        'onset_prominence': .2, 'minimum_attack_spacing_ms': 70}, decoding={
        'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1', 'infer_onsets': False,
        'melodia_trick': False, 'include_pitch_bends': False, 'multiple_pitch_bends': False,
        'midi_tempo': 120, 'minimum_frequency': None, 'maximum_frequency': None})
    return paths, path, profile


def write(paths, path, profile):
    config = {key: profile[key] for key in ('sample_rate', 'preprocessing', 'thresholds', 'decoding')}
    paths['config.json'].write_text(json.dumps(config))
    profile['config_sha256'] = hashlib.sha256(paths['config.json'].read_bytes()).hexdigest()
    path.write_text(json.dumps(profile))


def test_piano_profile_is_bound_and_reproducible(tmp_path):
    paths, path, profile = piano_profile(tmp_path); write(paths, path, profile)
    first = load(paths, path); second = load(paths, path)
    assert first['profile_sha256'] == second['profile_sha256']


@pytest.mark.parametrize('field,value', [('onset_prominence', -1), ('onset_threshold', 1.1),
    ('minimum_attack_spacing_ms', 0), ('minimum_note_length', 0), ('frame_threshold', True)])
def test_piano_profile_rejects_invalid_decoder_parameters(tmp_path, field, value):
    paths, path, profile = piano_profile(tmp_path)
    profile['thresholds'][field] = value; write(paths, path, profile)
    with pytest.raises(ValueError): load(paths, path)


def test_piano_profile_cannot_silently_reenable_inferred_attacks(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    profile['decoding']['infer_onsets'] = True; write(paths, path, profile)
    with pytest.raises(ValueError, match='explicit onsets'): load(paths, path)
