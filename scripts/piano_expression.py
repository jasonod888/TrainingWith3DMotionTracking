"""Phase-4 expression evidence over the corrected Phase 3 working events.

The report is diagnostic-first: candidates are generated and reported even when no
policy category is enabled. Permission to apply is decided separately. Duration and
relative dynamics use independent evidence groups and abstain on overlap, clipping or
missing release evidence. Relative dynamics is never converted to MIDI velocity without
a validated calibration.
"""
import argparse
import hashlib
import json
import math
import time
import wave
from pathlib import Path

import numpy as np

try:
    import piano_verifier as verifier
    import piano_expression_evidence as attribution
    import piano_velocity_calibration as velocity_calibration
    from piano_expression_identity import estimator_sha256, measurement_sha256
except ImportError:
    from scripts import piano_verifier as verifier
    from scripts import piano_expression_evidence as attribution
    from scripts import piano_velocity_calibration as velocity_calibration
    from scripts.piano_expression_identity import estimator_sha256, measurement_sha256

SCHEMA_VERSION = 2
SCHEMA_NAME = 'piano-expression-report-2'
MAX_ANALYSIS_EVENTS = 500
MAX_AUDIO_SECONDS = 60.0
DURATION_STEP = 0.02
RELEASE_HOLD = 0.15
MIN_CHANGE = 0.12
MAX_EXTENSION = 1.0


def _partial_activity(analysis, pitch, seconds, group='all'):
    frame = verifier._frame_index(analysis, float(seconds))
    index = int(np.clip(int(pitch) - verifier.MIDI_MIN, 0, verifier.MIDI_MAX - verifier.MIDI_MIN))
    entries = analysis.partials[index]
    if group == 'low':
        entries = entries[0::2]
    elif group == 'high':
        entries = entries[1::2]
    if not entries:
        return None
    signal = sum(float(analysis.Y[frame, indices] @ weights) ** 2
                 for _k, _f, indices, weights in entries)
    floor = sum(float(analysis.noise[indices] @ weights) ** 2
                for _k, _f, indices, weights in entries)
    return float(10.0 * math.log10((signal + 1e-12) / (floor + 1e-12)))


def _activity(analysis, pitch, seconds):
    return _partial_activity(analysis, pitch, seconds, 'all')


def _event_end(note):
    return float(note['onset']) + float(note.get('duration') or 0.0)


def _ring_end(analysis, other, seconds):
    nominal = _event_end(other)
    if nominal < seconds and (_activity(analysis, other['pitch'], seconds) or 0.0) < 6.0:
        return nominal
    return max(nominal, float(other['onset']) + 0.8) + 1.2


def _overlaps(events, note, start, end, ring=0.12, analysis=None):
    for other in events:
        if other is note or str(other.get('id')) == str(note.get('id')):
            continue
        other_start = float(other['onset'])
        other_end = _ring_end(analysis, other, start) if analysis is not None else _event_end(other)
        if other_start <= end + ring and other_end >= start - ring:
            return True
    return False


def _release(series, threshold):
    """Return (last_above, sustained_release) for [time, db] samples."""
    last_above = None
    below_from = None
    for time, value in series:
        if value is None:
            continue
        if value >= threshold:
            last_above = time
            below_from = None
        elif last_above is not None:
            below_from = time if below_from is None else below_from
            if time - below_from >= RELEASE_HOLD:
                return last_above, True
    return last_above, False


