"""Turn a held-out verification benchmark into a fail-closed correction policy.

The policy is deliberately conservative: a category is enabled only when it has
human-performance held-out evidence, enough suggested corrections, sufficient
precision and no measured damage. A smoke or rendered benchmark can produce a policy,
but that policy cannot enable a correction category.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

try:
    from .piano_verifier import (CORRECTION_CATEGORIES, CORRECTION_POLICY_VERSION,
                                 validate_correction_policy)
except ImportError:
    from piano_verifier import (CORRECTION_CATEGORIES, CORRECTION_POLICY_VERSION,
                                validate_correction_policy)

DEFAULT_THRESHOLDS = {
    'min_heldout_cases': 40,
    'min_suggestions': 20,
    'min_correction_precision': 0.95,
    'max_damage_rate': 0.0,
}


def build_policy(report, report_bytes, *, evidence_kind='rendered', thresholds=None,
                 generated_at=None):
    thresholds = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    declared = report.get('evidence_kind')
    if declared and declared != evidence_kind:
        raise ValueError('Benchmark evidence kind does not match the requested qualification kind.')
    if evidence_kind == 'human' and declared != 'human':
        raise ValueError('A human qualification run requires a report that declares human evidence.')
    trials = report.get('correction_trials')
    if not isinstance(trials, list):
        raise ValueError('Benchmark report has no correction_trials; qualification requires individual correction evidence.')
    required = {'trial_id', 'performance_id', 'piece_id', 'instrument', 'split', 'category', 'source',
                'correct', 'damaged_correct_notes', 'fixed_errors'}
    holdout = []
    seen, performance_splits = set(), {}
    for trial in trials:
        if not isinstance(trial, dict) or not required <= set(trial):
            raise ValueError('A correction trial is missing required evidence fields.')
        if trial['category'] not in CORRECTION_CATEGORIES:
            raise ValueError('A correction trial has an unknown category.')
        identifier = trial['trial_id']
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError('Correction trials require unique, non-empty trial identities.')
        seen.add(identifier)
        if trial['split'] not in ('development', 'holdout'):
            raise ValueError('A correction trial has an invalid split.')
        if trial['source'] not in ('corruption', 'clean_reference', 'natural_decoder'):
            raise ValueError('A correction trial has an unknown source.')
        if type(trial['correct']) is not bool:
            raise ValueError('A correction trial has no explicit correctness measurement.')
        if isinstance(trial['damaged_correct_notes'], bool) or not isinstance(trial['damaged_correct_notes'], int) or trial['damaged_correct_notes'] < 0:
            raise ValueError('A correction trial has no explicit damage measurement.')
        if isinstance(trial['fixed_errors'], bool) or not isinstance(trial['fixed_errors'], int):
            raise ValueError('A correction trial has no explicit fixed-error measurement.')
        if not isinstance(trial['performance_id'], str) or not trial['performance_id']:
            raise ValueError('A correction trial has no performance identity.')
        previous_split = performance_splits.setdefault(trial['performance_id'], trial['split'])
        if previous_split != trial['split']:
            raise ValueError('A performance occurs in both development and holdout evidence.')
        if not isinstance(trial['piece_id'], str) or not isinstance(trial['instrument'], str):
            raise ValueError('A correction trial must retain piece and instrument identity.')
        if trial['split'] == 'holdout':
            holdout.append(trial)
    heldout_cases = len({trial['performance_id'] for trial in holdout})
    categories = {}
    for category in CORRECTION_CATEGORIES:
        rows = [trial for trial in holdout if trial['category'] == category]
        attempts = len(rows)
        performances = len({trial['performance_id'] for trial in rows})
        correct = sum(1 for trial in rows if trial['correct'])
        damaged_notes = sum(trial['damaged_correct_notes'] for trial in rows)
        damaged_trials = sum(1 for trial in rows if trial['damaged_correct_notes'] > 0)
        precision = correct / attempts if attempts else 0.0
        damage_rate = damaged_trials / attempts if attempts else 0.0
        reasons = []
        if evidence_kind != 'human':
            reasons.append('Only rendered/synthetic evidence is available.')
        if performances < thresholds['min_heldout_cases']:
            reasons.append('Too few distinct held-out performances for this category.')
        if attempts < thresholds['min_suggestions']:
            reasons.append('Too few individual corrections to estimate precision.')
        if precision < thresholds['min_correction_precision']:
            reasons.append('Individual correction precision is below the threshold.')
        if damaged_notes or damage_rate > thresholds['max_damage_rate']:
            reasons.append('A correction damaged a previously correct note.')
        enabled = not reasons
        categories[category] = {
            'enabled': enabled,
            'reason': 'Qualified on held-out human performances.' if enabled else ' '.join(reasons),
            'attempts': attempts,
            'suggestions': attempts,
            'precision': round(precision, 4),
            'damage_rate': round(damage_rate, 4),
            'heldout_cases': performances,
        }
    policy = {
        'policy_version': CORRECTION_POLICY_VERSION,
        'generated_at': generated_at or datetime.now(timezone.utc).isoformat(),
        'status': 'qualified' if any(item['enabled'] for item in categories.values())
                  else 'insufficient-evidence',
        'scope': 'Piano correction qualification; categories not listed are never enabled.',
        'benchmark': {
            'report_sha256': hashlib.sha256(report_bytes).hexdigest(),
            'evidence_kind': evidence_kind,
            'heldout_cases': heldout_cases,
            'source': 'scripts/benchmark_piano_verification.py',
        },
        'thresholds': thresholds,
        'categories': categories,
        **({'implementation': report['implementation']} if report.get('implementation') else {}),
    }
    return validate_correction_policy(policy)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--evidence-kind', choices=('rendered', 'human'), default='rendered')
    parser.add_argument('--min-heldout-cases', type=int,
                        default=DEFAULT_THRESHOLDS['min_heldout_cases'])
    parser.add_argument('--min-suggestions', type=int,
                        default=DEFAULT_THRESHOLDS['min_suggestions'])
    parser.add_argument('--min-precision', type=float,
                        default=DEFAULT_THRESHOLDS['min_correction_precision'])
    parser.add_argument('--max-damage-rate', type=float,
                        default=DEFAULT_THRESHOLDS['max_damage_rate'])
    parser.add_argument('--require-qualified', action='store_true')
    args = parser.parse_args()
    report_bytes = args.report.read_bytes()
    report = json.loads(report_bytes)
    thresholds = {
        'min_heldout_cases': args.min_heldout_cases,
        'min_suggestions': args.min_suggestions,
        'min_correction_precision': args.min_precision,
        'max_damage_rate': args.max_damage_rate,
    }
    policy = build_policy(report, report_bytes, evidence_kind=args.evidence_kind,
                          thresholds=thresholds)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(policy, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'status': policy['status'],
                      'enabled_categories': [name for name, item in policy['categories'].items()
                                             if item['enabled']],
                      'heldout_cases': policy['benchmark']['heldout_cases'],
                      'output': str(args.output)}, indent=2))
    if args.require_qualified and policy['status'] != 'qualified':
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
