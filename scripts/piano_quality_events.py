"""M2: `piano-event-metrics-2`, the canonical event correspondence scorer.

Matching is a per-pitch dynamic program that first maximises the number of pairs, then minimises
the summed absolute onset distance, then applies a documented match-first tie-break. The
returned correspondence keeps the original event ids and signed onset errors, and every
downstream attribute scorer consumes that same correspondence.

This replaces the two-pointer greedy for the measurement path. ``legacy_score`` reproduces the
old behaviour explicitly, so historical numbers can be re-derived without being mixed with v2.
"""
import argparse
import json
import math
import statistics
import sys
from pathlib import Path

METRIC_VERSION = 'piano-event-metrics-2'
TOLERANCES = {'onset_match_seconds': 0.050, 'onset_within_seconds': 0.020,
              'onset_diagnostic_seconds': 0.050}
MAX_CELLS = 1_000_000


class ScorerError(ValueError):
    """The correspondence cannot be computed as specified."""


def normalize_events(events):
    """Accept dicts with ``onset``/``onset_seconds`` and preserve or synthesize stable ids."""
    normalized = []
    synthesized = False
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise ScorerError(f'event {index} is not an object')
        onset = event.get('onset_seconds', event.get('onset'))
        if onset is None:
            raise ScorerError(f'event {index} has no onset')
        onset = float(onset)
        if not math.isfinite(onset):
            raise ScorerError(f'event {index} has a non-finite onset')
        pitch = event.get('pitch', event.get('pitch_midi'))
        if isinstance(pitch, bool) or not isinstance(pitch, int):
            raise ScorerError(f'event {index} has no integer pitch')
        if not 0 <= pitch <= 127:
            raise ScorerError(f'event {index} pitch is outside 0..127')
        identifier = event.get('id')
        if identifier is None:
            identifier = f'event-{index:05d}'
            synthesized = True
        uncertainty = event.get('onset_uncertainty_seconds', 0.0)
        if uncertainty is None:
            uncertainty = 0.0
        uncertainty = float(uncertainty)
        if not math.isfinite(uncertainty) or uncertainty < 0:
            raise ScorerError(f'event {index} has invalid onset uncertainty')
        normalized.append({'id': str(identifier), 'pitch': pitch, 'onset_seconds': onset,
                           'onset_uncertainty_seconds': uncertainty,
                           'status': event.get('status', 'verified')})
    identifiers = [event['id'] for event in normalized]
    if len(set(identifiers)) != len(identifiers):
        raise ScorerError('event ids are not unique')
    return sorted(normalized, key=lambda event: (event['onset_seconds'], event['pitch'],
                                                 event['id'])), synthesized


def _round(value):
    return round(float(value), 9)


def _better(candidate, best):
    """Higher count wins; then smaller summed distance."""
    if candidate[0] != best[0]:
        return candidate[0] > best[0]
    return _round(candidate[1]) < _round(best[1])