def _energy_end(analysis, note, clip):
    """Independent broadband release end for an already-isolated note."""
    onset = float(note['onset'])
    samples = np.asarray(analysis.samples)
    rate = int(analysis.sample_rate)
    window = max(1, int(0.02 * rate))
    max_end = min(clip - 0.10, onset + 8.0)
    start = max(0, int(round(onset * rate)))
    peak = 1e-12
    for value in np.arange(0.0, min(0.15, max_end - onset), 0.01):
        index = min(len(samples) - window, start + int(round(value * rate)))
        block = samples[max(0, index):index + window]
        peak = max(peak, float(np.sqrt(np.mean(block * block))) if len(block) else 0.0)
    threshold = peak * 10 ** (-40.0 / 20.0)
    last_above = None
    below_from = None
    for value in np.arange(onset + 0.04, max_end + 1e-6, 0.02):
        index = max(0, int(round(value * rate)))
        block = samples[index:index + window]
        if len(block) < window:
            break
        level = float(np.sqrt(np.mean(block * block)))
        if level >= threshold:
            last_above = float(value)
            below_from = None
        elif last_above is not None:
            below_from = float(value) if below_from is None else below_from
            if float(value) - below_from >= 0.10:
                return last_above + window / rate
    return None


def _duration_candidate(analysis, note, clip, events):
    """Build a no-change/baseline plus candidate comparison for one note."""
    onset = float(note['onset'])
    baseline = float(note.get('duration') or 0.0)
    baseline_end = onset + baseline
    event_id = str(note['id'])
    result = {'event_id': event_id, 'attribute': 'audible_duration',
              'target_kind': 'audible_end_seconds', 'units': 'seconds',
              'baseline': baseline, 'baseline_end': baseline_end,
              'proposed': None, 'candidate_interval': None, 'decision': 'no_change',
              'status': 'no_change', 'reason': None, 'scope': 'isolated', 'evidence': {}}
    if baseline <= 0.0:
        result.update(reason='missing_baseline')
        return result
    if baseline_end >= clip - 0.10:
        result.update(reason='clipped_baseline')
        return result
    later_same = [float(other['onset']) for other in events
                  if other is not note and int(other['pitch']) == int(note['pitch'])
                  and float(other['onset']) > onset + 0.05]
    max_end = min(clip - 0.10, onset + min(8.0, max(2.0, baseline * 2.0 + 1.0)))
    if later_same:
        max_end = min(max_end, min(later_same) - 0.04)
    if max_end <= onset + 0.10:
        result.update(reason='no_search_range')
        return result
    overlap_start = onset
    overlap_end = max(baseline_end, onset + 0.5) + 0.20
    overlap_notes = []
    for other in events:
        if other is note or str(other.get('id')) == str(note.get('id')):
            continue
        other_start = float(other['onset'])
        audible_end = _ring_end(analysis, other, overlap_start)
        if other_start <= overlap_end and audible_end >= overlap_start - 0.12:
            overlap_notes.append(other)
    if overlap_notes:
        sounding = [int(item['pitch']) for item in overlap_notes]
        if verifier._harmonic_relation(int(note['pitch']), sounding) is not None:
            result.update(reason='shared_partials', scope='polyphonic')
            return result
        result['scope'] = 'polyphonic'
    times = np.arange(onset + 0.02, max_end + 1e-6, DURATION_STEP)
    all_values, low_values, high_values = [], [], []
    for value in times:
        all_values.append((float(value), _activity(analysis, note['pitch'], float(value))))
        low_values.append((float(value), _partial_activity(analysis, note['pitch'], float(value), 'low')))
        high_values.append((float(value), _partial_activity(analysis, note['pitch'], float(value), 'high')))
    peak = max((value for _time, value in all_values if value is not None), default=-999.0)
    if peak < 6.0:
        result.update(reason='unsupported_quiet', evidence={'peak_db': round(peak, 2)})
        return result
    threshold = max(8.0, peak - 40.0)
    last_all, released_all = _release(all_values, threshold)
    last_low, released_low = _release(low_values, threshold)
    last_high, released_high = _release(high_values, threshold)
    result['evidence'].update({'peak_db': round(peak, 2), 'release_threshold_db': round(threshold, 2),
                               'group_release': [last_low, last_high]})
    if not released_all or not released_low or not released_high:
        result.update(reason='no_observed_release')
        return result
    group_releases = [value for value in (last_low, last_high) if value is not None]
    if not group_releases:
        result.update(reason='no_observed_release')
        return result
    # Upper partials often decay earlier than the fundamental. A group may confirm
    # an earlier release, but it must not claim a substantially later note ending.
    if max(group_releases) > float(last_all) + 0.15:
        result.update(reason='independent_groups_disagree')
        return result
    if result['scope'] == 'isolated':
        energy_end = _energy_end(analysis, note, clip)
        if energy_end is None:
            result.update(reason='no_energy_release')
            return result
        if abs(energy_end - float(last_all)) > 0.12:
            result.update(reason='energy_and_harmonics_disagree')
            return result
        result['evidence']['energy_end'] = round(energy_end, 3)
        candidate_end = energy_end
    else:
        # In polyphony the broadband ending is contaminated by the other note.
        # Use the target's harmonic release as diagnostic evidence only.
        candidate_end = float(last_all) + DURATION_STEP
        result['evidence']['polyphonic_end'] = round(candidate_end, 3)
    candidate_duration = candidate_end - onset
    interval = [round(candidate_duration - 0.04, 3), round(candidate_duration + 0.04, 3)]
    result.update(proposed=round(candidate_duration, 3), candidate_interval=interval)
    if candidate_duration < 0.08:
        result.update(reason='candidate_too_short')
        return result
    if interval[0] <= baseline <= interval[1]:
        result.update(reason='baseline_within_uncertainty')
        return result
    direction = 'shorten' if candidate_duration < baseline else 'extend'
    if direction == 'extend':
        if candidate_duration - baseline > MAX_EXTENSION:
            result.update(reason='extension_too_large')
            return result
        if result['scope'] == 'isolated' and _overlaps(events, note, baseline_end, candidate_end + 0.12,
                                                    analysis=analysis):
            result.update(reason='overlap_after_baseline')
            return result
        # The broadband release establishes that the note continued past the
        # baseline; no later activity is attributed to another note because the
        # overlap check above already excluded that case.
    if abs(candidate_duration - baseline) < max(0.15, baseline * 0.25):
        result.update(reason='change_below_materiality')
        return result
    result.update(decision='change', status='diagnostic', reason='observed_release',
                  direction=direction)
    if result['scope'] != 'isolated':
        result['reason'] = 'polyphonic_harmonic_release'
    return result


