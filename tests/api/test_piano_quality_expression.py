"""M3: expression scores keep full-population denominators and never promote guesses."""
import pytest

import scripts.piano_performance as performance
import scripts.piano_quality_expression as expression
import scripts.piano_quality_reference as reference

PAIRS = [{'reference_id': 'n1', 'candidate_id': 'c1', 'signed_error_seconds': 0.0},
         {'reference_id': 'n2', 'candidate_id': 'c2', 'signed_error_seconds': 0.0}]


def base_reference(*, releases=None, endings=None, velocities=None, pedal=None, notes=None):
    attributes = reference.unavailable_attributes()
    note_events = notes or [{'id': f'n{index + 1}', 'pitch': 60 + index,
                             'onset_seconds': 0.2 + index * 0.2} for index in range(2)]
    attributes['pitch_onset'] = reference.attribute('verified', note_events, 'reviewed')
    if releases is not None:
        values, uncertainties = (releases if isinstance(releases, tuple)
                                 else (releases, [0.0] * len(releases)))
        attributes['key_release'] = reference.attribute(
            'verified', [{'id': f'r{index + 1}', 'note_id': f'n{index + 1}',
                          'release_seconds': value,
                          'uncertainty_seconds': uncertainties[index]}
                         for index, value in enumerate(values)], 'capture')
    if endings is not None:
        attributes['audible_end'] = reference.attribute(
            'verified', [{'id': f'e{index + 1}', 'note_id': f'n{index + 1}',
                          'earliest': earliest, 'latest': latest}
                         for index, (earliest, latest) in enumerate(endings)], 'annotated')
    if velocities is not None:
        attributes['velocity'] = reference.attribute(
            'verified', [{'id': f'v{index + 1}', 'note_id': f'n{index + 1}',
                          'velocity_midi': value}
                         for index, value in enumerate(velocities)], 'capture')
    if pedal is not None:
        attributes['pedal'] = reference.attribute(
            'verified', [{'id': f'p{index + 1}', 'type': 'sustain',
                          'onset_seconds': onset, 'value': value}
                         for index, (onset, value) in enumerate(pedal)], 'capture')
    return reference.new_reference(
        reference_id='ref', source={'sha256': 'a' * 64, 'seconds': 2.0,
                                    'sample_rate': 8000, 'channels': 1},
        performance={'performance_id': 'p', 'performer_id': 'p01',
                     'recording_id': 'r01', 'work_id': 'w01'},
        rights={'license': 'CC-BY-4.0', 'status': 'approved'},
        scored_interval=[0.0, 2.0],
        timeline={**reference.default_timeline(),
                  'video_to_analysis': {**reference.default_timeline()['video_to_analysis'],
                                        'verified': True}},
        attributes=attributes)


def make_document(notes, pedal=()):
    document = performance.new_document(
        performance_id='candidate',
        source={'sha256': 'b' * 64, 'duration_seconds': 2.0, 'sample_rate': 8000,
                'channels': 1})
    for note in notes:
        performance.add_note(document, **note)
    for event in pedal:
        performance.add_pedal(document, **event)
    return document


def note(identifier, pitch, onset, release=None, velocity=None, audible_end=None,
         legacy=None, render_intensity=None):
    return {'note_id': identifier, 'pitch_midi': pitch, 'onset_seconds': onset,
            'key_release_seconds': release, 'velocity_midi': velocity,
            'audible_end': audible_end, 'legacy': legacy,
            'render_intensity': render_intensity}


# ------------------------------------------------------------------------------- release

def test_release_scores_measure_only_measured_releases():
    ref = base_reference(releases=[0.600, 1.000])
    document = make_document([note('c1', 60, 0.2, release=0.610, velocity=80),
                              note('c2', 61, 0.4, release=1.100, velocity=80)])
    result = expression.release_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['n'] == 2
    assert result['mae'] == pytest.approx(0.055, abs=1e-9)
    assert result['within_tolerance'] == 1
    assert result['all_reference_within_tolerance'] == pytest.approx(0.5)
    assert result['reference_population'] == 2


