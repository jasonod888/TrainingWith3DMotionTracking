"""Piano transcription verification: evidence extraction and diagnostic findings.

This module compares a decoded Basic Pitch piano proposal with the recording that
produced it. It never changes the proposal. It returns a versioned report that a
reviewer (or a later, separately qualified stage) can act on.

Design constraints from ``docs/piano-audio-verification-plan.md``:

* The audio timeline is used unchanged; no quantisation or chord snapping.
* The proposal is a *soft* guide. Candidate pitches and attacks that the proposal
  does not contain are always considered.
* Audio explanation is modelled with non-negative note atoms (attack and sustain)
  plus a noise component. A smaller residual is not sufficient evidence on its own:
  attack support, model agreement, bounded changes and explicit ambiguity decide.
* Anything that is not clearly supported is reported as a finding or marked
  ambiguous. Failure to find evidence is never reported as proof of absence.

The implementation depends only on ``numpy`` and ``scipy`` so the same code can run
inside the music worker and in the ordinary test environment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks, get_window, resample_poly

SCHEMA_VERSION = 1
VERIFIER_VERSION = 'piano-verifier-1'
MIDI_MIN, MIDI_MAX = 21, 108
A4_HZ = 440.0
BASIC_PITCH_HOP = 256

DEFAULT_SETTINGS = {
    'analysis': {
        'low_split_hz': 700.0,
        'low_fft': 8192,
        'full_fft': 2048,
        'hop': 256,
        'min_bin_hz': 25.0,
        'max_bin_hz': 6000.0,
        'noise_percentile': 15,
        'attack_fft': 1024,
        'attack_hop': 128,
        'attack_min_hz': 900.0,
        'attack_max_hz': 8000.0,
    },
    'tuning': {'max_cents': 40.0, 'min_partial_hz': 80.0, 'max_partial_hz': 2500.0},
    'templates': {
        'max_partials': 24,
        'inharmonicity': 0.0004,
        'attack_tilt': 0.72,
        'sustain_tilt': 1.05,
        'attack_rolloff_hz': 6500.0,
        'sustain_rolloff_hz': 3200.0,
        'velocity_tilt': 0.35,
        'sustain_decay_scale': 1.0,
    },
    'decomposition': {
        'attack_tau_s': 0.030,
        'sustain_attack_s': 0.012,
        'ridge': 1e-9,
        'sweeps': 90,
        'context_before_s': 2.0,
        'envelope_smear_frames': 8,
        'max_atoms': 160,
        'max_frames': 720,
    },
    'regions': {
        'cluster_gap_s': 0.35,
        'before_s': 0.45,
        'after_s': 1.10,
        'max_regions': 80,
        'max_region_seconds': 8.0,
        'max_region_notes': 80,
        'max_window_notes': 240,
    },
    'checks': {
        'attack_tolerance_s': 0.060,
        'unmatched_attack_min_novelty': 0.22,
        'onset_step_s': 0.020,
        'onset_min_shift_s': 0.060,
        'onset_min_attack': 0.50,
        'attack_lag_s': 0.045,
        'repetition_min_gap_s': 0.120,
        'repetition_end_margin_s': 0.050,
        'repetition_min_novelty': 0.90,
        'repetition_min_broadband': 0.55,
        'duplicate_gap_s': 0.160,
        'duplicate_second_attack': 0.35,
        'duplicate_attack_ratio': 0.50,
        'missing_unexplained': 0.35,
        'missing_fundamental': 0.35,
        'missing_min_snr_db': 3.0,
        'candidate_limit': 4,
    },
    'scoring': {
        'add_gain': 0.55,
        'shift_gain': 0.30,
        'repetition_min_gain': 0.15,
        'substitute_gain': 0.45,
        'delete_max_gain': 0.18,
        'merge_max_gain': 1.50,
        'margin': 0.12,
    },
    'insertion': {
        'min_gain': 1.00,
        'min_fundamental': 0.50,
        'min_attack_sharp': 2.00,
        'min_attack': 0.20,
        'min_decoder_onset': 0.65,
        'competing_ratio': 0.75,
    },
    'limits': {'max_findings': 400, 'budget_seconds': 100.0, 'max_events': 20000,
               'max_audio_seconds': 600.0, 'max_region_matrix': 2000000},
}

# ---------------------------------------------------------------------------
# Correction qualification policy

CORRECTION_POLICY_VERSION = 'piano-corrections-1'
CORRECTION_CATEGORIES = (
    'onset_shift', 'duplicate_event', 'missed_repetition', 'unmatched_attack',
    'missing_pitch', 'extra_pitch', 'octave_ambiguity',
)
CORRECTION_CATEGORY_FOR_KIND = {
    'onset_shift': 'onset_shift',
    'duplicate_event': 'duplicate_event',
    'missed_repetition': 'missed_repetition',
    'unmatched_attack': 'unmatched_attack',
    'missing_pitch': 'missing_pitch',
    'extra_pitch': 'extra_pitch',
    'octave_ambiguity': 'octave_ambiguity',
}
_POLICY_KEYS = {'policy_version', 'generated_at', 'status', 'scope', 'benchmark',
                'thresholds', 'categories', 'implementation'}
_IMPLEMENTATION_KEYS = {'verifier_code_sha256', 'settings_sha256', 'weights_sha256',
                        'model', 'model_version', 'decoder', 'decoder_sha256',
                        'application_code_sha256'}
_THRESHOLD_KEYS = {'min_heldout_cases', 'min_suggestions', 'min_correction_precision',
                   'max_damage_rate'}
_BENCHMARK_KEYS = {'report_sha256', 'evidence_kind', 'heldout_cases', 'source'}
_CATEGORY_KEYS = {'enabled', 'reason', 'attempts', 'suggestions', 'precision',
                  'damage_rate', 'heldout_cases'}


def validate_correction_policy(value):
    """Return a normalized policy or raise ValueError. Fail closed on anything unknown."""
    if not isinstance(value, dict) or set(value) - _POLICY_KEYS:
        raise ValueError('Correction policy has unknown or missing fields.')
    if value.get('policy_version') != CORRECTION_POLICY_VERSION:
        raise ValueError('Correction policy version is not supported.')
    if value.get('status') not in ('insufficient-evidence', 'qualified'):
        raise ValueError('Correction policy status is invalid.')
    if not isinstance(value.get('generated_at'), str) or not value['generated_at']:
        raise ValueError('Correction policy date is invalid.')
    if not isinstance(value.get('scope'), str) or not value['scope']:
        raise ValueError('Correction policy scope is invalid.')
    benchmark = value.get('benchmark')
    if not isinstance(benchmark, dict) or set(benchmark) - _BENCHMARK_KEYS:
        raise ValueError('Correction policy benchmark is invalid.')
    if not isinstance(benchmark.get('report_sha256'), str) or len(benchmark['report_sha256']) != 64:
        raise ValueError('Correction policy benchmark digest is invalid.')
    if benchmark.get('evidence_kind') not in ('rendered', 'human'):
        raise ValueError('Correction policy evidence kind is invalid.')
    heldout = benchmark.get('heldout_cases')
    if isinstance(heldout, bool) or not isinstance(heldout, int) or heldout < 0:
        raise ValueError('Correction policy held-out case count is invalid.')
    thresholds = value.get('thresholds')
    if not isinstance(thresholds, dict) or set(thresholds) != _THRESHOLD_KEYS:
        raise ValueError('Correction policy thresholds are incomplete.')
    for name in ('min_heldout_cases', 'min_suggestions'):
        number = thresholds[name]
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            raise ValueError('Correction policy sample thresholds are invalid.')
    for name in ('min_correction_precision', 'max_damage_rate'):
        number = thresholds[name]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not 0 <= number <= 1:
            raise ValueError('Correction policy quality thresholds are invalid.')
    categories = value.get('categories')
    if not isinstance(categories, dict) or set(categories) - set(CORRECTION_CATEGORIES):
        raise ValueError('Correction policy categories are invalid.')
    implementation = value.get('implementation')
    if implementation is not None:
        if not isinstance(implementation, dict) or set(implementation) != _IMPLEMENTATION_KEYS:
            raise ValueError('Correction policy implementation fingerprint is invalid.')
        for key in ('verifier_code_sha256', 'settings_sha256', 'weights_sha256', 'decoder_sha256',
                    'application_code_sha256'):
            if not isinstance(implementation.get(key), str) or len(implementation[key]) != 64:
                raise ValueError('Correction policy implementation digest is invalid.')
        for key in ('model', 'model_version', 'decoder'):
            if not isinstance(implementation.get(key), str) or not implementation[key]:
                raise ValueError('Correction policy implementation identity is invalid.')
    normalized = {**value, 'benchmark': dict(benchmark), 'thresholds': dict(thresholds),
                  'categories': {},
                  **({'implementation': implementation} if implementation is not None else {})}
    for name, category in categories.items():
        if not isinstance(category, dict) or set(category) - _CATEGORY_KEYS:
            raise ValueError(f'Correction policy category {name} is invalid.')
        if type(category.get('enabled')) is not bool:
            raise ValueError(f'Correction policy category {name} needs an enabled flag.')
        metrics = {key: category.get(key) for key in ('attempts', 'suggestions', 'precision',
                                                      'damage_rate', 'heldout_cases')}
        for key, number in metrics.items():
            if number is None:
                continue
            if isinstance(number, bool) or not isinstance(number, (int, float)):
                raise ValueError(f'Correction policy category {name} metric {key} is invalid.')
            if key in ('precision', 'damage_rate') and not 0 <= number <= 1:
                raise ValueError(f'Correction policy category {name} metric {key} must be 0..1.')
            if key in ('attempts', 'suggestions', 'heldout_cases') and number < 0:
                raise ValueError(f'Correction policy category {name} metric {key} is negative.')
        normalized['categories'][name] = {**category}
        if not category['enabled']:
            continue
        if value['status'] != 'qualified':
            raise ValueError('A correction category cannot be enabled without qualified evidence.')
        if benchmark['evidence_kind'] != 'human':
            raise ValueError('Only human-performance held-out evidence can qualify a correction category.')
        if heldout < thresholds['min_heldout_cases']:
            raise ValueError('The held-out sample is below the qualification minimum.')
        if (category.get('heldout_cases') or 0) < thresholds['min_heldout_cases']:
            raise ValueError(f'Category {name} has too few held-out cases.')
        if (category.get('suggestions') or 0) < thresholds['min_suggestions']:
            raise ValueError(f'Category {name} has too few suggested corrections.')
        if (category.get('precision') or 0.0) < thresholds['min_correction_precision']:
            raise ValueError(f'Category {name} is below the precision threshold.')
        if (category.get('damage_rate') if category.get('damage_rate') is not None else 1.0) > thresholds['max_damage_rate']:
            raise ValueError(f'Category {name} exceeds the damage threshold.')
    if normalized['status'] == 'qualified' and not any(
            item['enabled'] for item in normalized['categories'].values()):
        raise ValueError('A qualified policy must enable at least one category.')
    if any(item['enabled'] for item in normalized['categories'].values()) and implementation is None:
        raise ValueError('Enabled correction categories require an implementation fingerprint.')
    return normalized


def correction_policy_digest(policy):
    return _sha256_bytes(_canonical(policy).encode('utf-8'))


def gate_corrections(findings, mode='diagnostic', policy=None):
    """Mark suggestions qualified or withheld and return report metadata.

    Diagnostic mode preserves the phase-2 owner-suggestion behaviour. Qualified mode
    exposes edits only for categories that passed the versioned evidence policy.
    """
    if mode not in ('diagnostic', 'qualified'):
        raise ValueError('Verification mode must be diagnostic or qualified.')
    if mode == 'qualified':
        policy = validate_correction_policy(policy)
    enabled = [name for name, item in (policy or {}).get('categories', {}).items()
               if item.get('enabled')]
    withheld = 0
    for finding in findings:
        if finding.get('status') != 'suggested' or not finding.get('proposed_edits'):
            finding['correction_status'] = 'none'
            continue
        if mode == 'diagnostic':
            finding['correction_status'] = 'diagnostic'
            continue
        category = CORRECTION_CATEGORY_FOR_KIND.get(finding.get('kind'))
        if finding.get('ambiguous'):
            withheld += 1
            finding['status'] = 'unresolved'
            finding['correction_status'] = 'withheld'
            finding['withheld_reason'] = 'The finding remains ambiguous, so its edit is withheld.'
            continue
        if category in enabled:
            finding['correction_status'] = 'qualified'
            finding['qualification'] = {'policy_version': policy['policy_version'],
                                        'category': category}
        else:
            withheld += 1
            finding['status'] = 'unresolved'
            finding['correction_status'] = 'withheld'
            finding['withheld_reason'] = (
                f'Correction category {category or finding.get("kind")} has not met the '
                'held-out qualification limits, so the edit is withheld.')
    return {'mode': mode,
            'policy_version': (policy or {}).get('policy_version'),
            'policy_sha256': correction_policy_digest(policy) if policy else None,
            'status': (policy or {}).get('status'),
            'policy': policy,
            'enabled_categories': enabled,
            'withheld_count': withheld}


# ---------------------------------------------------------------------------
# Phase 4 expression policy

EXPRESSION_VERSION = 'piano-expression-1'
EXPRESSION_CATEGORIES = ('audible_duration', 'relative_dynamics', 'pedal',
                         'key_release', 'written_rhythm')
EXPRESSION_IMPLEMENTED = {'audible_duration', 'relative_dynamics'}
_EXPRESSION_THRESHOLDS = {'min_heldout_cases', 'min_suggestions',
                          'min_correction_precision', 'max_damage_rate'}
_EXPRESSION_IMPLEMENTATION_KEYS = {
    'estimator_code_sha256', 'verifier_code_sha256', 'settings_sha256',
    'weights_sha256', 'model', 'model_version', 'decoder', 'decoder_sha256', 'application_code_sha256'}


def validate_expression_policy(value):
    if not isinstance(value, dict) or set(value) - {'policy_version', 'generated_at',
                                                    'status', 'scope', 'benchmark',
                                                    'thresholds', 'categories', 'implementation'}:
        raise ValueError('Expression policy has unknown or missing fields.')
    if value.get('policy_version') != EXPRESSION_VERSION:
        raise ValueError('Expression policy version is not supported.')
    if value.get('status') not in ('insufficient-evidence', 'qualified'):
        raise ValueError('Expression policy status is invalid.')
    if not isinstance(value.get('generated_at'), str) or not value.get('generated_at'):
        raise ValueError('Expression policy date is invalid.')
    if not isinstance(value.get('scope'), str) or not value.get('scope'):
        raise ValueError('Expression policy scope is invalid.')
    benchmark = value.get('benchmark')
    if not isinstance(benchmark, dict) or set(benchmark) - {'report_sha256', 'evidence_kind',
                                                            'heldout_cases', 'source'}:
        raise ValueError('Expression policy benchmark is invalid.')
    if not isinstance(benchmark.get('report_sha256'), str) or len(benchmark['report_sha256']) != 64:
        raise ValueError('Expression policy benchmark digest is invalid.')
    if benchmark.get('evidence_kind') not in ('rendered', 'human'):
        raise ValueError('Expression policy evidence kind is invalid.')
    if isinstance(benchmark.get('heldout_cases'), bool) or not isinstance(benchmark.get('heldout_cases'), int) or benchmark['heldout_cases'] < 0:
        raise ValueError('Expression policy held-out case count is invalid.')
    thresholds = value.get('thresholds')
    if not isinstance(thresholds, dict) or set(thresholds) != _EXPRESSION_THRESHOLDS:
        raise ValueError('Expression policy thresholds are incomplete.')
    for name in ('min_heldout_cases', 'min_suggestions'):
        if isinstance(thresholds[name], bool) or not isinstance(thresholds[name], int) or thresholds[name] < 1:
            raise ValueError('Expression policy sample thresholds are invalid.')
    for name in ('min_correction_precision', 'max_damage_rate'):
        number = thresholds[name]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not 0 <= number <= 1:
            raise ValueError('Expression policy quality thresholds are invalid.')
    categories = value.get('categories')
    if not isinstance(categories, dict) or set(categories) - set(EXPRESSION_CATEGORIES):
        raise ValueError('Expression policy categories are invalid.')
    implementation = value.get('implementation')
    if implementation is not None:
        if not isinstance(implementation, dict) or set(implementation) - {'calibration_sha256'} != _EXPRESSION_IMPLEMENTATION_KEYS:
            raise ValueError('Expression implementation fingerprint is invalid.')
        for key in ('estimator_code_sha256', 'verifier_code_sha256', 'settings_sha256',
                    'weights_sha256', 'decoder_sha256', 'application_code_sha256'):
            if not isinstance(implementation.get(key), str) or len(implementation[key]) != 64:
                raise ValueError('Expression implementation digest is invalid.')
        for key in ('model', 'model_version', 'decoder'):
            if not isinstance(implementation.get(key), str) or not implementation[key]:
                raise ValueError('Expression implementation identity is invalid.')
        if 'calibration_sha256' in implementation and (not isinstance(implementation['calibration_sha256'], str)
                                                       or len(implementation['calibration_sha256']) != 64):
            raise ValueError('Expression calibration fingerprint is invalid.')
    normalized = {**value, 'benchmark': dict(benchmark), 'thresholds': dict(thresholds),
                  'categories': {},
                  **({'implementation': implementation} if implementation is not None else {})}
    for name, category in categories.items():
        if not isinstance(category, dict) or set(category) - {
                'enabled', 'implemented', 'reason', 'attempts', 'suggestions',
                'precision', 'damage_rate', 'heldout_cases', 'scopes'}:
            raise ValueError(f'Expression category {name} is invalid.')
        if type(category.get('enabled')) is not bool or type(category.get('implemented')) is not bool:
            raise ValueError(f'Expression category {name} needs enabled/implemented flags.')
        if category['implemented'] != (name in EXPRESSION_IMPLEMENTED):
            raise ValueError(f'Expression category {name} implementation flag disagrees with the runtime.')
        scopes = category.get('scopes', ['isolated'])
        if (not isinstance(scopes, list)
                or any(scope not in ('isolated', 'polyphonic') for scope in scopes)
                or len(set(scopes)) != len(scopes)):
            raise ValueError(f'Expression category {name} scopes are invalid.')
        if category.get('enabled') and not scopes:
            raise ValueError(f'Expression category {name} has no supported scope.')
        category['scopes'] = scopes
        for key in ('attempts', 'suggestions', 'precision', 'damage_rate', 'heldout_cases'):
            number = category.get(key)
            if number is None:
                continue
            if isinstance(number, bool) or not isinstance(number, (int, float)):
                raise ValueError(f'Expression category {name} metric {key} is invalid.')
            if key in ('attempts', 'suggestions', 'heldout_cases'):
                if not isinstance(number, int) or number < 0:
                    raise ValueError(f'Expression category {name} metric {key} must be a non-negative integer.')
            elif not 0 <= number <= 1:
                raise ValueError(f'Expression category {name} metric {key} must be 0..1.')
        normalized['categories'][name] = {**category}
        if not category['enabled']:
            continue
        if not category['implemented']:
            raise ValueError(f'Expression category {name} has no implementation.')
        if implementation is None:
            raise ValueError('Enabled expression categories require an implementation fingerprint.')
        if name == 'relative_dynamics' and not implementation.get('calibration_sha256'):
            raise ValueError('Automatic velocity requires a bound calibration artifact.')
        if value['status'] != 'qualified':
            raise ValueError('An expression category cannot be enabled without qualified evidence.')
        if benchmark['evidence_kind'] != 'human':
            raise ValueError('Only human held-out evidence can qualify an expression category.')
        if benchmark['heldout_cases'] < thresholds['min_heldout_cases']:
            raise ValueError('The expression held-out sample is below the minimum.')
        if (category.get('heldout_cases') or 0) < thresholds['min_heldout_cases']:
            raise ValueError(f'Expression category {name} has too few held-out cases.')
        if (category.get('suggestions') or 0) < thresholds['min_suggestions']:
            raise ValueError(f'Expression category {name} has too few suggestions.')
        if (category.get('precision') or 0.0) < thresholds['min_correction_precision']:
            raise ValueError(f'Expression category {name} is below precision threshold.')
        if (category.get('damage_rate') if category.get('damage_rate') is not None else 1.0) > thresholds['max_damage_rate']:
            raise ValueError(f'Expression category {name} exceeds the damage threshold.')
    if normalized['status'] == 'qualified' and not any(
            item['enabled'] for item in normalized['categories'].values()):
        raise ValueError('A qualified expression policy must enable at least one category.')
    return normalized


def expression_policy_digest(policy):
    return _sha256_bytes(_canonical(policy).encode('utf-8'))


def _expression_duration(analysis, note, clip, events):
    onset = float(note['onset'])
    existing = float(note.get('duration') or 0.0)
    max_end = min(clip, onset + min(8.0, max(2.0, existing * 2.0 + 1.0)))
    later = [float(other['onset']) for other in events
             if int(other['pitch']) == int(note['pitch']) and float(other['onset']) > onset + 0.05]
    if later:
        max_end = min(max_end, min(later) - 0.04)
    if max_end <= onset + 0.08:
        return None
    start = support(analysis, int(note['pitch']), onset)['activity_db']
    if start < 4.0:
        return None
    last = None
    for value in np.arange(onset + 0.08, max_end + 1e-6, 0.04):
        if support(analysis, int(note['pitch']), float(value))['activity_db'] >= 3.5:
            last = float(value)
        elif last is not None and float(value) - last > 0.20:
            break
    if last is None:
        return None
    duration = min(clip, last + 0.04) - onset
    if duration < 0.05 or abs(duration - existing) < 0.06:
        return None
    return round(duration, 3)


def _expression_dynamics(analysis, events):
    values = []
    for note in events:
        db = support(analysis, int(note['pitch']), float(note['onset']))['activity_db']
        if db >= 3.0:
            values.append((note, db))
    if len(values) < 2:
        return {}
    low = min(db for _note, db in values)
    high = max(db for _note, db in values)
    if high - low < 6.0:
        return {}
    proposals = {}
    for note, db in values:
        value = round(min(1.0, max(0.2, 0.2 + 0.8 * (db - low) / (high - low))), 3)
        existing = note.get('velocity')
        if existing is None or abs(value - float(existing)) >= 0.08:
            proposals[str(note['id'])] = (value, round(db, 2))
    return proposals


def analyze_expression(analysis, events, duration, policy, mode):
    """Build phase-4 proposals only for enabled, implemented categories."""
    if not policy:
        return {'version': EXPRESSION_VERSION, 'mode': mode, 'status': 'disabled',
                'policy': None, 'proposals': [], 'summary': {'proposal_count': 0}}
    policy = validate_expression_policy(policy)
    enabled = [name for name, item in policy['categories'].items() if item['enabled']]
    if not enabled:
        return {'version': EXPRESSION_VERSION, 'mode': mode, 'status': 'disabled',
                'policy': {'policy_version': policy['policy_version'],
                           'policy_sha256': expression_policy_digest(policy),
                           'enabled_categories': []},
                'proposals': [], 'summary': {'proposal_count': 0}}
    limit = 500
    considered = events[:limit]
    proposals = []
    dynamics = _expression_dynamics(analysis, considered) if 'relative_dynamics' in enabled else {}
    for note in considered:
        event_id = str(note['id'])
        if 'audible_duration' in enabled:
            value = _expression_duration(analysis, note, duration, considered)
            if value is not None:
                proposals.append({'event_id': event_id, 'attribute': 'audible_duration',
                                  'value': value, 'before': float(note.get('duration') or 0.0),
                                  'status': 'suggested', 'ambiguous': False,
                                  'evidence': {'activity_db': support(
                                      analysis, int(note['pitch']), float(note['onset']))['activity_db']}})
        if event_id in dynamics:
            value, db = dynamics[event_id]
            proposals.append({'event_id': event_id, 'attribute': 'relative_dynamics',
                              'value': value, 'before': note.get('velocity'),
                              'status': 'suggested', 'ambiguous': False,
                              'evidence': {'activity_db': db}})
    for proposal in proposals:
        if mode == 'diagnostic':
            proposal['correction_status'] = 'diagnostic'
        else:
            proposal['correction_status'] = 'qualified'
    by_attribute = {}
    for proposal in proposals:
        by_attribute[proposal['attribute']] = by_attribute.get(proposal['attribute'], 0) + 1
    return {'version': EXPRESSION_VERSION, 'mode': mode,
            'status': 'partial' if len(events) > limit else ('complete' if proposals else 'no-improvements'),
            'policy': {'policy_version': policy['policy_version'],
                       'policy_sha256': expression_policy_digest(policy),
                       'enabled_categories': enabled},
            'proposals': proposals,
            'summary': {'proposal_count': len(proposals), 'by_attribute': by_attribute,
                        'events_considered': len(considered), 'truncated': len(events) > limit}}


# ---------------------------------------------------------------------------
# Small utilities



def _merge(base, override):
    result = {key: (dict(value) if isinstance(value, dict) else value) for key, value in base.items()}
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _r(value, digits=4):
    return round(float(value), digits)


def _midi_hz(pitch, cents=0.0):
    return A4_HZ * 2.0 ** ((float(pitch) - 69.0) / 12.0) * 2.0 ** (float(cents) / 1200.0)


def _decay_tau(pitch, settings):
    """Approximate audible decay constant of a struck piano note."""
    f0 = _midi_hz(pitch)
    tau = 1.9 * (261.63 / f0) ** 0.32
    return float(np.clip(tau, 0.35, 7.0) * settings['templates']['sustain_decay_scale'])


def _smooth(values, width):
    if width <= 1 or values.size == 0:
        return values
    kernel = np.ones(int(width), dtype=np.float64) / float(width)
    pad = int(width) // 2
    if values.ndim == 1:
        padded = np.pad(values, (pad, pad), mode='edge')
        return np.convolve(padded, kernel, mode='valid')[:values.size]
    padded = np.pad(values, ((pad, pad), (0, 0)), mode='edge')
    output = np.empty_like(values, dtype=np.float64)
    for column in range(values.shape[1]):
        output[:, column] = np.convolve(padded[:, column], kernel, mode='valid')[:values.shape[0]]
    return output


def proposal_digest(events) -> str:
    """Stable identity of the decoded proposal for staleness checks."""
    payload = [{'id': str(event.get('id')), 'onset': _r(event.get('onset') or 0.0, 4),
                'duration': _r(event.get('duration') or 0.0, 4), 'pitch': int(event.get('pitch')),
                'velocity': _r(event.get('velocity') or 0.0, 4)} for event in events]
    return _sha256_bytes(_canonical(payload).encode('utf-8'))


def apply_edits(events, edits):
    """Return a revised event list; the input events are never mutated.

    Only the verifier's own edit operations are accepted. This produces the
    separate alternative proposal retained beside the immutable baseline.
    """
    working = [dict(event) for event in events]
    counter = 0
    for edit in edits:
        operation = edit.get('op')
        if operation in ('set_onset', 'set_pitch'):
            field = 'onset' if operation == 'set_onset' else 'pitch'
            value = edit['after'][field]
            for identifier in edit.get('event_ids', []):
                match = next((item for item in working if str(item['id']) == str(identifier)), None)
                if match is None:
                    raise ValueError('Edit references an unknown event.')
                match[field] = float(value) if field == 'onset' else int(value)
        elif operation == 'delete_note':
            identifiers = {str(value) for value in edit.get('event_ids', [])}
            working = [item for item in working if str(item['id']) not in identifiers]
        elif operation == 'merge':
            identifiers = [str(value) for value in edit.get('event_ids', [])]
            if len(identifiers) != 2:
                raise ValueError('A merge edit needs two events.')
            matches = [item for item in working if str(item['id']) in identifiers]
            if len(matches) != 2:
                raise ValueError('Edit references an unknown event.')
            onset = float(edit['after']['onset'])
            duration = float(edit['after']['duration'])
            counter += 1
            merged = {'id': f'vf-edit-{counter}', 'onset': onset, 'duration': duration,
                      'pitch': int(edit['after']['pitch']),
                      'velocity': max(float(item.get('velocity', 0.5) or 0.5) for item in matches),
                      'confidence': None, 'optional': False}
            working = [item for item in working if str(item['id']) not in identifiers] + [merged]
        elif operation == 'split_note':
            identifiers = [str(value) for value in edit.get('event_ids', [])]
            if len(identifiers) != 1:
                raise ValueError('A split edit needs one event.')
            original = [item for item in working if str(item['id']) == identifiers[0]]
            if not original:
                raise ValueError('Edit references an unknown event.')
            pieces = []
            for piece in edit['after']:
                counter += 1
                pieces.append({'id': f'vf-edit-{counter}', 'onset': float(piece['onset']),
                               'duration': float(piece['duration']), 'pitch': int(piece['pitch']),
                               'velocity': float(original[0].get('velocity', 0.5) or 0.5),
                               'confidence': None, 'optional': False})
            working = [item for item in working if str(item['id']) != identifiers[0]] + pieces
        elif operation == 'add_note':
            counter += 1
            note = edit['after']
            working.append({'id': f'vf-edit-{counter}', 'onset': float(note['onset']),
                            'duration': float(note['duration']), 'pitch': int(note['pitch']),
                            'velocity': float(note.get('velocity', 0.5)),
                            'confidence': None, 'optional': False})
        else:
            raise ValueError('Unsupported verification edit operation.')
    working.sort(key=lambda item: (float(item['onset']), int(item['pitch']), str(item['id'])))
    return working


# ---------------------------------------------------------------------------
# Audio loading and spectral analysis


def load_audio(path, expected_rate: int = 22050):
    """Read the exact analysis audio. Only PCM WAV is accepted; never guesses."""
    path = Path(path)
    with wave.open(str(path), 'rb') as stream:
        channels = stream.getnchannels()
        width = stream.getsampwidth()
        rate = stream.getframerate()
        frames = stream.getnframes()
        if stream.getcomptype() != 'NONE':
            raise ValueError('Compressed analysis audio is not supported.')
        if width != 2:
            raise ValueError('Analysis audio must be 16-bit PCM.')
        raw = stream.readframes(frames)
    samples = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1)
    elif channels != 1:
        raise ValueError('Analysis audio must be mono or stereo.')
    if rate != expected_rate:
        divisor = math.gcd(int(expected_rate), int(rate))
        up, down = int(expected_rate) // divisor, int(rate) // divisor
        samples = resample_poly(samples, up, down)
        rate = expected_rate
    return np.ascontiguousarray(samples, dtype=np.float64), int(rate)


def _stft_magnitude(samples, rate, n_fft, hop):
    window = get_window('hann', n_fft, fftbins=True)
    scale = 2.0 / float(window.sum())
    pad = n_fft // 2
    padded = np.pad(samples, (pad, pad), mode='reflect')
    count = 1 + len(samples) // hop
    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft)[::hop][:count]
    output = np.empty((frames.shape[0], n_fft // 2 + 1), dtype=np.float64)
    block = 256
    for start in range(0, frames.shape[0], block):
        chunk = frames[start:start + block]
        output[start:start + block] = np.abs(np.fft.rfft(chunk * window, axis=1)) * scale
    return output


@dataclass
class Analysis:
    samples: np.ndarray
    sample_rate: int
    hop: int
    times: np.ndarray
    freqs: np.ndarray
    bin_widths: np.ndarray
    Y: np.ndarray
    noise: np.ndarray
    novelty: np.ndarray
    pitch_novelty: np.ndarray
    pitch_activity: np.ndarray
    tuning_cents: float
    tuning_spread_cents: float
    partials: list = field(default_factory=list)
    attack_times: np.ndarray = None
    attack_novelty: np.ndarray = None
    level: np.ndarray = None
    noise_level: float = 0.0

    @property
    def frames(self):
        return self.Y.shape[0]


def _freq_weights(freq, freqs, bin_widths, relative=0.0035):
    if freq <= 0 or freq >= freqs[-1]:
        return np.empty(0, dtype=int), np.empty(0)
    width = float(np.interp(freq, freqs, bin_widths))
    sigma = max(0.55 * width, relative * freq)
    low = int(np.searchsorted(freqs, freq - 3.0 * sigma))
    high = int(np.searchsorted(freqs, freq + 3.0 * sigma, side='right'))
    if high <= low:
        high = min(len(freqs), low + 1)
    indices = np.arange(low, min(high, len(freqs)))
    weights = np.exp(-0.5 * ((freqs[indices] - freq) / sigma) ** 2)
    total = weights.sum()
    if total <= 0:
        return np.empty(0, dtype=int), np.empty(0)
    return indices, weights / total


def _partial_table(freqs, bin_widths, cents, settings):
    table = []
    maximum = settings['analysis']['max_bin_hz']
    inharmonicity = settings['templates']['inharmonicity']
    for pitch in range(MIDI_MIN, MIDI_MAX + 1):
        f0 = _midi_hz(pitch, cents)
        entries = []
        for k in range(1, settings['templates']['max_partials'] + 1):
            freq = k * f0 * math.sqrt(1.0 + inharmonicity * k * k)
            if freq >= maximum:
                break
            indices, weights = _freq_weights(freq, freqs, bin_widths)
            if indices.size:
                entries.append((k, float(freq), indices, weights * (1.0 / k)))
        table.append(entries)
    return table


def _estimate_tuning(Y, freqs, settings):
    spectrum = Y.mean(axis=0)
    valid = (freqs >= settings['tuning']['min_partial_hz']) & (freqs <= settings['tuning']['max_partial_hz'])
    if not valid.any():
        return 0.0, 999.0
    band = spectrum[valid]
    peaks, props = find_peaks(band, prominence=max(band.max() * 0.02, 1e-9), distance=2)
    if peaks.size == 0:
        return 0.0, 999.0
    frequencies = freqs[valid][peaks]
    weights = props['prominences']
    deviations = []
    for freq, weight in zip(frequencies, weights):
        midi = 69.0 + 12.0 * math.log2(freq / A4_HZ)
        nearest = round(midi)
        dev = 1200.0 * math.log2(freq / _midi_hz(nearest))
        if -50.0 < dev < 50.0:
            deviations.append((dev, weight))
    if not deviations:
        return 0.0, 999.0
    values = np.array([item[0] for item in deviations])
    magnitudes = np.array([item[1] for item in deviations])
    complex_sum = np.sum(magnitudes * np.exp(1j * 2.0 * np.pi * values / 100.0))
    mean = float(np.angle(complex_sum) * 100.0 / (2.0 * np.pi))
    spread = float(np.sqrt(np.average((values - mean) ** 2, weights=magnitudes)))
    limit = settings['tuning']['max_cents']
    if not math.isfinite(mean) or abs(mean) > limit or spread > 30.0:
        return (0.0 if abs(mean) > limit or not math.isfinite(mean) else _r(mean, 2)), spread
    return _r(mean, 2), spread


def _attack_curve(samples, rate, settings, cents):
    """Sharp pitch-specific attack evidence from a short-window transform.

    The main spectrogram uses a long window for low-pitch resolution.  Attacks are
    localised from a much shorter window using partials above the bass region,
    where the time-frequency trade-off is acceptable.
    """
    n_fft = int(settings['analysis']['attack_fft'])
    hop = int(settings['analysis']['attack_hop'])
    magnitude = _stft_magnitude(samples, rate, n_fft, hop)
    freqs = np.arange(magnitude.shape[1]) * rate / n_fft
    widths = np.full(freqs.shape, rate / n_fft)
    count = magnitude.shape[0]
    times = np.arange(count) * hop / float(rate)
    curve = np.zeros((count, MIDI_MAX - MIDI_MIN + 1))
    low_hz = settings['analysis']['attack_min_hz']
    high_hz = min(settings['analysis']['attack_max_hz'], rate / 2.0 - 100.0)
    for pitch in range(MIDI_MIN, MIDI_MAX + 1):
        f0 = _midi_hz(pitch, cents)
        total = np.zeros(count)
        for k in range(1, 24):
            freq = k * f0
            if freq < low_hz:
                continue
            if freq > high_hz:
                break
            indices, weights = _freq_weights(freq, freqs, widths)
            if indices.size:
                total += magnitude[:, indices] @ weights
        curve[:, pitch - MIDI_MIN] = total
    floor = np.percentile(curve, 25, axis=0) + 1e-7
    compressed = np.log(curve + 1e-7)
    rise = np.diff(compressed, axis=0, prepend=compressed[:1])
    gate = curve / (curve + 2.0 * floor[None, :])
    value = _smooth(np.maximum(rise, 0.0) * gate, 2)
    scale = np.maximum(np.percentile(value, 98, axis=0), 0.03)
    return times, value / scale[None, :]


def _attack_peak(analysis, pitch, seconds, before=0.03, after=0.10):
    if analysis.attack_novelty is None:
        return float(seconds), 0.0
    index = int(np.clip(int(pitch) - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
    low = int(np.searchsorted(analysis.attack_times, seconds - before))
    high = int(np.searchsorted(analysis.attack_times, seconds + after, side='right'))
    if high <= low:
        return float(seconds), 0.0
    segment = analysis.attack_novelty[low:high, index]
    best = int(np.argmax(segment))
    return float(analysis.attack_times[low + best]), float(segment[best])


def analyze_audio(samples, rate, settings, tuning_cents=None):
    hop = int(settings['analysis']['hop'])
    n_low = int(settings['analysis']['low_fft'])
    n_full = int(settings['analysis']['full_fft'])
    split = float(settings['analysis']['low_split_hz'])
    low = _stft_magnitude(samples, rate, n_low, hop)
    full = _stft_magnitude(samples, rate, n_full, hop)
    low_freqs = np.arange(low.shape[1]) * rate / n_low
    full_freqs = np.arange(full.shape[1]) * rate / n_full
    low_mask = (low_freqs >= settings['analysis']['min_bin_hz']) & (low_freqs < split)
    full_mask = (full_freqs >= split) & (full_freqs <= settings['analysis']['max_bin_hz'])
    count = min(low.shape[0], full.shape[0])
    Y = np.concatenate([low[:count, low_mask], full[:count, full_mask]], axis=1)
    freqs = np.concatenate([low_freqs[low_mask], full_freqs[full_mask]])
    widths = np.concatenate([np.full(low_mask.sum(), rate / n_low), np.full(full_mask.sum(), rate / n_full)])
    times = np.arange(count) * hop / float(rate)

    noise = np.percentile(Y, settings['analysis']['noise_percentile'], axis=0)
    noise = np.maximum(noise, 1e-7)

    if tuning_cents is None:
        tuning, spread = _estimate_tuning(Y, freqs, settings)
    else:
        tuning, spread = float(tuning_cents), 0.0
    partials = _partial_table(freqs, widths, tuning, settings)

    compressed = np.log1p(10.0 * Y)
    diff = np.diff(compressed, axis=0, prepend=compressed[:1])
    novelty = _smooth(np.maximum(diff, 0.0).mean(axis=1), 3)
    novelty_scale = float(np.percentile(novelty, 95)) if novelty.size else 0.0
    novelty = novelty / max(novelty_scale, 1e-6)

    pitch_activity = np.zeros((count, MIDI_MAX - MIDI_MIN + 1))
    for index, entries in enumerate(partials):
        total = np.zeros(count)
        floor = 0.0
        for _k, _f, indices, weights in entries:
            total += Y[:, indices] @ weights
            floor += float(noise[indices] @ weights)
        pitch_activity[:, index] = total
    noise_activity = np.array([
        float(sum(float(noise[indices] @ weights) for _k, _f, indices, weights in entries))
        for entries in partials]) + 1e-7
    gate = pitch_activity / (pitch_activity + 2.0 * noise_activity[None, :])
    log_activity = np.log(pitch_activity + 1e-7)
    rise = np.diff(log_activity, axis=0, prepend=log_activity[:1])
    pitch_novelty = _smooth(np.maximum(rise, 0.0) * gate, 2)
    scale = np.percentile(pitch_novelty, 97, axis=0)
    scale = np.maximum(scale, 0.05)
    pitch_novelty = pitch_novelty / scale[None, :]

    attack_times, attack_novelty = _attack_curve(samples, rate, settings, tuning)
    level = np.sqrt(np.mean(Y * Y, axis=1))
    return Analysis(samples=np.asarray(samples, dtype=np.float64), sample_rate=rate, hop=hop,
                    times=times, freqs=freqs, bin_widths=widths, Y=Y, noise=noise,
                    novelty=novelty, pitch_novelty=pitch_novelty, pitch_activity=pitch_activity,
                    tuning_cents=tuning, tuning_spread_cents=spread, partials=partials,
                    attack_times=attack_times, attack_novelty=attack_novelty,
                    level=level, noise_level=float(np.percentile(level, 10)))


# ---------------------------------------------------------------------------
# Note atoms and local non-negative decomposition


def _template(analysis, pitch, kind, velocity, settings, brightness=1.0):
    index = pitch - MIDI_MIN
    if index < 0 or index >= len(analysis.partials):
        return None
    tilt = settings['templates']['attack_tilt'] if kind == 'attack' else settings['templates']['sustain_tilt']
    rolloff = settings['templates']['attack_rolloff_hz'] if kind == 'attack' else settings['templates']['sustain_rolloff_hz']
    tilt += settings['templates']['velocity_tilt'] * (0.6 - float(np.clip(velocity, 0.0, 1.0)))
    vector = np.zeros_like(analysis.freqs)
    for k, freq, indices, weights in analysis.partials[index]:
        amplitude = (k ** -tilt) * math.exp(-freq / (rolloff * brightness))
        vector[indices] += weights * amplitude
    total = vector.sum()
    if total <= 0:
        return None
    return vector / total


def _envelope(analysis, onset, frames, kind, pitch, settings):
    times = analysis.times[frames]
    delta = times - float(onset)
    active = delta >= 0.0
    if kind == 'attack':
        values = np.exp(-np.maximum(delta, 0.0) / settings['decomposition']['attack_tau_s'])
    else:
        tau = _decay_tau(pitch, settings)
        rise = 1.0 - np.exp(-np.maximum(delta, 0.0) / settings['decomposition']['sustain_attack_s'])
        values = rise * np.exp(-np.maximum(delta, 0.0) / tau)
    values = np.where(active, values, 0.0)
    smear = int(settings['decomposition'].get('envelope_smear_frames', 8))
    if smear > 2:
        kernel = np.hanning(smear + 2)[1:-1]
        kernel = kernel / kernel.sum()
        values = np.convolve(values, kernel, mode='same')
    return values


def _atom(key, template, envelope):
    return {'key': key, 'template': template, 'envelope': envelope}


def _note_atoms(analysis, note, frames, settings, onset=None, brightness=1.0):
    onset = float(note['onset'] if onset is None else onset)
    pitch = int(note['pitch'])
    velocity = float(note.get('velocity', 0.5) or 0.5)
    atoms = []
    for kind in ('attack', 'sustain'):
        template = _template(analysis, pitch, kind, velocity, settings, brightness)
        if template is None:
            continue
        atoms.append(_atom((kind, pitch, round(onset, 4)), template,
                           _envelope(analysis, onset, frames, kind, pitch, settings)))
    return atoms


class RegionModel:
    """Union of separable note atoms evaluated over one local time window."""

    def __init__(self, analysis, frames, atoms, settings):
        # Atoms are separable: no (atom, frequency, time) tensor is allocated.
        # Bound the actual workspace, including the expanded candidate union and
        # transient Gram matrices, rather than rejecting ordinary chords based on
        # the size of an imaginary dense dictionary.
        bins = len(analysis.freqs)
        count = max(1, frames.stop - frames.start)
        size = len(atoms)
        workspace = 3 * bins * count + 3 * bins * size + count * size + 6 * size * size
        if workspace > int(settings['limits']['max_region_matrix']):
            raise ValueError('A passage needs more decomposition memory than the verifier allows.')
        self.analysis = analysis
        self.frames = frames
        self.settings = settings
        self.atoms = atoms
        self.keys = [atom['key'] for atom in atoms]
        self.index = {key: position for position, key in enumerate(self.keys)}
        templates = np.stack([atom['template'] for atom in atoms], axis=1)
        envelopes = np.stack([atom['envelope'] for atom in atoms], axis=1)
        window = analysis.Y[frames]
        self.window = window
        self.y2 = float(np.sum(window * window))
        projection = window.T @ envelopes
        gram_t = templates.T @ templates
        gram_e = envelopes.T @ envelopes
        gram = gram_t * gram_e
        ridge = settings['decomposition']['ridge'] * max(float(np.trace(gram)) / max(1, len(atoms)), 1e-12)
        gram = gram + np.eye(len(atoms)) * ridge
        self.gram = gram
        self.linear = np.sum(templates * projection, axis=0)
        self.noise_energy = float(np.sum(analysis.noise ** 2)) * max(1, window.shape[0])

    def indices(self, keys):
        return [self.index[key] for key in keys if key in self.index]

    def solve(self, keys, sweeps=None):
        positions = self.indices(keys)
        if not positions:
            return 0.0, 0.0
        gram = self.gram[np.ix_(positions, positions)]
        linear = self.linear[positions]
        gains = _nnls(gram, linear, sweeps or self.settings['decomposition']['sweeps'])
        residual = self.y2 - 2.0 * float(gains @ linear) + float(gains @ gram @ gains)
        return max(residual, 0.0), float(gains.sum())

    def residual_map(self, keys):
        positions = self.indices(keys)
        gram = self.gram[np.ix_(positions, positions)]
        linear = self.linear[positions]
        gains = _nnls(gram, linear, self.settings['decomposition']['sweeps'])
        contributions = np.zeros((self.window.shape[1], self.window.shape[0]))
        for position, gain in zip(positions, gains):
            atom = self.atoms[position]
            contributions += np.outer(atom['template'], atom['envelope']) * gain
        return self.window.T - contributions


def _nnls(gram, linear, sweeps):
    size = gram.shape[0]
    gains = np.zeros(size)
    diagonal = np.diag(gram).copy()
    diagonal[diagonal <= 0] = 1.0
    product = np.zeros(size)
    linear = np.maximum(np.asarray(linear, dtype=np.float64), 0.0)
    for _ in range(int(sweeps)):
        product = gram @ gains
        for j in range(size):
            delta = (linear[j] - product[j]) / diagonal[j]
            updated = gains[j] + delta
            if updated < 0.0:
                delta = -gains[j]
                updated = 0.0
            if delta:
                gains[j] = updated
                product += gram[:, j] * delta
    return gains


# ---------------------------------------------------------------------------
# Evidence helpers


def _frame_index(analysis, seconds):
    return int(np.clip(round((float(seconds) - analysis.times[0]) * analysis.sample_rate / analysis.hop),
                       0, analysis.frames - 1))


def support(analysis, pitch, seconds, activations=None):
    """Independent evidence for one pitch at one time, in plain units.

    The analysis window smears an attack over roughly 90 ms, and the decoder's
    peak frame is often a little later than the decoded note onset, so the support
    window looks slightly forward as well as back.
    """
    index = int(np.clip(int(pitch) - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
    frame = _frame_index(analysis, seconds)
    low = max(0, frame - 2)
    high = min(analysis.frames - 1, frame + 5)
    novelty = float(np.max(analysis.pitch_novelty[low:high + 1, index]))
    entries = analysis.partials[index]
    signal = sum(float(analysis.Y[frame, indices] @ weights) ** 2 for _k, _f, indices, weights in entries)
    floor = sum(float(analysis.noise[indices] @ weights) ** 2 for _k, _f, indices, weights in entries)
    activity_db = 10.0 * math.log10((signal + 1e-12) / (floor + 1e-12))
    result = {'attack': _r(novelty, 3), 'activity_db': _r(activity_db, 2)}
    peak_time, peak_strength = _attack_peak(analysis, pitch, seconds)
    result['attack_time'] = _r(peak_time, 4)
    result['attack_sharp'] = _r(peak_strength, 3)
    if activations is not None:
        result['decoder_onset'] = _decoder_value(activations, 'onset', pitch, seconds, analysis.sample_rate)
        result['decoder_note'] = _decoder_value(activations, 'note', pitch, seconds, analysis.sample_rate)
    return result


def _decoder_value(activations, name, pitch, seconds, rate, before=1, after=5):
    array = activations.get(name) if isinstance(activations, dict) else None
    if array is None:
        return None
    array = np.asarray(array)
    if array.ndim != 2 or array.shape[1] < 88:
        return None
    frame = int(round(float(seconds) * rate / BASIC_PITCH_HOP))
    index = int(pitch) - MIDI_MIN
    low = max(0, frame - before)
    high = min(array.shape[0] - 1, frame + after)
    if high < low:
        return None
    return _r(float(np.max(array[low:high + 1, index])), 3)


def _residual_evidence(analysis, residual, observed, pitch, frame):
    """How much of a pitch's harmonic energy survives the proposal explanation.

    Returns the unexplained fraction, the residual-to-local-floor level in dB and
    the number of partials that are both above the local residual floor and
    substantially unexplained.  A shared octave partial is mostly explained by the
    lower note, so it scores a low fraction even when its residual is above the
    floor.
    """
    index = int(np.clip(int(pitch) - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
    residual_energy = 0.0
    observed_energy = 0.0
    floor_energy = 0.0
    strong = 0
    peak = 0.0
    fundamental = 0.0
    for k, _freq, indices, weights in analysis.partials[index][:10]:
        weight = weights ** 2
        left = float(residual[indices, frame] ** 2 @ weight)
        total = float(observed[indices, frame] ** 2 @ weight)
        start = int(indices[0])
        stop = int(indices[-1]) + 1
        neighbours = np.concatenate([residual[max(0, start - 30):max(0, start - 2), frame],
                                     residual[stop + 2:stop + 30, frame]])
        floor = float(np.median(neighbours)) if neighbours.size else float(np.median(analysis.noise))
        floor_energy += (floor ** 2) / k
        residual_energy += left / k
        observed_energy += total / k
        peak = max(peak, float(np.sqrt(total)))
        if k == 1:
            fundamental = left / max(total, 1e-12)
        if left > 4.0 * floor ** 2 and left > 0.08 * total:
            strong += 1
    fraction = residual_energy / max(observed_energy, 1e-12)
    level_db = 10.0 * math.log10(max(residual_energy, 1e-15) / max(floor_energy, 1e-15))
    frame_peak = float(np.max(observed[:, frame])) + 1e-12
    relative = peak / frame_peak
    return float(fraction), float(level_db), strong, float(relative), float(np.clip(fundamental, 0.0, 1.0))


def _candidate_pitches(analysis, residual, observed, frame, excluded, limit):
    scored = []
    for pitch in range(MIDI_MIN, MIDI_MAX + 1):
        if pitch in excluded:
            continue
        fraction, level, strong, relative, fundamental = _residual_evidence(
            analysis, residual, observed, pitch, frame)
        if strong >= 2 and fraction >= 0.30 and relative >= 0.01 and fundamental >= 0.25:
            scored.append((fraction, level, strong, pitch))
    scored.sort(reverse=True)
    return [(pitch, fraction, level, strong) for fraction, level, strong, pitch in scored[:limit]]


def _candidate_key(key):
    return isinstance(key[1], tuple) and key[1] and key[1][0] == 'candidate'


def _pitch_profile_fit(analysis, pitch, seconds, settings, window=0.20):
    """How well one pitch's harmonic amplitude profile matches the recording.

    The fundamental-to-harmonic ratio distinguishes a struck note from the same
    series produced as an octave cousin's harmonics, which a residual comparison
    alone cannot do: either template can absorb the shared partials.
    """
    index = int(np.clip(int(pitch) - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
    entries = analysis.partials[index][:8]
    if not entries:
        return 1.0, 0.0
    low = _frame_index(analysis, float(seconds) + 0.02)
    high = _frame_index(analysis, float(seconds) + window)
    if high <= low:
        return 1.0, 0.0
    observed, predicted = [], []
    for k, freq, indices, weights in entries:
        values = analysis.Y[low:high + 1][:, indices] @ weights
        observed.append(float(np.median(values)))
        predicted.append((k ** -settings['templates']['sustain_tilt'])
                         * math.exp(-freq / settings['templates']['sustain_rolloff_hz']))
    observed = np.array(observed)
    predicted = np.array(predicted)
    scale = float(predicted @ observed) / max(float(predicted @ predicted), 1e-12)
    residual = float(np.sum((observed - scale * predicted) ** 2))
    total = float(np.sum(observed ** 2)) + 1e-12
    fundamental = observed[0] / (float(np.max(observed)) + 1e-12)
    return residual / total, fundamental


def _harmonic_relation(pitch, sounding):
    """Return a sounding note that shares this pitch's harmonic series."""
    for other in sorted(sounding):
        if int(other) == int(pitch):
            continue
        ratio = 2.0 ** ((int(pitch) - int(other)) / 12.0)
        for candidate, inverted in ((ratio, False), (1.0 / ratio, True)):
            nearest = int(round(candidate))
            if 2 <= nearest <= 8 and abs(candidate - nearest) <= 0.04:
                return int(other), nearest, inverted
    return None


