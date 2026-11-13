"""Bounded, score-informed time-varying nonnegative spectral attribution.

Templates describe pitches, not proposed offsets: changing a draft duration must
not change the measured decay. All estimates remain diagnostic until qualified.
"""
import math
import numpy as np

VERSION = 'piano-attribution-1'
MAX_PITCHES = 32
MAX_WINDOW_SECONDS = 8.0


def _templates(analysis, pitches, rows, settings, verifier):
    columns = []
    for pitch in pitches:
        sustain = verifier._template(analysis, pitch, 'sustain', .5, settings)
        if sustain is None:
            return None
        # Two spectral tilts accommodate attack/sustain timbre without dictating
        # a temporal envelope or trusting the incoming velocity.
        attack = verifier._template(analysis, pitch, 'attack', .5, settings)
        columns.extend([sustain[rows], attack[rows]])
    columns.append(np.maximum(analysis.noise[rows], 1e-9))
    matrix = np.stack(columns, axis=1)
    norms = np.linalg.norm(matrix, axis=0)
    if np.any(norms < 1e-12):
        return None
    return matrix / norms


def _fit(matrix, observed, allowed, sweeps=32, adapt=True):
    gram = matrix.T @ matrix
    linear = matrix.T @ observed
    gains = np.maximum(linear, 0.) * allowed
    for _ in range(sweeps):
        for i in range(len(matrix.T)):
            gains[i] = np.maximum(0., gains[i] + (linear[i] - gram[i] @ gains)
                                  / max(gram[i, i], 1e-9)) * allowed[i]
        if adapt and _ in (7, 15, 23):
            # Adapt timbre within the known harmonic support only. Temporal
            # activation constraints, not draft offsets, determine available data.
            numerator = observed @ gains.T
            denominator = matrix @ (gains @ gains.T)
            matrix *= np.clip(numerator / np.maximum(denominator, 1e-12), .25, 4.)
            norms = np.maximum(np.linalg.norm(matrix, axis=0), 1e-12)
            matrix /= norms
            gains *= norms[:, None]
            gram = matrix.T @ matrix
            linear = matrix.T @ observed
    return gains, matrix @ gains


