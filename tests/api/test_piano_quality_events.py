"""M2: event-metrics-2 must satisfy the versioned matching and empty-case contract."""
import json
import math

import pytest

import scripts.piano_quality_events as events


def event(identifier, pitch, onset):
    return {'id': identifier, 'pitch': pitch, 'onset_seconds': onset}


def test_required_tie_break_regression():
    """Plan §5.1: reference 1.000 and 1.040, candidate 1.035 must choose the 5 ms pair."""
    reference = [event('r1', 60, 1.000), event('r2', 60, 1.040)]
    candidate = [event('c1', 60, 1.035)]
    result = events.score_events(reference, candidate)
    assert result['matched'] == 1
    assert result['onset_mae_seconds'] == pytest.approx(0.005, abs=1e-9)
    pairs = events.match_events(reference, candidate)['pairs']
    assert pairs[0]['reference_id'] == 'r2'
    # Signed error is candidate minus reference, so the candidate is 5 ms early.
    assert pairs[0]['signed_error_seconds'] == pytest.approx(-0.005, abs=1e-9)
    assert abs(pairs[0]['signed_error_seconds']) == pytest.approx(0.005, abs=1e-9)

    legacy = events.legacy_score(reference, candidate)
    assert legacy['onset_mae_seconds'] == pytest.approx(0.035, abs=1e-9)


def test_minimum_distance_prefers_the_closer_reference():
    reference = [event('r1', 60, 0.000), event('r2', 60, 0.010)]
    candidate = [event('c1', 60, 0.009)]
    pairs = events.match_events(reference, candidate)['pairs']
    assert pairs[0]['reference_id'] == 'r2'
    assert pairs[0]['signed_error_seconds'] == pytest.approx(-0.001, abs=1e-9)


def test_cardinality_wins_over_a_locally_closer_pair():
    reference = [event('r1', 60, 0.000), event('r2', 60, 0.030)]
    candidate = [event('c1', 60, 0.029), event('c2', 60, 0.031)]
    correspondence = events.match_events(reference, candidate)
    assert correspondence['matched'] == 2
    assert {pair['reference_id'] for pair in correspondence['pairs']} == {'r1', 'r2'}


def test_exact_ties_are_deterministic_and_order_invariant():
    reference = [event('r1', 60, 0.100)]
    candidate = [event('c1', 60, 0.095), event('c2', 60, 0.105)]
    first = events.match_events(reference, candidate)['pairs']
    second = events.match_events(reference, list(reversed(candidate)))['pairs']
    assert first == second
    assert abs(first[0]['signed_error_seconds']) == pytest.approx(0.005, abs=1e-9)


def test_input_ordering_does_not_change_the_correspondence():
    reference = [event('r1', 60, 0.10), event('r2', 60, 0.40), event('r3', 64, 0.20)]
    candidate = [event('c1', 64, 0.21), event('c2', 60, 0.41), event('c3', 60, 0.09)]
    ordered = events.match_events(reference, candidate)
    shuffled = events.match_events(list(reversed(reference)), list(reversed(candidate)))
    assert ordered['pairs'] == shuffled['pairs']
    assert ordered['matched'] == 3


def test_unavailable_reference_yields_observation_not_accuracy():
    result = events.score_events([], [event(f'c{index}', 60, 0.1 * index) for index in range(34)],
                                 reference_status='unavailable')
    assert result['reference_status'] == 'unavailable'
    assert result['detected_notes'] == 34
    for key in ('f1', 'precision', 'recall', 'missing', 'extra', 'false_activity_notes',
                'all_reference_within_tolerance'):
        assert result[key] is None, key
    assert result['applicable'] is False


def test_verified_empty_reference_still_reports_false_activity():
    result = events.score_events([], [event('c1', 60, 0.0)], reference_status='verified')
    assert result['false_activity_notes'] == 1
    assert result['extra'] == 1
    assert result['f1'] == 0.0


def test_negative_uncertainty_is_rejected():
    with pytest.raises(events.ScorerError, match='uncertainty'):
        events.match_events([{**event('r1', 60, 0.0), 'onset_uncertainty_seconds': -0.01}], [])


def test_uncertainty_above_half_tolerance_makes_timing_unscorable():
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.100,
                  'onset_uncertainty_seconds': 0.030}]
    candidate = [event('c1', 60, 0.115)]      # 15 ms error but the reference is ±30 ms
    result = events.score_events(reference, candidate)
    assert result['matched'] == 1
    assert result['ambiguous_reference'] == 1
    assert result['scorable_reference'] == 0
    assert result['matched_within_tolerance'] == 0
    assert result['all_reference_within_tolerance'] is None


