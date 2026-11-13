"""Independent, domain-bound attack-to-MIDI calibration with held-out residuals.

No AI baseline velocity is used in fitting or prediction. This maps attributable
audio strength to reference MIDI velocity only for an explicitly matching domain.
"""
import hashlib
import json
import math
import numpy as np

VERSION = 'piano-velocity-calibration-1'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def fit(rows, domain, measurement_sha256):
    if not isinstance(domain, str) or not domain:
        raise ValueError('Calibration requires an explicit instrument/recording domain.')
    required = {'performance_id', 'split', 'pitch', 'velocity', 'attack_level_db'}
    for row in rows:
        if not required <= set(row) or row['split'] not in ('training', 'calibration'):
            raise ValueError('Calibration may not consume qualification/holdout rows.')
        if not 1 <= row['velocity'] <= 127 or not math.isfinite(row['attack_level_db']):
            raise ValueError('Invalid calibration measurement or reference velocity.')
    seen = {}
    for row in rows:
        if seen.setdefault(row['performance_id'], row['split']) != row['split']:
            raise ValueError('Calibration performance leaked between training and uncertainty calibration.')
    train = [r for r in rows if r['split'] == 'training']
    calibrate = [r for r in rows if r['split'] == 'calibration']
    if len({r['performance_id'] for r in train}) < 2 or not calibrate:
        raise ValueError('Supply independent training performances and uncertainty calibration.')
    pitches = [p for p in range(21, 109) if sum(r['pitch'] == p for r in train) >= 6
               and len({r['velocity'] for r in train if r['pitch'] == p}) >= 3
               and max(r['velocity'] for r in train if r['pitch'] == p)
                   - min(r['velocity'] for r in train if r['pitch'] == p) >= 16]
    if not pitches:
        raise ValueError('No pitch has enough velocity-layer coverage.')
    offsets = {p: np.median([r['attack_level_db'] for r in train if r['pitch'] == p]) for p in pitches}
    centers = {p: np.median([math.log2(r['velocity']) for r in train if r['pitch'] == p]) for p in pitches}
    x = np.array([math.log2(r['velocity']) - centers[r['pitch']] for r in train if r['pitch'] in offsets])
    y = np.array([r['attack_level_db'] - offsets[r['pitch']] for r in train if r['pitch'] in offsets])
    slope = 12.
    for _ in range(12):
        residual = y - slope * x
        weights = np.minimum(1., 3. / np.maximum(np.abs(residual), 1e-9))
        slope = float(np.sum(weights * x * y) / max(np.sum(weights * x * x), 1e-9))
    for p in pitches:
        offsets[p] = float(np.median([r['attack_level_db'] - slope * math.log2(r['velocity'])
                                     for r in train if r['pitch'] == p]))
    interpolated = []
    bounds = {p: [min(r['velocity'] for r in train if r['pitch'] == p),
                  max(r['velocity'] for r in train if r['pitch'] == p)] for p in pitches}
    for left, right in zip(pitches, pitches[1:]):
        if right - left <= 3:
            for pitch in range(left + 1, right):
                offsets[pitch] = offsets[left] + (offsets[right] - offsets[left]) * (pitch - left) / (right - left)
                interpolated.append(pitch)
                bounds[pitch] = [max(bounds[left][0], bounds[right][0]),
                                 min(bounds[left][1], bounds[right][1])]
    if not 1. <= slope <= 40.:
        raise ValueError('Calibration response is not a supported monotonic velocity curve.')
    errors = [abs(r['attack_level_db'] - offsets[r['pitch']] - slope * math.log2(r['velocity']))
              for r in calibrate if r['pitch'] in offsets]
    if len(errors) < 20:
        raise ValueError('Insufficient independent residual calibration.')
    artifact = {'calibration_version': VERSION, 'domain': domain,
                'measurement_sha256': measurement_sha256, 'slope_db_per_octave': slope,
                'pitch_offsets': {str(p): float(value) for p, value in offsets.items()},
                'interpolated_pitches': interpolated,
                'velocity_bounds': {str(p): value for p, value in bounds.items()},
                'residual_q90_db': float(np.quantile(errors, .9)),
                'training_performances': sorted({r['performance_id'] for r in train}),
                'calibration_performances': sorted({r['performance_id'] for r in calibrate}),
                'reference_kind': 'captured_midi_velocity', 'qualification_status': 'not-qualified',
                'measurements_sha256': digest(rows)}
    return {**artifact, 'calibration_id': digest(artifact)}


def predict(artifact, pitch, attack_level_db, domain, measurement_sha256):
    if not isinstance(artifact, dict) or artifact.get('calibration_version') != VERSION:
        return None, 'calibration_missing'
    body = {k: v for k, v in artifact.items() if k != 'calibration_id'}
    if artifact.get('calibration_id') != digest(body):
        return None, 'calibration_digest_mismatch'
    if artifact.get('domain') != domain or artifact.get('measurement_sha256') != measurement_sha256:
        return None, 'calibration_domain_mismatch'
    offset = artifact.get('pitch_offsets', {}).get(str(pitch))
    if offset is None:
        return None, 'calibration_pitch_unsupported'
    slope = artifact['slope_db_per_octave']
    error = artifact['residual_q90_db']
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (slope, error, offset, attack_level_db)) \
            or not 1 <= slope <= 40 or error < 0:
        return None, 'calibration_invalid'
    values = [2 ** min(math.log2(127), max(0., (attack_level_db + delta - offset) / slope)) / 127.
              for delta in (-error, 0., error)]
    supported = artifact.get('velocity_bounds', {}).get(str(pitch))
    if not supported or values[0] * 127 < supported[0] or values[-1] * 127 > supported[1]:
        return None, 'calibration_velocity_out_of_range'
    if values[-1] - values[0] > 16 / 127:
        return None, 'calibration_interval_too_wide'
    return {'velocity': values[1], 'interval': [values[0], values[-1]],
            'calibration_id': artifact['calibration_id'], 'domain': domain}, None