def _attributed_duration_candidate(analysis, note, clip, events, settings):
    baseline = float(note.get('duration') or 0.)
    onset = float(note['onset'])
    evidence = attribution.attribute(analysis, note, events, settings, verifier)
    later = [float(n['onset']) for n in events if int(n['pitch']) == int(note['pitch'])
             and float(n['onset']) > onset + .05]
    end = attribution.ending(evidence, onset, min(later) if later else None)
    measured = {key: value for key, value in evidence.items()
                if key not in ('times', 'envelope', 'groups')}
    result = {'event_id': str(note['id']), 'attribute': 'audible_duration',
              'target_kind': 'audible_end_seconds', 'units': 'seconds',
              'baseline': baseline, 'baseline_end': onset + baseline,
              'proposed': None, 'candidate_interval': None, 'decision': 'no_change',
              'status': 'no_change', 'scope': evidence.get('scope', 'polyphonic'),
              'reason': 'attribution_uncertain', 'evidence': measured}
    if end is None:
        return result
    low, high = [value - onset for value in end['interval']]
    proposed = end['end'] - onset
    result.update(proposed=round(proposed, 4), candidate_interval=[low, high])
    result['evidence'].update({'view_ends': end['view_ends'], 'release_threshold': end['threshold']})
    if low <= baseline <= high:
        result['reason'] = 'baseline_within_uncertainty'
    elif proposed < .08 or end['end'] > clip - .1:
        result['reason'] = 'unobserved_boundary'
    elif abs(proposed - baseline) < max(.15, baseline * .25):
        result['reason'] = 'change_below_materiality'
    elif proposed - baseline > MAX_EXTENSION:
        result['reason'] = 'extension_too_large'
    else:
        result.update(decision='change', status='diagnostic', reason='attributed_release',
                      direction='extend' if proposed > baseline else 'shorten')
    return result


