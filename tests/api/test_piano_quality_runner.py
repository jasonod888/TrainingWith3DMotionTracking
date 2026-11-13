"""M4: the runner enforces identity, status, interval and configuration before scoring."""
import hashlib
import json
import struct

import pytest

import scripts.benchmark_piano_quality as runner
import scripts.piano_performance as performance
import scripts.piano_quality_reference as reference_contract
from scripts.piano_reconstruction_harness import write_wav
import numpy as np

NOTES = [(0.20, 60), (0.40, 62), (0.60, 64), (0.80, 65)]


def write_audio(path, seconds=1.5, rate=8000):
    times = np.arange(int(seconds * rate)) / rate
    audio = (0.3 * np.sin(2 * np.pi * 220 * times)).astype(np.float32)
    return write_wav(path, audio, rate, bit_depth=16)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_reference(tmp_path, *, source_path=None, pitch_status='verified',
                    with_expression=True, pedal=False):
    if source_path is None:
        source = {'sha256': 'a' * 64, 'seconds': 1.5, 'sample_rate': 8000, 'channels': 1}
    else:
        source = reference_contract.source_from_audio(source_path)
    attributes = reference_contract.unavailable_attributes()
    attributes['pitch_onset'] = reference_contract.attribute(
        'verified' if pitch_status == 'verified' else pitch_status,
        ([{'id': f'n{index}', 'pitch': pitch, 'onset_seconds': onset}
          for index, (onset, pitch) in enumerate(NOTES)]
         if pitch_status == 'verified' else []),
        'reviewed')
    if with_expression:
        attributes['key_release'] = reference_contract.attribute(
            'verified', [{'id': f'r{index}', 'note_id': f'n{index}',
                          'release_seconds': onset + 0.3}
                         for index, (onset, _) in enumerate(NOTES)], 'capture')
        attributes['velocity'] = reference_contract.attribute(
            'verified', [{'id': f'v{index}', 'note_id': f'n{index}', 'velocity_midi': 70}
                         for index in range(len(NOTES))], 'capture')
    if pedal:
        attributes['pedal'] = reference_contract.attribute(
            'verified', [{'id': 'p1', 'type': 'sustain', 'onset_seconds': 0.1,
                          'value': 1.0},
                         {'id': 'p2', 'type': 'sustain', 'onset_seconds': 1.2,
                          'value': 0.0}], 'capture')
    timeline = reference_contract.default_timeline()
    timeline['video_to_analysis'].update({'verified': True, 'method': 'manual-markers'})
    value = reference_contract.new_reference(
        reference_id='ref-runner', source=source,
        performance={'performance_id': 'p1', 'performer_id': 'p01',
                     'recording_id': 'r01', 'work_id': 'w01'},
        rights={'license': 'CC-BY-4.0', 'status': 'approved'},
        scored_interval=[0.0, 1.5], timeline=timeline, attributes=attributes)
    path = tmp_path / 'reference.json'
    path.write_text(json.dumps(value), encoding='utf-8')
    return path, source


def write_events(tmp_path, name, offset):
    events = [{'id': f'c{index}', 'pitch': pitch, 'onset_seconds': onset + offset}
              for index, (onset, pitch) in enumerate(NOTES)]
    path = tmp_path / name
    path.write_text(json.dumps(events), encoding='utf-8')
    return path


def write_document(tmp_path, name, offset=0.005, velocity=70, extra_note=False,
                   source_sha='a' * 64):
    document = performance.new_document(
        performance_id=name,
        source={'sha256': source_sha, 'duration_seconds': 1.5, 'sample_rate': 8000,
                'channels': 1})
    for index, (onset, pitch) in enumerate(NOTES):
        performance.add_note(document, note_id=f'n{index}', pitch_midi=pitch,
                             onset_seconds=onset + offset,
                             key_release_seconds=onset + offset + 0.3,
                             velocity_midi=velocity)
    if extra_note:
        performance.add_note(document, note_id='extra', pitch_midi=72,
                             onset_seconds=1.2, key_release_seconds=1.4,
                             velocity_midi=velocity)
    path = tmp_path / f'{name}.json'
    path.write_text(performance.to_json(document), encoding='utf-8')
    return path


def test_a_worse_baseline_and_better_final_are_measured(tmp_path):
    reference, _source = build_reference(tmp_path)
    baseline = write_document(tmp_path, 'a', offset=0.080)
    final = write_document(tmp_path, 'c', offset=0.005)
    scorecard = runner.evaluate(reference, {'A': baseline, 'C': final}, baseline='A',
                                final='C')
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'measured'
    assert pitch['baseline'] == pytest.approx(0.0)
    assert pitch['final'] == pytest.approx(1.0)
    assert scorecard['outcomes']['pitch_onset'] == 'improved'
    assert scorecard['improvement_established'] is True
    assert scorecard['qualification_established'] is False
    assert scorecard['activation_authorized'] is False