def _match_pitch(reference, candidate, tolerance):
    """Cardinality-first, then minimum-distance DP; match-first deterministic tie-break."""
    n, m = len(reference), len(candidate)
    if n * m > MAX_CELLS:
        raise ScorerError(
            f'per-pitch matching needs {n}x{m} cells, above the {MAX_CELLS} bound; refusing to '
            'truncate or change matching semantics')
    count = [[0] * (m + 1) for _ in range(n + 1)]
    distance = [[0.0] * (m + 1) for _ in range(n + 1)]
    for index in range(n - 1, -1, -1):
        onset = reference[index]['onset_seconds']
        for other in range(m - 1, -1, -1):
            best = (count[index + 1][other], distance[index + 1][other])
            skip_candidate = (count[index][other + 1], distance[index][other + 1])
            if _better(skip_candidate, best):
                best = skip_candidate
            delta = candidate[other]['onset_seconds'] - onset
            if abs(delta) <= tolerance + 1e-9:
                matched = (count[index + 1][other + 1] + 1,
                           distance[index + 1][other + 1] + abs(delta))
                if _better(matched, best):
                    best = matched
            count[index][other] = best[0]
            distance[index][other] = best[1]

    pairs = []
    index = other = 0
    while index < n and other < m:
        target = (count[index][other], _round(distance[index][other]))
        delta = candidate[other]['onset_seconds'] - reference[index]['onset_seconds']
        if abs(delta) <= tolerance + 1e-9:
            matched = (count[index + 1][other + 1] + 1,
                       _round(distance[index + 1][other + 1] + abs(delta)))
            if matched == target:
                pairs.append({'reference_id': reference[index]['id'],
                              'candidate_id': candidate[other]['id'],
                              'signed_error_seconds': _round(delta)})
                index += 1
                other += 1
                continue
        if (count[index + 1][other], _round(distance[index + 1][other])) == target:
            index += 1
            continue
        if (count[index][other + 1], _round(distance[index][other + 1])) == target:
            other += 1
            continue
        raise ScorerError('matching reconstruction stalled; the DP table is inconsistent')
    return pairs


def match_events(reference, candidate, tolerance=TOLERANCES['onset_match_seconds']):
    """The canonical correspondence shared by every attribute scorer."""
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)):
        raise ScorerError('tolerance must be a number')
    if not 0 < float(tolerance) <= 1.0:
        raise ScorerError('tolerance must be within (0, 1] seconds')
    reference_events, _ = normalize_events(reference)
    candidate_events, _ = normalize_events(candidate)
    by_pitch = {}
    for event in reference_events:
        by_pitch.setdefault(event['pitch'], ([], []))[0].append(event)
    for event in candidate_events:
        by_pitch.setdefault(event['pitch'], ([], []))[1].append(event)

    pairs = []
    for pitch in sorted(by_pitch):
        expected, actual = by_pitch[pitch]
        for event in expected:
            if event['onset_seconds'] < 0:
                raise ScorerError('reference onset must not be negative')
        for event in actual:
            if event['onset_seconds'] < 0:
                raise ScorerError('candidate onset must not be negative')
        for pair in _match_pitch(expected, actual, float(tolerance)):
            reference_event = next(item for item in expected
                                   if item['id'] == pair['reference_id'])
            pair['reference_onset_uncertainty_seconds'] = \
                reference_event.get('onset_uncertainty_seconds', 0.0)
            pairs.append(pair)
    pairs.sort(key=lambda pair: (pair['signed_error_seconds'], pair['reference_id']))
    return {'metric_version': METRIC_VERSION, 'tolerance_seconds': float(tolerance),
            'signed_error_convention': 'candidate onset minus reference onset; positive is late',
            'pairs': pairs,
            'reference_count': len(reference_events), 'candidate_count': len(candidate_events),
            'matched': len(pairs)}


def unavailable_result(detected):
    """A reference that is unavailable yields no accuracy claim, only an observation."""
    return {
        'metric_version': METRIC_VERSION,
        'reference_status': 'unavailable',
        'applicable': False,
        'detected_notes': detected,
        'reference_count': None,
        'candidate_count': None,
        'matched': None,
        'missing': None,
        'extra': None,
        'precision': None,
        'recall': None,
        'f1': None,
        'silent_reference': None,
        'silent_candidate': None,
        'false_activity_notes': None,
        'missing_per_100_reference': None,
        'extra_per_100_reference': None,
        'onset_bias_seconds': None,
        'onset_mae_seconds': None,
        'onset_median_absolute_seconds': None,
        'onset_p95_absolute_seconds': None,
        'matched_within_tolerance': None,
        'matched_within_tolerance_rate': None,
        'matched_within_diagnostic': None,
        'all_reference_within_tolerance': None,
        'ambiguous_reference': None,
        'correspondence': {'pairs': 0, 'conditioning': 'not computed'},
        'notes': ['the reference for this attribute is unavailable; detected events are an '
                  'observation, not a correctness result',
                  'an absent reference is not evidence of verified silence'],
    }


