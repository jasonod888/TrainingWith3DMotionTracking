"""M6: the scorecard cannot turn unknown or damaged evidence into an improvement."""
import json

import pytest

import scripts.report_piano_quality as reporting


def reference(split='development', verified=True, status='unavailable'):
    return {'reference_id': 'ref-1', 'sha256': 'a' * 64, 'split': split,
            'scored_interval': [0.0, 10.0],
            'timeline': {'video_to_analysis': {'verified': verified}},
            'rights': {'status': 'approved'},
            'attributes': {name: {'status': status}
                           for name in ('pitch_onset', 'key_release', 'audible_end',
                                        'velocity', 'pedal')}}


def event_result(**overrides):
    base = {'metric_version': 'piano-event-metrics-2', 'applicable': True,
            'reference_status': 'verified', 'reference_count': 10, 'candidate_count': 9,
            'matched': 8, 'missing': 2, 'extra': 1, 'precision': 8 / 9, 'recall': 8 / 10,
            'f1': 2 * 8 / 19, 'onset_mae_seconds': 0.020, 'onset_p95_absolute_seconds': 0.040,
            'onset_bias_seconds': 0.005, 'all_reference_within_tolerance': 0.8,
            'missing_per_100_reference': 20.0, 'scorable_reference': 10,
            'matched_within_tolerance': 8}
    base.update(overrides)
    return base


def test_metric_nulls_do_not_become_zero():
    value = reporting.metric(name='x', version='v', units='f1', direction='higher_is_better',
                             status='not_measured')
    assert value['baseline'] is None and value['final'] is None
    assert value['absolute_change'] is None and value['relative_change'] is None


def test_zero_baseline_has_no_finite_relative_change():
    value = reporting.metric(name='x', version='v', units='seconds',
                             direction='lower_is_better', status='measured',
                             baseline=0.0, final=0.5)
    assert value['absolute_change'] == pytest.approx(0.5)
    assert value['relative_change'] is None


def test_outcome_classification_uses_metric_materiality():
    assert reporting.outcome(0.5, 0.8, 'higher_is_better', 0.002) == 'improved'
    assert reporting.outcome(0.5, 0.4, 'higher_is_better', 0.002) == 'regressed'
    assert reporting.outcome(0.5, 0.501, 'higher_is_better', 0.002) == 'unchanged'
    assert reporting.outcome(None, 0.5, 'higher_is_better', 0.002) == 'insufficient_evidence'


def test_one_wrong_added_note_blocks_improvement_despite_a_better_other_category():
    """Review P1: baseline F1 1.0 -> final 0.987 with one extra note must not be 'unchanged'."""
    baseline = event_result(reference_count=40, candidate_count=40, matched=40, missing=0,
                            extra=0, f1=1.0,
                            matched_reference_ids=[f'n{index}' for index in range(40)],
                            extra_candidate_ids=[])
    final = event_result(reference_count=40, candidate_count=41, matched=40, missing=0,
                         extra=1, f1=2 * 40 / 81,
                         matched_reference_ids=[f'n{index}' for index in range(40)],
                         extra_candidate_ids=['wrong-note'])
    velocity = {'metric_version': 'piano-expression-metrics-1', 'status': 'measured',
                'reference_status': 'verified', 'applicable': True,
                'reference_population': 40, 'n': 40, 'mae': 0.0,
                'all_reference_within_tolerance': 1.0, 'unmatched': 0,
                'missing_candidate_velocity': 0,
                'measured_note_ids': [f'n{index}' for index in range(40)],
                'errors': {f'n{index}': 0.0 for index in range(40)}}
    baseline_velocity = dict(velocity, mae=10.0,
                             errors={**{f'n{index}': 0.0 for index in range(40)},
                                     'n0': 40.0})
    scorecard = reporting.build(reference=reference(status='verified'), candidates={},
                                baseline_events=baseline, final_events=final,
                                baseline_expression={'velocity': baseline_velocity},
                                final_expression={'velocity': velocity})
    assert scorecard['damage']['damaged'] is True
    assert scorecard['damage']['event']['new_extra_ids'] == ['wrong-note']
    assert scorecard['outcomes']['pitch_onset'] == 'regressed'
    assert scorecard['outcomes']['velocity'] == 'improved'


