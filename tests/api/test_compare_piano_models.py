"""Package 4: per-model scores carry states, never invented zeros or a winner."""
import json
from pathlib import Path

import pytest

import scripts.compare_piano_models as comparison
import scripts.piano_performance as performance
import scripts.piano_quality_reference as reference_contract

ROOT = Path(__file__).resolve().parents[2]
NOTES = [(0.2, 60), (0.4, 62), (0.6, 64), (0.8, 65)]
MASTER = 'a' * 64
PREPARED = 'b' * 64


def build_reference(path, *, pitch_status='verified', expression=True, pedal=True,
                    alignment=True):
    attributes = reference_contract.unavailable_attributes()
    attributes['pitch_onset'] = reference_contract.attribute(
        pitch_status,
        ([{'id': f'n{index}', 'pitch': pitch, 'onset_seconds': onset}
          for index, (onset, pitch) in enumerate(NOTES)]
         if pitch_status == 'verified' else []), 'reviewed')
    if expression:
        attributes['key_release'] = reference_contract.attribute(
            'verified', [{'id': f'r{index}', 'note_id': f'n{index}',
                          'release_seconds': onset + 0.3}
                         for index, (onset, _pitch) in enumerate(NOTES)], 'capture')
        attributes['velocity'] = reference_contract.attribute(
            'verified', [{'id': f'v{index}', 'note_id': f'n{index}',
                          'velocity_midi': 70} for index in range(len(NOTES))], 'capture')
    if pedal:
        attributes['pedal'] = reference_contract.attribute(
            'verified', [{'id': 'p1', 'type': 'sustain', 'onset_seconds': 0.1,
                          'value': 1.0},
                         {'id': 'p2', 'type': 'sustain', 'onset_seconds': 1.3,
                          'value': 0.0}], 'capture')
    timeline = reference_contract.default_timeline()
    timeline['video_to_analysis'].update({'verified': alignment, 'method': 'manual'})
    value = reference_contract.new_reference(
        reference_id='ref-comparison', source={'sha256': MASTER, 'seconds': 1.5,
                                               'sample_rate': 22050, 'channels': 1},
        performance={'performance_id': 'p1', 'performer_id': 'perf',
                     'recording_id': 'rec', 'work_id': 'work'},
        rights={'license': 'CC-BY-4.0', 'status': 'approved'},
        scored_interval=[0.0, 1.5], timeline=timeline, attributes=attributes)
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def build_run(directory, variant, *, offset=0.005, velocity=True, pedal=True,
              correction=False, master=MASTER, interval=(0.0, 1.5)):
    directory.mkdir(parents=True, exist_ok=True)
    document = performance.new_document(
        performance_id=variant, source={'sha256': PREPARED, 'duration_seconds': 1.5,
                                        'sample_rate': 22050, 'channels': 1})
    for index, (onset, pitch) in enumerate(NOTES):
        performance.add_note(
            document, note_id=f'n{index}', pitch_midi=pitch,
            onset_seconds=onset + offset, velocity_midi=70 if velocity else None,
            velocity_provenance=({'kind': 'model_estimated'} if velocity
                                 else {'kind': 'amplitude_proxy', 'amplitude': 0.4}))
    if pedal:
        performance.add_pedal(document, pedal_id='p1', pedal_type='sustain',
                              onset_seconds=0.1, value=1.0)
        performance.add_pedal(document, pedal_id='p2', pedal_type='sustain',
                              onset_seconds=1.3, value=0.0)
    document_path = directory / 'document.json'
    document_path.write_text(performance.to_json(document), encoding='utf-8')
    native = {'schema': 'piano-model-native-1', 'version': 1, 'variant': variant,
              'note_count': len(NOTES), 'events': [
                  {'id': f'n{index}', 'pitch': pitch,
                   'onset_seconds': round(onset + offset, 6),
                   'offset_seconds': round(onset + offset + 0.3, 6),
                   'velocity': 70} for index, (onset, pitch) in enumerate(NOTES)]}
    (directory / 'native.json').write_text(json.dumps(native), encoding='utf-8')
    import hashlib
    receipt = {
        'schema': 'piano-model-run-receipt-1', 'version': 1, 'mode': 'raw-model-comparison-v1',
        'variant': variant, 'family': 'kong' if velocity else 'basic-pitch',
        'status': 'ready', 'correction_enabled': correction,
        'expression_correction_enabled': False,
        'correction_operations': 1 if correction else 0,
        'source': {'master_sha256': master, 'prepared_sha256': PREPARED,
                   'interval': list(interval)},
        'identity': {'checkpoint_sha256': 'c' * 64},
        'runtime': {'seconds': 1.25, 'device': 'cpu', 'backend': 'onnx'},
        'outputs': {'document': 'document.json',
                    'document_sha256': hashlib.sha256(
                        document_path.read_bytes()).hexdigest(),
                    'native': 'native.json',
                    'native_sha256': hashlib.sha256(
                        (directory / 'native.json').read_bytes()).hexdigest()},
    }
    (directory / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
    return {'receipt': str(directory / 'receipt.json')}


def evaluate(tmp_path, variants, **kwargs):
    reference = kwargs.pop('reference', None)
    if reference is None:
        reference = build_reference(tmp_path / 'reference.json', **kwargs)
    runs = {variant: build_run(tmp_path / variant, variant, **kwargs)
            for variant in variants}
    return comparison.evaluate(reference, runs, created_at='2026-11-13T00:00:00Z')


def test_kong_scores_measured_velocity_and_not_release():
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        reference = build_reference(directory / 'reference.json')
        runs = {'kong-piano': build_run(directory / 'kong-piano', 'kong-piano')}
        result = comparison.evaluate(reference, runs,
                                     created_at='2026-11-13T00:00:00Z')
    kong = result['models']['kong-piano']['attributes']
    assert kong['note_correctness']['state'] == 'measured'
    assert kong['note_correctness']['value']['f1'] == pytest.approx(1.0)
    assert kong['fine_timing']['state'] == 'measured'
    assert kong['velocity']['state'] == 'measured'
    assert kong['velocity']['value']['mae'] == pytest.approx(0.0)
    assert kong['key_release']['state'] == 'not_estimated'
    assert kong['audible_end']['state'] == 'not_estimated'
    assert kong['written_rhythm']['state'] == 'unsupported_semantics'


def test_amplitude_model_never_reports_velocity(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'basic-pitch-native': build_run(tmp_path / 'bp', 'basic-pitch-native',
                                            velocity=False)}
    result = comparison.evaluate(reference, runs)
    attributes = result['models']['basic-pitch-native']['attributes']
    assert attributes['velocity']['state'] == 'not_estimated'
    assert 'amplitude' in attributes['velocity']['reasons'][0]
    assert attributes['note_correctness']['state'] == 'measured'


def test_source_only_comparison_reports_observation_not_accuracy(tmp_path):
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(None, runs, interval=[0.0, 1.5])
    attributes = result['models']['kong-piano']['attributes']
    assert attributes['detected_notes']['state'] == 'measured'
    assert attributes['detected_notes']['value']['notes'] == 4
    assert attributes['note_correctness']['state'] == 'reference_unavailable'
    assert attributes['fine_timing']['state'] == 'reference_unavailable'
    assert attributes['velocity']['state'] == 'reference_unavailable'


def test_unverified_alignment_keeps_measured_values_diagnostic(tmp_path):
    reference = build_reference(tmp_path / 'reference.json', alignment=False)
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs)
    attributes = result['models']['kong-piano']['attributes']
    assert attributes['note_correctness']['state'] == 'diagnostic_only'
    assert attributes['fine_timing']['state'] == 'diagnostic_only'
    assert result['source']['reference']['alignment_verified'] is False