def _attack_level(analysis, note, events):
    onset = float(note['onset'])
    overlap_notes = []
    for other in events:
        if other is note or str(other.get('id')) == str(note.get('id')):
            continue
        other_start = float(other['onset'])
        audible_end = _ring_end(analysis, other, onset)
        if other_start <= onset + 0.20 and audible_end >= onset - 0.05:
            overlap_notes.append(other)
    scope = 'polyphonic' if overlap_notes else 'isolated'
    if overlap_notes:
        sounding = [int(item['pitch']) for item in overlap_notes]
        if verifier._harmonic_relation(int(note['pitch']), sounding) is not None:
            return None, 'overlap_shared_partials'
    pre_all = [_activity(analysis, note['pitch'], onset + delta)
               for delta in (-0.14, -0.10, -0.06)]
    post_all = [_activity(analysis, note['pitch'], onset + delta)
                for delta in (0.0, 0.04, 0.08)]
    if any(value is None for value in pre_all + post_all):
        return None, 'unsupported_pitch'
    pre = max(pre_all)
    post = max(post_all)
    rise = post - pre
    if rise < 6.0:
        return None, 'no_attack_change'
    low_pre = max((_partial_activity(analysis, note['pitch'], onset + delta, 'low') or -999.0)
                  for delta in (-0.10, -0.06))
    low_post = max((_partial_activity(analysis, note['pitch'], onset + delta, 'low') or -999.0)
                   for delta in (0.0, 0.04, 0.08))
    high_pre = max((_partial_activity(analysis, note['pitch'], onset + delta, 'high') or -999.0)
                   for delta in (-0.10, -0.06))
    high_post = max((_partial_activity(analysis, note['pitch'], onset + delta, 'high') or -999.0)
                    for delta in (0.0, 0.04, 0.08))
    if min(low_post - low_pre, high_post - high_pre) < 3.0:
        return None, 'independent_groups_disagree'
    return {'attack_db': round(post, 2), 'rise_db': round(rise, 2),
            'low_rise_db': round(low_post - low_pre, 2),
            'high_rise_db': round(high_post - high_pre, 2),
            'scope': scope}, None


def _dynamics_candidate(analysis, note, events):
    event_id = str(note['id'])
    baseline = note.get('velocity')
    result = {'event_id': event_id, 'attribute': 'relative_dynamics',
              'target_kind': 'relative_attack_level_db', 'units': 'db',
              'baseline': None, 'baseline_velocity': baseline,
              'proposed': None, 'candidate_interval': None,
              'decision': 'no_change', 'status': 'no_change', 'reason': None,
              'scope': 'isolated', 'application': 'none', 'evidence': {}}
    level, reason = _attack_level(analysis, note, events)
    if level is None:
        result.update(reason=reason)
        return result
    result.update(evidence=level)
    result.update(decision='no_change', status='diagnostic', direction='relative_only',
                  scope=level.get('scope', 'isolated'),
                  reason='relative_level_without_velocity_calibration')
    result['measurement'] = {'kind': 'harmonic_attack_snr_db', 'units': 'db',
                             'value': level['attack_db']}
    return result


def estimate_duration(analysis, note, clip, events):
    """Compatibility wrapper: return a candidate duration only when a change is safe."""
    candidate = _duration_candidate(analysis, note, clip, events)
    return candidate.get('proposed') if candidate.get('decision') == 'change' else None


def estimate_dynamics(analysis, events):
    """Compatibility wrapper: no relative level is converted to MIDI velocity."""
    return {}