def test_recovering_one_note_while_losing_another_is_damage():
    """Review P1: equal totals hide a newly lost reference note; identities expose it."""
    baseline = event_result(reference_count=4, candidate_count=3, matched=3, missing=1,
                            extra=0, f1=2 * 3 / 7,
                            matched_reference_ids=['n1', 'n2', 'n3'],
                            extra_candidate_ids=[])
    final = event_result(reference_count=4, candidate_count=3, matched=3, missing=1,
                         extra=0, f1=2 * 3 / 7,
                         matched_reference_ids=['n0', 'n2', 'n3'],
                         extra_candidate_ids=[])
    scorecard = reporting.build(reference=reference(status='verified'), candidates={},
                                baseline_events=baseline, final_events=final)
    assert scorecard['damage']['event']['lost_reference_ids'] == ['n1']
    assert scorecard['damage']['event']['recovered_reference_ids'] == ['n0']
    assert scorecard['damage']['damaged'] is True
    assert scorecard['outcomes']['pitch_onset'] == 'regressed'


def test_swapping_an_extra_note_for_another_extra_is_damage():
    baseline = event_result(matched_reference_ids=['n0'], extra_candidate_ids=['extra-a'])
    final = event_result(matched_reference_ids=['n0'], extra_candidate_ids=['extra-b'])
    scorecard = reporting.build(reference=reference(status='verified'), candidates={},
                                baseline_events=baseline, final_events=final)
    assert scorecard['damage']['event']['new_extra_ids'] == ['extra-b']
    assert scorecard['damage']['damaged'] is True


def test_dropping_a_velocity_prediction_cannot_count_as_improvement():
    """Review P1: removing the difficult value lowers conditional MAE but is not a fix."""
    baseline = {'metric_version': 'piano-expression-metrics-1', 'status': 'measured',
                'reference_status': 'verified', 'applicable': True,
                'reference_population': 4, 'n': 4, 'mae': 10.0,
                'all_reference_within_tolerance': 0.75, 'unmatched': 0,
                'missing_candidate_velocity': 0,
                'measured_note_ids': ['n0', 'n1', 'n2', 'n3'],
                'errors': {'n0': 40.0, 'n1': 0.0, 'n2': 0.0, 'n3': 0.0}}
    final = {'metric_version': 'piano-expression-metrics-1', 'status': 'measured',
             'reference_status': 'verified', 'applicable': True,
             'reference_population': 4, 'n': 3, 'mae': 0.0,
             'all_reference_within_tolerance': 0.75, 'unmatched': 0,
             'missing_candidate_velocity': 1,
             'measured_note_ids': ['n1', 'n2', 'n3'],
             'errors': {'n1': 0.0, 'n2': 0.0, 'n3': 0.0}}
    scorecard = reporting.build(reference=reference(status='verified'), candidates={},
                                baseline_expression={'velocity': baseline},
                                final_expression={'velocity': final})
    assert scorecard['damage']['expression']['velocity']['damaged'] is True
    assert scorecard['damage']['expression']['velocity']['lost_value_ids'] == ['n0']
    assert scorecard['outcomes']['velocity'] == 'regressed'


def test_unavailable_reference_reports_detection_not_accuracy():
    scorecard = reporting.build(
        reference=reference(status='unavailable'), candidates={},
        final_events={'metric_version': 'piano-event-metrics-2',
                      'reference_status': 'unavailable', 'applicable': False,
                      'detected_notes': 34, 'f1': None})
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'not_measured'
    assert pitch['reference_status'] == 'unavailable'
    assert pitch['coverage']['detected_notes'] == 34
    assert pitch['final'] is None
    answer = next(entry['answer'] for entry in scorecard['questions']
                  if entry['question'] == 'Are the notes better?')
    assert '34 notes detected' in answer and 'correctness unknown' in answer


def test_unverified_alignment_makes_timing_results_diagnostic():
    scorecard = reporting.build(reference=reference(verified=False), candidates={},
                                baseline_events=event_result(f1=0.5),
                                final_events=event_result(f1=0.8))
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'diagnostic_only'
    assert any('alignment' in warning for warning in scorecard['warnings'])