def test_legacy_release_is_excluded_and_counted():
    ref = base_reference(releases=[0.600, 1.000])
    legacy = {'duration_seconds': 0.4, 'velocity_amplitude': 0.5,
              'semantics': 'legacy-not-release'}
    document = make_document([note('c1', 60, 0.2, release=None, velocity=80, legacy=legacy),
                              note('c2', 61, 0.4, release=1.010, velocity=80)])
    result = expression.release_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['n'] == 1
    assert result['legacy_estimate_excluded'] == 1
    assert result['missing_candidate_release'] == 1
    assert result['all_reference_within_tolerance'] == pytest.approx(0.5)


def test_reference_uncertainty_beyond_half_tolerance_is_unscorable():
    ref = base_reference(releases=([0.600, 1.000], [0.060, 0.001]))
    document = make_document([note('c1', 60, 0.2, release=0.600, velocity=80),
                              note('c2', 61, 0.4, release=1.001, velocity=80)])
    result = expression.release_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['reference_uncertain'] == 1
    assert result['reference_population'] == 1
    assert result['n'] == 1


def test_unmatched_notes_count_against_the_all_reference_rate():
    """Review P1: one matched note in a four-note reference is 25 %, not 100 %."""
    notes = [{'id': f'n{index + 1}', 'pitch': 60 + index, 'onset_seconds': 0.2 + index * 0.3}
             for index in range(4)]
    ref = base_reference(notes=notes, releases=[0.5, 0.8, 1.1, 1.4],
                         velocities=[60, 60, 60, 60])
    document = make_document([note('c1', 60, 0.2, release=0.5, velocity=60)])
    pairs = [{'reference_id': 'n1', 'candidate_id': 'c1', 'signed_error_seconds': 0.0}]
    release = expression.release_scores(ref, expression.candidate_notes(document), pairs)
    velocity = expression.velocity_scores(ref, expression.candidate_notes(document), pairs)
    for result in (release, velocity):
        assert result['reference_population'] == 4
        assert result['unmatched'] == 3
        assert result['all_reference_within_tolerance'] == pytest.approx(0.25)
        assert result['n'] == 1


def test_unavailable_reference_is_explicitly_unmeasured():
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=80)])
    result = expression.release_scores(
        base_reference(), expression.candidate_notes(document), PAIRS,
        reference_status='unavailable')
    assert result['reference_status'] == 'unavailable'
    assert result['status'] == 'unscorable'
    assert result['mae'] is None and result['all_reference_within_tolerance'] is None


# -------------------------------------------------------------------------- audible end

def test_audible_end_scores_the_point_estimate_against_the_interval():
    ref = base_reference(endings=[(1.0, 1.2), (1.5, 1.7)])
    document = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 1.05, 'latest': 1.15, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 1.95, 'latest': 2.00, 'status': 'scorable'})])
    result = expression.audible_end_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['inside_interval'] == 1
    assert result['inside_interval_rate'] == pytest.approx(0.5)
    assert result['outside_interval_mean_seconds'] == pytest.approx(0.275, abs=1e-9)


def test_a_wide_uncertain_ending_cannot_claim_success():
    """Review P1: 0.2-1.5 s marked uncertain must abstain, not score 100 %."""
    ref = base_reference(endings=[(0.9, 1.0), (1.5, 1.7)])
    document = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.2, 'latest': 1.5, 'status': 'uncertain'}),
        note('c2', 61, 0.4, release=1.4, velocity=80)])
    result = expression.audible_end_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['inside_interval'] == 0
    assert result['abstained_uncertain_end'] == 2
    assert result['all_reference_within_tolerance'] == pytest.approx(0.0)
    assert result['candidate_interval_width_mean_seconds'] is None