def _percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def score_events(reference, candidate, tolerance=TOLERANCES['onset_match_seconds'],
                 within=TOLERANCES['onset_within_seconds'], reference_status='verified'):
    """Score pitch/onset detection over the verified reference population.

    The full reference is supplied, including uncertain events. Fine-timing eligibility is
    computed from the reference alone, so every candidate is judged against the same frozen
    population. Candidate events inside a pitch-and-time uncertainty region of an uncertain
    reference event are excluded from counts and denominators and reported explicitly.
    """
    all_reference, _ = normalize_events(reference)
    verified = [event for event in all_reference
                if event.get('status', 'verified') == 'verified']
    uncertain = [event for event in all_reference
                 if event.get('status') == 'uncertain']
    candidate_events, _ = normalize_events(candidate)
    preliminary = match_events(verified, candidate_events, tolerance) if verified else {'pairs': []}
    pre_matched = {pair['candidate_id'] for pair in preliminary['pairs']}
    excluded = []
    for event in candidate_events:
        if event['id'] in pre_matched:
            continue
        for unresolved in uncertain:
            reach = tolerance + unresolved['onset_uncertainty_seconds']
            if (event['pitch'] == unresolved['pitch']
                    and abs(event['onset_seconds'] - unresolved['onset_seconds'])
                    <= reach + 1e-9):
                excluded.append(event['id'])
                break
    if reference_status == 'unavailable' or (not verified and uncertain):
        result = unavailable_result(len(candidate_events))
        result['reference_status'] = (reference_status if reference_status != 'verified'
                                      else 'uncertain')
        result['uncertain_reference'] = len(uncertain)
        result['excluded_candidates'] = sorted(set(excluded))
        result['masked_extra'] = len(set(excluded))
        return result

    correspondence = match_events(verified, candidate_events, tolerance)
    pairs = correspondence['pairs']
    matched = len(pairs)
    matched_candidate_ids = {pair['candidate_id'] for pair in pairs}
    matched_reference_ids = {pair['reference_id'] for pair in pairs}

    excluded_set = set(excluded)
    candidate_scored = len(candidate_events) - len(excluded_set)

    # Fine-timing eligibility comes from the reference, never from what the candidate detected.
    timing_unscorable = [event for event in verified
                         if event['onset_uncertainty_seconds'] > within / 2.0]
    timing_unscorable_ids = {event['id'] for event in timing_unscorable}
    scorable_reference = len(verified) - len(timing_unscorable)
    timing_pairs = [pair for pair in pairs
                    if pair['reference_id'] not in timing_unscorable_ids]
    signed = [pair['signed_error_seconds'] for pair in timing_pairs]
    absolute = [abs(value) for value in signed]
    matched_within = sum(1 for value in absolute if value <= within + 1e-9)
    matched_within_wide = sum(1 for value in absolute
                              if value <= TOLERANCES['onset_diagnostic_seconds'] + 1e-9)

    missing = len(verified) - matched
    extra = candidate_scored - matched
    missing_ids = sorted(set(event['id'] for event in verified) - matched_reference_ids)
    extra_ids = sorted(event['id'] for event in candidate_events
                       if event['id'] not in matched_candidate_ids
                       and event['id'] not in excluded_set)

    both_empty = not verified and candidate_scored == 0
    if both_empty:
        precision = recall = f1 = None
    elif candidate_scored == 0:
        precision = None
        recall = 0.0
        f1 = 0.0
    elif not verified:
        precision = 0.0
        recall = None
        f1 = 0.0
    else:
        precision = matched / candidate_scored
        recall = matched / len(verified)
        f1 = 2 * matched / (len(verified) + candidate_scored)

    return {
        'metric_version': METRIC_VERSION,
        'reference_status': reference_status,
        'tolerance_seconds': float(tolerance),
        'within_seconds': float(within),
        'reference_count': len(verified),
        'uncertain_reference': len(uncertain),
        'candidate_count': len(candidate_events),
        'candidate_scored': candidate_scored,
        'excluded_candidates': sorted(excluded_set),
        'masked_extra': len(excluded_set),
        'matched': matched,
        'missing': missing,
        'extra': extra,
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'applicable': not both_empty,
        'silent_reference': not verified,
        'silent_candidate': candidate_scored == 0,
        'false_activity_notes': candidate_scored if not verified else 0,
        'missing_per_100_reference': (100.0 * missing / len(verified)
                                      if verified else None),
        'extra_per_100_reference': (100.0 * extra / len(verified) if verified else None),
        'detection_coverage': matched / len(verified) if verified else None,
        'onset_bias_seconds': round(statistics.fmean(signed), 6) if signed else None,
        'onset_mae_seconds': round(statistics.fmean(absolute), 6) if absolute else None,
        'onset_median_absolute_seconds': (round(statistics.median(absolute), 6)
                                          if absolute else None),
        'onset_p95_absolute_seconds': (_round_value(_percentile(absolute, 0.95))
                                       if absolute else None),
        'matched_within_tolerance': matched_within,
        'matched_within_tolerance_rate': (matched_within / len(timing_pairs)
                                          if timing_pairs else None),
        'matched_within_diagnostic': matched_within_wide,
        'all_reference_within_tolerance': (matched_within / scorable_reference
                                           if scorable_reference else None),
        'ambiguous_reference': len(timing_unscorable),
        'timing_unscorable_ids': sorted(timing_unscorable_ids),
        'scorable_reference': scorable_reference,
        'matched_reference_ids': sorted(matched_reference_ids),
        'missing_reference_ids': missing_ids,
        'matched_candidate_ids': sorted(matched_candidate_ids),
        'extra_candidate_ids': extra_ids,
        'correspondence': {'pairs': matched, 'conditioning': 'matched, timing-scorable only'},
        'notes': [
            'F1 is a tolerance-based event-detection percentage, not duration, dynamics or sound.',
            'fine-timing eligibility is computed from the reference alone and is identical '
            'for every candidate.',
            'candidates inside an uncertain reference region are excluded from counts and '
            'denominators and reported in excluded_candidates.',
            'matched onset statistics are conditioned on the matching window; the '
            'all-reference rate counts missed notes as failures.',
        ],
    }