def _calibrated_dynamics_candidate(analysis, note, events, settings, calibration, domain):
    evidence = attribution.attribute(analysis, note, events, settings, verifier, purpose='attack')
    baseline = note.get('velocity')
    result = {'event_id': str(note['id']), 'attribute': 'relative_dynamics',
              'target_kind': 'reference_velocity', 'units': 'normalized_midi_velocity',
              'baseline': baseline, 'baseline_velocity': baseline, 'proposed': None,
              'candidate_interval': None, 'decision': 'no_change', 'status': 'diagnostic',
              'scope': evidence.get('scope', 'polyphonic'), 'application': 'none',
              'reason': 'attribution_uncertain',
              'evidence': {key: value for key, value in evidence.items()
                           if key not in ('times', 'envelope', 'groups')}}
    if not evidence.get('usable') or evidence.get('residual', 1.) > .4 or evidence.get('harmonic_conflict'):
        return result
    result['measurement'] = {'kind': 'attributed_attack_level_db', 'units': 'db',
                             'value': evidence['attack_level_db']}
    prediction, reason = velocity_calibration.predict(calibration, int(note['pitch']),
        evidence['attack_level_db'], domain, measurement_sha256(velocity_calibration.digest(settings)))
    if prediction is None:
        result['reason'] = reason
        return result
    result.update(proposed=prediction['velocity'], candidate_interval=prediction['interval'],
                  calibration_id=prediction['calibration_id'], calibration_domain=domain)
    if baseline is not None and (prediction['interval'][0] <= baseline <= prediction['interval'][1]
                                or abs(prediction['velocity'] - baseline) < 8 / 127):
        result['reason'] = 'baseline_within_uncertainty'
        return result
    result.update(decision='change', status='diagnostic', reason='independent_calibrated_attack')
    return result


def _permission(policy, mode, attribute):
    if mode != 'qualified' or not policy or policy.get('status') != 'qualified':
        return 'diagnostic', 'policy-not-qualified'
    category = (policy.get('categories') or {}).get(attribute) or {}
    if category.get('enabled') is not True:
        return 'diagnostic', 'category-not-enabled'
    if category.get('implemented') is not True:
        return 'diagnostic', 'category-not-implemented'
    return 'qualified', None