def test_blocked_variants_appear_without_values(tmp_path):
    from scripts import piano_model_registry
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs,
                                 registry=piano_model_registry.build())
    assert result['aggregate']['blocked'] == 2
    correctness = next(row for row in result['table']
                       if row['attribute'] == 'note_correctness')
    assert correctness['cells']['transkun-v2']['state'] == 'blocked_license'
    assert correctness['cells']['transkun-v2']['value'] is None
    assert correctness['cells']['onsets-frames-piano']['state'] == 'blocked_license'


def test_no_overall_score_or_winner_is_emitted(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs)
    assert 'winner' not in result
    assert 'overall_score' not in result
    assert 'improvement_established' not in result
    assert 'activation_authorized' not in result
    assert 'percentage_matching' not in result


def test_correction_enabled_receipt_is_refused(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano', correction=True)}
    with pytest.raises(comparison.ComparisonError, match='corrections were'):
        comparison.evaluate(reference, runs)


def test_master_source_mismatch_is_refused(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano', master='d' * 64)}
    with pytest.raises(comparison.ComparisonError, match='run source does not match'):
        comparison.evaluate(reference, runs)


def test_interval_mismatch_is_refused(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano',
                                    interval=(0.0, 1.0))}
    with pytest.raises(comparison.ComparisonError, match='interval does not match'):
        comparison.evaluate(reference, runs)


def test_document_hash_mismatch_is_refused(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    (tmp_path / 'kong' / 'document.json').write_text('{}', encoding='utf-8')
    with pytest.raises(comparison.ComparisonError,
                       match='invalid performance document|hash does not match'):
        comparison.evaluate(reference, runs)


def test_audio_row_is_diagnostic_and_uses_the_fixed_gain(tmp_path):
    import numpy as np
    import scripts.piano_reconstruction_harness as harness
    source = tmp_path / 'source.wav'
    harness.write_wav(source, np.zeros(66150, dtype=np.float32), 22050, bit_depth=16)
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    run_dir = tmp_path / 'kong'
    preview_dir = run_dir / 'preview'
    preview_dir.mkdir()
    harness.write_wav(preview_dir / 'preview.wav', np.zeros(66150, dtype=np.float32),
                      22050, bit_depth=16)
    (preview_dir / 'preview.json').write_text(json.dumps({
        'common': {'sample_rate': 22050, 'renderer': 'additive-reference-1',
                   'gain_policy': {'common_gain_db': 0.0}},
        'previews': {'as_transcribed': {'clipping': False}}}), encoding='utf-8')
    result = comparison.evaluate(reference, runs, source_audio=source)
    audio = result['models']['kong-piano']['attributes']['audio']
    assert audio['state'] == 'diagnostic_only'
    assert isinstance(audio['value']['objective'], float)
    assert audio['value']['fixed_gain_db'] == 0.0
    assert audio['value']['fixed_gain_objective'] >= 0.0


def test_audio_row_is_not_run_without_source_audio(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs)
    assert result['models']['kong-piano']['attributes']['audio']['state'] == 'not_run'


def test_relative_dynamics_is_diagnostic_for_model_velocity(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs)
    dynamics = result['models']['kong-piano']['attributes']['relative_dynamics']
    # The fixture reference has constant velocity, so rank agreement is undefined.
    assert dynamics['state'] == 'not_estimated'
    assert 'no rankable variation' in dynamics['reasons'][0]


def test_relative_dynamics_ranks_varied_velocities(tmp_path):
    reference = {'attributes': {'velocity': {'events': [
        {'note_id': f'n{index}', 'velocity_midi': 60 + index * 10}
        for index in range(4)]}}}
    document = {'notes': [
        {'id': f'n{index}', 'velocity_midi': 90 - index * 10} for index in range(4)]}
    pairs = [{'reference_id': f'n{index}', 'candidate_id': f'n{index}'}
             for index in range(4)]
    cell = comparison._relative_dynamics(reference, document, pairs)
    assert cell['state'] == 'diagnostic_only'
    assert cell['value']['rank_correlation'] == pytest.approx(-1.0)


def test_relative_dynamics_is_not_estimated_for_amplitude(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'basic-pitch-native': build_run(tmp_path / 'bp', 'basic-pitch-native',
                                            velocity=False)}
    result = comparison.evaluate(reference, runs)
    dynamics = result['models']['basic-pitch-native']['attributes']['relative_dynamics']
    assert dynamics['state'] == 'not_estimated'


def test_stereo_and_human_rows_are_explicit(tmp_path):
    import numpy as np
    import scripts.piano_reconstruction_harness as harness
    mono = tmp_path / 'mono.wav'
    harness.write_wav(mono, np.zeros(22050, dtype=np.float32), 22050, bit_depth=16)
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs, source_audio=mono)
    attributes = result['models']['kong-piano']['attributes']
    assert attributes['stereo_room']['state'] == 'reference_unavailable'
    assert attributes['human_similarity']['state'] == 'reference_unavailable'


def test_table_has_every_attribute_and_direction(tmp_path):
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs)
    assert [row['attribute'] for row in result['table']] == list(
        comparison.TABLE_ORDER)
    assert all('direction' in row and 'units' in row for row in result['table'])
    correctness = next(row for row in result['table']
                       if row['attribute'] == 'note_correctness')
    assert correctness['direction'] == 'higher_is_better'


def test_markdown_marks_blocked_rows_and_limits(tmp_path):
    from scripts import piano_model_registry
    reference = build_reference(tmp_path / 'reference.json')
    runs = {'kong-piano': build_run(tmp_path / 'kong', 'kong-piano')}
    result = comparison.evaluate(reference, runs,
                                 registry=piano_model_registry.build())
    text = comparison.markdown(result)
    assert 'blocked_license' in text
    assert 'Blocked rows' in text
    assert 'not combined into an overall score' in text