def test_widening_a_scorable_interval_does_not_improve_the_error():
    ref = base_reference(endings=[(0.9, 1.0), (1.5, 1.7)])
    narrow = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.95, 'latest': 1.05, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 1.6, 'latest': 1.7, 'status': 'scorable'})])
    wide = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.3, 'latest': 1.7, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 1.3, 'latest': 2.3, 'status': 'scorable'})])
    narrow_result = expression.audible_end_scores(ref, expression.candidate_notes(narrow),
                                                  PAIRS)
    wide_result = expression.audible_end_scores(ref, expression.candidate_notes(wide), PAIRS)
    assert narrow_result['inside_interval'] == 2
    assert wide_result['inside_interval'] == 0
    assert wide_result['abstained_uncertain_end'] == 2   # over-wide intervals abstain
    assert wide_result['candidate_interval_width_mean_seconds'] is None


def test_asymmetric_widening_cannot_buy_success():
    """Review P2: 0.2-0.4 scores 0%, and extending it to 1.7 must abstain, not score 100%."""
    ref = base_reference(endings=[(0.9, 1.0), (1.5, 1.7)])
    short = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.2, 'latest': 0.4, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 0.4, 'latest': 0.5, 'status': 'scorable'})])
    stretched = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.2, 'latest': 1.7, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 0.4, 'latest': 1.7, 'status': 'scorable'})])
    short_result = expression.audible_end_scores(ref, expression.candidate_notes(short), PAIRS)
    stretched_result = expression.audible_end_scores(ref, expression.candidate_notes(stretched),
                                                     PAIRS)
    assert short_result['inside_interval'] == 0
    assert stretched_result['inside_interval'] == 0
    assert stretched_result['abstained_uncertain_end'] == 2
    assert stretched_result['inside_interval_rate'] == pytest.approx(0.0)


def test_touching_and_enclosing_intervals_are_judged_by_the_point_estimate():
    ref = base_reference(endings=[(0.9, 1.0), (1.5, 1.7)])
    document = make_document([
        note('c1', 60, 0.2, release=0.9, velocity=80,
             audible_end={'earliest': 0.8, 'latest': 1.0, 'status': 'scorable'}),
        note('c2', 61, 0.4, release=1.4, velocity=80,
             audible_end={'earliest': 1.45, 'latest': 1.75, 'status': 'scorable'})])
    result = expression.audible_end_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['inside_interval'] == 2      # midpoints 0.9 and 1.6 are both inside
    assert result['interval_error_mean_seconds'] == pytest.approx(0.0)


# ------------------------------------------------------------------------------- velocity

def test_velocity_scores_use_captured_velocity_only():
    ref = base_reference(velocities=[60, 80])
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=64,
                                   render_intensity=1.0),
                              note('c2', 61, 0.4, release=0.9, velocity=100)])
    result = expression.velocity_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['mae'] == pytest.approx(12.0, abs=1e-9)
    assert result['within_tolerance'] == 1
    assert result['all_reference_within_tolerance'] == pytest.approx(0.5)


def test_missing_candidate_velocity_cannot_vanish_from_the_denominator():
    ref = base_reference(velocities=[60, 80])
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=60),
                              note('c2', 61, 0.4, release=0.9, velocity=None)])
    result = expression.velocity_scores(ref, expression.candidate_notes(document), PAIRS)
    assert result['n'] == 1
    assert result['missing_candidate_velocity'] == 1
    assert result['all_reference_within_tolerance'] == pytest.approx(0.5)


def test_deleting_a_bad_note_improves_mae_but_not_coverage():
    ref = base_reference(releases=[0.600, 1.000])
    full = make_document([note('c1', 60, 0.2, release=0.600, velocity=80),
                          note('c2', 61, 0.4, release=1.400, velocity=80)])
    pruned = make_document([note('c1', 60, 0.2, release=0.600, velocity=80)])
    before = expression.release_scores(ref, expression.candidate_notes(full), PAIRS)
    after = expression.release_scores(ref, expression.candidate_notes(pruned), PAIRS)
    assert before['mae'] > after['mae']
    assert after['missing_candidate_release'] + after['unmatched'] >= 1
    assert after['all_reference_within_tolerance'] <= before['all_reference_within_tolerance']


