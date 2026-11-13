"""Build a fail-closed phase-4 expression policy from held-out attribute outcomes.

The input report is a JSON object with an ``evidence_kind`` and ``cases`` entries:
``category``, ``split``, ``suggested``, ``improved``, ``damaged``. A category is enabled
only with human held-out evidence and enough correct, non-damaging suggestions.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

try:
    from .piano_verifier import (EXPRESSION_CATEGORIES, EXPRESSION_IMPLEMENTED,
                                 EXPRESSION_VERSION, validate_expression_policy)
    from .piano_expression_identity import measurement_identity
except ImportError:
    from piano_verifier import (EXPRESSION_CATEGORIES, EXPRESSION_IMPLEMENTED,
                                EXPRESSION_VERSION, validate_expression_policy)
    from piano_expression_identity import measurement_identity

DEFAULT_THRESHOLDS = {
    'min_heldout_cases': 40,
    'min_suggestions': 20,
    'min_correction_precision': 0.95,
    'max_damage_rate': 0.0,
}


def build_policy(report, report_bytes, *, evidence_kind='rendered', thresholds=None,
                 generated_at=None, scope='isolated'):
    if scope not in ('isolated', 'polyphonic'):
        raise ValueError('Qualification requires one explicit supported scope.')
    thresholds = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    declared = report.get('evidence_kind')
    if declared and declared != evidence_kind:
        raise ValueError('Benchmark evidence kind does not match the requested qualification kind.')
    if evidence_kind == 'human' and declared != 'human':
        raise ValueError('A human qualification run requires a report that declares human evidence.')
    trials = report.get('expression_trials')
    if not isinstance(trials, list):
        raise ValueError('Expression benchmark report has no expression_trials.')
    required = {'trial_id', 'performance_id', 'piece_id', 'instrument', 'split', 'category', 'source',
                'target', 'tolerance', 'before', 'proposed', 'suggested', 'scope', 'scorable'}
    holdout = []
    seen, performance_splits = set(), {}
    for trial in trials:
        if not isinstance(trial, dict) or not required <= set(trial):
            raise ValueError('An expression trial is missing required target/outcome evidence.')
        if not isinstance(trial.get('reference_value'), (int, float)) and not isinstance(trial.get('reference_interval'), list):
            raise ValueError('An expression trial needs a reference value or interval.')
        if trial['category'] not in EXPRESSION_CATEGORIES:
            raise ValueError('An expression trial has an unknown category.')
        identifier = trial['trial_id']
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError('Expression trials require unique, non-empty trial identities.')
        seen.add(identifier)
        if trial['split'] not in ('development', 'holdout'):
            raise ValueError('An expression trial has an invalid split.')
        if trial['source'] not in ('corruption', 'clean_reference', 'natural_decoder'):
            raise ValueError('An expression trial has an unknown source.')
        if type(trial['suggested']) is not bool:
            raise ValueError('An expression trial must declare whether a suggestion was made.')
        if type(trial['scorable']) is not bool or trial['scope'] not in ('isolated', 'polyphonic'):
            raise ValueError('An expression trial needs a valid scope and scorability.')
        if not isinstance(trial['target'], str) or not trial['target']:
            raise ValueError('An expression trial has no reference target definition.')
        valid_targets = ({'audible_release_seconds', 'audible_end_seconds'}
                         if trial['category'] == 'audible_duration'
                         else {'isolated_strike_db', 'reference_velocity'})
        if trial['target'] not in valid_targets:
            raise ValueError('An expression trial target is not a valid acoustic reference.')
        if trial['category'] == 'relative_dynamics' and not isinstance(trial.get('calibration_id'), str):
            raise ValueError('Relative-dynamics trials require a calibration identity.')
        if isinstance(trial['tolerance'], bool) or not isinstance(trial['tolerance'], (int, float)) or not math.isfinite(trial['tolerance']) or trial['tolerance'] < 0:
            raise ValueError('An expression trial has no valid tolerance.')
        for key in ('before', 'proposed'):
            if isinstance(trial[key], bool) or not isinstance(trial[key], (int, float)) or not math.isfinite(trial[key]):
                raise ValueError('An expression trial has no numeric reference/before/proposed outcome.')
        if 'reference_interval' in trial:
            interval = trial['reference_interval']
            if (not isinstance(interval, list) or len(interval) != 2
                    or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                           for value in interval)
                    or interval[0] > interval[1]):
                raise ValueError('An expression trial has an invalid reference interval.')
            low, high = float(interval[0]), float(interval[1])
        else:
            if isinstance(trial['reference_value'], bool) or not isinstance(trial['reference_value'], (int, float)) or not math.isfinite(trial['reference_value']):
                raise ValueError('An expression trial has no numeric reference value.')
            low = high = float(trial['reference_value'])
        def distance(value):
            return 0.0 if low <= value <= high else (low - value if value < low else value - high)
        # Correctness and damage are derived from the reference, not trusted flags.
        before_error = distance(float(trial['before']))
        after_error = distance(float(trial['proposed']))
        tolerance = float(trial['tolerance'])
        if trial['category'] == 'audible_duration' and tolerance > .08:
            raise ValueError('Audible-ending tolerance must use seconds and cannot exceed 80 ms.')
        if trial['category'] == 'relative_dynamics' and trial['target'] == 'reference_velocity':
            if tolerance > 8 / 127 or not all(0 <= value <= 1 for value in
                    (low, high, float(trial['before']), float(trial['proposed']))):
                raise ValueError('Velocity evidence must use normalized MIDI units and an at-most 8/127 tolerance.')
        improved = after_error < before_error - max(tolerance * 0.10, 1e-9)
        correct = improved and after_error <= max(tolerance, 1e-9)
        damaged = before_error <= tolerance and after_error > tolerance
        trial = {**trial, '_before_error': before_error, '_after_error': after_error,
                 '_improved': improved, '_correct': correct, '_damaged': int(damaged)}
        if not isinstance(trial.get('damaged_correct_values', 0), int) or trial.get('damaged_correct_values', 0) < 0:
            raise ValueError('An expression trial has no valid damage measurement.')
        if not isinstance(trial['performance_id'], str) or not trial['performance_id']:
            raise ValueError('An expression trial has no performance identity.')
        previous_split = performance_splits.setdefault(trial['performance_id'], trial['split'])
        if previous_split != trial['split']:
            raise ValueError('A performance occurs in both development and holdout evidence.')
        if not isinstance(trial['piece_id'], str) or not isinstance(trial['instrument'], str):
            raise ValueError('An expression trial must retain piece and instrument identity.')
        if trial['split'] == 'holdout':
            holdout.append(trial)
    heldout_cases = len({trial['performance_id'] for trial in holdout})
    categories = {}
    for category in EXPRESSION_CATEGORIES:
        rows = [trial for trial in holdout if trial['category'] == category
                and trial['suggested'] and trial['scorable'] and trial['scope'] == scope]
        attempts = len(rows)
        performances = len({trial['performance_id'] for trial in rows})
        correct = sum(1 for trial in rows if trial['_correct'])
        damaged_values = sum(trial['_damaged'] for trial in rows)
        damaged_trials = sum(1 for trial in rows if trial['_damaged'])
        precision = correct / attempts if attempts else 0.0
        damage_rate = damaged_trials / attempts if attempts else 0.0
        reasons = []
        if category not in EXPRESSION_IMPLEMENTED:
            reasons.append('No implementation exists for this attribute.')
        if evidence_kind != 'human':
            reasons.append('Only rendered/synthetic evidence is available.')
        if performances < thresholds['min_heldout_cases']:
            reasons.append('Too few distinct held-out performances for this attribute.')
        if attempts < thresholds['min_suggestions']:
            reasons.append('Too few individual attribute corrections.')
        if precision < thresholds['min_correction_precision']:
            reasons.append('Individual attribute precision is below the threshold.')
        if damaged_values or damage_rate > thresholds['max_damage_rate']:
            reasons.append('An attribute correction damaged a previously correct value.')
        natural = [trial for trial in rows if trial['source'] == 'natural_decoder']
        if not any(trial['_correct'] for trial in natural) or sum(
                trial['_before_error'] - trial['_after_error'] for trial in natural) <= 0:
            reasons.append('No net improvement on natural decoder errors was demonstrated in this scope.')
        if category == 'relative_dynamics':
            calibration = report.get('calibration') or {}
            calibration_id = hashlib.sha256(json.dumps({k: v for k, v in calibration.items()
                if k != 'calibration_id'}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            calibration_sha = hashlib.sha256(json.dumps(calibration, sort_keys=True,
                separators=(',', ':')).encode()).hexdigest()
            implementation = report.get('implementation') or {}
            if (calibration.get('calibration_id') != calibration_id
                    or calibration.get('reference_kind') != 'captured_midi_velocity'
                    or implementation.get('calibration_sha256') != calibration_sha
                    or not all(key in implementation for key in ('estimator_code_sha256', 'verifier_code_sha256', 'settings_sha256'))
                    or calibration.get('measurement_sha256') != measurement_identity(implementation)
                    or any(r['target'] != 'reference_velocity' or r.get('calibration_id') != calibration_id for r in rows)):
                reasons.append('No applicable captured-MIDI velocity calibration is bound to this evidence.')
        categories[category] = {
            'enabled': not reasons,
            'implemented': category in EXPRESSION_IMPLEMENTED,
            'reason': 'Qualified on held-out human performances.' if not reasons else ' '.join(reasons),
            'attempts': attempts, 'suggestions': attempts,
            'precision': round(precision, 4), 'damage_rate': round(damage_rate, 4),
            'heldout_cases': performances,
            'scopes': [scope],
        }
    policy = {
        'policy_version': EXPRESSION_VERSION,
        'generated_at': generated_at or datetime.now(timezone.utc).isoformat(),
        'status': 'qualified' if any(item['enabled'] for item in categories.values())
                  else 'insufficient-evidence',
        'scope': 'Phase 4 expression improvements; categories not listed are never applied.',
        'benchmark': {'report_sha256': hashlib.sha256(report_bytes).hexdigest(),
                      'evidence_kind': evidence_kind, 'heldout_cases': heldout_cases,
                      'source': 'scripts/qualify_piano_expression.py'},
        'thresholds': thresholds,
        'categories': categories,
        **({'implementation': report['implementation']} if report.get('implementation') else {}),
    }
    return validate_expression_policy(policy)


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
    parser.add_argument('--scope', choices=('isolated', 'polyphonic'), default='isolated')
    args = parser.parse_args()
    report_bytes = args.report.read_bytes()
    report = json.loads(report_bytes)
    thresholds = {'min_heldout_cases': args.min_heldout_cases,
                  'min_suggestions': args.min_suggestions,
                  'min_correction_precision': args.min_precision,
                  'max_damage_rate': args.max_damage_rate}
    policy = build_policy(report, report_bytes, evidence_kind=args.evidence_kind,
                          thresholds=thresholds, scope=args.scope)
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
