"""Correction qualification must fail closed on incomplete or weak evidence."""
import json
import pytest
from pathlib import Path

from scripts.piano_verifier import validate_correction_policy
from scripts.qualify_piano_corrections import build_policy


def implementation():
    return {'verifier_code_sha256': 'a' * 64, 'settings_sha256': 'b' * 64,
            'weights_sha256': 'c' * 64, 'model': 'basic-pitch', 'model_version': '0.4.0',
            'decoder': 'basic-pitch-0.4.0/piano-peaks-v1', 'decoder_sha256': 'e' * 64,
            'application_code_sha256': 'd' * 64}


def trials(category, count, *, correct=True, damaged=0, prefix='performance', source='corruption'):
    return [{'trial_id': f'{prefix}-{source}-{index}',
             'performance_id': f'{prefix}-{index}', 'piece_id': f'piece-{index}',
             'instrument': 'piano', 'split': 'holdout', 'category': category,
             'source': source, 'correct': correct,
             'damaged_correct_notes': damaged, 'fixed_errors': 1 if correct else 0}
            for index in range(count)]


def report_for(rows, evidence='human'):
    return {'evidence_kind': evidence, 'implementation': implementation(),
            'correction_trials': rows}


def test_human_heldout_individual_corrections_can_qualify_a_category():
    policy = build_policy(report_for(trials('duplicate_event', 40)), b'benchmark',
                          evidence_kind='human')
    assert policy['status'] == 'qualified'
    assert policy['categories']['duplicate_event']['enabled'] is True
    assert policy['categories']['onset_shift']['enabled'] is False


def test_rendered_few_performances_or_missing_evidence_cannot_qualify():
    rendered = build_policy(report_for(trials('duplicate_event', 40), 'rendered'),
                            b'benchmark', evidence_kind='rendered')
    assert not any(item['enabled'] for item in rendered['categories'].values())
    small = build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                          'correction_trials': trials('duplicate_event', 4)},
                         b'benchmark', evidence_kind='human')
    assert not any(item['enabled'] for item in small['categories'].values())
    one = [dict(row, performance_id='one') for row in trials('duplicate_event', 40)]
    repeated = build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                             'correction_trials': one}, b'benchmark', evidence_kind='human')
    assert repeated['categories']['duplicate_event']['enabled'] is False


def test_missing_damage_evidence_is_rejected():
    rows = trials('duplicate_event', 40)
    del rows[0]['damaged_correct_notes']
    try:
        build_policy(report_for(rows), b'benchmark', evidence_kind='human')
    except ValueError as error:
        assert 'missing required' in str(error)
    else:
        raise AssertionError('missing damage evidence was accepted')


def test_damage_or_low_precision_blocks_qualification():
    damaged = build_policy(report_for(trials('duplicate_event', 40, damaged=1)),
                           b'benchmark', evidence_kind='human')
    assert damaged['categories']['duplicate_event']['enabled'] is False
    uncertain = build_policy(report_for(trials('duplicate_event', 40, correct=False)),
                             b'benchmark', evidence_kind='human')
    assert uncertain['categories']['duplicate_event']['enabled'] is False


def test_clean_and_natural_corrections_count_in_precision():
    rows = trials('duplicate_event', 20) + trials(
        'duplicate_event', 20, correct=False, source='clean_reference')
    policy = build_policy(report_for(rows), b'benchmark', evidence_kind='human')
    assert policy['categories']['duplicate_event']['precision'] == 0.5
    assert policy['categories']['duplicate_event']['enabled'] is False


def test_checked_in_policy_is_fail_closed():
    path = Path(__file__).resolve().parents[2] / 'docs/qualification/piano-correction-policy.json'
    policy = validate_correction_policy(json.loads(path.read_text(encoding='utf-8')))
    assert policy['status'] == 'insufficient-evidence'
    assert not any(item['enabled'] for item in policy['categories'].values())


def test_duplicate_trials_cannot_inflate_precision():
    rows = trials('duplicate_event', 40)
    for row in rows[-5:]:
        row.update(correct=False, fixed_errors=0)
    assert not build_policy(report_for(rows), b'benchmark', evidence_kind='human')[
        'categories']['duplicate_event']['enabled']
    with pytest.raises(ValueError, match='unique'):
        build_policy(report_for(rows + [dict(rows[0])] * 100), b'benchmark', evidence_kind='human')


def test_performance_cannot_leak_from_development_into_holdout():
    rows = trials('duplicate_event', 40)
    rows.append({**rows[0], 'trial_id': 'development-trial', 'split': 'development'})
    with pytest.raises(ValueError, match='both development and holdout'):
        build_policy(report_for(rows), b'benchmark', evidence_kind='human')