def _round_value(value):
    return None if value is None else round(float(value), 6)


def legacy_score(reference, candidate, tolerance=TOLERANCES['onset_match_seconds']):
    """Reproduce the pre-v2 two-pointer scorer for historical comparison only."""
    try:
        from scripts import qualify_music_model as legacy
    except ImportError:  # pragma: no cover
        import qualify_music_model as legacy
    reference_events, _ = normalize_events(reference)
    candidate_events, _ = normalize_events(candidate)
    result = legacy.score_events(
        [{'pitch': event['pitch'], 'onset': event['onset_seconds']}
         for event in reference_events],
        [{'pitch': event['pitch'], 'onset': event['onset_seconds']}
         for event in candidate_events],
        tolerance=tolerance)
    return {**result, 'metric_version': 'piano-event-metrics-1-legacy',
            'empty_case_policy': 'legacy: empty/empty reports precision=recall=f1=1.0'}


def aggregate(cases):
    """Micro pooling across cases, macro means over applicable cases, plus silence results."""
    usable = [case for case in cases if isinstance(case, dict)]
    scored = [case for case in usable if case.get('matched') is not None]
    totals = {'reference_count': 0, 'candidate_scored': 0, 'matched': 0, 'missing': 0,
              'extra': 0}
    for case in scored:
        totals['reference_count'] += int(case.get('reference_count') or 0)
        totals['candidate_scored'] += int(case.get('candidate_scored') or 0)
        totals['matched'] += int(case.get('matched') or 0)
        totals['missing'] += int(case.get('missing') or 0)
        totals['extra'] += int(case.get('extra') or 0)
    micro = {'reference_count': totals['reference_count'],
             'candidate_count': totals['candidate_scored'],
             'matched': totals['matched'], 'missing': totals['missing'],
             'extra': totals['extra'],
             'precision': (totals['matched'] / totals['candidate_scored']
                           if totals['candidate_scored'] else None),
             'recall': (totals['matched'] / totals['reference_count']
                        if totals['reference_count'] else None),
             'f1': (2 * totals['matched'] /
                    (totals['reference_count'] + totals['candidate_scored'])
                    if totals['reference_count'] + totals['candidate_scored'] else None)}

    def macro(key):
        values = [float(case[key]) for case in scored
                  if case.get(key) is not None]
        return {'mean': round(statistics.fmean(values), 6) if values else None,
                'cases': len(values)}

    return {'metric_version': METRIC_VERSION, 'cases': len(usable),
            'scored_cases': len(scored), 'micro': micro,
            'macro': {key: macro(key) for key in
                      ('precision', 'recall', 'f1', 'onset_mae_seconds',
                       'all_reference_within_tolerance')},
            'silence': {'silent_reference_cases': sum(1 for case in usable
                                                      if case.get('silent_reference')),
                        'silent_candidate_cases': sum(1 for case in usable
                                                      if case.get('silent_candidate')),
                        'false_activity_notes': sum(int(case.get('false_activity_notes') or 0)
                                                    for case in usable)}}