def attribute(analysis, note, events, settings, verifier, purpose='decay'):
    onset = float(note['onset'])
    stop = min(float(analysis.times[-1]), onset + (.25 if purpose == 'attack' else MAX_WINDOW_SECONDS))
    start = max(0., onset - .25)
    context = [n for n in events if float(n['onset']) <= stop
               and float(n['onset']) + MAX_WINDOW_SECONDS >= start]
    pitches = sorted({int(n['pitch']) for n in context})
    if int(note['pitch']) not in pitches or len(pitches) > MAX_PITCHES:
        return {'usable': False, 'reason': 'attribution_pitch_limit'}
    lo = int(np.searchsorted(analysis.times, start))
    hi = int(np.searchsorted(analysis.times, stop, side='right'))
    times = analysis.times[lo:hi]
    if len(times) < 12:
        return {'usable': False, 'reason': 'attribution_short_context'}
    # Use the short-window frequency range for precise offsets; low-resolution
    # fundamentals remain a separate corroborating view in the expression stage.
    rows = np.flatnonzero((analysis.freqs >= 700.) & (analysis.freqs <= 6000.))
    matrix = _templates(analysis, pitches, rows, settings, verifier)
    if matrix is None:
        return {'usable': False, 'reason': 'attribution_unsupported_pitch'}
    observed = np.maximum(analysis.Y[lo:hi, rows].T, 0.)
    allowed = np.ones((len(matrix.T), len(times)))
    for index, pitch in enumerate(pitches):
        active = np.zeros(len(times), dtype=bool)
        for other in context:
            if int(other['pitch']) == pitch:
                active |= (times >= float(other['onset']) - .05) & (
                    times <= float(other['onset']) + MAX_WINDOW_SECONDS)
        allowed[index * 2:index * 2 + 2] = active
    gains, reconstruction = _fit(matrix, observed, allowed)
    index = pitches.index(int(note['pitch']))
    own = matrix[:, index * 2:index * 2 + 2] @ gains[index * 2:index * 2 + 2]
    envelope = np.linalg.norm(own, axis=0)
    relative_residual = float(np.linalg.norm(observed - reconstruction) /
                              max(np.linalg.norm(observed), 1e-9))
    # Shared templates, particularly octave-related spectra, are not proof of
    # independently identifiable notes even when the total fit is good.
    other_columns = [i for i in range(len(matrix.T) - 1) if i // 2 != index]
    coherence = float(np.max(matrix[:, index * 2:index * 2 + 2].T @
                            matrix[:, other_columns])) if other_columns else 0.
    attack = (times >= onset + .02) & (times <= onset + .16)
    peak = float(np.max(envelope[attack])) if attack.any() else 0.
    floor = float(np.linalg.norm(analysis.noise[rows]))
    groups = []
    for parity in (() if purpose == 'attack' else (0, 1)):
        selected = np.zeros(len(analysis.freqs), dtype=bool)
        for partial, _freq, indices, _weights in analysis.partials[int(note['pitch']) - 21]:
            if partial % 2 == parity:
                selected[indices] = True
        local = np.flatnonzero(selected[rows])
        if len(local) < 8:
            continue
        group_matrix = matrix[local].copy()
        group_gain, _ = _fit(group_matrix, observed[local], allowed, sweeps=24, adapt=False)
        group_own = group_matrix[:, index * 2:index * 2 + 2] @ group_gain[index * 2:index * 2 + 2]
        group_env = np.linalg.norm(group_own, axis=0)
        groups.append({'envelope': group_env, 'peak': float(np.max(group_env[attack])),
                       'noise': float(np.linalg.norm(analysis.noise[rows[local]]))})
    prior = (times >= onset - .15) & (times <= onset - .05)
    ringing = float(np.max(envelope[prior])) if prior.any() else 0.
    strike = math.sqrt(max(peak * peak - ringing * ringing, 0.))
    return {'usable': strike > max(4 * floor, 1e-6) and coherence < .92,
            'reason': 'attribution_ambiguous' if coherence >= .92 else 'attributed',
            'version': VERSION, 'times': times, 'envelope': envelope,
            'peak': peak, 'noise': floor, 'residual': relative_residual,
            'coherence': coherence, 'context_pitches': pitches,
            'groups': groups,
            'harmonic_conflict': verifier._harmonic_relation(int(note['pitch']),
                [p for p in pitches if p != int(note['pitch'])]) is not None,
            'attack_level_db': float(20 * math.log10(max(strike, 1e-12))),
            'ringing_before_attack': ringing,
            'scope': 'polyphonic' if len(pitches) > 1 else 'isolated'}


def ending(evidence, onset, next_same=None):
    if (not evidence.get('usable') or evidence.get('harmonic_conflict')
            or evidence['coherence'] > .65 or evidence['residual'] > .4
            or evidence['peak'] < evidence['noise'] * 100):
        return None
    estimates = [_ending_view(evidence, onset, next_same)]
    for group in evidence.get('groups', []):
        estimates.append(_ending_view({**evidence, **group}, onset, next_same))
    if len(estimates) != 3 or any(item is None for item in estimates):
        return None
    ends = [item['end'] for item in estimates]
    if max(ends) - min(ends) > .08:
        return None
    end = float(np.median(ends))
    return {'end': end, 'interval': [min(ends) - .04, max(ends) + .04],
            'view_ends': ends, 'threshold': estimates[0]['threshold']}


def _ending_view(evidence, onset, next_same):
    times, env = evidence['times'], evidence['envelope']
    high = float(times[-1]) - .15
    if next_same is not None:
        high = min(high, next_same - .12)
    valid = (times >= onset + .16) & (times <= high)
    if not valid.any():
        return None
    threshold = max(evidence['peak'] * .01, evidence['noise'] * 4.)
    # A sustained fall must be observed, not inferred from the end of a window.
    for i in np.flatnonzero(valid):
        future = (times >= times[i]) & (times <= times[i] + .12)
        if future.sum() >= 6 and np.all(env[future] < threshold):
            before = np.flatnonzero((times >= onset + .05) & (times < times[i]) & (env >= threshold))
            if not len(before):
                return None
            end = float(times[before[-1]])
            return {'end': end, 'interval': [end - .05, end + .05],
                    'threshold': threshold}
    return None