def _check_extra_guard(note, current):
    """Genuine notes keep their own attack even when harmonics overlap."""
    return current['attack'] >= 0.30 or (current.get('decoder_onset') or 0.0) >= 0.45


# ---------------------------------------------------------------------------
# Region checks


class Verifier:
    def __init__(self, analysis, events, activations, settings, provenance=None, budget=None, debug=False):
        self.analysis = analysis
        self.events = events
        self.activations = activations
        self.settings = settings
        self.provenance = provenance or {}
        self.deadline = budget
        self.debug = debug
        self.diagnostics = []
        self.findings = []
        self.warnings = []
        self.coverage = {'regions_total': 0, 'regions_analysed': 0, 'regions_skipped': 0,
                         'skipped': [], 'truncated_regions': False, 'findings_truncated': False,
                         'atoms_truncated': False}
        self._finding_count = 0
        self._by_id = {str(event['id']): event for event in events}
        self._base_frames = {}
        self._note_cache = {}

    # -- finding assembly -------------------------------------------------
    def _add(self, kind, status, time_range, event_ids, pitch, explanation, evidence,
             alternatives=None, edits=None, ambiguous=None, edit_status='proposed'):
        if len(self.findings) >= self.settings['limits']['max_findings']:
            self.coverage['findings_truncated'] = True
            return None
        self._finding_count += 1
        finding = {
            'id': f'vf-{self._finding_count}',
            'kind': kind,
            'status': status,
            'time_range': [_r(time_range[0], 3), _r(time_range[1], 3)],
            'event_ids': [str(value) for value in event_ids],
            'pitch': None if pitch is None else int(pitch),
            'explanation': explanation,
            'evidence': evidence,
            'alternatives': alternatives or [],
            'proposed_edits': edits or [],
            'ambiguous': bool(ambiguous),
            'ambiguity_reasons': list(ambiguous or []),
        }
        self.findings.append(finding)
        return finding

    def _over_budget(self):
        return self.deadline is not None and time.monotonic() > self.deadline

    # -- region construction ----------------------------------------------
    def _regions(self):
        ordered = sorted(self.events, key=lambda item: float(item['onset']))
        clusters = []
        for event in ordered:
            onset = float(event['onset'])
            if clusters and onset - float(clusters[-1][-1]['onset']) <= self.settings['regions']['cluster_gap_s']:
                clusters[-1].append(event)
            else:
                clusters.append([event])
        # Split a continuous cluster into bounded regions so one long passage cannot
        # grow an unbounded note/candidate matrix.
        chunks = []
        max_seconds = float(self.settings['regions']['max_region_seconds'])
        max_notes = int(self.settings['regions']['max_region_notes'])
        for cluster in clusters:
            current = []
            for event in cluster:
                if current and (float(event['onset']) - float(current[0]['onset'])
                                > max_seconds - float(self.settings['regions']['after_s'])
                                or len(current) >= max_notes):
                    chunks.append(current)
                    current = []
                current.append(event)
            if current:
                chunks.append(current)
        regions = []
        for index, chunk in enumerate(chunks):
            first = float(chunk[0]['onset'])
            last = float(chunk[-1]['onset'])
            end = last + self.settings['regions']['after_s']
            if index + 1 < len(chunks):
                end = min(end, float(chunks[index + 1][0]['onset']) + 0.30)
            regions.append({'start': max(0.0, first - self.settings['regions']['before_s']),
                            'end': end, 'attack': None,
                            'focus': [str(event['id']) for event in chunk]})
        novelty = self.analysis.novelty
        peaks, properties = find_peaks(novelty, prominence=0.10, distance=3)
        if peaks.size:
            prominences = properties['prominences']
            for peak, prominence in zip(peaks, prominences):
                if prominence < self.settings['checks']['unmatched_attack_min_novelty']:
                    continue
                time_value = float(self.analysis.times[peak])
                if time_value > float(self.analysis.times[-1]) - 0.15:
                    continue
                if self.analysis.level[peak] < max(4.0 * self.analysis.noise_level, 1.0e-4):
                    continue
                if any(region['start'] - 0.05 <= time_value <= region['end'] + 0.05 for region in regions):
                    continue
                regions.append({'start': max(0.0, time_value - 0.40), 'end': time_value + 0.60,
                                'attack': time_value, 'focus': []})
        regions.sort(key=lambda item: item['start'])
        limit = int(self.settings['regions']['max_regions'])
        if len(regions) > limit:
            self.coverage['truncated_regions'] = True
            self.warnings.append(f'Only the first {limit} of {len(regions)} passages were analysed.')
            self.coverage['regions_skipped'] += len(regions) - limit
            self.coverage['skipped'].append({'reason': 'region-limit',
                                             'count': len(regions) - limit})
            regions = regions[:limit]
        self.coverage['regions_total'] = len(regions)
        return regions

    def _window_notes(self, start, end):
        notes = []
        for event in self.events:
            onset = float(event['onset'])
            offset = onset + float(event['duration'])
            # A note that still sounds at the window start belongs in the model even
            # when its attack is older than the normal context.
            if onset <= end and offset >= start - 0.08:
                notes.append(event)
        notes.sort(key=lambda item: float(item['onset']))
        limit = int(self.settings['regions']['max_window_notes'])
        if len(notes) > limit:
            notes = notes[-limit:]
        return notes

    # -- main loop ---------------------------------------------------------
    def run(self):
        if self._over_budget():
            self.warnings.append('Verification stopped before analysis at its time budget.')
            self.coverage['skipped'].append({'reason': 'time-budget', 'count': 1})
            return self.findings
        self._timeline_check()
        self._duplicate_check()
        if self._over_budget():
            self.warnings.append('Verification stopped at its time budget before passage analysis.')
            self.coverage['skipped'].append({'reason': 'time-budget', 'count': 1})
            return self.findings
        regions = self._regions()
        for region in regions:
            if self._over_budget():
                self.warnings.append('Verification stopped at its time budget; later passages were not analysed.')
                self.coverage['regions_skipped'] += 1
                self.coverage['skipped'].append({'reason': 'time-budget',
                                                 'start': _r(region['start'], 2),
                                                 'end': _r(region['end'], 2)})
                break
            frames = _frame_index(self.analysis, region['end']) - _frame_index(self.analysis, region['start']) + 1
            if frames > int(self.settings['decomposition']['max_frames']):
                self.coverage['regions_skipped'] += 1
                self.coverage['skipped'].append({'reason': 'region-too-long',
                                                 'start': _r(region['start'], 2),
                                                 'end': _r(region['end'], 2)})
                continue
            try:
                self._analyse_region(region['start'], region['end'], region['attack'], region['focus'])
                self.coverage['regions_analysed'] += 1
            except (ValueError, FloatingPointError, np.linalg.LinAlgError) as error:
                self.coverage['regions_skipped'] += 1
                self.coverage['skipped'].append({'reason': type(error).__name__,
                                                 'start': _r(region['start'], 2),
                                                 'end': _r(region['end'], 2)})
                self.warnings.append(f'A passage near {_r(region["start"], 2)}s could not be analysed ({type(error).__name__}).')
        return self.findings

    # -- bookkeeping checks ------------------------------------------------
    def _timeline_check(self):
        duration = float(self.provenance.get('duration') or 0.0)
        for event in self.events:
            onset = float(event['onset'])
            end = onset + float(event['duration'])
            if onset < 0 or onset > duration or end > duration + 1e-6 or end <= onset:
                reasons = []
                if onset > duration:
                    reasons.append('The event starts after the analysed audio ends.')
                if end <= onset:
                    reasons.append('The event has no positive duration.')
                self._add('timeline', 'flagged', (max(0.0, onset), max(onset, end)),
                          [event['id']], event['pitch'],
                          'This event lies outside the analysed recording or its clocks disagree; inspect the pipeline timeline before editing the note.',
                          {'onset': _r(onset, 4), 'duration': _r(float(event['duration']), 4),
                           'audio_duration': _r(duration, 4)},
                          ambiguous=reasons)

    def _duplicate_check(self):
        events = sorted(self.events, key=lambda item: (int(item['pitch']), float(item['onset'])))
        for first, second in zip(events, events[1:]):
            if int(first['pitch']) != int(second['pitch']):
                continue
            gap = float(second['onset']) - float(first['onset'])
            if gap <= 0.002 or gap > self.settings['checks']['duplicate_gap_s']:
                continue
            evidence = self._note_pair_evidence(first, second)
            if evidence.get('merge_gain') is None:
                continue
            reasons = []
            self._add('duplicate_event', 'suggested',
                      (float(first['onset']), float(second['onset']) + float(second['duration'])),
                      [first['id'], second['id']], first['pitch'],
                      'These two events may represent one strike; the second onset has no clearly separate attack.',
                      evidence,
                      [{'kind': 'merge', 'event_ids': [first['id'], second['id']],
                        'onset': _r(float(first['onset']), 4),
                        'end': _r(max(float(first['onset']) + float(first['duration']),
                                      float(second['onset']) + float(second['duration'])), 4),
                        'gain': evidence.get('merge_gain'), 'supported': True}],
                      [{'op': 'merge', 'event_ids': [first['id'], second['id']],
                        'before': [self._event_snapshot(first), self._event_snapshot(second)],
                        'after': {'onset': _r(float(first['onset']), 4),
                                  'pitch': int(first['pitch']),
                                  'duration': _r(max(float(first['onset']) + float(first['duration']),
                                                     float(second['onset']) + float(second['duration']))
                                                  - float(first['onset']), 4)},
                        'reason': 'Two proposed events may be one strike.'}],
                      ambiguous=reasons)

    def _event_snapshot(self, event):
        # Preconditions compare the source values, not rounded presentation values.
        # Rounding here made valid merge/split suggestions fail on real precision.
        return {'id': event['id'], 'onset': float(event['onset']),
                'duration': float(event['duration']), 'pitch': int(event['pitch']),
                'velocity': None if event.get('velocity') is None else float(event['velocity'])}

    def _note_pair_evidence(self, first, second):
        analysis = self.analysis
        pitch = int(first['pitch'])
        later = float(second['onset'])
        peak_later, second_attack = _attack_peak(analysis, pitch, later, 0.04, 0.04)
        _peak_first, first_attack = _attack_peak(analysis, pitch, float(first['onset']), 0.04, 0.04)
        decoder_later = _decoder_value(self.activations, 'onset', pitch, later, analysis.sample_rate,
                                       before=1, after=1)
        duration = max(float(first['onset']) + float(first['duration']),
                       float(second['onset']) + float(second['duration']))
        start = max(0.0, float(first['onset']) - 0.3)
        end = min(float(analysis.times[-1]), duration + 0.3)
        frames = slice(_frame_index(analysis, start), _frame_index(analysis, end) + 1)
        atoms = self._base_atoms(frames, start, end)
        if not atoms:
            return {'second_attack': _r(second_attack, 3), 'merge_gain': None}
        first_key = str(first['id'])
        second_key = str(second['id'])
        base_keys = [atom['key'] for atom in atoms if atom['key'][0] in ('attack', 'sustain')]
        model = RegionModel(analysis, frames, atoms, self.settings)
        baseline, _ = model.solve(base_keys)
        merged = self._merge_atoms(frames, first, second, duration)
        if not merged:
            return {'second_attack': _r(second_attack, 3), 'merge_gain': None}
        combined = self._extend_model(model, atoms, merged)
        keys = [key for key in base_keys if key[1] != first_key and key[1] != second_key]
        keys += [atom['key'] for atom in merged]
        residual, _ = combined.solve(keys)
        unit = max(combined.noise_energy, 0.01 * combined.y2)
        gain = (residual - baseline) / unit
        evidence = {'second_attack': _r(second_attack, 3), 'first_attack': _r(first_attack, 3),
                    'merge_cost': _r(gain, 3),
                    'decoder_onset': decoder_later, 'attack_peak': _r(peak_later, 4)}
        if (second_attack < self.settings['checks']['duplicate_second_attack'] and second_attack < self.settings['checks']['duplicate_attack_ratio'] * max(first_attack, 0.1)
                and (decoder_later or 0.0) < 0.50
                and gain < self.settings['scoring']['merge_max_gain']):
            evidence['merge_gain'] = _r(gain, 3)
        else:
            evidence['merge_gain'] = None
        return evidence

    # -- atoms -------------------------------------------------------------
    def _base_atoms(self, frames, start, end):
        notes = self._window_notes(start, end)
        atoms = []
        limit = int(self.settings['decomposition']['max_atoms']) - 1
        for note in notes:
            for atom in _note_atoms(self.analysis, note, frames, self.settings):
                if atom['key'][0] == 'attack' and float(note['onset']) < start - 0.8:
                    continue
                if len(atoms) >= limit:
                    self.warnings.append('A passage had more sounding notes than the verifier models at once.')
                    self.coverage['atoms_truncated'] = True
                    break
                atom['key'] = (atom['key'][0], str(note['id']), 'base')
                atoms.append(atom)
            if len(atoms) >= limit:
                break
        noise = _atom(('noise', '', 'base'), self.analysis.noise, np.ones(frames.stop - frames.start))
        atoms.append(noise)
        return atoms

    def _candidate_atom(self, frames, pitch, onset, velocity, kind, label, brightness=1.0):
        template = _template(self.analysis, pitch, kind, velocity, self.settings, brightness)
        if template is None:
            return None
        envelope = _envelope(self.analysis, onset, frames, kind, pitch, self.settings)
        return _atom((kind, ('candidate', int(pitch), round(float(onset), 3), label)), template, envelope)

    def _merge_atoms(self, frames, first, second, end):
        note = {'onset': float(first['onset']), 'pitch': int(first['pitch']),
                'velocity': max(float(first.get('velocity', 0.5) or 0.5),
                                float(second.get('velocity', 0.5) or 0.5))}
        atoms = _note_atoms(self.analysis, note, frames, self.settings)
        for atom in atoms:
            atom['key'] = (atom['key'][0], 'merge', 'merge')
        return atoms

    def _extend_model(self, model, old_atoms, extra_atoms):
        atoms = list(old_atoms) + [atom for atom in extra_atoms if atom['key'] not in model.index]
        return RegionModel(self.analysis, model.frames, atoms, self.settings)

    # -- one passage -------------------------------------------------------
    def _analyse_region(self, start, end, unmatched_attack, focus_ids):
        analysis = self.analysis
        frames = slice(_frame_index(analysis, start), _frame_index(analysis, end) + 1)
        if frames.stop - frames.start < 8:
            return
        notes = self._window_notes(start, end)
        by_id = {str(note['id']): note for note in notes}
        focus = [by_id[event_id] for event_id in focus_ids if event_id in by_id]
        if self.debug:
            self.diagnostics.append({'region': [_r(start, 3), _r(end, 3)],
                                     'focus': [str(note['id']) for note in focus],
                                     'scan': [_r(value, 3) for value in self._scan_times(start, end)]})
        atoms = self._base_atoms(frames, start, end)
        base_keys = [atom['key'] for atom in atoms]
        model = RegionModel(analysis, frames, atoms, self.settings)
        baseline, _ = model.solve(base_keys)
        residual_map = model.residual_map(base_keys)
        unit = max(model.noise_energy, 0.01 * model.y2)

        candidates = self._candidate_specs(focus, start, end, residual_map, frames, unmatched_attack,
                                           self._scan_times(start, end))
        scan_times = self._scan_times(start, end)
        extra_atoms = []
        for spec in candidates:
            for kind in ('attack', 'sustain'):
                atom = self._candidate_atom(frames, spec['pitch'], spec['onset'], spec['velocity'],
                                            kind, spec['label'])
                if atom is not None:
                    extra_atoms.append(atom)
        shifts = {}
        step = self.settings['checks']['onset_step_s']
        for note in focus:
            onset = float(note['onset'])
            peak_time, strength = _attack_peak(analysis, int(note['pitch']), onset, 0.14, 0.12)
            if strength < 0.20:
                continue
            delta = peak_time - self.settings['checks']['attack_lag_s'] - onset
            if abs(delta) < 0.04:
                continue
            centre = round(delta / step) * step
            for offset in (-1, 0, 1):
                candidate_delta = round(centre + offset * step, 4)
                if abs(candidate_delta) > 0.16:
                    continue
                target = onset + candidate_delta
                if target < 0:
                    continue
                keys = []
                for kind in ('attack', 'sustain'):
                    atom = self._candidate_atom(frames, int(note['pitch']), target,
                                                float(note.get('velocity', 0.5) or 0.5), kind,
                                                'shift', brightness=1.0)
                    if atom is not None:
                        keys.append(atom['key'])
                        extra_atoms.append(atom)
                shifts[(str(note['id']), candidate_delta)] = keys
        if extra_atoms:
            model = self._extend_model(model, atoms, extra_atoms)
            base_keys = [atom['key'] for atom in atoms]

        # --- onset shift
        for note in focus:
            self._check_onset(note, model, base_keys, shifts, unit, baseline, start, end)
        # --- extra / substitution / octave
        for note in focus:
            self._check_extra(note, model, base_keys, unit, baseline, start, end)
        for note in focus:
            self._check_octave(note, model, base_keys, unit, baseline, candidates, frames)
        # --- repetitions
        for note in focus:
            self._check_repetition(note, model, base_keys, unit, baseline, candidates, start, end, frames)
        # --- wrong-pitch diagnostics (report only)
        for note in focus:
            self._check_wrong_pitch(note, model, base_keys, unit, baseline)
        # --- missing pitches
        self._check_missing(model, base_keys, unit, baseline, candidates, focus, start, end, frames, residual_map)
        # --- unmatched attacks anywhere in the analysed passage
        self._check_region_attacks(scan_times, focus, end)
        # --- unmatched attack (finding only unless a candidate is strong)
        if unmatched_attack is not None:
            self._check_unmatched(unmatched_attack, model, base_keys, unit, baseline, candidates, start)

    def _sharp_repetition(self, analysis, pitch, low, high):
        """Strongest short-window attack inside an existing note, with lag removed."""
        if analysis.attack_novelty is None or high <= low:
            return None
        index = int(np.clip(int(pitch) - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
        start = int(np.searchsorted(analysis.attack_times, low))
        stop = int(np.searchsorted(analysis.attack_times, high, side='right'))
        if stop - start < 3:
            return None
        segment = analysis.attack_novelty[start:stop, index]
        peaks, properties = find_peaks(segment, prominence=0.15, distance=2)
        if peaks.size == 0:
            return None
        best = int(peaks[int(np.argmax(segment[peaks]))])
        strength = float(segment[best])
        if strength < self.settings['checks']['repetition_min_novelty']:
            return None
        estimated = float(analysis.attack_times[start + best]) - self.settings['checks']['attack_lag_s']
        return estimated, strength

    def _scan_times(self, start, end):
        """Attack times in the passage that are not tied to the proposal."""
        analysis = self.analysis
        low = _frame_index(analysis, start + 0.05)
        high = _frame_index(analysis, end - 0.05)
        if high <= low:
            return []
        segment = analysis.novelty[low:high + 1]
        peaks, properties = find_peaks(segment, prominence=0.25, distance=4)
        if peaks.size == 0:
            return []
        order = np.argsort(properties['prominences'])[::-1][:8]
        floor = max(4.0 * self.analysis.noise_level, 1.0e-4)
        return [float(analysis.times[low + peaks[index]]) for index in order
                if analysis.level[low + peaks[index]] >= floor]

    def _candidate_specs(self, focus, start, end, residual_map, frames, unmatched_attack, scan_times):
        analysis = self.analysis
        offset = frames.start
        specs = []
        seen = set()

        def add(pitch, onset, velocity, label):
            pitch = int(np.clip(pitch, MIDI_MIN, MIDI_MAX))
            if not 0.0 <= onset <= analysis.times[-1]:
                return
            onset = round(float(onset), 3)
            key = (pitch, round(onset, 2))
            if key in seen:
                return
            seen.add(key)
            specs.append({'pitch': pitch, 'onset': onset,
                          'velocity': float(np.clip(velocity, 0.0, 1.0)), 'label': label})

        active = {}
        for note in focus:
            frame = _frame_index(analysis, float(note['onset']))
            active.setdefault(frame, set()).add(int(note['pitch']))
        for note in focus:
            pitch = int(note['pitch'])
            onset = float(note['onset'])
            frame = _frame_index(analysis, onset) - offset
            frame = int(np.clip(frame, 0, residual_map.shape[1] - 1))
            excluded = active.get(_frame_index(analysis, onset), set())
            for candidate, fraction, snr, strong in _candidate_pitches(
                    analysis, residual_map, analysis.Y[frames].T, frame, excluded,
                    self.settings['checks']['candidate_limit']):
                if fraction >= self.settings['checks']['missing_unexplained']:
                    add(candidate, onset, max(0.35, float(note.get('velocity', 0.5) or 0.5)), 'harmonic')
            for alternative in (pitch - 12, pitch + 12, pitch - 1, pitch + 1):
                add(alternative, onset, float(note.get('velocity', 0.5) or 0.5), 'alternative')
            lower = onset + self.settings['checks']['repetition_min_gap_s']
            upper = onset + float(note['duration']) - self.settings['checks']['repetition_end_margin_s']
            if upper > lower:
                index = int(np.clip(pitch - MIDI_MIN, 0, MIDI_MAX - MIDI_MIN))
                low_frame = _frame_index(analysis, lower)
                high_frame = _frame_index(analysis, upper)
                segment = analysis.pitch_novelty[low_frame:high_frame + 1, index]
                peaks, properties = find_peaks(segment, prominence=0.2, distance=3)
                if peaks.size:
                    best = int(peaks[int(np.argmax(properties['prominences']))])
                    peak_time = float(analysis.times[low_frame + best])
                    if (float(segment[best]) >= self.settings['checks']['repetition_min_novelty']
                            and not self._near_other_onset(note, peak_time)):
                        add(pitch, peak_time, float(note.get('velocity', 0.5) or 0.5), 'repetition')
                sharp = self._sharp_repetition(analysis, pitch, lower, upper)
                if sharp is not None:
                    add(pitch, sharp[0], float(note.get('velocity', 0.5) or 0.5), 'repetition')
        for scan_time in scan_times:
            frame = _frame_index(analysis, scan_time) - offset
            frame = int(np.clip(frame, 0, residual_map.shape[1] - 1))
            excluded = self._sounding_pitches(scan_time)
            for candidate, fraction, snr, strong in _candidate_pitches(
                    analysis, residual_map, analysis.Y[frames].T, frame, excluded,
                    self.settings['checks']['candidate_limit']):
                if fraction >= self.settings['checks']['missing_unexplained']:
                    add(candidate, scan_time, 0.45, 'scan')
        if unmatched_attack is not None:
            frame = _frame_index(analysis, unmatched_attack) - offset
            frame = int(np.clip(frame, 0, residual_map.shape[1] - 1))
            for candidate, fraction, snr, strong in _candidate_pitches(
                    analysis, residual_map, analysis.Y[frames].T, frame, set(),
                    self.settings['checks']['candidate_limit']):
                if fraction >= self.settings['checks']['missing_unexplained']:
                    add(candidate, unmatched_attack, 0.5, 'attack')
        return specs

    def _check_onset(self, note, model, base_keys, shifts, unit, baseline, start, end):
        analysis = self.analysis
        event_id = str(note['id'])
        pitch = int(note['pitch'])
        onset = float(note['onset'])
        own = [key for key in base_keys if key[1] == event_id]
        if not own:
            return
        peak_time, strength = _attack_peak(analysis, pitch, onset, 0.14, 0.12)
        if self.debug:
            self.diagnostics.append({'onset_candidate': {'id': event_id, 'pitch': pitch,
                                                         'onset': _r(onset, 3), 'peak': _r(peak_time, 3),
                                                         'strength': _r(strength, 3)}})
        if strength < self.settings['checks']['onset_min_attack']:
            return
        lag = self.settings['checks']['attack_lag_s']
        estimated = peak_time - lag
        delta = estimated - onset
        if abs(delta) < self.settings['checks']['onset_min_shift_s']:
            return
        decoder_onset = support(analysis, pitch, onset, self.activations).get('decoder_onset') or 0.0
        if decoder_onset >= 0.70 and abs(delta) < 0.08:
            return
        if strength < 0.60:
            return
        _current_peak, current_strength = _attack_peak(analysis, pitch, onset, 0.03, 0.03)
        if current_strength >= 0.30:
            # The note already has an attack where it is; a displaced peak elsewhere
            # is more likely another note or resonance than a moved onset.
            return
        step = self.settings['checks']['onset_step_s']
        target = onset + round(delta / step) * step
        best = None
        for (note_id, candidate_delta), keys in shifts.items():
            if note_id != event_id or not keys:
                continue
            if abs((onset + candidate_delta) - target) > 0.031:
                continue
            candidate_keys = [key for key in base_keys if key not in own] + keys
            if any(key not in model.index for key in candidate_keys):
                continue
            residual, _ = model.solve(candidate_keys)
            gain = (baseline - residual) / unit
            if best is None or gain > best['gain']:
                best = {'gain': gain, 'delta': candidate_delta, 'target': onset + candidate_delta}
        if best is None:
            if self.debug:
                self.diagnostics.append({'onset_decision': {'id': event_id, 'delta': _r(delta, 3),
                                                             'target': _r(target, 3), 'gain': None}})
            return
        if self.debug:
            self.diagnostics.append({'onset_decision': {'id': event_id, 'delta': _r(delta, 3),
                                                         'target': _r(target, 3), 'chosen': _r(best['target'], 3),
                                                         'gain': _r(best['gain'], 3)}})
        reasons = []
        if best['gain'] < self.settings['scoring']['shift_gain']:
            reasons.append('The audio explanation improves only slightly.')
        if self._near_other_onset(note, best['target']) and strength < 1.0:
            reasons.append('The new time coincides with another note; this may be a shared attack rather than this note.')
        if pitch < 48:
            reasons.append('Bass timing is less certain at this analysis resolution.')
        if reasons:
            return
        self._add('onset_shift', 'suggested', (min(onset, best['target']), max(onset, best['target']) + 0.05),
                  [event_id], pitch,
                  'This note may start %s in the recording.' % ('later' if best['delta'] > 0 else 'earlier'),
                  {'current_onset': _r(onset, 4), 'candidate_onset': _r(best['target'], 4),
                   'gain': _r(best['gain'], 3), 'attack_peak': _r(peak_time, 4),
                   'attack_strength': _r(strength, 3),
                   'decoder_onset': support(analysis, pitch, onset, self.activations).get('decoder_onset')},
                  [{'kind': 'shift_onset', 'onset': _r(best['target'], 4), 'gain': _r(best['gain'], 3),
                    'supported': True}],
                  [{'op': 'set_onset', 'event_ids': [event_id],
                    'before': {'onset': _r(onset, 4)},
                    'after': {'onset': _r(best['target'], 4)},
                    'reason': 'Pitch-specific attack evidence favours a different local onset.'}],
                  ambiguous=reasons)

    def _near_other_onset(self, note, target, tolerance=0.03):
        for other in self.events:
            if str(other['id']) == str(note['id']):
                continue
            if abs(float(other['onset']) - target) <= tolerance and int(other['pitch']) != int(note['pitch']):
                return True
        return False

    def _check_extra(self, note, model, base_keys, unit, baseline, start, end):
        analysis = self.analysis
        event_id = str(note['id'])
        pitch = int(note['pitch'])
        onset = float(note['onset'])
        own = [key for key in base_keys if key[1] == event_id]
        if not own:
            return
        without = [key for key in base_keys if key not in own]
        residual, _ = model.solve(without)
        cost = (residual - baseline) / unit
        current = support(analysis, pitch, onset, self.activations)
        if _check_extra_guard(note, current):
            return
        for other in self.events:
            if str(other['id']) == event_id:
                continue
            if int(other['pitch']) == pitch and abs(float(other['onset']) - onset) <= 0.5:
                # A nearby strike of the same pitch may be a genuine repetition.
                return
        if (current.get('decoder_note') or 0.0) >= 0.50:
            return
        if cost > self.settings['scoring']['delete_max_gain']:
            return
        if (cost < 0.01 and current['activity_db'] < 0.0 and current['attack'] < 0.10
                and (current.get('decoder_note') or 0.0) < 0.15):
            self._add('extra_pitch', 'suggested', (onset, onset + float(note['duration'])),
                      [event_id], pitch,
                      'This detected note has no independent evidence in the recording: it adds nothing to the audio explanation and no attack was found.',
                      {'removal_cost': _r(cost, 3), 'activity_db': current['activity_db'],
                       'attack': current['attack'], 'decoder_onset': current.get('decoder_onset'),
                       'decoder_note': current.get('decoder_note')},
                      [{'kind': 'delete', 'event_id': event_id, 'supported': True}],
                      [{'op': 'delete_note', 'event_ids': [event_id],
                        'before': self._event_snapshot(note), 'after': None,
                        'reason': 'No independent evidence for this note.'}],
                      ambiguous=[])
            return
        decoder_onset = current.get('decoder_onset')
        quiet = current['activity_db'] < 6.0
        overlap = self._overlap_fraction(note, without, model)
        if self.debug:
            self.diagnostics.append({'region': [start, end], 'extra_candidate': {
                'id': event_id, 'pitch': pitch, 'onset': _r(onset, 3), 'cost': _r(cost, 3),
                'activity_db': current['activity_db'], 'attack': current['attack'],
                'decoder_onset': decoder_onset, 'decoder_note': current.get('decoder_note'),
                'overlap': _r(overlap, 3), 'quiet': quiet}})
        if overlap < 0.20 and not quiet:
            return
        reasons = []
        if quiet:
            reasons.append('The note is quiet; a masked note cannot be distinguished from an absent one.')
        if overlap < 0.50:
            reasons.append('Only part of this pitch\u2019s harmonic energy is explained by other notes.')
        if (decoder_onset or 0.0) >= 0.45:
            reasons.append('The decoder activation still supports this pitch.')
        status = 'suggested' if not reasons else 'unresolved'
        self._add('extra_pitch', status, (onset, onset + float(note['duration'])),
                  [event_id], pitch,
                  'This detected note may be an extra pitch: it adds little to the audio explanation and has weak independent evidence.'
                  if status == 'suggested' else
                  'This detected note is weakly supported, but it may be a quiet or masked note. It was not proposed for removal.',
                  {'removal_cost': _r(cost, 3), 'activity_db': current['activity_db'],
                   'attack': current['attack'], 'decoder_onset': decoder_onset,
                   'overlap_fraction': _r(overlap, 3)},
                  [{'kind': 'delete', 'event_id': event_id, 'supported': status == 'suggested'}],
                  [{'op': 'delete_note', 'event_ids': [event_id], 'before': self._event_snapshot(note),
                    'after': None,
                    'reason': 'The note contributes little independent evidence.'}] if status == 'suggested' else [],
                  ambiguous=reasons)

    def _check_octave(self, note, model, base_keys, unit, baseline, candidates, frames):
        analysis = self.analysis
        event_id = str(note['id'])
        pitch = int(note['pitch'])
        onset = float(note['onset'])
        own = [key for key in base_keys if key[1] == event_id]
        if not own:
            return
        for alternative in (pitch - 12, pitch + 12):
            keys = [key for key in model.keys if _candidate_key(key) and key[1][1] == alternative
                    and abs(key[1][2] - onset) < 1.5e-3]
            if not keys:
                continue
            support_alt = support(analysis, alternative, onset, self.activations)
            if support_alt['attack'] < 0.5 and (support_alt.get('decoder_onset') or 0.0) < 0.50:
                continue
            fit_original, _ = _pitch_profile_fit(analysis, pitch, onset, self.settings)
            fit_alternative, _ = _pitch_profile_fit(analysis, alternative, onset, self.settings)
            if fit_alternative > fit_original - 0.02:
                continue
            residual_sub, _ = model.solve([key for key in base_keys if key not in own] + keys)
            gain_sub = (baseline - residual_sub) / unit
            if gain_sub < self.settings['scoring']['substitute_gain']:
                continue
            residual_both, _ = model.solve(base_keys + keys)
            gain_both = (baseline - residual_both) / unit
            residual_without, _ = model.solve([key for key in base_keys if key not in own])
            cost_note = (residual_without - baseline) / unit
            reasons = []
            original_support = support(analysis, pitch, onset, self.activations)
            if cost_note >= 0.30 and fit_original < 0.50:
                reasons.append('The original pitch is independently supported; genuine doubling cannot be excluded.')
            if gain_both >= gain_sub - self.settings['scoring']['margin'] and cost_note >= 0.30:
                reasons.append('Keeping both octaves explains the passage about as well; genuine doubling cannot be excluded.')
            if fit_alternative > 0.45:
                reasons.append('The alternative pitch profile does not match the recording closely.')
            if fit_original < 0.45:
                reasons.append('The original pitch profile also matches the recording; the octave is ambiguous.')
            if cost_note >= 0.10 or original_support['attack_sharp'] >= 0.60:
                reasons.append('The original pitch has independent evidence, so an octave substitution is not safe.')
            reasons.append('Pitch substitution requires separate qualification and is reported for review only.')
            status = 'unresolved'
            self._add('octave_ambiguity', status, (onset, onset + float(note['duration'])),
                      [event_id], pitch,
                      'This note may be an octave error: the recording supports %s at least as well as %s.'
                      % (_pitch_name(alternative), _pitch_name(pitch))
                      if status == 'suggested' else
                      'The octave relationship at this note is uncertain; genuine doubling cannot be excluded.',
                      {'original_pitch': pitch, 'alternative_pitch': alternative,
                       'substitution_gain': _r(gain_sub, 3), 'both_gain': _r(gain_both, 3),
                       'removal_cost': _r(cost_note, 3),
                       'profile_fit_original': _r(fit_original, 3),
                       'profile_fit_alternative': _r(fit_alternative, 3),
                       'alternative_attack': support_alt['attack'],
                       'alternative_decoder_onset': support_alt.get('decoder_onset')},
                      [{'kind': 'substitute_pitch', 'pitch': alternative, 'gain': _r(gain_sub, 3),
                        'supported': status == 'suggested'}],
                      [{'op': 'set_pitch', 'event_ids': [event_id],
                        'before': {'pitch': pitch}, 'after': {'pitch': alternative},
                        'reason': 'The neighbouring octave explains the local recording better.'}]
                      if status == 'suggested' else [],
                      ambiguous=reasons)

    def _overlap_fraction(self, note, keys_without, model):
        positions = model.indices(keys_without)
        if not positions:
            return 0.0
        gram = model.gram[np.ix_(positions, positions)]
        linear = model.linear[positions]
        gains = _nnls(gram, linear, self.settings['decomposition']['sweeps'])
        predicted = np.zeros(model.window.shape[1])
        for position, gain in zip(positions, gains):
            predicted += model.atoms[position]['template'] * gain
        own_positions = model.indices([key for key in model.keys if key[1] == str(note['id'])])
        if not own_positions:
            return 0.0
        own = np.zeros_like(predicted)
        for position in own_positions:
            own += model.atoms[position]['template']
        relevant = own > own.max() * 0.02
        if not relevant.any():
            return 0.0
        covered = np.minimum(predicted[relevant], own[relevant]) / np.maximum(own[relevant], 1e-9)
        return float(np.clip(covered, 0.0, 1.0).mean())

    def _check_repetition(self, note, model, base_keys, unit, baseline, candidates, start, end, frames):
        analysis = self.analysis
        event_id = str(note['id'])
        pitch = int(note['pitch'])
        onset = float(note['onset'])
        offset = onset + float(note['duration'])
        if offset - onset < 0.25:
            return
        low = onset + self.settings['checks']['repetition_min_gap_s']
        high = offset - self.settings['checks']['repetition_end_margin_s']
        if self.debug:
            self.diagnostics.append({'repetition_entry': {'id': event_id, 'low': _r(low, 3),
                                                          'high': _r(high, 3)}})
        if high <= low:
            return
        sharp = self._sharp_repetition(analysis, pitch, low, high)
        if sharp is None:
            return
        time_value, strength = sharp
        if any(str(other['id']) != event_id and int(other['pitch']) == pitch
               and abs(float(other['onset']) - time_value) <= self.settings['checks']['attack_tolerance_s']
               for other in self.events):
            # A ringing earlier note may overlap a strike that is already present.
            return
        frame = _frame_index(analysis, time_value)
        window = analysis.novelty[max(0, frame - 3):frame + 4]
        if window.size == 0 or float(np.max(window)) < self.settings['checks']['repetition_min_broadband']:
            return
        sounding = self._sounding_pitches(time_value)
        sounding.discard(pitch)
        relation = _harmonic_relation(pitch, sounding)
        if relation and strength < 2.0:
            return
        if self._near_other_onset(note, time_value, 0.06) and strength < 1.5:
            return
        added = [key for key in model.keys if _candidate_key(key) and key[1][1] == pitch
                 and abs(key[1][2] - time_value) <= 0.035]
        if not added:
            return
        residual, _ = model.solve(base_keys + added)
        gain = (baseline - residual) / unit
        if self.debug:
            self.diagnostics.append({'repetition': {'id': event_id, 'pitch': pitch,
                                                    'candidate': _r(time_value, 3),
                                                    'strength': _r(strength, 3),
                                                    'gain': _r(gain, 3), 'added': len(added)}})
        if gain < self.settings['scoring']['repetition_min_gain']:
            return
        decoder_onset = _decoder_value(self.activations, 'onset', pitch, time_value,
                                       analysis.sample_rate, before=1, after=2)
        reasons = []
        if decoder_onset is None or decoder_onset < self.settings['insertion']['min_decoder_onset']:
            reasons.append('No separate decoder onset corroborates the proposed repeated strike.')
        status = 'unresolved' if reasons else 'suggested'
        self._add('missed_repetition', status, (onset, offset), [event_id], pitch,
                  'A second strike of this pitch may occur here; the proposal keeps one sustained note.',
                  {'candidate_onset': _r(time_value, 4), 'attack': _r(strength, 3),
                   'decoder_onset': decoder_onset, 'gain': _r(gain, 3)},
                  [{'kind': 'split', 'onset': _r(time_value, 4), 'gain': _r(gain, 3), 'supported': not reasons}],
                  [{'op': 'split_note', 'event_ids': [event_id],
                    'before': self._event_snapshot(note),
                    'after': [{'onset': _r(onset, 4), 'duration': _r(time_value - onset, 4), 'pitch': pitch},
                              {'onset': _r(time_value, 4), 'duration': _r(max(0.05, offset - time_value), 4),
                               'pitch': pitch}],
                    'reason': 'A pitch-specific attack suggests a repeated strike.'}] if not reasons else [],
                  ambiguous=reasons)

    def _sounding_pitches(self, seconds):
        """Pitches that can still be ringing at this time, not only notated holds.

        Basic Pitch durations and piano decay disagree, and the pedal can extend a
        note well past its nominal end, so harmonic caution uses a generous ring
        window rather than the proposed offset alone.
        """
        found = set()
        for event in self.events:
            start = float(event['onset'])
            audible_end = start + max(float(event['duration']), 0.8) + 1.2
            if start - 0.03 <= seconds <= audible_end:
                found.add(int(event['pitch']))
        return found

    def _check_wrong_pitch(self, note, model, base_keys, unit, baseline):
        """Report a semitone alternative when it explains the passage better."""
        analysis = self.analysis
        event_id = str(note['id'])
        pitch = int(note['pitch'])
        onset = float(note['onset'])
        own = [key for key in base_keys if key[1] == event_id]
        if not own:
            return
        original_fit, _ = _pitch_profile_fit(analysis, pitch, onset, self.settings)
        for alternative in (pitch - 1, pitch + 1):
            keys = [key for key in model.keys if _candidate_key(key) and key[1][1] == alternative
                    and abs(key[1][2] - onset) < 1.5e-3]
            if not keys:
                continue
            alternative_fit, _ = _pitch_profile_fit(analysis, alternative, onset, self.settings)
            if alternative_fit + 0.05 >= original_fit:
                continue
            residual, _ = model.solve([key for key in base_keys if key not in own] + keys)
            gain = (baseline - residual) / unit
            support_alt = support(analysis, alternative, onset, self.activations)
            if gain < self.settings['scoring']['substitute_gain'] * 0.5 and alternative_fit > 0.35:
                continue
            if support_alt['attack'] < 0.3 and (support_alt.get('decoder_onset') or 0.0) < 0.3:
                continue
            self._add('wrong_pitch', 'unresolved', (onset, onset + float(note['duration'])),
                      [event_id], pitch,
                      'This note may be a neighbouring semitone; the recording is ambiguous, so no substitution is proposed.',
                      {'original_pitch': pitch, 'alternative_pitch': alternative,
                       'profile_fit_original': _r(original_fit, 3),
                       'profile_fit_alternative': _r(alternative_fit, 3),
                       'substitution_gain': _r(gain, 3),
                       'alternative_attack': support_alt['attack'],
                       'alternative_decoder_onset': support_alt.get('decoder_onset')},
                      [{'kind': 'substitute_pitch', 'pitch': alternative, 'gain': _r(gain, 3),
                        'supported': False}],
                      [], ambiguous=['A small fit improvement is not enough to change the pitch.'])

    def _check_region_attacks(self, scan_times, focus, end):
        """Flag audible attacks in the passage that no proposal onset explains."""
        duration = float(self.provenance.get('duration') or 0.0)
        tolerance = self.settings['checks']['attack_tolerance_s']
        for time_value in scan_times:
            if time_value < 0.05 or time_value > min(duration, end) - tolerance:
                continue
            if any(abs(float(event['onset']) - time_value) <= tolerance for event in self.events):
                continue
            if any(finding['kind'] in ('missing_pitch', 'unmatched_attack')
                   and abs(finding['time_range'][0] - time_value) <= 0.10
                   for finding in self.findings):
                continue
            self._add('unmatched_attack', 'flagged', (time_value, time_value + 0.1), [], None,
                      'An attack is audible here without a proposed onset; its pitch is uncertain.',
                      {'attack': _r(float(self.analysis.novelty[_frame_index(self.analysis, time_value)]), 3)},
                      ambiguous=['An attack alone does not establish its pitch.'])

    def _insertion_reasons(self, *, gain, fundamental, relation=None, competing=False,
                           attack_sharp=None, attack=None, decoder_onset=None):
        """Shared acceptance gate for missing-pitch and unmatched-attack insertions."""
        policy = self.settings['insertion']
        reasons = []
        if competing:
            reasons.append('More than one pitch explains this evidence almost as well.')
        if relation:
            reasons.append('The candidate shares a harmonic series with a sounding note (%s).'
                           % _pitch_name(relation[0]))
        if gain < policy['min_gain']:
            reasons.append('The audio explanation improves only slightly.')
        if fundamental < policy['min_fundamental']:
            reasons.append('The candidate harmonic profile does not match closely.')
        if attack_sharp is not None and attack_sharp < policy['min_attack_sharp']:
            reasons.append('The attack is not sharp enough to identify this pitch.')
        if attack is not None and attack < policy['min_attack']:
            reasons.append('No independent attack evidence supports this pitch.')
        if decoder_onset is not None and decoder_onset < policy['min_decoder_onset']:
            reasons.append('The decoder activation does not support this onset.')
        return reasons

    def _check_missing(self, model, base_keys, unit, baseline, candidates, focus, start, end, frames, residual_map):
        analysis = self.analysis
        observed = analysis.Y[frames].T
        grouped = {}
        for spec in candidates:
            if spec['label'] not in ('harmonic', 'attack', 'scan'):
                continue
            keys = [key for key in model.keys if _candidate_key(key)
                    and key[1][1] == spec['pitch'] and abs(key[1][2] - spec['onset']) < 1.5e-3]
            if not keys:
                continue
            residual, _ = model.solve(base_keys + keys)
            gain = (baseline - residual) / unit
            frame = _frame_index(analysis, spec['onset']) - frames.start
            frame = int(np.clip(frame, 0, residual_map.shape[1] - 1))
            fraction, snr, strong, relative, fundamental = _residual_evidence(
                analysis, residual_map, observed, spec['pitch'], frame)
            evidence = support(analysis, spec['pitch'], spec['onset'], self.activations)
            candidate = {'pitch': spec['pitch'], 'onset': spec['onset'], 'gain': gain,
                         'unexplained': fraction, 'snr_db': snr, 'strong_partials': strong,
                         'relative_level': relative, 'fundamental': fundamental, 'evidence': evidence}
            grouped.setdefault((spec['pitch'], round(spec['onset'], 2)), candidate)
        if not grouped:
            return
        ranked = sorted(grouped.values(), key=lambda item: (item['gain'], item['unexplained']), reverse=True)
        if self.debug:
            self.diagnostics.append({'region': [start, end], 'missing_candidates': [
                {'pitch': item['pitch'], 'onset': _r(item['onset'], 3), 'gain': _r(item['gain'], 3),
                 'unexplained': _r(item['unexplained'], 3), 'snr': _r(item['snr_db'], 1),
                 'strong': item['strong_partials'], 'attack': item['evidence']['attack'],
                 'sharp': item['evidence'].get('attack_sharp'), 'relative': _r(item['relative_level'], 4)}
                for item in ranked[:8]]})
        for item in ranked[:6]:
            if item['gain'] < self.settings['scoring']['add_gain']:
                continue
            if item['unexplained'] < self.settings['checks']['missing_unexplained']:
                continue
            if item['fundamental'] < self.settings['checks']['missing_fundamental']:
                continue
            if item['snr_db'] < self.settings['checks']['missing_min_snr_db'] and item['evidence']['attack'] < 0.4:
                continue
            sounding = self._sounding_pitches(item['onset'])
            relation = _harmonic_relation(item['pitch'], sounding)
            same_time = [other for other in ranked
                         if abs(other['onset'] - item['onset']) < 0.03 and other['pitch'] != item['pitch']
                         and other['gain'] > item['gain'] * 0.75]
            reasons = self._insertion_reasons(
                gain=item['gain'], fundamental=item['fundamental'], relation=relation,
                competing=bool(same_time), attack_sharp=item['evidence'].get('attack_sharp', 0.0),
                attack=item['evidence'].get('attack'), decoder_onset=item['evidence'].get('decoder_onset'))
            if item['evidence']['attack'] < 0.25 and item['unexplained'] < 0.5:
                reasons.append('The harmonic evidence is modest and no attack clearly identifies the pitch.')
            strong_evidence = not reasons
            status = 'suggested' if strong_evidence and not reasons else 'unresolved'
            self._add('missing_pitch', status, (item['onset'], min(end, item['onset'] + 0.8)),
                      [], item['pitch'],
                      'A note may be missing here; the audio supports pitch %s but the evidence is not conclusive.' % _pitch_name(item['pitch'])
                      if status == 'suggested' else
                      'Unexplained harmonic energy near %s may indicate a missing note, but no single pitch is sufficiently supported.' % _pitch_name(item['pitch']),
                      {'gain': _r(item['gain'], 3), 'unexplained': _r(item['unexplained'], 3),
                       'fundamental': _r(item['fundamental'], 3),
                       'snr_db': _r(item['snr_db'], 2), 'strong_partials': item['strong_partials'],
                       'attack': item['evidence']['attack'],
                       'attack_sharp': item['evidence'].get('attack_sharp'),
                       'attack_time': item['evidence'].get('attack_time'),
                       'decoder_onset': item['evidence'].get('decoder_onset'),
                       'decoder_note': item['evidence'].get('decoder_note')},
                      [{'kind': 'add_note', 'pitch': item['pitch'], 'onset': _r(item['onset'], 4),
                        'gain': _r(item['gain'], 3), 'supported': status == 'suggested'}],
                      [{'op': 'add_note', 'event_ids': [],
                        'before': None,
                        'after': {'onset': _r(item['onset'], 4), 'duration': _r(0.4, 4),
                                  'pitch': item['pitch'], 'velocity': _r(0.5, 2)},
                        'reason': 'Unexplained harmonic evidence at this pitch.'}] if status == 'suggested' else [],
                      ambiguous=reasons)

    def _check_unmatched(self, attack_time, model, base_keys, unit, baseline, candidates, start):
        duration = float(self.provenance.get('duration') or 0.0)
        if attack_time < 0.05 or attack_time > duration - 0.15:
            return
        if any(abs(float(event['onset']) - attack_time) <= self.settings['checks']['attack_tolerance_s']
               for event in self.events):
            return
        options = [spec for spec in candidates if abs(spec['onset'] - attack_time) < 0.03
                   and spec['label'] in ('attack', 'scan')]
        evaluated = []
        sounding = self._sounding_pitches(attack_time)
        for spec in options[:4]:
            keys = [key for key in model.keys if _candidate_key(key) and key[1][1] == spec['pitch']
                    and abs(key[1][2] - attack_time) <= 0.02]
            if not keys:
                continue
            residual, _ = model.solve(base_keys + keys)
            gain = (baseline - residual) / unit
            fit, _fundamental = _pitch_profile_fit(self.analysis, spec['pitch'], attack_time, self.settings)
            relation = _harmonic_relation(spec['pitch'], sounding)
            support_value = support(self.analysis, spec['pitch'], attack_time, self.activations)
            evaluated.append({'pitch': spec['pitch'], 'gain': gain, 'fit': fit,
                              'relation': relation, 'support': support_value})
        if not evaluated:
            self._add('unmatched_attack', 'flagged', (attack_time, attack_time + 0.1), [], None,
                      'An attack is audible here but the proposal has no note onset; its pitch could not be identified.',
                      {'attack': _r(float(self.analysis.pitch_novelty[_frame_index(self.analysis, attack_time)].max()), 3)},
                      ambiguous=['An attack alone does not establish its pitch.'])
            return
        evaluated.sort(key=lambda item: item['gain'], reverse=True)
        best = evaluated[0]
        competing = [item for item in evaluated[1:] if item['gain'] > best['gain'] * 0.75]
        reasons = self._insertion_reasons(
            gain=best['gain'], fundamental=max(0.0, 1.0 - best['fit']),
            relation=best['relation'], competing=bool(competing),
            attack=best['support']['attack'], decoder_onset=best['support'].get('decoder_onset'))
        if reasons:
            self._add('unmatched_attack', 'flagged', (attack_time, attack_time + 0.1), [], best['pitch'],
                      'An attack is audible here without a proposed onset; the best candidate pitch is not sufficiently supported.',
                      {'candidate_pitch': best['pitch'], 'gain': _r(best['gain'], 3),
                       'profile_fit': _r(best['fit'], 3), 'attack': best['support']['attack']},
                      ambiguous=reasons)
            return
        self._add('unmatched_attack', 'suggested', (attack_time, attack_time + 0.1), [], best['pitch'],
                  'An attack is audible here with no proposed note onset; the best-supported pitch is %s.'
                  % _pitch_name(best['pitch']),
                  {'candidate_pitch': best['pitch'], 'gain': _r(best['gain'], 3),
                   'profile_fit': _r(best['fit'], 3), 'attack': best['support']['attack']},
                  [{'kind': 'add_note', 'pitch': best['pitch'], 'onset': _r(attack_time, 4),
                    'gain': _r(best['gain'], 3), 'supported': True}],
                  [{'op': 'add_note', 'event_ids': [], 'before': None,
                    'after': {'onset': _r(attack_time, 4), 'duration': 0.4,
                              'pitch': best['pitch'], 'velocity': 0.5},
                    'reason': 'Unmatched attack with harmonic support.'}])


_NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')


def _pitch_name(pitch):
    pitch = int(pitch)
    return f'{_NAMES[pitch % 12]}{pitch // 12 - 1}'


# ---------------------------------------------------------------------------
# Report assembly


def verify_piano_transcription(*, audio, events, activations=None, duration=None,
                               sample_rate=22050, settings=None, provenance=None,
                               tuning_cents=None, debug=False, correction_mode='diagnostic',
                               correction_policy=None, expression_enabled=False,
                               expression_mode='qualified', expression_policy=None):
    """Run diagnostic or qualified verification and return a versioned report dictionary."""
    started = time.monotonic()
    if correction_mode not in ('diagnostic', 'qualified'):
        raise ValueError('Verification mode must be diagnostic or qualified.')
    if correction_mode == 'qualified':
        correction_policy = validate_correction_policy(correction_policy)
    if expression_mode not in ('diagnostic', 'qualified'):
        raise ValueError('Expression mode must be diagnostic or qualified.')
    if expression_enabled:
        raise ValueError('Expression analysis must run after Phase 3 working corrections in piano_expression.py.')
    expression_error = None
    if expression_enabled and expression_mode == 'qualified':
        try:
            expression_policy = validate_expression_policy(expression_policy)
        except ValueError as error:
            expression_enabled = False
            expression_error = str(error)
    settings = _merge(DEFAULT_SETTINGS, settings)
    budget = started + float(settings['limits']['budget_seconds'])
    events = [dict(event) for event in events]
    if len(events) > settings['limits']['max_events']:
        raise ValueError('The proposal has too many events to verify.')
    for event in events:
        for key in ('id', 'onset', 'duration', 'pitch'):
            if key not in event:
                raise ValueError('Proposal event is missing ' + key + '.')
        if not math.isfinite(float(event['onset'])) or not math.isfinite(float(event['duration'])):
            raise ValueError('Proposal event has a non-finite time.')
    provenance = dict(provenance or {})
    if isinstance(audio, (str, Path)):
        samples, rate = load_audio(audio, sample_rate)
        provenance.setdefault('audio_sha256', _sha256_bytes(Path(audio).read_bytes()))
    else:
        samples = np.asarray(audio, dtype=np.float64)
        rate = int(sample_rate)
    if duration is None:
        duration = len(samples) / float(rate)
    duration = float(min(duration, len(samples) / float(rate)))
    provenance['duration'] = duration
    if duration > float(settings['limits']['max_audio_seconds']):
        correction = gate_corrections([], correction_mode, correction_policy)
        return {
            'schema_version': SCHEMA_VERSION, 'verifier_version': VERIFIER_VERSION,
            'mode': correction_mode, 'correction_policy': correction, 'status': 'unavailable',
            'expression': {'version': EXPRESSION_VERSION, 'mode': expression_mode,
                           'status': 'unavailable', 'policy': None, 'proposals': [],
                           'summary': {'proposal_count': 0}},
            'source': {'verifier_code_sha256': _sha256_bytes(Path(__file__).read_bytes()),
                       'audio_sha256': provenance.get('audio_sha256'),
                       'reference_sha256': provenance.get('reference_sha256'),
                       'proposal_sha256': proposal_digest(events),
                       'profile_sha256': provenance.get('profile_sha256'),
                       'model': provenance.get('model'), 'model_version': provenance.get('model_version'),
                       'decoder': provenance.get('decoder'),
                       'weights_sha256': provenance.get('weights_sha256'),
                       'decoder_sha256': provenance.get('decoder_sha256'), 'duration': _r(duration, 4),
                       'sample_rate': int(rate), 'note_count': len(events)},
            'settings': settings,
            'settings_sha256': _sha256_bytes(_canonical(settings).encode('utf-8')),
            'analysis': {'usable': False, 'reason': 'audio-too-long', 'frames': 0, 'bins': 0},
            'findings': [], 'edits': [],
            'summary': {'finding_count': 0, 'suggested_count': 0, 'flagged_count': 0,
                        'unresolved_count': 0, 'qualified_count': 0, 'withheld_count': 0,
                        'edit_count': 0, 'by_kind': {}, 'runtime_seconds': 0.0},
            'warnings': ['The recording is longer than the verifier limit; no automatic verification was run.'],
            'coverage': {'regions_total': 0, 'regions_analysed': 0, 'regions_skipped': 0,
                         'skipped': [{'reason': 'audio-too-long'}], 'truncated_regions': True,
                         'findings_truncated': False, 'atoms_truncated': False},
        }

    analysis = analyze_audio(samples, rate, settings, tuning_cents=tuning_cents)
    usable = float(np.max(analysis.level)) >= max(4.0 * analysis.noise_level, 1.0e-4)
    verifier = Verifier(analysis, events, activations, settings, provenance, budget, debug)
    if not usable:
        verifier.warnings.append('The recording is silent or too quiet for reliable verification.')
    if time.monotonic() > budget:
        verifier.warnings.append('Verification stopped at its time budget after audio analysis.')
        verifier.coverage['skipped'].append({'reason': 'time-budget', 'count': 1})
        findings = []
    else:
        findings = verifier.run()
    rank = {'suggested': 0, 'unresolved': 1, 'flagged': 2}
    findings.sort(key=lambda item: (rank.get(item['status'], 3), item['time_range'][0], item['id']))
    unique, seen = [], set()
    for finding in findings:
        signature = (finding['kind'], tuple(finding['event_ids']), finding['pitch'],
                     round(finding['time_range'][0], 2), _canonical(finding['proposed_edits']))
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(finding)
    findings = sorted(unique, key=lambda item: (item['time_range'][0], item['kind'], item['pitch'] or 0))
    for index, finding in enumerate(findings, 1):
        finding['id'] = f'vf-{index}'
    correction = gate_corrections(findings, correction_mode, correction_policy)
    edits = [edit for finding in findings for edit in finding['proposed_edits']
             if finding.get('correction_status') in ('diagnostic', 'qualified')]
    if expression_enabled:
        try:
            expression = analyze_expression(analysis, events, duration, expression_policy,
                                            expression_mode)
        except Exception as error:
            expression = {'version': EXPRESSION_VERSION, 'mode': expression_mode,
                          'status': 'unavailable', 'policy': None, 'proposals': [],
                          'summary': {'proposal_count': 0},
                          'reason': type(error).__name__}
    elif expression_error:
        expression = {'version': EXPRESSION_VERSION, 'mode': expression_mode,
                      'status': 'unavailable', 'policy': None, 'proposals': [],
                      'summary': {'proposal_count': 0}, 'reason': expression_error}
    else:
        expression = {'version': EXPRESSION_VERSION, 'mode': expression_mode,
                      'status': 'disabled', 'policy': None, 'proposals': [],
                      'summary': {'proposal_count': 0}}
    runtime = time.monotonic() - started
    coverage = verifier.coverage
    partial = (not usable or coverage['regions_skipped'] > 0 or coverage['truncated_regions']
               or coverage['findings_truncated'] or coverage['atoms_truncated']
               or any('budget' in warning for warning in verifier.warnings))
    status = 'partial' if partial else 'complete'
    if not np.isfinite(analysis.Y).all():
        status = 'partial'
    report = {
        'schema_version': SCHEMA_VERSION,
        'verifier_version': VERIFIER_VERSION,
        'mode': correction_mode,
        'correction_policy': correction,
        'expression': expression,
        'status': status,
        'source': {
            'verifier_code_sha256': _sha256_bytes(Path(__file__).read_bytes()),
            'audio_sha256': provenance.get('audio_sha256'),
            'reference_sha256': provenance.get('reference_sha256'),
            'proposal_sha256': proposal_digest(events),
            'profile_sha256': provenance.get('profile_sha256'),
            'model': provenance.get('model'),
            'model_version': provenance.get('model_version'),
            'decoder': provenance.get('decoder'),
            'weights_sha256': provenance.get('weights_sha256'),
            'decoder_sha256': provenance.get('decoder_sha256'),
            'duration': _r(duration, 4),
            'sample_rate': int(rate),
            'note_count': len(events),
            'tuning_cents': analysis.tuning_cents,
            'tuning_spread_cents': _r(analysis.tuning_spread_cents, 2),
        },
        'settings': settings,
        'settings_sha256': _sha256_bytes(_canonical(settings).encode('utf-8')),
        'analysis': {
            'frames': int(analysis.frames),
            'bins': int(len(analysis.freqs)),
            'frame_hop_seconds': _r(analysis.hop / float(rate), 5),
            'low_split_hz': settings['analysis']['low_split_hz'],
            'noise_floor_db': _r(20.0 * math.log10(float(np.sqrt(np.mean(analysis.noise ** 2))) + 1e-12), 2),
            'usable': bool(usable),
            'signal_db': _r(20.0 * math.log10(float(np.max(analysis.level)) + 1e-12), 2),
        },
        'coverage': coverage,
        'findings': findings,
        'edits': edits,
        'summary': {
            'finding_count': len(findings),
            'suggested_count': sum(1 for item in findings if item['status'] == 'suggested'),
            'flagged_count': sum(1 for item in findings if item['status'] == 'flagged'),
            'unresolved_count': sum(1 for item in findings if item['status'] == 'unresolved'),
            'qualified_count': sum(1 for item in findings if item.get('correction_status') == 'qualified'),
            'withheld_count': sum(1 for item in findings if item.get('correction_status') == 'withheld'),
            'edit_count': len(edits),
            'by_kind': {kind: sum(1 for item in findings if item['kind'] == kind)
                        for kind in sorted({item['kind'] for item in findings})},
            'runtime_seconds': _r(runtime, 2),
        },
        'warnings': verifier.warnings,
    }
    if debug:
        report['diagnostics'] = verifier.diagnostics
    return report


# ---------------------------------------------------------------------------
# Command line


def _load_activations(path):
    if not path:
        return None
    data = np.load(str(path), allow_pickle=False)
    return {name: data[name] for name in data.files if name in ('note', 'onset', 'contour')}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True,
                        help='Draft document (events) or a JSON array of note events.')
    parser.add_argument('--activations', type=Path, help='Retained Basic Pitch raw.npz')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--settings', type=Path, help='JSON overrides for verification settings')
    parser.add_argument('--execution-metadata', type=Path,
                        help='Verified model and decoder identity supplied by the adapter')
    parser.add_argument('--mode', choices=('diagnostic', 'qualified'), default='diagnostic')
    parser.add_argument('--correction-policy', type=Path,
                        help='Versioned correction policy required in qualified mode')
    parser.add_argument('--expression-enabled', action='store_true')
    parser.add_argument('--expression-mode', choices=('diagnostic', 'qualified'), default='qualified')
    parser.add_argument('--expression-policy', type=Path,
                        help='Versioned phase-4 expression policy')
    parser.add_argument('--duration', type=float)
    parser.add_argument('--sample-rate', type=int, default=22050)
    args = parser.parse_args(argv)
    payload = json.loads(args.reference.read_text(encoding='utf-8'))
    events = payload.get('events') if isinstance(payload, dict) else payload
    if not isinstance(events, list):
        raise SystemExit('Reference must contain an events array.')
    settings = json.loads(args.settings.read_text(encoding='utf-8')) if args.settings else None
    policy = (json.loads(args.correction_policy.read_text(encoding='utf-8'))
              if args.correction_policy else None)
    expression_policy = (json.loads(args.expression_policy.read_text(encoding='utf-8'))
                         if args.expression_policy else None)
    provenance = {}
    if isinstance(payload, dict):
        provenance['reference_sha256'] = _sha256_bytes(args.reference.read_bytes())
        provenance.update({key: payload.get('provenance', {}).get(key)
                           for key in ('model', 'model_version', 'profile_sha256', 'decoder')})
    if args.execution_metadata:
        execution = json.loads(args.execution_metadata.read_text(encoding='utf-8'))
        allowed = {'model', 'model_version', 'profile_sha256', 'decoder',
                   'weights_sha256', 'decoder_sha256'}
        if not isinstance(execution, dict) or set(execution) - allowed:
            raise ValueError('Invalid verifier execution identity.')
        provenance.update(execution)
    report = verify_piano_transcription(
        audio=args.audio, events=events, activations=_load_activations(args.activations),
        duration=args.duration, sample_rate=args.sample_rate, settings=settings,
        provenance=provenance, correction_mode=args.mode, correction_policy=policy,
        expression_enabled=args.expression_enabled, expression_mode=args.expression_mode,
        expression_policy=expression_policy)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'], indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
