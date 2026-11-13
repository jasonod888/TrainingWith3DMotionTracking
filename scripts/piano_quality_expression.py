"""M3: `piano-expression-metrics-1` for release, audible ending, velocity and pedal.

Each scorer derives its denominator from the **full scorable reference population**, not from the
matched pairs. An unmatched note is a failure, not an omission: removing a difficult note cannot
improve coverage or hide a failure. Uncertain reference values are unscorable and reported.

Physical key release, audible ending, captured velocity, renderer intensity and pedal state stay
distinct; an unavailable reference produces an explicit unavailable result, never verified
silence or a verified pedal-off.
"""
import math
import statistics

METRIC_VERSION = 'piano-expression-metrics-1'
RELEASE_TOLERANCE = 0.080
VELOCITY_TOLERANCE = 8
VELOCITY_WIDE_TOLERANCE = 16
PEDAL_TOLERANCE = 0.050
STATE_STEP_SECONDS = 0.010
PEDAL_TYPES = ('sustain', 'soft', 'sostenuto')
# A candidate ending interval wider than max(50 ms, 3x the reference interval) is treated as
# unresolved uncertainty rather than a point estimate, so widening cannot buy success.
END_MIN_WIDTH_LIMIT_SECONDS = 0.050
END_WIDTH_FACTOR = 3.0


class ExpressionError(ValueError):
    """The expression comparison cannot be computed as specified."""


def _percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _stats(errors):
    if not errors:
        return {'n': 0, 'bias': None, 'mae': None, 'median_absolute': None,
                'p95_absolute': None}
    absolute = [abs(value) for value in errors]
    return {'n': len(errors), 'bias': round(statistics.fmean(errors), 6),
            'mae': round(statistics.fmean(absolute), 6),
            'median_absolute': round(statistics.median(absolute), 6),
            'p95_absolute': round(_percentile(absolute, 0.95), 6)}


def _rate(numerator, denominator):
    return None if not denominator else numerator / denominator


def unavailable(attribute, reason):
    return {'metric_version': METRIC_VERSION, 'attribute': attribute,
            'reference_status': 'unavailable', 'status': 'unscorable', 'applicable': False,
            'reasons': [reason], 'n': 0, 'reference_population': 0,
            'unmatched': None, 'all_reference_within_tolerance': None,
            'bias': None, 'mae': None, 'median_absolute': None, 'p95_absolute': None}


def candidate_notes(document):
    """Candidate note attributes from a versioned performance document."""
    notes = {}
    for note in document['notes']:
        release = note.get('key_release_seconds')
        ending = note.get('audible_end')
        notes[str(note['id'])] = {
            'release_seconds': None if release is None else float(release),
            'velocity_midi': note.get('velocity_midi'),
            'audible_end': (None if not ending else
                            {'earliest': ending.get('earliest'),
                             'latest': ending.get('latest'),
                             'status': ending.get('status')}),
            'legacy_release': bool((note.get('legacy') or {}).get('duration_seconds')),
        }
    return notes


def candidate_pedal(document, pedal_type='sustain'):
    return [{'id': str(event['id']), 'type': event['type'],
             'onset_seconds': float(event['onset_seconds']),
             'value': float(event['value'])}
            for event in document['pedal'] if event['type'] == pedal_type]


def _verified(reference, attribute):
    events = {}
    for event in reference['attributes'][attribute]['events']:
        if event.get('status', 'verified') == 'verified':
            events[event['note_id']] = event
    return events


def _pairs_by_reference(pairs):
    return {pair['reference_id']: pair for pair in pairs}