def test_unverified_source_identity_makes_results_diagnostic():
    scorecard = reporting.build(reference=reference(), candidates={},
                                baseline_events=event_result(f1=0.5),
                                final_events=event_result(f1=0.8),
                                source_verified=False)
    pitch = scorecard['categories']['pitch_onset'][0]
    assert pitch['status'] == 'diagnostic_only'
    assert any('source identity' in reason for reason in pitch['reasons'])


def test_unverified_source_identity_downgrades_expression_rows():
    velocity = {'metric_version': 'piano-expression-metrics-1', 'status': 'measured',
                'reference_status': 'verified', 'applicable': True,
                'reference_population': 4, 'n': 4, 'mae': 3.0,
                'all_reference_within_tolerance': 0.75, 'unmatched': 0,
                'missing_candidate_velocity': 0,
                'measured_note_ids': ['n0', 'n1', 'n2', 'n3'],
                'errors': {f'n{index}': 3.0 for index in range(4)}}
    scorecard = reporting.build(reference=reference(), candidates={},
                                final_expression={'velocity': velocity},
                                source_verified=False)
    row = scorecard['categories']['velocity'][0]
    assert row['name'] == 'velocity_mae_units'
    assert row['status'] == 'diagnostic_only'
    assert any('source identity' in reason for reason in row['reasons'])


def test_audio_before_and_after_are_retained_with_components():
    scorecard = reporting.build(
        reference=reference(status='verified'), candidates={},
        audio={'baseline': {'objective': 0.70, 'components': {'spectral': 0.5},
                            'absolute_objective': 0.80, 'gain_db': -2.0, 'complete': True},
               'final': {'objective': 0.55, 'components': {'spectral': 0.3},
                         'absolute_objective': 0.65, 'gain_db': -2.0, 'complete': True},
               'renderer': {'name': 'additive-reference-1', 'version': '2.1.0'},
               'qualification': {'valid_for_qualification': False},
               'diagnostic_only': True, 'reasons': ['renderer is approximate']})
    audio = scorecard['categories']['audio'][0]
    assert audio['status'] == 'diagnostic_only'
    assert audio['baseline'] == pytest.approx(0.70)
    assert audio['final'] == pytest.approx(0.55)
    assert audio['coverage']['components'] == {'spectral': 0.3}
    assert audio['coverage']['absolute_objective'] == pytest.approx(0.65)
    assert audio['coverage']['renderer']['name'] == 'additive-reference-1'
    assert scorecard['outcomes']['audio'] == 'insufficient_evidence'


def test_listening_without_enough_units_is_unscorable():
    scorecard = reporting.build(reference=reference(), candidates={},
                                listening={'adequate': False, 'mean': 72.0,
                                           'listeners': 1, 'performances': 1})
    listening = scorecard['categories']['listening'][0]
    assert listening['status'] == 'unscorable'
    assert scorecard['outcomes']['listening'] == 'insufficient_evidence'


def test_markdown_reports_na_and_answers():
    scorecard = reporting.build(reference=reference(split='holdout'), candidates={})
    text = reporting.markdown(scorecard)
    assert 'n/a' in text
    assert 'Are the notes better?' in text
    assert 'No overall fidelity percentage' in text
    assert 'Descriptive single-clip report' in text


def test_write_creates_both_artifacts(tmp_path):
    scorecard = reporting.build(reference=reference(), candidates={})
    reporting.write(scorecard, tmp_path / 'scorecard.json', tmp_path / 'scorecard.md')
    assert json.loads((tmp_path / 'scorecard.json').read_text(encoding='utf-8'))['schema'] == \
        reporting.SCHEMA
    assert (tmp_path / 'scorecard.md').read_text(encoding='utf-8').startswith(
        '# Piano reconstruction quality scorecard')


def test_cli_refuses_unknown_schema(tmp_path, capsys):
    path = tmp_path / 'bad.json'
    path.write_text(json.dumps({'schema': 'nope'}), encoding='utf-8')
    assert reporting.main(['--scorecard', str(path)]) == 2
    assert 'unsupported scorecard schema' in capsys.readouterr().err