def load_events(path):
    """Load events from a quality reference, an event list, or a captured MIDI file."""
    path = Path(path)
    if path.suffix.lower() in ('.mid', '.midi'):
        try:
            from scripts import prepare_vienna_dataset as capture
        except ImportError:  # pragma: no cover
            import prepare_vienna_dataset as capture
        events = capture.performance_events(path)
        return [{'id': note['id'], 'pitch': note['pitch'],
                 'onset_seconds': note['onset_seconds']} for note in events['notes']]
    value = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(value, dict):
        if 'attributes' in value:
            events = value['attributes']['pitch_onset']['events']
        elif 'events' in value:
            events = value['events']
        else:
            raise ScorerError(f'{path} has no events')
    elif isinstance(value, list):
        events = value
    else:
        raise ScorerError(f'{path} does not contain events')
    normalized, _ = normalize_events(events)
    return [{'id': event['id'], 'pitch': event['pitch'],
             'onset_seconds': event['onset_seconds']} for event in normalized]


def main(argv=None):
    parser = argparse.ArgumentParser(description='Score pitch/onset events (event-metrics-2).')
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--tolerance', type=float, default=TOLERANCES['onset_match_seconds'])
    parser.add_argument('--legacy', action='store_true',
                        help='reproduce the pre-v2 two-pointer scorer for comparison')
    parser.add_argument('--json', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        reference = load_events(arguments.reference)
        candidate = load_events(arguments.candidate)
        if arguments.legacy:
            result = legacy_score(reference, candidate, arguments.tolerance)
        else:
            result = score_events(reference, candidate, arguments.tolerance)
    except (ScorerError, ValueError, OSError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    if arguments.json:
        print(json.dumps(result, indent=2, sort_keys=True, default=str))
        return 0
    print(f"{result['metric_version']}: {result['matched']} matched, "
          f"{result['missing']} missing, {result['extra']} extra "
          f"(reference {result['reference_count']}, candidate {result['candidate_count']})")
    for key in ('precision', 'recall', 'f1', 'onset_bias_seconds', 'onset_mae_seconds',
                'all_reference_within_tolerance'):
        value = result.get(key)
        print(f'  {key}: {"n/a" if value is None else round(value, 4)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