def release_scores(reference, candidates, pairs, tolerance=RELEASE_TOLERANCE,
                   reference_status='verified'):
    """Physical key release errors, with the full population as the denominator."""
    if reference_status == 'unavailable':
        return unavailable('key_release', 'no independent key-release reference')
    expected = _verified(reference, 'key_release')
    by_reference = _pairs_by_reference(pairs)
    errors = []
    errors_by_note = {}
    uncertain_ids = set()
    unmatched_ids = set()
    missing_ids = set()
    legacy_estimates = 0
    for note_id, target in expected.items():
        uncertainty = float(target.get('uncertainty_seconds') or 0.0)
        if uncertainty > tolerance / 2.0:
            uncertain_ids.add(note_id)
            continue
        pair = by_reference.get(note_id)
        if pair is None:
            unmatched_ids.add(note_id)
            continue
        candidate = candidates.get(pair['candidate_id'])
        if candidate is None or candidate['release_seconds'] is None:
            if candidate is not None and candidate['legacy_release']:
                legacy_estimates += 1
            missing_ids.add(note_id)
            continue
        error = candidate['release_seconds'] - float(target['release_seconds'])
        errors.append(error)
        errors_by_note[note_id] = error
    stats = _stats(errors)
    within = sum(1 for value in errors if abs(value) <= tolerance + 1e-9)
    population = len(expected) - len(uncertain_ids)
    return {
        'metric_version': METRIC_VERSION,
        'attribute': 'key_release',
        'reference_status': reference_status,
        'tolerance_seconds': tolerance,
        'status': 'measured' if population else 'unscorable',
        'applicable': bool(population),
        **stats,
        'reference_population': population,
        'unmatched': len(unmatched_ids),
        'missing_candidate_release': len(missing_ids),
        'legacy_estimate_excluded': legacy_estimates,
        'reference_uncertain': len(uncertain_ids),
        'failures': len(unmatched_ids) + len(missing_ids),
        'within_tolerance': within,
        'within_tolerance_rate': _rate(within, stats['n']),
        'all_reference_within_tolerance': _rate(within, population),
        'errors': {note_id: round(value, 6) for note_id, value in errors_by_note.items()},
        'measured_note_ids': sorted(errors_by_note),
        'missing_note_ids': sorted(unmatched_ids | missing_ids),
        'reference_uncertain_ids': sorted(uncertain_ids),
        'notes': ['legacy or assumed releases are never treated as measured key release',
                  'unmatched reference notes count against the all-reference rate',
                  'per-note errors are retained for damage and common-set comparisons'],
    }


def audible_end_scores(reference, candidates, pairs, reference_status='verified'):
    """Distance of a defined point estimate from the independently annotated interval."""
    if reference_status == 'unavailable':
        return unavailable('audible_end', 'no independently annotated audible ending')
    expected = _verified(reference, 'audible_end')
    by_reference = _pairs_by_reference(pairs)
    inside = 0
    outside = []
    interval_errors = {}
    unmatched_ids = set()
    abstained_ids = set()
    widths = []
    for note_id, target in expected.items():
        pair = by_reference.get(note_id)
        if pair is None:
            unmatched_ids.add(note_id)
            continue
        candidate = (candidates.get(pair['candidate_id']) or {}).get('audible_end') or {}
        if candidate.get('status') != 'scorable':
            abstained_ids.add(note_id)
            continue
        earliest, latest = candidate.get('earliest'), candidate.get('latest')
        if earliest is None or latest is None:
            abstained_ids.add(note_id)
            continue
        width = float(latest) - float(earliest)
        reference_width = float(target['latest']) - float(target['earliest'])
        if width < 0:
            abstained_ids.add(note_id)
            continue
        # A caller-declared point estimate is bounded: an interval wider than the qualified
        # rule represents unresolved uncertainty, not a precise ending, and abstains.
        limit = max(END_MIN_WIDTH_LIMIT_SECONDS, END_WIDTH_FACTOR * reference_width)
        if width > limit:
            abstained_ids.add(note_id)
            continue
        widths.append(width)
        point = (float(earliest) + float(latest)) / 2.0
        if float(target['earliest']) <= point <= float(target['latest']):
            inside += 1
            interval_errors[note_id] = 0.0
        elif point < float(target['earliest']):
            error = float(target['earliest']) - point
            outside.append(error)
            interval_errors[note_id] = error
        else:
            error = point - float(target['latest'])
            outside.append(error)
            interval_errors[note_id] = error
    population = len(expected)
    scorable = len(interval_errors)
    return {
        'metric_version': METRIC_VERSION,
        'attribute': 'audible_end',
        'reference_status': reference_status,
        'status': 'measured' if population else 'unscorable',
        'applicable': bool(population),
        'reference_population': population,
        'scorable_point_predictions': scorable,
        'unmatched': len(unmatched_ids),
        'abstained_uncertain_end': len(abstained_ids),
        'abstained_ids': sorted(abstained_ids),
        'inside_interval': inside,
        'inside_interval_rate': _rate(inside, population),
        'all_reference_within_tolerance': _rate(inside, population),
        'interval_error_mean_seconds': (round(statistics.fmean(interval_errors.values()), 6)
                                        if interval_errors else None),
        'outside_interval_n': len(outside),
        'outside_interval_mean_seconds': round(statistics.fmean(outside), 6)
        if outside else None,
        'outside_interval_median_seconds': round(statistics.median(outside), 6)
        if outside else None,
        'outside_interval_p95_seconds': round(_percentile(outside, 0.95), 6)
        if outside else None,
        'candidate_interval_width_mean_seconds': (round(statistics.fmean(widths), 6)
                                                  if widths else None),
        'errors': {note_id: round(value, 6) for note_id, value in interval_errors.items()},
        'measured_note_ids': sorted(interval_errors),
        'missing_note_ids': sorted(unmatched_ids | abstained_ids),
        'width_limit_seconds': round(max(END_MIN_WIDTH_LIMIT_SECONDS,
                                         END_WIDTH_FACTOR * 0.1), 6),
        'notes': ['the point estimate is the midpoint of a bounded candidate interval',
                  'uncertain or over-wide candidate intervals abstain, never score',
                  'interval_error_mean_seconds counts zeros, so complete recovery is visible',
                  'outside_interval_* is a diagnostic over failed predictions only'],
    }