def test_uncertainty_within_tolerance_keeps_timing_scorable():
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.100,
                  'onset_uncertainty_seconds': 0.005}]
    candidate = [event('c1', 60, 0.110)]
    result = events.score_events(reference, candidate)
    assert result['ambiguous_reference'] == 0
    assert result['matched_within_tolerance'] == 1
    assert result['all_reference_within_tolerance'] == pytest.approx(1.0)


def test_uncertain_only_reference_reports_observation():
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.500, 'status': 'uncertain',
                  'onset_uncertainty_seconds': 0.040}]
    candidate = [event('c1', 60, 0.570), event('c2', 72, 1.400)]
    result = events.score_events(reference, candidate, reference_status='uncertain')
    assert result['reference_status'] == 'uncertain'
    assert result['applicable'] is False
    assert result['masked_extra'] == 1        # near the unresolved reference note
    assert result['excluded_candidates'] == ['c1']
    assert result['detected_notes'] == 2
    assert result['extra'] is None


def test_mixed_reference_masks_uncertain_candidates_but_not_wrong_pitches():
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.500},
                 {'id': 'r2', 'pitch': 64, 'onset_seconds': 1.000, 'status': 'uncertain',
                  'onset_uncertainty_seconds': 0.030}]
    candidate = [event('c1', 60, 0.505), event('c2', 64, 1.040), event('c3', 67, 1.000)]
    result = events.score_events(reference, candidate)
    assert result['matched'] == 1
    assert result['excluded_candidates'] == ['c2']
    assert result['masked_extra'] == 1
    assert result['extra'] == 1               # c3 is a different pitch: not masked
    assert result['candidate_scored'] == 2
    assert result['precision'] == pytest.approx(0.5)


def test_uncertain_notes_never_become_false_extras_in_a_verified_attribute():
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.500},
                 {'id': 'r2', 'pitch': 62, 'onset_seconds': 0.700, 'status': 'uncertain'}]
    candidate = [event('c1', 60, 0.500), event('c2', 62, 0.710)]
    result = events.score_events(reference, candidate)
    assert result['reference_count'] == 1
    assert result['matched'] == 1
    assert result['extra'] == 0
    assert result['excluded_candidates'] == ['c2']
    assert result['masked_extra'] == 1


def test_timing_eligibility_is_candidate_independent():
    """Review P1: detecting the uncertain note must not manufacture fine-timing evidence."""
    reference = [{'id': 'r1', 'pitch': 60, 'onset_seconds': 0.500},
                 {'id': 'r2', 'pitch': 62, 'onset_seconds': 0.800,
                  'onset_uncertainty_seconds': 0.020}]
    only_precise = events.score_events(reference, [event('c1', 60, 0.505)])
    both = events.score_events(reference, [event('c1', 60, 0.505),
                                           event('c2', 62, 0.805)])
    assert only_precise['scorable_reference'] == 1
    assert both['scorable_reference'] == 1
    assert only_precise['ambiguous_reference'] == 1
    assert both['ambiguous_reference'] == 1
    assert only_precise['all_reference_within_tolerance'] == pytest.approx(1.0)
    assert both['all_reference_within_tolerance'] == pytest.approx(1.0)
    assert only_precise['detection_coverage'] == pytest.approx(0.5)
    assert both['detection_coverage'] == pytest.approx(1.0)


def test_ids_are_preserved_and_synthesized_ids_are_reported():
    reference = [{'pitch': 60, 'onset_seconds': 0.1}]
    candidate = [{'pitch': 60, 'onset_seconds': 0.11}]
    normalized, synthesized = events.normalize_events(reference)
    assert synthesized is True
    assert normalized[0]['id'].startswith('event-')
    pairs = events.match_events(reference, candidate)['pairs']
    assert pairs[0]['reference_id'] == 'event-00000'


def test_duplicate_ids_are_rejected():
    with pytest.raises(events.ScorerError, match='not unique'):
        events.match_events([event('same', 60, 0.0), event('same', 61, 0.1)], [])


def test_invalid_pitch_and_onsets_are_rejected():
    with pytest.raises(events.ScorerError, match='pitch'):
        events.match_events([{'id': 'a', 'pitch': 200, 'onset_seconds': 0.0}], [])
    with pytest.raises(events.ScorerError, match='non-finite'):
        events.match_events([{'id': 'a', 'pitch': 60, 'onset_seconds': float('nan')}], [])


