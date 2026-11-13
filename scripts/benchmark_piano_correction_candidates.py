"""Offline A/C correction experiment, using production edit semantics and scorers.

This builds diagnostic candidates, never changes a lesson or enables a policy. An
independent quality reference is required for accuracy measurements; audio alone
produces observation-only scores. All outputs go into a new directory so previous
evidence and the original proposal cannot be overwritten.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

from scripts import benchmark_piano_quality as quality
from scripts import piano_corrections as corrections
from scripts import piano_performance as performance
from scripts import piano_quality_reference as references
from scripts import piano_verifier as verifier
from scripts import qualify_piano_corrections as qualification


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write('\n')


def construct_candidate(events, report, duration, category=None, finding_id=None):
    """Apply unambiguous diagnostic suggestions offline; reject stale/partial evidence.

    The production eligibility gate is deliberately not called: this is an offline
    candidate for testing the disabled categories, with no application authorization.
    Each edit still uses the exact production precondition checks and validation.
    """
    if report.get('source', {}).get('proposal_sha256') != verifier.proposal_digest(events):
        raise ValueError('Verification report does not match the frozen proposal.')
    if report.get('status') != 'complete':
        return copy.deepcopy(events), [], 'incomplete_analysis'
    selected = [finding for finding in report.get('findings', [])
                if finding.get('status') == 'suggested'
                and finding.get('ambiguous') is False
                and finding.get('kind') in corrections.CATEGORY_OPERATIONS
                and finding.get('proposed_edits')
                and (category is None or finding['kind'] == category)
                and (finding_id is None or finding['id'] == finding_id)]
    candidate = copy.deepcopy(events)
    for finding in selected:
        allowed = corrections.CATEGORY_OPERATIONS[finding['kind']]
        if any(edit.get('op') not in allowed for edit in finding['proposed_edits']):
            raise ValueError('Finding contains an operation outside its correction category.')
        candidate = corrections.apply_finding(candidate, finding, duration)
    corrections.validate_events_basic(candidate, duration)
    return candidate, [finding['id'] for finding in selected], (
        'diagnostic_candidate' if selected else 'no_supported_edits')


def run(*, audio, baseline, output, activations=None, reference=None, settings=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    baseline_bytes = Path(baseline).read_bytes()
    payload = json.loads(baseline_bytes)
    events = payload['events'] if isinstance(payload, dict) else payload
    source = references.source_from_audio(audio)
    duration = source['seconds']
    corrections.validate_events_basic(events, duration)
    (output / 'baseline-input.json').write_bytes(baseline_bytes)
    if reference:
        ref = quality.load_reference(reference)['reference']
        if ref['source']['sha256'] != source['sha256']:
            raise ValueError('Independent reference belongs to different audio.')
    else:
        ref = references.from_audio_only(
            reference_id='audio-only-correction-experiment', source=source,
            performance={'performance_id': source['sha256'], 'performer_id': 'unknown',
                         'recording_id': source['sha256'], 'work_id': 'unknown'},
            rights={'license': 'user-provided local experiment', 'status': 'approved',
                    'receipt_id': 'owner-authorized-local-comparison'},
            scored_interval=[0, duration], split='development',
            reason='No independent pitch/onset or expression annotation is available.')
    write(output / 'reference.json', ref)
    predictions = verifier._load_activations(activations)
    settings_value = json.loads(Path(settings).read_text()) if settings else None
    report = verifier.verify_piano_transcription(
        audio=audio, events=events, activations=predictions, duration=duration,
        settings=settings_value, correction_mode='diagnostic')
    write(output / 'verification.json', report)

    def performance_file(name, candidate):
        doc = performance.from_legacy_events(
            candidate, source={'sha256': source['sha256'],
                               'duration_seconds': duration,
                               'sample_rate': source['sample_rate'],
                               'channels': source['channels'], 'path_hint': str(audio)},
            performance_id=f'{ref["performance"]["performance_id"]}-{name}')
        path = output / f'{name}-performance.json'
        write(path, doc)
        return path

    baseline_path = performance_file('A', events)

    def compare(name, candidate, *, include_audio=False):
        directory = output / name
        candidate_path = performance_file(name, candidate)
        return quality.evaluate(output / 'reference.json',
                                {'A': baseline_path, 'C': candidate_path},
                                baseline='A', final='C', output=directory,
                                source_audio=audio if include_audio else None)

    candidate, applied, state = construct_candidate(events, report, duration)
    write(output / 'candidate.json', {'events': candidate, 'duration': duration,
                                     'diagnostic_only': True,
                                     'activation_authorized': False})
    combined = compare('combined', candidate, include_audio=True)
    category_results = {}
    trials = []
    for category in verifier.CORRECTION_CATEGORIES:
        cat_events, ids, cat_state = construct_candidate(events, report, duration, category)
        cat_score = compare(category, cat_events) if ids else None
        category_results[category] = {
            'state': cat_state, 'applied_findings': ids,
            'outcomes': cat_score['outcomes'] if cat_score else None,
            'damage': cat_score['damage'] if cat_score else None,
            'qualification_established': False}
        # Every proposed correction is evaluated individually as well as in combination.
        for identifier in ids:
            single, _, _ = construct_candidate(events, report, duration,
                                               category, identifier)
            score = compare(f'individual-{identifier}', single)
            row = next(item for item in score['categories']['pitch_onset']
                       if item['name'] == 'pitch_onset_f1')
            gain = (row['final'] - row['baseline']
                    if row['final'] is not None and row['baseline'] is not None else None)
            known = ref['attributes']['pitch_onset']['status'] == 'verified'
            if known:
                # Development evidence never becomes holdout by slicing a recording.
                damaged = score['damage']['event']
                trials.append({
                    'trial_id': f'{ref["reference_id"]}-{identifier}',
                    'performance_id': ref['performance']['performance_id'],
                    'piece_id': ref['performance']['work_id'], 'instrument': 'piano',
                    'split': 'development', 'category': category, 'source': 'natural_decoder',
                    'correct': bool(gain is not None and gain > 0 and not damaged['damaged']),
                    'damaged_correct_notes': len(damaged.get('lost_reference_ids', [])),
                    'fixed_errors': max(0, -(damaged.get('new_missing') or 0)
                                        -(damaged.get('new_extra') or 0))})
    benchmark = {'evidence_kind': 'human' if trials else 'rendered',
                 'correction_trials': trials,
                 'note': 'Local development experiment only; no held-out qualification.'}
    write(output / 'correction-trials.json', benchmark)
    benchmark_bytes = (output / 'correction-trials.json').read_bytes()
    policy = qualification.build_policy(benchmark, benchmark_bytes,
                                        evidence_kind=benchmark['evidence_kind'])
    write(output / 'qualification-policy.json', policy)
    manifest = {
        'schema': 'piano-correction-experiment-1',
        'baseline_sha256': hashlib.sha256(baseline_bytes).hexdigest(),
        'source_sha256': source['sha256'],
        'raw_sha256': corrections.file_sha256(activations) if activations else None,
        'verifier_sha256': corrections.file_sha256(verifier.__file__),
        'application_sha256': corrections.current_application_sha256(),
        'settings_sha256': report['settings_sha256'],
        'baseline_notes': len(events), 'candidate_notes': len(candidate),
        'state': state, 'applied_findings': applied, 'categories': category_results,
        'qualification_status': policy['status'], 'activation_authorized': False,
        'audio_comparison': 'combined A/C only; category and individual ablations use event scores',
        'database_modified': False, 'outcomes': combined['outcomes'],
        'warnings': ['Candidate edits are experimental, not approved app corrections.',
                     'No new human annotation, listening study, or qualified renderer is supplied.']}
    write(output / 'experiment.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--activations', type=Path)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--settings', type=Path,
                        help='Explicit experimental verifier settings; hashed in the receipt.')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(**vars(args)), indent=2))


if __name__ == '__main__':
    main()
