import hashlib
import json
import pytest
from test_music_run_profile import files, load

from scripts.piano_settings import DEFAULT_SETTINGS as SETTINGS_DEFAULTS
from scripts.piano_verifier import DEFAULT_SETTINGS as VERIFIER_DEFAULTS


def test_settings_defaults_are_shared_with_profile_preparation():
    assert SETTINGS_DEFAULTS == VERIFIER_DEFAULTS


def verification(settings=None):
    settings = settings or {}
    return {'enabled': True, 'mode': 'diagnostic', 'version': 'piano-verifier-1',
            'code_sha256': 'c' * 64, 'settings': settings,
            'settings_sha256': hashlib.sha256(
                json.dumps(settings, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def piano_profile(tmp_path):
    paths, path, profile = files(tmp_path)
    profile.update(model='basic-pitch', model_version='0.4.0', thresholds={
        'onset_threshold': .6, 'frame_threshold': .3, 'minimum_note_length': 80,
        'onset_prominence': .2, 'minimum_attack_spacing_ms': 70}, decoding={
        'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1', 'infer_onsets': False,
        'melodia_trick': False, 'include_pitch_bends': False, 'multiple_pitch_bends': False,
        'midi_tempo': 120, 'minimum_frequency': None, 'maximum_frequency': None},
        verification=verification())
    return paths, path, profile


def correction_policy():
    return {'policy_version': 'piano-corrections-1', 'generated_at': '2026-11-11T00:00:00Z',
            'status': 'insufficient-evidence', 'scope': 'test',
            'benchmark': {'report_sha256': 'a' * 64, 'evidence_kind': 'human',
                          'heldout_cases': 40, 'source': 'test'},
            'thresholds': {'min_heldout_cases': 1, 'min_suggestions': 1,
                           'min_correction_precision': 0.9, 'max_damage_rate': 0.0},
            'categories': {}}


def write(paths, path, profile):
    config = {key: profile[key] for key in ('sample_rate', 'preprocessing', 'thresholds', 'decoding')}
    keys = ['enabled', 'mode', 'version', 'settings']
    if profile['verification']['mode'] == 'qualified':
        keys += ['correction_policy', 'correction_policy_sha256']
    config['verification'] = {key: profile['verification'][key] for key in keys
                              if key in profile['verification']}
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


def test_piano_profile_binds_diagnostic_verification(tmp_path):
    paths, path, profile = piano_profile(tmp_path); write(paths, path, profile)
    verified = load(paths, path)
    assert verified['verification']['enabled'] is True
    assert verified['verification']['mode'] == 'diagnostic'
    assert verified['verification']['code_sha256'] == 'c' * 64
    assert len(verified['profile_sha256']) == 64


def test_piano_profile_binds_qualified_verification(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    policy = correction_policy()
    profile['verification'].update(mode='qualified', correction_policy=policy,
        correction_policy_sha256=hashlib.sha256(
            json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
    write(paths, path, profile)
    verified = load(paths, path)
    assert verified['verification']['mode'] == 'qualified'
    assert verified['verification']['correction_policy_sha256']


def test_piano_profile_rejects_unbound_or_diagnostic_policies(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    profile['verification']['mode'] = 'qualified'
    write(paths, path, profile)
    with pytest.raises(ValueError, match='requires a correction policy'):
        load(paths, path)
    policy = correction_policy()
    profile['verification'].update(correction_policy=policy,
        correction_policy_sha256='c' * 64)
    write(paths, path, profile)
    with pytest.raises(ValueError, match='digest does not match'):
        load(paths, path)
    profile['verification']['mode'] = 'diagnostic'
    profile['verification']['correction_policy_sha256'] = hashlib.sha256(
        json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    write(paths, path, profile)
    with pytest.raises(ValueError, match='only valid in qualified mode'):
        load(paths, path)


@pytest.mark.parametrize('field,value', [('mode', 'automatic'), ('version', ''),
    ('enabled', 'yes'), ('code_sha256', 'short')])
def test_piano_profile_rejects_unsafe_verification(tmp_path, field, value):
    paths, path, profile = piano_profile(tmp_path)
    profile['verification'][field] = value; write(paths, path, profile)
    with pytest.raises(ValueError): load(paths, path)


def test_verification_settings_digest_is_bound(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    profile['verification']['settings'] = {'checks': {'onset_min_attack': 0.4}}
    write(paths, path, profile)
    with pytest.raises(ValueError, match='settings digest'):
        load(paths, path)


def test_verification_requires_the_piano_peak_decoder(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    profile['decoding']['decoding_version'] = 'basic-pitch-0.4.0/decoding-v1'
    write(paths, path, profile)
    with pytest.raises(ValueError, match='piano peak decoder'):
        load(paths, path)


def test_verification_settings_reject_unknown_sections_and_fields(tmp_path):
    paths, path, profile = piano_profile(tmp_path)
    profile['verification']['settings'] = {'typo_section': {'x': 1}}
    profile['verification']['settings_sha256'] = hashlib.sha256(
        json.dumps(profile['verification']['settings'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    write(paths, path, profile)
    with pytest.raises(ValueError, match='unknown sections'):
        load(paths, path)
    profile['verification']['settings'] = {'checks': {'typo_field': 1}}
    profile['verification']['settings_sha256'] = hashlib.sha256(
        json.dumps(profile['verification']['settings'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    write(paths, path, profile)
    with pytest.raises(ValueError, match='unknown fields'):
        load(paths, path)
    profile['verification']['settings'] = {'limits': {'budget_seconds': 0}}
    profile['verification']['settings_sha256'] = hashlib.sha256(
        json.dumps(profile['verification']['settings'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    write(paths, path, profile)
    with pytest.raises(ValueError, match='between'):
        load(paths, path)


def test_prepared_expression_bytes_are_pinned_and_reverified(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    from scripts.music_run_profile import load_profile
    root = Path(__file__).resolve().parents[2]
    weights = tmp_path / 'model.onnx'; weights.write_bytes(b'local-pinned-test-weights')
    evidence = tmp_path / 'evidence.txt'; evidence.write_text('local test evidence')
    output = tmp_path / 'bundle'
    subprocess.run([sys.executable, str(root / 'scripts/prepare_piano_decoder_profile.py'),
        '--weights', str(weights), '--evidence', str(evidence),
        '--correction-policy', str(root / 'docs/qualification/piano-correction-policy.json'),
        '--expression-policy', str(root / 'docs/qualification/piano-expression-policy.json'),
        '--output', str(output)], check=True, capture_output=True)
    args = dict(weights=weights, code=output / 'adapter.py',
                config=output / 'config.json', approval=evidence)
    profile = load_profile(output / 'run-profile.json', **args)
    profile.reverify()
    expression = output / 'piano_expression.py'
    expression.write_bytes(expression.read_bytes() + b'\n# changed estimator\n')
    with pytest.raises(ValueError, match='expression_code bytes'):
        profile.reverify()
    with pytest.raises(ValueError, match='Expression estimator bytes'):
        load_profile(output / 'run-profile.json', **args)