def test_tolerance_is_validated():
    with pytest.raises(events.ScorerError, match='tolerance'):
        events.match_events([], [], tolerance=0)
    with pytest.raises(events.ScorerError, match='tolerance'):
        events.match_events([], [], tolerance=2)


@pytest.mark.parametrize('reference,candidate,precision,recall,f1,applicable', [
    ([], [], None, None, None, False),
    ([event('r1', 60, 0.0)], [], None, 0.0, 0.0, True),
    ([], [event('c1', 60, 0.0)], 0.0, None, 0.0, True),
])
def test_empty_case_contract(reference, candidate, precision, recall, f1, applicable):
    result = events.score_events(reference, candidate)
    assert result['precision'] == precision
    assert result['recall'] == recall
    assert result['f1'] == f1
    assert result['applicable'] is applicable


def test_empty_reference_reports_false_activity():
    result = events.score_events([], [event('c1', 60, 0.0), event('c2', 62, 0.1)])
    assert result['false_activity_notes'] == 2
    assert result['silent_reference'] is True


def test_nonempty_f1_is_the_matched_ratio_formula():
    reference = [event(f'r{index}', 60, index * 0.5) for index in range(4)]
    candidate = [event(f'c{index}', 60, index * 0.5 + 0.010) for index in range(3)]
    result = events.score_events(reference, candidate)
    assert result['matched'] == 3
    assert result['f1'] == pytest.approx(2 * 3 / (4 + 3), abs=1e-9)


def test_all_reference_rate_counts_misses_as_failures():
    reference = [event('r1', 60, 0.0), event('r2', 62, 1.0)]
    candidate = [event('c1', 60, 0.010)]
    result = events.score_events(reference, candidate)
    assert result['matched_within_tolerance'] == 1
    assert result['matched_within_tolerance_rate'] == pytest.approx(1.0)
    assert result['all_reference_within_tolerance'] == pytest.approx(0.5)
    assert result['missing'] == 1


def test_legacy_scorer_retains_its_old_empty_behavior():
    legacy = events.legacy_score([], [])
    assert legacy['f1'] == 1.0
    assert legacy['metric_version'] == 'piano-event-metrics-1-legacy'
    modern = events.score_events([], [])
    assert modern['f1'] is None


def test_aggregate_pools_micro_counts_and_excludes_nulls_from_macro():
    cases = [
        events.score_events([event('r1', 60, 0.0), event('r2', 62, 1.0)],
                            [event('c1', 60, 0.010)]),
        events.score_events([], []),
        events.score_events([], [event('c1', 70, 0.0)]),
    ]
    result = events.aggregate(cases)
    assert result['cases'] == 3
    assert result['micro']['reference_count'] == 2
    assert result['micro']['candidate_count'] == 2
    assert result['micro']['matched'] == 1
    assert result['micro']['f1'] == pytest.approx(2 * 1 / (2 + 2))
    assert result['macro']['f1']['cases'] == 2      # the empty/empty case is excluded
    assert result['macro']['precision']['cases'] == 2   # false-activity precision is 0, not null
    assert result['silence']['silent_reference_cases'] == 2
    assert result['silence']['false_activity_notes'] == 1


def test_state_space_bound_is_explicit_not_silent():
    reference = [event(f'r{index}', 60, index * 0.001) for index in range(1001)]
    candidate = [event(f'c{index}', 60, index * 0.001) for index in range(1001)]
    assert 1001 * 1001 > events.MAX_CELLS
    with pytest.raises(events.ScorerError, match='above the'):
        events.match_events(reference, candidate)


def test_cli_emits_nulls_not_zeros(tmp_path, capsys):
    reference = tmp_path / 'reference.json'
    candidate = tmp_path / 'candidate.json'
    reference.write_text(json.dumps([]), encoding='utf-8')
    candidate.write_text(json.dumps([]), encoding='utf-8')
    assert events.main(['--reference', str(reference), '--candidate', str(candidate),
                        '--json']) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload['f1'] is None
    assert payload['precision'] is None
    assert payload['applicable'] is False


def test_scores_are_finite_or_null():
    result = events.score_events([event('r1', 60, 0.0)], [event('c1', 60, 0.02)])
    for key, value in result.items():
        if isinstance(value, float):
            assert math.isfinite(value), key
