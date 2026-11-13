"""Adversarial integration cases for the second foundation review."""
import copy
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from scripts import analyze_listening_study as analysis
from scripts import build_listening_study as listening
from scripts import piano_reconstruction_harness as harness
from scripts import piano_render as render
from scripts import probe_sampler as sampler
from test_listening_study import build, corpus, session, spec, study_sha, SCORES
from test_piano_reconstruction_harness import measured_document
from test_probe_sampler import build_mapping


def test_browser_manifest_changed_rotation_is_rejected(tmp_path):
    output, _study = build(tmp_path)
    path = output / 'public' / 'study.browser.json'
    browser = json.loads(path.read_text())
    browser['rotations'][0]['item_order'].reverse()
    path.write_text(json.dumps(browser))
    assert not listening.verify(output / 'study.json')['ok']


def test_public_bundle_excludes_decoding_key_and_includes_protocol(tmp_path):
    output, _study = build(tmp_path)
    assert not list((output / 'public').rglob('study.json'))
    for name in ('index.html', 'app.js', 'protocol.js', 'styles.css', 'study.browser.json'):
        assert (output / 'public' / name).is_file()
    (output / 'public' / 'study.browser.json').unlink()
    assert not listening.verify(output / 'study.json')['ok']


def test_declared_comparisons_survive_build(tmp_path):
    directory = corpus(tmp_path / 'audio')
    specification = spec(directory)
    specification['comparisons'] = [{'candidate': 'refinement', 'baseline': 'model_only'}]
    path = tmp_path / 'spec.json'
    path.write_text(json.dumps(specification))
    study = listening.build(path, tmp_path / 'study')
    assert analysis.planned_comparisons(study, 'model_only') == [
        {'candidate': 'refinement', 'baseline': 'model_only', 'exploratory': False}]


@pytest.mark.parametrize('defect', ['duplicate_id', 'duplicate_role', 'traversal_id'])
def test_ambiguous_or_unsafe_study_spec_is_rejected(tmp_path, defect):
    directory = corpus(tmp_path / 'audio')
    specification = spec(directory)
    if defect == 'duplicate_id':
        specification['excerpts'][1]['id'] = specification['excerpts'][0]['id']
    elif defect == 'duplicate_role':
        specification['excerpts'][0]['candidates'].append(specification['excerpts'][0]['candidates'][0])
    else:
        specification['excerpts'][0]['id'] = '../outside'
    path = tmp_path / 'spec.json'
    path.write_text(json.dumps(specification))
    with pytest.raises(listening.StudyError):
        listening.build(path, tmp_path / 'study')


def test_mixed_timezone_session_is_excluded_without_crashing(tmp_path):
    output, study = build(tmp_path)
    submission = session(study, 'L01', SCORES, sha=study_sha(output))
    submission['finished_at'] = '2026-11-12T10:30:00'
    decoded = analysis.decode(study, submission, study_sha(output))
    assert decoded['excluded']
    assert any('time zones' in reason for reason in decoded['exclusions'])


def test_fractional_label_index_cannot_impersonate_a_candidate(tmp_path):
    output, study = build(tmp_path)
    submission = session(study, 'L01', SCORES, sha=study_sha(output))
    submission['ratings'][0]['label_index'] += .9
    assert analysis.decode(study, submission, study_sha(output))['excluded']


def test_unsupported_controls_block_their_target_and_audio_fidelity():
    document = measured_document()
    result = SimpleNamespace(renderer='real', asset_sha256='a' * 64, warnings=(),
                             control_support=render.ControlSupport(False, False, False,
                                                                   False, False, False, False),
                             release_sources={'measured': 2})
    flags = harness.qualification(document, result, {'delivered': SimpleNamespace(complete=True)},
                                  source_identity={'declared': True, 'verified': True})
    assert {'velocity', 'release', 'pedal', 'audio_fidelity'} <= set(flags['blocked_targets'])