def test_captured_pedal_scorecard_reads_each_type_without_cross_contamination(tmp_path):
    reference, _ = build_reference(tmp_path, pedal=True)
    ref = json.loads(reference.read_text())
    ref['attributes']['pedal']['events'].extend([
        {'id': 'soft-on', 'type': 'soft', 'onset_seconds': 0.2, 'value': 1.0},
        {'id': 'soft-off', 'type': 'soft', 'onset_seconds': 1.0, 'value': 0.0}])
    reference.write_text(json.dumps(ref))
    baseline = write_document(tmp_path, 'pedal-baseline')
    final = write_document(tmp_path, 'pedal-final')
    for path, times in ((baseline, (0.3, 1.4)), (final, (0.1, 1.2))):
        doc = json.loads(path.read_text())
        for index, time in enumerate(times):
            performance.add_pedal(doc, pedal_id=f'p{index}', pedal_type='sustain',
                                  onset_seconds=time, value=1.0 if index == 0 else 0.0)
        # Soft-pedal predictions remain wrong in both candidates; sustain improves.
        for index, time in enumerate((0.4, 1.3)):
            performance.add_pedal(doc, pedal_id=f'soft{index}', pedal_type='soft',
                                  onset_seconds=time, value=1.0 if index == 0 else 0.0)
        path.write_text(performance.to_json(doc))
    score = runner.evaluate(reference, {'A': baseline, 'C': final}, final='C')
    row = score['categories']['pedal'][0]
    assert row['name'] == 'pedal_sustain_f1'
    assert row['baseline'] == 0 and row['final'] == 1
    assert row['coverage']['false_off_seconds'] == 0
    soft = score['categories']['pedal'][1]
    assert soft['name'] == 'pedal_soft_f1'
    assert soft['baseline'] == 0 and soft['final'] == 0
    assert soft['coverage']['false_off_seconds'] > 0


def test_uncaptured_candidate_pedal_is_unknown_not_predicted_all_off(tmp_path):
    reference, _ = build_reference(tmp_path, pedal=True)
    candidate = write_document(tmp_path, 'no-pedal-capture')
    score = runner.evaluate(reference, {'A': candidate})
    row = score['categories']['pedal'][0]
    assert row['status'] == 'unscorable'
    assert row['final'] is None and row['baseline'] is None


