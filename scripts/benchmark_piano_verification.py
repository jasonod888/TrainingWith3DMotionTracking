"""Controlled evaluation of the piano transcription verifier.

Renders known performances from locally supplied recorded piano samples (the same
generator as ``benchmark_piano_decoding.py``), decodes them with the piano profile,
and compares the verifier against (a) the natural decoder errors and (b) controlled
corruptions injected into the known reference.

Run in the environment with Basic Pitch installed. Audio and weights are not
redistributed. This is sample-rendered audio, not human performance: it measures
whether each check recognises its intended problem, not general piano accuracy.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import mir_eval
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.api.music_corrections import (EligibilityError, apply_qualified_corrections,
                                        policy_sha256)
from scripts.piano_corrections import decoder_sha256
try:
    from .benchmark_piano_decoding import RATE, render, samples_from
    from .music_basic_pitch_adapter import DEFAULT_DECODING, PIANO_DECODING, decode_predictions, note_events
    from .piano_verifier import VERIFIER_VERSION, verify_piano_transcription
except ImportError:
    from benchmark_piano_decoding import RATE, render, samples_from
    from music_basic_pitch_adapter import DEFAULT_DECODING, PIANO_DECODING, decode_predictions, note_events
    from piano_verifier import VERIFIER_VERSION, verify_piano_transcription

THRESHOLDS = {'onset_threshold': .6, 'frame_threshold': .3, 'minimum_note_length': 80.,
              'onset_prominence': .2, 'minimum_attack_spacing_ms': 70.}
DECODING = {**DEFAULT_DECODING, 'decoding_version': PIANO_DECODING, 'infer_onsets': False}


def reference_events(reference):
    return [{'id': f'ref-{index + 1}', 'onset': float(note['onset']),
             'duration': float(note['duration']), 'pitch': int(note['pitch']),
             'velocity': float(note.get('velocity', 0.5))}
            for index, note in enumerate(reference)]


def _free_at(reference, pitch, onset, tolerance=0.06):
    return all(not (int(note['pitch']) == int(pitch) and abs(float(note['onset']) - onset) <= tolerance)
               for note in reference)


def corrupt(context, rng):
    """Yield (name, events, expectation) pairs for one case."""
    base = [dict(event) for event in context['events']]
    reference = context['reference']
    candidates = [event for event in base if float(event['velocity']) >= 0.25] or base
    event = candidates[int(rng.integers(0, len(candidates)))]
    results = []

    def copy():
        return [dict(item) for item in base]

    # Deletion: the verifier should propose the missing pitch.
    events = copy()
    events = [item for item in events if item['id'] != event['id']]
    results.append(('deleted_note', events, {'kind': 'missing_pitch', 'pitch': int(event['pitch']),
                                             'time': float(event['onset']), 'tolerance': 0.15}))

    # Insertion: a pitch and onset that the reference does not contain.
    for _ in range(20):
        pitch = int(rng.integers(45, 90))
        onset = round(float(rng.uniform(0.4, context['duration'] - 0.5)), 2)
        if _free_at(reference, pitch, onset):
            break
    events = copy() + [{'id': 'injected', 'onset': onset, 'duration': 0.3, 'pitch': pitch, 'velocity': 0.5}]
    results.append(('inserted_note', events, {'kind': 'extra_pitch', 'pitch': pitch,
                                              'event_id': 'injected', 'tolerance': 0.2}))

    # Octave substitution.
    for direction in (12, -12):
        shifted = {'id': 'octave-shifted', 'onset': float(event['onset']),
                   'duration': float(event['duration']), 'pitch': int(event['pitch']) + direction,
                   'velocity': float(event['velocity'])}
        if _free_at(reference, shifted['pitch'], shifted['onset']):
            break
    events = [item for item in copy() if item['id'] != event['id']] + [shifted]
    results.append(('octave_substitution', events,
                    {'kind': 'octave_ambiguity', 'pitch': int(shifted['pitch']),
                     'event_id': 'octave-shifted', 'tolerance': 0.1}))

    # Onset shift: choose a strongly attacked, isolated note so the test measures
    # the checker rather than an impossible masked case.
    isolated = [item for item in base if float(item['velocity']) >= 0.5
                and all(other['id'] == item['id'] or abs(float(other['onset']) - float(item['onset'])) > 0.06
                        for other in base)]
    shift_event = isolated[int(rng.integers(0, len(isolated)))] if isolated else event
    for delta in (0.10, -0.10):
        target = float(shift_event['onset']) + delta
        if target > 0.2 and _free_at(reference, shift_event['pitch'], target, 0.08):
            break
    events = copy()
    for item in events:
        if item['id'] == shift_event['id']:
            item['onset'] = round(target, 3)
    results.append(('shifted_onset', events,
                    {'kind': 'onset_shift', 'pitch': int(shift_event['pitch']), 'event_id': shift_event['id'],
                     'time': float(shift_event['onset']), 'tolerance': 0.06}))

    # Duplicate: split one note into two overlapping strikes.
    duplicate = {'id': 'duplicate', 'onset': round(float(event['onset']) + 0.14, 3),
                 'duration': max(0.08, float(event['duration']) - 0.14),
                 'pitch': int(event['pitch']), 'velocity': float(event['velocity']) * 0.8}
    events = copy() + [duplicate]
    results.append(('duplicate_event', events,
                    {'kind': 'duplicate_event', 'event_ids': [event['id'], 'duplicate'],
                     'tolerance': 0.1}))

    # Merge: join two repeated strikes of one pitch into a single long note.
    by_pitch = {}
    for item in base:
        by_pitch.setdefault(int(item['pitch']), []).append(item)
    pairs = []
    for group in by_pitch.values():
        group.sort(key=lambda item: float(item['onset']))
        for first, second in zip(group, group[1:]):
            gap = float(second['onset']) - float(first['onset'])
            if 0.12 <= gap <= 0.40:
                pairs.append((first, second, gap))
    if pairs:
        first, second, _gap = pairs[int(rng.integers(0, len(pairs)))]
    else:
        group = max(by_pitch.values(), key=len)
        first, second = group[0], group[-1]
    merged = {'id': 'merged', 'onset': float(first['onset']),
              'duration': max(float(second['onset']) + float(second['duration']) - float(first['onset']),
                              float(first['duration'])),
              'pitch': int(first['pitch']),
              'velocity': max(float(first['velocity']), float(second['velocity']))}
    events = [item for item in copy() if item['id'] not in (first['id'], second['id'])] + [merged]
    results.append(('merged_repetition', events,
                    {'kind': 'missed_repetition', 'pitch': int(first['pitch']), 'event_id': 'merged',
                     'time': float(second['onset']), 'tolerance': 0.08}))
    return results


def _match_kind(finding, expectation):
    if finding['kind'] != expectation['kind']:
        return False
    if 'pitch' in expectation and finding['pitch'] != expectation['pitch']:
        return False
    if 'event_id' in expectation and expectation['event_id'] not in finding['event_ids']:
        return False
    if 'event_ids' in expectation and not set(expectation['event_ids']).issubset(set(finding['event_ids'])):
        return False
    if 'time' in expectation:
        low = expectation['time'] - expectation.get('tolerance', 0.1)
        high = expectation['time'] + expectation.get('tolerance', 0.1)
        if not (finding['time_range'][0] <= high and finding['time_range'][1] >= low):
            return False
    return True


def _target(finding, expectation):
    return any(_match_kind(finding, expectation) for finding in finding['findings'])


def _all_suggestions(report):
    return sum(1 for finding in report['findings'] if finding['status'] == 'suggested')


def match_stats(events, reference):
    """One-to-one pitch/onset matching against the known reference."""
    ref_intervals = np.array([[n['onset'], n['onset'] + n['duration']] for n in reference])
    ref_hz = mir_eval.util.midi_to_hz(np.array([n['pitch'] for n in reference]))
    intervals = np.array([[float(n['onset']), float(n['onset']) + float(n['duration'])] for n in events]).reshape(-1, 2)
    hz = mir_eval.util.midi_to_hz(np.array([n['pitch'] for n in events]))
    matches = mir_eval.transcription.match_notes(ref_intervals, ref_hz, intervals, hz,
                                                onset_tolerance=.05, offset_ratio=None)
    errors = [abs(reference[i]['onset'] - events[j]['onset']) for i, j in matches]
    return {'matched': len(matches), 'missing': len(reference) - len(matches),
            'extra': len(events) - len(matches),
            'matched_ref_indices': sorted(int(i) for i, _j in matches),
            'onset_mae_ms': 1000.0 * sum(errors) / max(1, len(errors))}


def evaluation_policy(implementation):
    if not implementation:
        raise ValueError('Benchmark report has no implementation fingerprint.')
    categories = {
        kind: {'enabled': True, 'reason': 'evaluation', 'attempts': 1,
               'suggestions': 1, 'precision': 1.0, 'damage_rate': 0.0,
               'heldout_cases': 1}
        for kind in ('onset_shift', 'duplicate_event', 'missed_repetition',
                     'unmatched_attack', 'missing_pitch', 'extra_pitch',
                     'octave_ambiguity')
    }
    return {'policy_version': 'piano-corrections-1',
            'generated_at': '2026-11-11T00:00:00+00:00',
            'status': 'qualified', 'scope': 'benchmark production-equivalence evaluation',
            'benchmark': {'report_sha256': 'a' * 64, 'evidence_kind': 'human',
                          'heldout_cases': 1, 'source': 'benchmark'},
            'thresholds': {'min_heldout_cases': 1, 'min_suggestions': 1,
                           'min_correction_precision': 0.5, 'max_damage_rate': 0.0},
            'categories': categories, 'implementation': implementation}


def qualified_report(report, findings, policy):
    selected = [{**finding, 'status': 'suggested', 'correction_status': 'qualified'}
                for finding in findings]
    return {**report, 'mode': 'qualified', 'findings': selected,
            'correction_policy': {'mode': 'qualified', 'policy': policy,
                                  'policy_sha256': policy_sha256(policy),
                                  'enabled_categories': sorted(policy['categories'])}}


def _suggested_findings(report):
    return [finding for finding in report.get('findings') or []
            if finding.get('status') == 'suggested'
            and finding.get('proposed_edits') and not finding.get('ambiguous')]


def apply_suggestions(events, report, implementation, clip_duration=8.0):
    """Apply all suggested edits with production eligibility and all-or-nothing rules."""
    findings = _suggested_findings(report)
    if not findings:
        return events, 0, 0
    try:
        policy = evaluation_policy(implementation)
        applied, history, _policy = apply_qualified_corrections(
            events, qualified_report(report, findings, policy), clip_duration)
        return applied, len(history), 0
    except (EligibilityError, ValueError, KeyError, TypeError):
        return events, 0, 1


def correction_trials(report, proposal, reference, seed, split, source, implementation,
                      clip_duration=8.0):
    """Per-suggestion production-application trials with identity-based damage."""
    trials = []
    before = match_stats(proposal, reference)
    before_refs = set(before['matched_ref_indices'])
    for finding in _suggested_findings(report):
        single = qualified_report(report, [finding], evaluation_policy(implementation))
        try:
            after_events, _history, _policy = apply_qualified_corrections(
                proposal, single, clip_duration)
            applied = True
        except (EligibilityError, ValueError, KeyError, TypeError):
            after_events, applied = proposal, False
        after = match_stats(after_events, reference)
        after_refs = set(after['matched_ref_indices'])
        damaged = len(before_refs - after_refs)
        fixed = max(0, (before['missing'] + before['extra'])
                    - (after['missing'] + after['extra']))
        common = before_refs & after_refs
        onset_improved = False
        if common:
            before_errors = []
            after_errors = []
            for index in common:
                # Matching is one-to-one; recovered event indices are not exposed, so
                # compare the nearest same-pitch onset in each proposal.
                ref_onset = reference[index]['onset']
                ref_pitch = reference[index]['pitch']
                before_candidates = [event['onset'] for event in proposal
                                     if int(event['pitch']) == int(ref_pitch)]
                after_candidates = [event['onset'] for event in after_events
                                    if int(event['pitch']) == int(ref_pitch)]
                if before_candidates and after_candidates:
                    before_errors.append(min(abs(value - ref_onset) for value in before_candidates))
                    after_errors.append(min(abs(value - ref_onset) for value in after_candidates))
            if before_errors and after_errors:
                onset_improved = sum(after_errors) < sum(before_errors) - 0.005
        correct = bool(applied and damaged == 0 and (fixed > 0 or onset_improved))
        trials.append({
            'trial_id': hashlib.sha256(json.dumps({
                'performance': str(seed), 'source': source,
                'proposal': proposal, 'finding': finding,
            }, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'performance_id': str(seed), 'piece_id': f'case-{seed}',
            'instrument': 'piano', 'split': split, 'category': finding['kind'],
            'source': source, 'correct': correct,
            'eligible': bool(applied), 'damaged_correct_notes': damaged,
            'fixed_errors': fixed, 'onset_improved': bool(onset_improved),
            'proposal_improved': bool(applied and damaged == 0
                                      and (after['missing'] + after['extra'])
                                      < (before['missing'] + before['extra'])),
        })
    return trials


def natural_scores(report, reference):
    """Outcome for every suggested edit operation, including merges and splits."""
    scored = []
    for finding in report['findings']:
        if finding['status'] != 'suggested':
            continue
        for edit in finding.get('proposed_edits') or []:
            outcome = 'unjudged'
            if edit['op'] == 'add_note':
                target = edit['after']
                outcome = 'correct' if any(int(n['pitch']) == int(target['pitch'])
                                           and abs(float(n['onset']) - float(target['onset'])) <= 0.08
                                           for n in reference) else 'incorrect'
            elif edit['op'] == 'delete_note':
                before = edit['before']
                outcome = 'correct' if not any(int(n['pitch']) == int(before['pitch'])
                                               and abs(float(n['onset']) - float(before['onset'])) <= 0.05
                                               for n in reference) else 'incorrect'
            elif edit['op'] == 'set_onset':
                before = edit['before']
                after = edit['after']
                matched = [n for n in reference if int(n['pitch']) == int(finding['pitch'])
                           and abs(float(n['onset']) - float(before['onset'])) <= 0.12]
                if matched:
                    before_error = abs(float(matched[0]['onset']) - float(before['onset']))
                    after_error = abs(float(matched[0]['onset']) - float(after['onset']))
                    outcome = 'correct' if after_error + 0.01 < before_error else 'incorrect'
            elif edit['op'] == 'set_pitch':
                before = edit['before']
                after = edit['after']
                matched = [n for n in reference if abs(float(n['onset']) - float(before['onset'])) <= 0.08]
                outcome = ('correct' if any(int(n['pitch']) == int(after['pitch']) for n in matched)
                           and not any(int(n['pitch']) == int(before['pitch']) for n in matched)
                           else 'incorrect')
            elif edit['op'] in ('merge', 'split_note'):
                outcome = 'outcome-measured'
            scored.append({'kind': finding['kind'], 'op': edit['op'], 'outcome': outcome})
    return scored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.local/piano-verification'))
    parser.add_argument('--cases', type=int, default=12)
    args = parser.parse_args()
    samples, identities = samples_from(args.samples)
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'benchmark_version': 2, 'verifier_version': VERIFIER_VERSION,
              'evidence_kind': 'rendered',
              'weights_sha256': hashlib.sha256(args.weights.read_bytes()).hexdigest(),
              'sample_identities': identities,
              'scope': 'Sample-rendered known notes with injected corruption; not human performance.',
              'correction_trials': [], 'cases': []}
    decoding_config = {'sample_rate': RATE, 'preprocessing': 'mono-pcm-s16le',
                       'thresholds': THRESHOLDS, 'decoding': DECODING}
    provenance = {'model': 'basic-pitch', 'model_version': '0.4.0',
                  'decoder': DECODING['decoding_version'],
                  'weights_sha256': report['weights_sha256'],
                  'decoder_sha256': decoder_sha256(decoding_config,
                      Path(__file__).with_name('music_basic_pitch_adapter.py'))}
    scenario_rows = {}
    natural_rows = []
    for index in range(args.cases):
        seed = 100 + index if index < args.cases // 2 else 1000 + index
        split = 'development' if index < args.cases // 2 else 'holdout'
        audio, reference, pedal = render(seed, samples)
        stem = args.output / f'case-{seed}'
        wav = stem.with_suffix('.wav')
        sf.write(wav, audio, RATE, subtype='PCM_16')
        raw_path = stem.with_suffix('.npz')
        receipt = stem.with_suffix('.sha256')
        cache_key = hashlib.sha256(wav.read_bytes() + report['weights_sha256'].encode()).hexdigest()
        if not raw_path.exists() or not receipt.exists() or receipt.read_text() != cache_key:
            raw = run_inference(wav, args.weights)
            np.savez_compressed(raw_path, **raw)
            receipt.write_text(cache_key)
        else:
            raw = dict(np.load(raw_path, allow_pickle=False))
        _, decoded = decode_predictions(raw, THRESHOLDS, DECODING)
        events = note_events(decoded, 8.0)
        started = time.monotonic()
        clean_report = verify_piano_transcription(audio=wav, events=reference_events(reference),
                                                  activations=raw, duration=8.0,
                                                  provenance=provenance)
        clean_seconds = time.monotonic() - started
        if 'implementation' not in report:
            root = Path(__file__).resolve().parents[1]
            report['implementation'] = {
                'verifier_code_sha256': hashlib.sha256(
                    (root / 'scripts/piano_verifier.py').read_bytes()).hexdigest(),
                'settings_sha256': clean_report['settings_sha256'],
                'weights_sha256': report['weights_sha256'],
                'model': 'basic-pitch', 'model_version': '0.4.0',
                'decoder': DECODING['decoding_version'],
                'decoder_sha256': provenance['decoder_sha256'],
                'application_code_sha256': hashlib.sha256(
                    (root / 'scripts/piano_corrections.py').read_bytes()).hexdigest(),
            }
        reference_events_raw = reference_events(reference)
        report['correction_trials'].extend(correction_trials(
            clean_report, reference_events_raw, reference, seed, split, 'clean_reference',
            report['implementation']))
        for item in natural_scores(clean_report, reference):
            natural_rows.append({'split': split, 'proposal': 'reference', **item})
        clean_before = match_stats(reference_events_raw, reference)
        clean_after_events, clean_applied, clean_conflicts = apply_suggestions(reference_events_raw, clean_report, report['implementation'])
        clean_after = match_stats(clean_after_events, reference)
        natural_rows.append({'split': split, 'proposal': 'reference', 'kind': 'summary',
                             'applied': clean_applied, 'conflicts': clean_conflicts,
                             'before': clean_before, 'after': clean_after,
                             'fixed': max(0, (clean_before['missing'] + clean_before['extra'])
                                          - (clean_after['missing'] + clean_after['extra'])),
                             'damaged': max(0, clean_before['matched'] - clean_after['matched'])})
        damage = _all_suggestions(clean_report)
        started = time.monotonic()
        decoded_report = verify_piano_transcription(audio=wav, events=events, activations=raw,
                                                    duration=8.0,
                                                    provenance=provenance)
        decoded_seconds = time.monotonic() - started
        report['correction_trials'].extend(correction_trials(
            decoded_report, events, reference, seed, split, 'natural_decoder',
            report['implementation']))
        for item in natural_scores(decoded_report, reference):
            natural_rows.append({'split': split, 'proposal': 'decoder', **item})
        decoded_before = match_stats(events, reference)
        decoded_after_events, decoded_applied, decoded_conflicts = apply_suggestions(events, decoded_report, report['implementation'])
        decoded_after = match_stats(decoded_after_events, reference)
        natural_rows.append({'split': split, 'proposal': 'decoder', 'kind': 'summary',
                             'applied': decoded_applied, 'conflicts': decoded_conflicts,
                             'before': decoded_before, 'after': decoded_after,
                             'fixed': max(0, (decoded_before['missing'] + decoded_before['extra'])
                                          - (decoded_after['missing'] + decoded_after['extra'])),
                             'damaged': max(0, decoded_before['matched'] - decoded_after['matched'])})
        context = {'events': reference_events(reference), 'reference': reference, 'duration': 8.0}
        rng = np.random.default_rng(seed)
        for name, corrupted, expectation in corrupt(context, rng):
            started = time.monotonic()
            result = verify_piano_transcription(audio=wav, events=corrupted, activations=raw,
                                                duration=8.0,
                                                provenance=provenance)
            seconds = time.monotonic() - started
            report['correction_trials'].extend(correction_trials(
                result, corrupted, reference, seed, split, 'corruption',
                report['implementation']))
            found = _target(result, expectation)
            suggestions = _all_suggestions(result)
            expected_suggested = any(finding['status'] == 'suggested' and _match_kind(finding, expectation)
                                     for finding in result['findings'])
            before = match_stats(corrupted, reference)
            after_events, applied, conflicts = apply_suggestions(corrupted, result, report['implementation'])
            after = match_stats(after_events, reference)
            improved = ((after['missing'] + after['extra']) < (before['missing'] + before['extra'])
                        and after['matched'] >= before['matched'])
            proposal_damaged = after['matched'] < before['matched']
            row = scenario_rows.setdefault(name, {'attempts': 0, 'detected': 0, 'suggested': 0,
                                                  'damage': 0, 'improved': 0, 'proposal_damaged': 0,
                                                  'applied': 0, 'conflicts': 0, 'seconds': 0.0})
            row['attempts'] += 1
            row['detected'] += int(found)
            row['suggested'] += int(expected_suggested)
            row['damage'] += max(0, suggestions - int(expected_suggested))
            row['improved'] += int(improved)
            row['proposal_damaged'] += int(proposal_damaged)
            row['applied'] += applied
            row['conflicts'] += conflicts
            row['seconds'] += seconds
            report['cases'].append({'seed': seed, 'split': split, 'scenario': name,
                                    'detected': bool(found), 'suggested': bool(expected_suggested),
                                    'suggestions': suggestions, 'applied': applied,
                                    'conflicts': conflicts, 'improved': bool(improved),
                                    'proposal_damaged': bool(proposal_damaged),
                                    'before': before, 'after': after,
                                    'findings': [{'kind': f['kind'], 'status': f['status'],
                                                  'event_ids': f['event_ids'], 'pitch': f['pitch']}
                                                 for f in result['findings']]})
        report['cases'].append({'seed': seed, 'split': split, 'scenario': 'clean_reference',
                                'suggestions': damage, 'seconds': clean_seconds,
                                'findings': [{'kind': f['kind'], 'status': f['status'],
                                              'event_ids': f['event_ids'], 'pitch': f['pitch'],
                                              'time_range': f['time_range'], 'evidence': f['evidence'],
                                              'edits': f['proposed_edits']}
                                             for f in clean_report['findings']]})
        report['cases'].append({'seed': seed, 'split': split, 'scenario': 'decoded_proposal',
                                'suggestions': _all_suggestions(decoded_report), 'seconds': decoded_seconds,
                                'findings': decoded_report['summary']['by_kind']})
        print(f'case {seed} ({split}): clean suggestions {damage}, decoded findings '
              f'{decoded_report["summary"]["by_kind"]}', flush=True)
    report['scenarios'] = scenario_rows
    report['natural'] = natural_rows
    report['summary'] = {}
    report['summary']['correction_trial_count'] = len(report['correction_trials'])
    report['summary']['correction_trial_categories'] = {
        category: sum(1 for trial in report['correction_trials']
                      if trial['category'] == category)
        for category in sorted({trial['category'] for trial in report['correction_trials']})
    }
    for name, row in scenario_rows.items():
        report['summary'][name] = {
            'attempts': row['attempts'], 'detection_rate': row['detected'] / max(1, row['attempts']),
            'suggestion_rate': row['suggested'] / max(1, row['attempts']),
            'improved_rate': row['improved'] / max(1, row['attempts']),
            'proposal_damage_rate': row['proposal_damaged'] / max(1, row['attempts']),
            'applied_edits': row['applied'], 'conflicts': row['conflicts'],
            'damage_per_case': row['damage'] / max(1, row['attempts']),
            'mean_seconds': row['seconds'] / max(1, row['attempts'])}
    report['summary']['clean_reference'] = {
        'suggestions': sum(c['suggestions'] for c in report['cases'] if c['scenario'] == 'clean_reference'),
        'cases': args.cases}
    report['summary']['natural'] = {}
    for proposal in ('reference', 'decoder'):
        rows = [row for row in natural_rows if row['proposal'] == proposal and row.get('kind') == 'summary']
        report['summary']['natural'][proposal] = {
            'cases': len(rows),
            'applied_edits': sum(row['applied'] for row in rows),
            'conflicts': sum(row['conflicts'] for row in rows),
            'errors_fixed': sum(row['fixed'] for row in rows),
            'correct_notes_damaged': sum(row['damaged'] for row in rows),
            'remaining_missing': sum(row['after']['missing'] for row in rows),
            'remaining_extra': sum(row['after']['extra'] for row in rows),
            'errors_before': sum(row['before']['missing'] + row['before']['extra'] for row in rows),
            'errors_after': sum(row['after']['missing'] + row['after']['extra'] for row in rows)}
        judged = [row for row in natural_rows if row['proposal'] == proposal and row.get('kind') != 'summary'
                  and row.get('outcome') in ('correct', 'incorrect')]
        report['summary']['natural'][proposal]['judged_edits'] = len(judged)
        report['summary']['natural'][proposal]['correct_edits'] = sum(1 for row in judged if row['outcome'] == 'correct')
        report['summary']['natural'][proposal]['incorrect_edits'] = sum(1 for row in judged if row['outcome'] == 'incorrect')
    (args.output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()
