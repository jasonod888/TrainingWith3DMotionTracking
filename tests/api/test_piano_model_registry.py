"""Package 1: the model registry must pin identities and honour the rights preflight."""
import json
from pathlib import Path

import pytest

import scripts.piano_model_registry as registry_module
from scripts import piano_rights

ROOT = Path(__file__).resolve().parents[2]
KONG_PATH = ROOT / '.local' / 'piano-diagnosis' / 'reference-packages' / 'piano.pth'
BASIC_PITCH_PROFILE = ROOT / 'docs' / 'qualification' / 'basic-pitch-profile.json'


def build(**kwargs):
    return registry_module.build(built_at='2026-11-13T00:00:00Z', **kwargs)


def variant(name, built=None):
    built = built or build()
    return next(entry for entry in built['variants'] if entry['id'] == name)


def test_pilot_has_three_runnable_variants_of_two_families():
    built = build()
    assert built['pilot']['runnable'] == ['basic-pitch-native', 'basic-pitch-current-app',
                                          'kong-piano']
    assert built['pilot']['runnable_families'] == ['basic-pitch', 'kong']
    assert built['pilot']['complete_four_family_benchmark'] is False
    assert 'not a completed four-family benchmark' in built['pilot']['note']


def test_transkun_and_onsets_are_blocked_with_recorded_blockers():
    built = build()
    transkun = variant('transkun-v2', built)
    onsets = variant('onsets-frames-piano', built)
    assert transkun['status'] == registry_module.STATUS_BLOCKED
    assert transkun['rights']['status'] == 'unresolved'
    assert any('model_selection=unresolved' in blocker
               for blocker in transkun['rights']['blockers'])
    assert onsets['status'] == registry_module.STATUS_BLOCKED
    assert onsets['rights']['status'] == 'prohibited'
    assert any('prohibited' in blocker for blocker in onsets['rights']['blockers'])
    for entry in (transkun, onsets):
        assert entry['runnable'] is False
        assert entry['checkpoint']['sha256'] is None


def test_basic_pitch_variants_share_weights_but_not_decoders():
    built = build()
    native = variant('basic-pitch-native', built)
    current = variant('basic-pitch-current-app', built)
    assert native['checkpoint']['sha256'] == current['checkpoint']['sha256']
    assert native['decoder']['profile'] != current['decoder']['profile']
    assert native['decoder']['verification_enabled'] is False
    assert current['decoder']['verification_enabled'] is False
    assert current['decoder']['thresholds'] == {
        'onset_threshold': 0.6, 'frame_threshold': 0.3, 'minimum_note_length': 80.0,
        'onset_prominence': 0.2, 'minimum_attack_spacing_ms': 70.0}


def test_basic_pitch_amplitude_is_never_velocity():
    for name in ('basic-pitch-native', 'basic-pitch-current-app'):
        entry = variant(name)
        assert entry['capabilities']['velocity'] == 'amplitude_proxy'
        assert entry['capabilities']['velocity_units'] is None
    assert variant('kong-piano')['capabilities']['velocity'] == 'model_estimated'
    assert variant('kong-piano')['capabilities']['velocity_units'] == 'midi_1_127'


def test_native_profile_weights_match_the_pinned_checkpoint():
    profile = json.loads(BASIC_PITCH_PROFILE.read_text(encoding='utf-8'))
    native = variant('basic-pitch-native')
    assert native['decoder']['profile_weights_sha256'] == profile['weights_sha256']
    assert native['checkpoint']['sha256'] == profile['weights_sha256']
    assert native['decoder']['thresholds'] == profile['thresholds']


def test_blocked_rows_are_not_counted_as_testable_models():
    built = build()
    assert len(built['variants']) == 5
    assert len(built['pilot']['runnable']) == 3
    assert len(built['pilot']['blocked']) == 2


def test_verification_accepts_a_matching_checkpoint():
    if not KONG_PATH.is_file():
        pytest.skip('Kong checkpoint is not present on this host')
    built = build(verify=True, artifacts={'kong-piano': str(KONG_PATH)})
    kong = variant('kong-piano', built)
    assert kong['status'] == registry_module.STATUS_READY
    assert kong['identity_complete'] is True


def test_verification_detects_a_wrong_checkpoint(tmp_path):
    if not KONG_PATH.is_file():
        pytest.skip('Kong checkpoint is not present on this host')
    fake = tmp_path / 'piano.pth'
    fake.write_bytes(b'not the checkpoint')
    built = build(verify=True, artifacts={'kong-piano': str(fake)})
    kong = variant('kong-piano', built)
    assert kong['status'] == registry_module.STATUS_IDENTITY
    assert 'does not match the pinned digest' in kong['identity_problem']
    assert kong['runnable'] is False


def test_verification_without_an_artifact_is_identity_unresolved():
    built = build(verify=True, artifacts={})
    kong = variant('kong-piano', built)
    assert kong['status'] == registry_module.STATUS_IDENTITY
    assert 'not available for verification' in kong['identity_problem']


def test_validation_rejects_a_blocked_row_without_a_blocker():
    built = build()
    built['variants'][3]['rights']['blockers'] = []
    with pytest.raises(registry_module.RegistryError, match='recorded blocker'):
        registry_module.validate(built)


def test_validation_rejects_shared_decoders_for_basic_pitch():
    built = build()
    current = next(entry for entry in built['variants']
                   if entry['id'] == 'basic-pitch-current-app')
    native = next(entry for entry in built['variants']
                  if entry['id'] == 'basic-pitch-native')
    current['decoder']['profile'] = native['decoder']['profile']
    with pytest.raises(registry_module.RegistryError, match='distinct decoders'):
        registry_module.validate(built)


def test_markdown_names_every_variant_and_blocker():
    text = registry_module.markdown(build())
    for label in ('Basic Pitch — native', 'Basic Pitch — current app', 'Kong', 'Transkun',
                  'Onsets and Frames'):
        assert label in text
    assert 'blocked_license' in text
    assert 'not a completed four-family benchmark' not in text


def test_cli_prints_json():
    import subprocess
    import sys
    result = subprocess.run([sys.executable, '-m', 'scripts.piano_model_registry', '--json'],
                            cwd=str(ROOT), capture_output=True, text=True)
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload['schema'] == registry_module.SCHEMA
    assert payload['pilot']['runnable_families'] == ['basic-pitch', 'kong']


def test_rights_manifest_has_no_approved_transkun_decision():
    manifest = piano_rights.load_manifest(registry_module.MANIFEST_PATH)
    decision = piano_rights.decide(manifest, ['transkun-checkpoint'],
                                   registry_module.USE)
    assert decision.status != 'approved'
    assert decision.blockers