def analyze(audio_path, events, clip, settings, policy=None, mode='diagnostic',
            analyze_duration=True, analyze_dynamics=True, provenance=None,
            calibration=None, calibration_domain=None):
    started = time.monotonic()
    deadline = started + min(60., settings['limits']['budget_seconds'])
    with wave.open(str(audio_path), 'rb') as header:
        if header.getnframes() / header.getframerate() > min(MAX_AUDIO_SECONDS, settings['limits']['max_audio_seconds']):
            raise ValueError('Expression recording exceeds the bounded audio limit.')
    if len(events) > settings['limits']['max_events']:
        raise ValueError('Expression proposal exceeds the event limit.')
    samples, rate = verifier.load_audio(Path(audio_path), 22050)
    if not math.isfinite(clip) or clip <= 0 or clip > len(samples) / rate + 0.05:
        raise ValueError('Expression duration does not match the analysis audio.')
    clip = min(float(clip), len(samples) / rate)
    samples = samples[:int(round(clip * rate))]
    audio_sha = hashlib.sha256(Path(audio_path).read_bytes()).hexdigest()
    provenance = dict(provenance or {})
    if provenance.get('audio_sha256') not in (None, audio_sha):
        raise ValueError('Expression audio identity does not match the analysis WAV.')
    provenance['audio_sha256'] = audio_sha
    analysis = verifier.analyze_audio(samples, rate, settings)
    settings_sha = hashlib.sha256(
        json.dumps(settings, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    policy = verifier.validate_expression_policy(policy) if policy else None
    considered = events[:MAX_ANALYSIS_EVENTS]
    candidates, abstentions = [], []
    duration_considered = dynamics_considered = 0
    for note in considered:
        if analyze_duration:
            duration_considered += 1
            try:
                if time.monotonic() > deadline:
                    raise TimeoutError('expression-budget')
                candidate = _duration_candidate(analysis, note, clip, events)
                fitted = _attributed_duration_candidate(analysis, note, clip, events, settings)
                if fitted['decision'] == 'change':
                    candidate = fitted
                elif candidate.get('scope') == 'polyphonic':
                    candidate.update(decision='no_change', status='no_change',
                                     reason='attribution_uncertain')
                elif candidate['decision'] != 'change':
                    candidate['evidence']['attribution'] = fitted['evidence']
            except Exception as error:
                candidate = {'event_id': str(note['id']), 'attribute': 'audible_duration',
                             'target_kind': 'audible_end_seconds', 'units': 'seconds',
                             'baseline': float(note.get('duration') or 0.0), 'proposed': None,
                             'candidate_interval': None, 'decision': 'no_change',
                             'status': 'no_change', 'reason': 'time_budget' if isinstance(error, TimeoutError) else 'estimator_failure',
                             'evidence': {}}
            status, reason = _permission(policy, mode, 'audible_duration')
            scopes = ((policy or {}).get('categories', {}).get('audible_duration') or {}).get('scopes', [])
            if candidate['decision'] == 'change' and (status != 'qualified' or candidate.get('scope') not in scopes):
                candidate['status'] = 'diagnostic' if mode == 'diagnostic' else 'withheld'
                candidate['reason'] = candidate.get('reason') or reason
                if candidate.get('scope') != 'isolated':
                    candidate['reason'] = 'polyphonic-scope-not-qualified'
            elif candidate['decision'] == 'change':
                candidate['status'] = 'qualified'
            candidates.append(candidate)
            if candidate['decision'] != 'change':
                abstentions.append({'event_id': candidate['event_id'],
                                    'attribute': 'audible_duration',
                                    'reason': candidate.get('reason') or 'no_change',
                                    'evidence': candidate.get('evidence') or {}})
        if analyze_dynamics:
            dynamics_considered += 1
            try:
                if time.monotonic() > deadline:
                    raise TimeoutError('expression-budget')
                candidate = _calibrated_dynamics_candidate(analysis, note, events, settings,
                                                           calibration, calibration_domain)
            except Exception as error:
                candidate = {'event_id': str(note['id']), 'attribute': 'relative_dynamics',
                             'target_kind': 'relative_attack_level_db', 'units': 'db',
                             'baseline': note.get('velocity'), 'proposed': None,
                             'candidate_interval': None, 'decision': 'no_change',
                             'status': 'no_change', 'reason': 'time_budget' if isinstance(error, TimeoutError) else 'estimator_failure',
                             'application': 'none', 'evidence': {}}
            permission, withheld = _permission(policy, mode, 'relative_dynamics')
            category = ((policy or {}).get('categories') or {}).get('relative_dynamics') or {}
            if candidate['decision'] == 'change' and permission == 'qualified' \
                    and candidate.get('scope') in category.get('scopes', []):
                candidate['status'] = 'qualified'
            elif candidate['decision'] == 'change':
                candidate['status'] = 'withheld' if mode == 'qualified' else 'diagnostic'
                candidate['withheld_reason'] = withheld or 'scope-not-qualified'
            candidate['reason'] = candidate.get('reason') or 'relative-only'
            candidate['application'] = 'none'
            candidates.append(candidate)
            if candidate['decision'] != 'change':
                abstentions.append({'event_id': candidate['event_id'],
                                    'attribute': 'relative_dynamics',
                                    'reason': candidate.get('reason') or 'no_change',
                                    'evidence': candidate.get('evidence') or {}})
    by_attribute = {}
    for candidate in candidates:
        entry = by_attribute.setdefault(candidate['attribute'], {
            'analyzed': 0, 'candidates': 0, 'no_change': 0})
        entry['analyzed'] += 1
        if candidate['decision'] == 'change':
            entry['candidates'] += 1
        else:
            entry['no_change'] += 1
    proposals = [candidate for candidate in candidates
                 if candidate['decision'] == 'change'
                 and candidate['status'] == 'qualified'
                 and candidate.get('proposed') is not None]
    for proposal in proposals:
        proposal['value'] = proposal['proposed']
        proposal['before'] = proposal['baseline']
        proposal['proposal_status'] = 'suggested'
        proposal['correction_status'] = 'qualified'
        proposal['application'] = 'automatic'
        proposal['ambiguous'] = False
    truncated = len(events) > MAX_ANALYSIS_EVENTS
    failures = [candidate for candidate in candidates if candidate.get('reason') in
                ('estimator_failure', 'unsupported_recording', 'time_budget')]
    mode_status = 'unsupported' if not events else ('partial' if truncated or failures else 'complete')
    return {
        'schema_version': SCHEMA_VERSION, 'schema': SCHEMA_NAME,
        'version': verifier.EXPRESSION_VERSION, 'mode': mode,
        'status': mode_status,
        'source': {**dict(provenance or {}), 'audio_sha256': (provenance or {}).get('audio_sha256'),
                   'duration': clip, 'working_sha256': verifier.proposal_digest(events)},
        'working_sha256': verifier.proposal_digest(events),
        'settings_sha256': settings_sha,
        'estimator_code_sha256': estimator_sha256(),
        'calibration': calibration,
        'calibration_sha256': velocity_calibration.digest(calibration) if calibration else None,
        'calibration_domain': calibration_domain,
        'analysis_switches': {'audible_duration': bool(analyze_duration),
                              'relative_dynamics': bool(analyze_dynamics)},
        'targets': {
            'audible_duration': {'target': 'audible_end', 'units': 'seconds',
                                 'not': ['key_release', 'written_duration', 'pedal'],
                                 'interval_uncertainty_seconds': 0.04},
            'relative_dynamics': {'target': 'midi_velocity' if calibration else 'attributed_attack_level',
                                  'units': 'normalized_midi_velocity' if calibration else 'db',
                                  'not': ['linear_gain_as_velocity', 'physical_key_pressure'],
                                  'application': 'qualified-calibration-only'},
        },
        'limits': {'events': len(events), 'considered': len(considered),
                   'analysis_events': MAX_ANALYSIS_EVENTS, 'truncated': truncated},
        'policy': ({**policy, 'policy_sha256': verifier.expression_policy_digest(policy),
                    'enabled_categories': [name for name, item in policy['categories'].items()
                                           if item.get('enabled')]} if policy else None),
        'candidates': candidates,
        'abstentions': abstentions,
        'proposals': proposals,
        'coverage': {'events': len(events), 'considered': len(considered),
                     'duration_considered': duration_considered,
                     'dynamics_considered': dynamics_considered,
                     'by_attribute': by_attribute,
                     'abstentions': len(abstentions),
                     'truncated': truncated},
        'summary': {'candidate_count': sum(1 for item in candidates if item['decision'] == 'change'),
                    'measurement_count': sum(1 for item in candidates if item.get('measurement')),
                    'proposal_count': len(proposals),
                    'abstention_count': len(abstentions),
                    'by_attribute': by_attribute,
                    'events_considered': len(considered), 'truncated': truncated},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--policy', type=Path)
    parser.add_argument('--mode', choices=('diagnostic', 'qualified'), default='diagnostic')
    parser.add_argument('--duration', type=float, required=True)
    parser.add_argument('--analyze-duration', action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument('--analyze-dynamics', action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--velocity-calibration', type=Path)
    parser.add_argument('--calibration-domain')
    args = parser.parse_args()
    payload = json.loads(args.reference.read_text(encoding='utf-8'))
    events = payload.get('events') if isinstance(payload, dict) else payload
    if not isinstance(events, list):
        raise SystemExit('Expression reference must contain an events array.')
    settings = verifier._merge(verifier.DEFAULT_SETTINGS,
                               json.loads(args.settings.read_text(encoding='utf-8'))
                               if args.settings else None)
    policy = json.loads(args.policy.read_text(encoding='utf-8')) if args.policy else None
    report = analyze(args.audio, events, args.duration, settings, policy, args.mode,
                     analyze_duration=args.analyze_duration,
                     analyze_dynamics=args.analyze_dynamics,
                     calibration=json.loads(args.velocity_calibration.read_text()) if args.velocity_calibration else None,
                     calibration_domain=args.calibration_domain,
                     provenance=payload.get('provenance') if isinstance(payload, dict) else None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'working_sha256', 'coverage')}, indent=2))


if __name__ == '__main__':
    raise SystemExit(main())