def velocity_scores(reference, candidates, pairs, tolerance=VELOCITY_TOLERANCE,
                    wide=VELOCITY_WIDE_TOLERANCE, reference_status='verified'):
    """Captured MIDI velocity errors against the full verified reference population."""
    if reference_status == 'unavailable':
        return unavailable('velocity', 'no captured MIDI velocity reference')
    expected = _verified(reference, 'velocity')
    by_reference = _pairs_by_reference(pairs)
    errors = []
    errors_by_note = {}
    unmatched_ids = set()
    missing_ids = set()
    for note_id, target in expected.items():
        pair = by_reference.get(note_id)
        if pair is None:
            unmatched_ids.add(note_id)
            continue
        candidate = candidates.get(pair['candidate_id'])
        velocity = None if candidate is None else candidate['velocity_midi']
        if velocity is None:
            missing_ids.add(note_id)
            continue
        error = float(velocity) - float(target['velocity_midi'])
        errors.append(error)
        errors_by_note[note_id] = error
    stats = _stats(errors)
    population = len(expected)
    within = sum(1 for value in errors if abs(value) <= tolerance + 1e-9)
    within_wide = sum(1 for value in errors if abs(value) <= wide + 1e-9)
    return {
        'metric_version': METRIC_VERSION,
        'attribute': 'velocity',
        'reference_status': reference_status,
        'tolerance_units': tolerance,
        'status': 'measured' if population else 'unscorable',
        'applicable': bool(population),
        **stats,
        'reference_population': population,
        'unmatched': len(unmatched_ids),
        'missing_candidate_velocity': len(missing_ids),
        'failures': len(unmatched_ids) + len(missing_ids),
        'within_tolerance': within,
        'within_tolerance_rate': _rate(within, stats['n']),
        'within_wide_tolerance': within_wide,
        'all_reference_within_tolerance': _rate(within, population),
        'errors': {note_id: round(value, 6) for note_id, value in errors_by_note.items()},
        'measured_note_ids': sorted(errors_by_note),
        'missing_note_ids': sorted(unmatched_ids | missing_ids),
        'notes': ['velocity is the captured 1..127 instrument value',
                  'renderer intensity and audible level are different quantities',
                  'unmatched notes and missing candidate values count against coverage',
                  'per-note errors are retained for damage and common-set comparisons'],
    }


def _state_at(events, time):
    state = 0.0
    for event in events:
        if event['onset_seconds'] > time:
            break
        state = 1.0 if event['value'] >= 0.5 else 0.0
    return state


def _transitions(events):
    transitions = []
    previous = 0.0
    for event in sorted(events, key=lambda item: item['onset_seconds']):
        state = 1.0 if event['value'] >= 0.5 else 0.0
        if state != previous:
            transitions.append({'id': f'{event["id"]}-{int(state)}',
                                'pitch': int(state), 'onset_seconds': event['onset_seconds']})
            previous = state
    return transitions