# ---------------------------------------------------------------------------------- pedal

def test_pedal_transitions_and_state_agreement():
    ref = base_reference(pedal=[(0.500, 1.0), (1.000, 0.0)])
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=80)],
                             pedal=[{'pedal_id': 'p1', 'pedal_type': 'sustain',
                                     'onset_seconds': 0.510, 'value': 1.0},
                                    {'pedal_id': 'p2', 'pedal_type': 'sustain',
                                     'onset_seconds': 1.010, 'value': 0.0}])
    result = expression.pedal_scores(ref, expression.candidate_pedal(document), [0.0, 2.0])
    assert result['reference_transitions'] == 2
    assert result['matched_transitions'] == 2
    assert result['precision'] == pytest.approx(1.0)
    assert result['time_weighted_agreement'] > 0.9


def test_a_missed_pedal_off_produces_false_on_time():
    ref = base_reference(pedal=[(0.500, 1.0), (1.000, 0.0)])
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=80)],
                             pedal=[{'pedal_id': 'p1', 'pedal_type': 'sustain',
                                     'onset_seconds': 0.500, 'value': 1.0}])
    result = expression.pedal_scores(ref, expression.candidate_pedal(document), [0.0, 2.0])
    assert result['missed_transitions'] == 1
    assert result['recall'] == pytest.approx(0.5)
    assert result['false_on_seconds'] > 0.5
    assert result['false_off_seconds'] == 0.0


def test_absent_controller_reference_is_unavailable_not_off():
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=80)],
                             pedal=[{'pedal_id': 'p1', 'pedal_type': 'sustain',
                                     'onset_seconds': 0.500, 'value': 1.0}])
    result = expression.pedal_scores(base_reference(), expression.candidate_pedal(document),
                                     [0.0, 2.0])
    assert result['reference_status'] == 'unavailable'
    assert result['status'] == 'unscorable'
    assert result.get('f1') is None
    assert result.get('false_on_seconds') is None


def test_carry_in_state_is_preserved_when_the_crop_starts_inside_sustain():
    ref = base_reference(pedal=[(0.100, 1.0), (1.500, 0.0)])
    events = expression.clip_pedal_events(ref['attributes']['pedal']['events'], [0.5, 1.0])
    assert events[0]['carried_in'] is True
    assert events[0]['onset_seconds'] == pytest.approx(0.5)
    assert events[0]['value'] == 1.0
    document = make_document([note('c1', 60, 0.2, release=0.6, velocity=80)],
                             pedal=[{'pedal_id': 'p1', 'pedal_type': 'sustain',
                                     'onset_seconds': 0.500, 'value': 1.0},
                                    {'pedal_id': 'p2', 'pedal_type': 'sustain',
                                     'onset_seconds': 0.800, 'value': 0.0}])
    result = expression.pedal_scores(ref, expression.candidate_pedal(document),
                                     [0.5, 1.0], pedal_type='sustain')
    # Reference: on at 0.1, off at 1.5 -> the crop is entirely sustain, with one carry-in on.
    assert result['reference_transitions'] == 1
    assert result['false_off_seconds'] > 0.0


def test_continuous_pedal_values_are_unscorable_not_thresholded():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = reference.attribute(
        'verified', [{'id': 'n1', 'pitch': 60, 'onset_seconds': 0.2}], 'reviewed')
    attributes['pedal'] = reference.attribute(
        'verified', [{'id': 'p1', 'type': 'sustain', 'onset_seconds': 0.5, 'value': 0.4},
                     {'id': 'p2', 'type': 'sustain', 'onset_seconds': 0.9, 'value': 0.0}],
        'capture')
    ref = base_reference()
    ref['attributes']['pedal'] = attributes['pedal']
    result = expression.pedal_scores(ref, [], [0.0, 2.0])
    assert result['status'] == 'unscorable'
    assert result['reference_status'] == 'unavailable'
    assert any('continuous' in reason for reason in result['reasons'])