def test_empty_comparisons_cannot_qualify():
    result = SimpleNamespace(renderer='real', asset_sha256='a' * 64, warnings=(),
                             control_support=render.ControlSupport(True, True, True,
                                                                   False, False, False, False),
                             release_sources={'measured': 2})
    flags = harness.qualification(measured_document(), result, {},
                                  source_identity={'declared': True, 'verified': True})
    assert not flags['valid_for_qualification']


def test_wrong_pitch_and_monophonic_chord_do_not_pass():
    rate = 8000
    times = np.arange(rate) / rate
    wrong = sampler.measure_probe(.2 * np.sin(2 * np.pi * 440 * times), rate)
    results = sampler.evaluate_features({'strike_loud': wrong, 'dense_chord': wrong})
    assert not results['pitch and attack']['supported']
    assert not results['dense polyphony']['supported']


def test_natural_decay_does_not_prove_pedal_lift():
    rate = 8000
    times = np.arange(2 * rate) / rate
    decay = sampler.measure_probe(.2 * np.sin(2 * np.pi * 261.6 * times) * np.exp(-times), rate)
    results = sampler.evaluate_features({'release_pedal_down': decay, 'pedal_lift': decay})
    assert not results['pedal lift']['supported']


def test_missing_mandatory_probe_cannot_pass_selection(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    for name in ('av2.flac', 'noise.wav'):
        (path.parent / 'Samples' / name).write_bytes(b'sample')
    inventory = sampler.inventory(path)
    measurements = {'features': {}, 'identity': {
        'mapping_sha256': inventory['dependencies_sha256'],
        'samples_sha256': inventory['samples']['sha256'],
        'probe_set_sha256': sampler.probe_set_sha256(), 'engine_sha256': None}}
    decision = sampler.selection_artifact(inventory, engine='test', samples='test', measurements=measurements)
    assert decision['decision'] == 'pending-probes'
    assert decision['untested_mandatory']


def test_sample_change_invalidates_probe_evidence(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    for name in ('av2.flac', 'noise.wav'):
        (path.parent / 'Samples' / name).write_bytes(b'original')
    before = sampler.inventory(path)
    (path.parent / 'Samples' / 'noise.wav').write_bytes(b'changed')
    after = sampler.inventory(path)
    assert before['samples']['sha256'] != after['samples']['sha256']
    measurements = {'features': {}, 'identity': {'mapping_sha256': before['dependencies_sha256'],
                                                'samples_sha256': before['samples']['sha256']}}
    assert sampler.selection_artifact(after, 'engine', 'samples', measurements)['decision'] == 'blocked'


def test_engine_argv_substitution_preserves_windows_paths():
    arguments = [sys.executable, '--sfz', '{sfz}', '--midi', '{midi}', '--out', '{wav}']
    callback = sampler.run_engine(arguments)
    paths = [r'D:\Piano Samples\mapping.sfz', r'D:\Piano Clips\probe.mid', r'D:\Piano Clips\out.wav']
    with patch('subprocess.run', return_value=SimpleNamespace(returncode=0)) as command:
        callback(*paths)
    assert command.call_args.args[0] == [sys.executable, '--sfz', paths[0], '--midi', paths[1], '--out', paths[2]]


def test_changed_probe_midi_is_rejected_before_engine_runs(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    probes = tmp_path / 'probes'
    sampler.write_probes(probes)
    (probes / 'dense_chord.mid').write_bytes(b'changed')
    with pytest.raises(sampler.SamplerError, match='changed canonical probe'):
        sampler.execute(lambda **_arguments: pytest.fail('engine must not run'), path, probes)


def test_instrument_script_tampering_invalidates_study(tmp_path):
    output, _study = build(tmp_path)
    (output / 'public' / 'protocol.js').write_text('// changed label decoding')
    assert not listening.verify(output / 'study.json')['ok']


def test_blinding_key_is_not_published(tmp_path):
    output, study = build(tmp_path)
    assert study['blinding_key'] not in (output / 'public' / 'study.browser.json').read_text()