def clip_pedal_events(events, interval):
    """Keep events inside the interval and carry the state known at interval start."""
    start, end = float(interval[0]), float(interval[1])
    ordered = sorted(events, key=lambda event: event['onset_seconds'])
    carry = [event for event in ordered if event['onset_seconds'] < start]
    inside = [event for event in ordered if start <= event['onset_seconds'] <= end]
    if carry:
        state = 1.0 if carry[-1]['value'] >= 0.5 else 0.0
        inside = [{'id': 'carry-in', 'type': carry[-1].get('type', 'sustain'),
                   'onset_seconds': start, 'value': state, 'carried_in': True}] + inside
    return inside


def pedal_scores(reference, candidate_events, interval, pedal_type='sustain',
                 tolerance=PEDAL_TOLERANCE, reference_status='verified'):
    """Binary pedal transition accuracy plus time-weighted state agreement."""
    try:
        from scripts import piano_quality_events as events_module
    except ImportError:  # pragma: no cover
        import piano_quality_events as events_module

    if reference_status == 'unavailable':
        return unavailable('pedal', 'no captured controller reference')

    expected_events = [event for event in reference['attributes']['pedal']['events']
                       if event['type'] == pedal_type
                       and event.get('status', 'verified') == 'verified']
    if not expected_events:
        result = unavailable('pedal', f'no captured {pedal_type} controller reference')
        result['pedal_type'] = pedal_type
        return result

    for label, values in (('reference', [event['value'] for event in expected_events]),
                          ('candidate', [event['value'] for event in candidate_events])):
        if any(abs(float(value) - round(float(value))) > 1e-9 for value in values):
            result = unavailable('pedal', f'{label} pedal values are continuous; the calibrated '
                                          'continuous contract is not implemented')
            result['pedal_type'] = pedal_type
            return result

    expected = _transitions(clip_pedal_events(expected_events, interval))
    actual = _transitions(clip_pedal_events(candidate_events, interval))

    matched = 0
    errors = []
    missed = 0
    if expected or actual:
        correspondence = events_module.match_events(expected, actual, tolerance=tolerance)
        matched = correspondence['matched']
        for pair in correspondence['pairs']:
            errors.append(pair['signed_error_seconds'])
        missed = len(expected) - matched
    false_transitions = len(actual) - matched

    start, end = float(interval[0]), float(interval[1])
    steps = max(1, int(round((end - start) / STATE_STEP_SECONDS)))
    agree = 0
    false_on = 0.0
    false_off = 0.0
    for step in range(steps):
        time = start + (step + 0.5) * (end - start) / steps
        expected_state = _state_at(expected_events, time)
        actual_state = _state_at(candidate_events, time)
        if expected_state == actual_state:
            agree += 1
        elif actual_state > expected_state:
            false_on += (end - start) / steps
        else:
            false_off += (end - start) / steps

    precision = matched / len(actual) if actual else None
    recall = matched / len(expected) if expected else None
    f1 = (2 * matched / (len(expected) + len(actual))
          if len(expected) + len(actual) else None)
    stats = _stats(errors)
    within = sum(1 for value in errors if abs(value) <= tolerance + 1e-9)
    return {
        'metric_version': METRIC_VERSION,
        'attribute': 'pedal',
        'pedal_type': pedal_type,
        'reference_status': reference_status,
        'scope': 'binary',
        'tolerance_seconds': tolerance,
        'status': 'measured',
        'applicable': True,
        'reference_transitions': len(expected),
        'candidate_transitions': len(actual),
        'matched_transitions': matched,
        'missed_transitions': missed,
        'false_transitions': false_transitions,
        'precision': precision, 'recall': recall, 'f1': f1,
        **stats,
        'within_tolerance': within,
        'within_tolerance_rate': _rate(within, stats['n']),
        'time_weighted_agreement': round(agree / steps, 6),
        'false_on_seconds': round(false_on, 6),
        'false_off_seconds': round(false_off, 6),
        'state_step_seconds': STATE_STEP_SECONDS,
        'notes': ['absent controller data is unavailable, not an explicit pedal-off',
                  'false-on and false-off time are reported separately',
                  'continuous values require the calibrated continuous contract'],
    }