def test_a_candidate_from_another_source_is_refused(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_document(tmp_path, 'a', source_sha='b' * 64)
    with pytest.raises(runner.RunnerError, match='different source'):
        runner.evaluate(reference, {'A': candidate})


def test_unbound_candidates_make_measured_results_diagnostic(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_events(tmp_path, 'a.json', 0.005)
    scorecard = runner.evaluate(reference, {'A': candidate})
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'diagnostic_only'
    assert scorecard['source_verified'] is False
    assert scorecard['improvement_established'] is False


def test_an_unavailable_reference_reports_detection_only(tmp_path):
    reference, _source = build_reference(tmp_path, pitch_status='unavailable',
                                         with_expression=False)
    candidate = write_events(tmp_path, 'a.json', 0.005)
    scorecard = runner.evaluate(reference, {'A': candidate})
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'not_measured'
    assert pitch['coverage']['detected_notes'] == 4
    assert scorecard['detected_notes']['A'] == 4
    assert scorecard['outcomes']['pitch_onset'] == 'insufficient_evidence'


def test_candidate_events_outside_the_scored_interval_are_excluded(tmp_path):
    reference, _source = build_reference(tmp_path)
    events = [{'id': 'inside', 'pitch': 60, 'onset_seconds': 0.2},
              {'id': 'after', 'pitch': 62, 'onset_seconds': 1.9}]
    path = tmp_path / 'a.json'
    path.write_text(json.dumps(events), encoding='utf-8')
    scorecard = runner.evaluate(reference, {'A': path})
    assert scorecard['detected_notes']['A'] == 1
    assert scorecard['categories']['pitch_onset'][0]['coverage']['extra'] == 0


def test_an_incompatible_metric_configuration_is_rejected(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_document(tmp_path, 'a')
    bad = dict(reference_contract.TOLERANCES, onset_match_seconds=0.010)
    with pytest.raises(runner.RunnerError, match='frozen metric configuration'):
        runner.evaluate(reference, {'A': candidate}, tolerances=bad)
    scorecard = runner.evaluate(reference, {'A': candidate}, tolerances=bad,
                                allow_config_override=True)
    assert scorecard['tolerances']['onset_match_seconds'] == 0.010


def test_damage_from_an_added_note_blocks_improvement(tmp_path):
    reference, _source = build_reference(tmp_path)
    baseline = write_document(tmp_path, 'a', offset=0.010, velocity=74)
    final = write_document(tmp_path, 'c', offset=0.005, velocity=70, extra_note=True)
    scorecard = runner.evaluate(reference, {'A': baseline, 'C': final}, baseline='A',
                                final='C')
    assert scorecard['damage']['damaged'] is True
    assert scorecard['damage']['event']['new_extra_ids'] == ['extra']
    assert scorecard['outcomes']['pitch_onset'] == 'regressed'
    assert scorecard['improvement_established'] is False
    assert any('damage' in warning.lower() for warning in scorecard['warnings'])


def test_without_a_corrected_candidate_improvement_is_not_established(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_document(tmp_path, 'a', offset=0.010)
    scorecard = runner.evaluate(reference, {'A': candidate})
    assert scorecard['final_candidate'] == 'A'
    assert scorecard['improvement_established'] is False
    assert any('no corrected candidate' in warning for warning in scorecard['warnings'])


def test_unknown_baseline_or_final_identifiers_are_rejected(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_document(tmp_path, 'a')
    with pytest.raises(runner.RunnerError, match='baseline'):
        runner.evaluate(reference, {'A': candidate}, baseline='B')
    with pytest.raises(runner.RunnerError, match='final'):
        runner.evaluate(reference, {'A': candidate}, final='C')


def test_expression_uses_the_full_reference_population(tmp_path):
    reference, _source = build_reference(tmp_path)
    candidate = write_document(tmp_path, 'a', velocity=74)
    scorecard = runner.evaluate(reference, {'A': candidate})
    velocity = next(row for row in scorecard['categories']['velocity']
                    if row['name'] == 'velocity_mae_units')
    assert velocity['denominator']['reference_population'] == 4
    assert velocity['final'] == pytest.approx(4.0, abs=1e-9)
    rate = next(row for row in scorecard['categories']['velocity']
                if row['name'] == 'velocity_all_reference_within_tolerance')
    assert rate['final'] == pytest.approx(1.0)


def test_audio_baseline_and_final_are_retained(tmp_path):
    audio_path = write_audio(tmp_path / 'source.wav')
    reference, source = build_reference(tmp_path, source_path=audio_path)
    baseline = write_document(tmp_path, 'a', offset=0.080, source_sha=source['sha256'])
    final = write_document(tmp_path, 'c', offset=0.005, source_sha=source['sha256'])
    scorecard = runner.evaluate(reference, {'A': baseline, 'C': final}, baseline='A',
                                final='C', source_audio=audio_path)
    audio = scorecard['categories']['audio'][0]
    assert audio['status'] == 'diagnostic_only'
    assert audio['baseline'] is not None and audio['final'] is not None
    assert audio['coverage']['components']
    assert audio['coverage']['qualification']['valid_for_qualification'] is False


def test_source_audio_must_match_the_reference(tmp_path):
    reference, _source = build_reference(tmp_path)
    other = write_audio(tmp_path / 'other.wav')
    candidate = write_document(tmp_path, 'a')
    with pytest.raises(runner.RunnerError, match='does not match the reference source'):
        runner.evaluate(reference, {'A': candidate}, source_audio=other)


def test_a_bare_midi_reference_is_refused(tmp_path):
    body = b'\x00\x90\x3c\x40\x83\x60\x3c\x00\x00\xff\x2f\x00'
    midi = tmp_path / 'capture.mid'
    midi.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 1, 1, 480)
                     + b'MTrk' + struct.pack('>I', len(body)) + body)
    with pytest.raises(runner.RunnerError, match='piano-quality-reference'):
        runner.evaluate(midi, {'A': write_events(tmp_path, 'a.json', 0.01)})


def test_cli_writes_both_scorecard_artifacts(tmp_path):
    reference, _source = build_reference(tmp_path)
    baseline = write_document(tmp_path, 'a', offset=0.080)
    final = write_document(tmp_path, 'c', offset=0.005)
    output = tmp_path / 'out'
    code = runner.main(['--reference', str(reference),
                        '--candidate', f'A={baseline}',
                        '--candidate', f'C={final}',
                        '--baseline', 'A', '--final', 'C',
                        '--output', str(output)])
    assert code == 0
    assert (output / 'scorecard.json').is_file()
    payload = json.loads((output / 'scorecard.json').read_text(encoding='utf-8'))
    assert payload['schema'] == 'piano-quality-scorecard-1'
    assert payload['outcomes']['pitch_onset'] == 'improved'
    assert payload['implementation']['events']
