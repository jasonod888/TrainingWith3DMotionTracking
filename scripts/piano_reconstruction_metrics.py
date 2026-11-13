"""Frozen reconstruction objective v2 with separately reported components.

v1 evidence remains historical; this version adds an implementation identity, retains raw
distances beside bounded display values, replaces the saturating scale with a smooth one,
adds octave-band evidence beside chroma, and makes the compared interval explicit so a
short candidate cannot score a perfect match on a matching prefix.

The objective measures a **declared interval** of the source. A candidate that does not
cover that interval is rejected by default; unwanted sound beyond it is reported
separately rather than folded into the score.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

OBJECTIVE_VERSION = 'piano-reconstruction-objective-2'
WEIGHTS = {'spectral': 0.30, 'attack': 0.20, 'loudness': 0.15,
           'pitch_energy': 0.10, 'octave_balance': 0.10, 'decay': 0.15}
# Smooth bounded display values: ``raw / (raw + scale)`` approaches but never reaches 1.
COMPONENT_SCALES = {'spectral': 9.0, 'attack': 0.5, 'loudness': 3.0,
                    'pitch_energy': 0.3, 'octave_balance': 0.3, 'decay': 2.0}
SUPPORTED_FEATURES = ('multi-resolution spectral', 'attack alignment',
                      'short-term loudness', 'pitch-class energy', 'octave-band energy',
                      'decay slope')
UNSUPPORTED_FEATURES = ('stereo width', 'room/reverb similarity', 'waveform identity')
# Feature windows are defined in time, then converted per source rate.
STFT_DURATIONS = (0.023, 0.046, 0.093)
ENVELOPE_SECONDS = 0.006
ENVELOPE_HOP_SECONDS = 0.002
LOUDNESS_SECONDS = 0.023
LOUDNESS_HOP_SECONDS = 0.012
DECAY_SECONDS = 0.046
DECAY_HOP_SECONDS = 0.023
EPSILON = 1e-10
MIN_SAMPLES = 2048
MAX_SECONDS = 900.0
OCTAVE_BANDS = (21, 48, 60, 72, 84, 109)


class MetricError(ValueError):
    """The comparison could not be computed."""


class IncompleteCandidate(MetricError):
    """The candidate does not cover the declared comparison interval."""


class Comparison:
    """Result of comparing a rendered candidate with its source reference."""

    def __init__(self, *, objective, ranking, components, raw_components, sample_rate,
                 duration_seconds, interval, gain_db, latency_samples, complete,
                 padded_seconds, extra_energy_db, warnings, normalized):
        self.objective = float(objective)
        self.ranking = float(ranking)
        self.components = dict(components)
        self.raw_components = dict(raw_components)
        self.sample_rate = int(sample_rate)
        self.duration_seconds = float(duration_seconds)
        self.interval = (float(interval[0]), float(interval[1]))
        self.gain_db = float(gain_db)
        self.latency_samples = int(latency_samples)
        self.complete = bool(complete)
        self.padded_seconds = float(padded_seconds)
        self.extra_energy_db = None if extra_energy_db is None else float(extra_energy_db)
        self.warnings = tuple(warnings)
        self.normalized = bool(normalized)

    def to_dict(self):
        return {'objective_version': OBJECTIVE_VERSION,
                'objective': round(self.objective, 6),
                'ranking': round(self.ranking, 6),
                'components': {name: round(value, 6)
                               for name, value in self.components.items()},
                'raw_components': {name: round(value, 6)
                                   for name, value in self.raw_components.items()},
                'weights': dict(WEIGHTS),
                'sample_rate': self.sample_rate,
                'duration_seconds': round(self.duration_seconds, 4),
                'interval': [round(self.interval[0], 6), round(self.interval[1], 6)],
                'complete': self.complete,
                'padded_seconds': round(self.padded_seconds, 4),
                'extra_energy_db': (None if self.extra_energy_db is None
                                    else round(self.extra_energy_db, 3)),
                'gain_db': round(self.gain_db, 4),
                'latency_samples': self.latency_samples,
                'gain_normalized': self.normalized,
                'supported_features': list(SUPPORTED_FEATURES),
                'unsupported_features': list(UNSUPPORTED_FEATURES),
                'implementation_sha256': implementation_sha256(),
                'warnings': list(self.warnings)}

    def __repr__(self):
        return (f'Comparison(objective={self.objective:.4f}, complete={self.complete}, '
                f'gain_db={self.gain_db:+.2f})')


def _as_mono(signal, name):
    array = np.asarray(signal)
    if array.ndim == 1:
        return array.astype(np.float64, copy=False), False
    if array.ndim == 2:
        if array.shape[1] not in (1, 2):
            raise MetricError(f'{name} must have 1 or 2 channels, got {array.shape[1]}')
        return array.astype(np.float64, copy=False).mean(axis=1), array.shape[1] == 2
    raise MetricError(f'{name} must be 1-D or 2-D, got {array.ndim}-D')


def _seconds_to_frames(seconds, sample_rate):
    return max(1, int(round(float(seconds) * sample_rate)))


def fft_sizes(sample_rate):
    """STFT sizes chosen from target durations, so behaviour does not depend on rate."""
    sizes = []
    for duration in STFT_DURATIONS:
        target = duration * sample_rate
        size = 1 << max(8, min(14, int(round(math.log2(max(1.0, target))))))
        if size not in sizes:
            sizes.append(size)
    return tuple(sizes)


def _slice(mono, start_seconds, end_seconds, sample_rate, offset=0):
    first = int(round(start_seconds * sample_rate)) + offset
    last = int(round(end_seconds * sample_rate)) + offset
    first = max(0, first)
    if last <= first:
        return np.zeros(0, dtype=np.float64)
    return mono[first:last]


def _frame_view(signal, size, hop):
    if signal.shape[0] < size:
        padded = np.zeros(size, dtype=np.float64)
        padded[:signal.shape[0]] = signal
        return padded[None, :]
    count = 1 + (signal.shape[0] - size) // hop
    index = np.arange(size)[None, :] + hop * np.arange(count)[:, None]
    return signal[index]


def _blocks(count, block=256):
    for start in range(0, count, block):
        yield start, min(count, start + block)


def _envelope(signal, frame, hop):
    return np.sqrt(np.mean(np.square(_frame_view(signal, frame, hop)), axis=1))


def _spectral_raw(reference, candidate, sample_rate):
    """Mean absolute log-spectral difference, streamed so memory stays bounded."""
    total = 0.0
    observations = 0
    for size in fft_sizes(sample_rate):
        hop = max(1, size // 2)
        reference_frames = _frame_view(reference, size, hop)
        candidate_frames = _frame_view(candidate, size, hop)
        count = min(reference_frames.shape[0], candidate_frames.shape[0])
        window = np.hanning(size)
        for start, stop in _blocks(count):
            ref_mag = np.abs(np.fft.rfft(reference_frames[start:stop] * window, axis=1))
            cand_mag = np.abs(np.fft.rfft(candidate_frames[start:stop] * window, axis=1))
            ref_db = 20.0 * np.log10(ref_mag + EPSILON)
            cand_db = 20.0 * np.log10(cand_mag + EPSILON)
            floor = np.max(ref_db) - 80.0
            mask = ref_db > floor
            if not np.any(mask):
                continue
            total += float(np.sum(np.abs(ref_db[mask] - cand_db[mask])))
            observations += int(np.count_nonzero(mask))
    return total / observations if observations else 0.0


def _attack_raw(reference, candidate, sample_rate):
    frame = _seconds_to_frames(ENVELOPE_SECONDS, sample_rate)
    hop = _seconds_to_frames(ENVELOPE_HOP_SECONDS, sample_rate)
    ref_env = _envelope(reference, frame, hop)
    cand_env = _envelope(candidate, frame, hop)
    ref_onset = np.maximum(np.diff(np.log1p(ref_env * 1000.0), prepend=0.0), 0.0)
    cand_onset = np.maximum(np.diff(np.log1p(cand_env * 1000.0), prepend=0.0), 0.0)
    if not np.any(ref_onset) and not np.any(cand_onset):
        return 0.0
    denominator = float(np.linalg.norm(ref_onset) * np.linalg.norm(cand_onset))
    if denominator < EPSILON:
        return 1.0
    correlation = float(np.dot(ref_onset, cand_onset)) / denominator
    return float(min(2.0, max(0.0, 1.0 - correlation)))


def _loudness_raw(reference, candidate, sample_rate):
    frame = _seconds_to_frames(LOUDNESS_SECONDS, sample_rate)
    hop = _seconds_to_frames(LOUDNESS_HOP_SECONDS, sample_rate)
    ref_level = 20.0 * np.log10(_envelope(reference, frame, hop) + EPSILON)
    cand_level = 20.0 * np.log10(_envelope(candidate, frame, hop) + EPSILON)
    floor = np.max(ref_level) - 60.0
    mask = ref_level > floor
    if not np.any(mask):
        return 0.0
    return float(np.mean(np.abs(ref_level[mask] - cand_level[mask])))


def _chroma_profile(reference, sample_rate):
    size = fft_sizes(sample_rate)[-1]
    hop = max(1, size // 4)
    magnitude = np.abs(np.fft.rfft(_frame_view(reference, size, hop) * np.hanning(size),
                                   axis=1))
    frequencies = np.fft.rfftfreq(size, d=1.0 / sample_rate)
    usable = (frequencies > 55.0) & (frequencies < 5000.0)
    if not np.any(usable):
        return np.zeros(12)
    midi = 69.0 + 12.0 * np.log2(np.maximum(frequencies[usable], 1e-6) / 440.0)
    classes = np.mod(np.round(midi).astype(int), 12)
    profile = np.zeros(12)
    np.add.at(profile, classes, magnitude[:, usable].mean(axis=0))
    total = float(np.linalg.norm(profile))
    return profile / total if total > EPSILON else profile


def _octave_profile(reference, sample_rate):
    """Five pitch bands, so a chroma match cannot certify that octaves are correct."""
    size = fft_sizes(sample_rate)[-1]
    hop = max(1, size // 4)
    magnitude = np.abs(np.fft.rfft(_frame_view(reference, size, hop) * np.hanning(size),
                                   axis=1))
    frequencies = np.fft.rfftfreq(size, d=1.0 / sample_rate)
    usable = (frequencies > 27.5) & (frequencies < 4200.0)
    if not np.any(usable):
        return np.zeros(len(OCTAVE_BANDS) - 1)
    midi = 69.0 + 12.0 * np.log2(np.maximum(frequencies[usable], 1e-6) / 440.0)
    profile = np.zeros(len(OCTAVE_BANDS) - 1)
    for index in range(len(OCTAVE_BANDS) - 1):
        band = (midi >= OCTAVE_BANDS[index]) & (midi < OCTAVE_BANDS[index + 1])
        if np.any(band):
            profile[index] = magnitude[:, usable][:, band].mean()
    total = float(np.linalg.norm(profile))
    return profile / total if total > EPSILON else profile


def _cosine_distance(first, second):
    if not np.any(first) and not np.any(second):
        return 0.0
    return float(min(2.0, max(0.0, 1.0 - float(np.dot(first, second)))))


def _decay_raw(reference, candidate, sample_rate):
    frame = _seconds_to_frames(DECAY_SECONDS, sample_rate)
    hop = _seconds_to_frames(DECAY_HOP_SECONDS, sample_rate)
    ref_level = 20.0 * np.log10(_envelope(reference, frame, hop) + EPSILON)
    cand_level = 20.0 * np.log10(_envelope(candidate, frame, hop) + EPSILON)
    floor = np.max(ref_level) - 45.0
    mask = ref_level > floor
    if np.count_nonzero(mask) < 3:
        return 0.0
    difference = np.abs(np.diff(ref_level) - np.diff(cand_level))[mask[:-1]]
    return float(np.mean(difference)) if difference.size else 0.0


RAW_FUNCTIONS = {'spectral': _spectral_raw, 'attack': _attack_raw,
                 'loudness': _loudness_raw, 'decay': _decay_raw}


def bounded(raw, name):
    """Smooth bounded display value; never saturates to 1 the way a linear clip does."""
    if raw <= 0.0:
        return 0.0
    scale = COMPONENT_SCALES[name]
    return float(raw / (raw + scale))


def _gain_db(reference, candidate):
    reference_rms = float(np.sqrt(np.mean(np.square(reference)))) if reference.size else 0.0
    candidate_rms = float(np.sqrt(np.mean(np.square(candidate)))) if candidate.size else 0.0
    if reference_rms < EPSILON or candidate_rms < EPSILON:
        return 0.0
    return 20.0 * math.log10(candidate_rms / reference_rms)


def compare(reference, candidate, sample_rate, *, interval=None, latency_samples=0,
            gain_normalize=True, require_complete=True, fixed_gain_db=None):
    """Compare a candidate with the source over a declared interval.

    ``interval`` is ``(start, end)`` in source seconds and defaults to the whole reference.
    ``latency_samples`` removes a declared fixed renderer delay only; nothing is time-warped.
    A candidate shorter than the interval is rejected unless ``require_complete=False``, in
    which case it is padded with silence over the interval and the padding is scored.
    ``gain_normalize`` fits one global recording gain; report the unnormalized comparison
    too when the delivered playback level matters. ``fixed_gain_db`` applies a caller-supplied
    gain instead of fitting one, which gives every candidate the same frozen gain.
    """
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, int) or sample_rate <= 0:
        raise MetricError('sample_rate must be a positive integer')
    if latency_samples < 0:
        raise MetricError('latency_samples must not be negative')

    reference_mono, reference_stereo = _as_mono(reference, 'reference')
    candidate_mono, candidate_stereo = _as_mono(candidate, 'candidate')
    if reference_mono.shape[0] < MIN_SAMPLES:
        raise MetricError(f'reference needs at least {MIN_SAMPLES} samples')
    reference_seconds = reference_mono.shape[0] / float(sample_rate)
    if reference_seconds > MAX_SECONDS:
        raise MetricError(f'reference exceeds the {MAX_SECONDS:g} s bounded processing limit')

    warnings = []
    if reference_stereo or candidate_stereo:
        warnings.append('stereo input mixed to mono; stereo similarity is not in objective v2')

    start, end = (0.0, reference_seconds) if interval is None else (
        float(interval[0]), float(interval[1]))
    if not 0.0 <= start < end:
        raise MetricError(f'invalid comparison interval {interval!r}')
    if end > reference_seconds + 0.5 / sample_rate:
        raise MetricError(
            f'interval end {end:.3f}s exceeds the reference duration {reference_seconds:.3f}s')

    reference_segment = _slice(reference_mono, start, end, sample_rate)
    candidate_segment = _slice(candidate_mono, start, end, sample_rate, latency_samples)
    required = reference_segment.shape[0]

    complete = candidate_segment.shape[0] >= required
    padded_seconds = 0.0
    if not complete:
        missing = required - candidate_segment.shape[0]
        padded_seconds = missing / float(sample_rate)
        if require_complete:
            raise IncompleteCandidate(
                f'candidate covers {candidate_segment.shape[0] / sample_rate:.3f}s of the '
                f'declared {end - start:.3f}s interval; {padded_seconds:.3f}s is missing and '
                'a matching prefix cannot qualify')
        warnings.append(f'candidate padded with {padded_seconds:.3f}s of silence')

    if fixed_gain_db is not None:
        gain = float(fixed_gain_db)
        candidate_segment = candidate_segment * (10.0 ** (-gain / 20.0))
        warnings.append(f'applied the frozen common gain of {gain:+.2f} dB')
    else:
        gain = _gain_db(reference_segment, candidate_segment)
        if gain_normalize and abs(gain) > 1e-9:
            candidate_segment = candidate_segment * (10.0 ** (-gain / 20.0))
            warnings.append(f'applied {gain:+.2f} dB recording gain calibration')
    if candidate_segment.shape[0] < required:
        candidate_segment = np.pad(candidate_segment, (0, required - candidate_segment.shape[0]))

    beyond_start = int(round(end * sample_rate)) + latency_samples
    beyond = candidate_mono[beyond_start:]
    extra_energy_db = None
    if beyond.size and complete:
        reference_rms = float(np.sqrt(np.mean(np.square(reference_segment))))
        extra_rms = float(np.sqrt(np.mean(np.square(beyond))))
        if extra_rms > EPSILON and reference_rms > EPSILON:
            extra_energy_db = 20.0 * math.log10(extra_rms / reference_rms)
            if extra_energy_db > -20.0:
                warnings.append(
                    f'candidate continues {extra_energy_db:+.1f} dB beyond the scored interval')

    if not np.any(reference_segment) and not np.any(candidate_segment):
        raw_components = {name: 0.0 for name in WEIGHTS}
    else:
        raw_components = {name: function(reference_segment, candidate_segment, sample_rate)
                          for name, function in RAW_FUNCTIONS.items()}
        raw_components['pitch_energy'] = _cosine_distance(
            _chroma_profile(reference_segment, sample_rate),
            _chroma_profile(candidate_segment, sample_rate))
        raw_components['octave_balance'] = _cosine_distance(
            _octave_profile(reference_segment, sample_rate),
            _octave_profile(candidate_segment, sample_rate))

    components = {name: bounded(raw_components[name], name) for name in WEIGHTS}
    objective = sum(WEIGHTS[name] * components[name] for name in WEIGHTS)
    ranking = sum(WEIGHTS[name] * math.log1p(raw_components[name] / COMPONENT_SCALES[name])
                  for name in WEIGHTS)

    return Comparison(objective=objective, ranking=ranking, components=components,
                      raw_components=raw_components, sample_rate=sample_rate,
                      duration_seconds=required / float(sample_rate),
                      interval=(start, end), gain_db=gain,
                      latency_samples=latency_samples, complete=complete,
                      padded_seconds=padded_seconds, extra_energy_db=extra_energy_db,
                      warnings=warnings, normalized=gain_normalize)


def stereo_diagnostics(reference, candidate, sample_rate, *, interval=None,
                       latency_samples=0):
    """Channel-level stereo diagnostics, explicitly not qualification evidence.

    The objective is mono-mixed: a small difference here does not establish room equivalence.
    """
    reference_array = np.asarray(reference)
    candidate_array = np.asarray(candidate)
    if reference_array.ndim != 2 or reference_array.shape[1] != 2:
        return {'status': 'unavailable', 'supported_for_qualification': False,
                'reason': 'reference is not stereo'}
    if candidate_array.ndim != 2 or candidate_array.shape[1] != 2:
        return {'status': 'unavailable', 'supported_for_qualification': False,
                'reason': 'candidate is not stereo'}
    if isinstance(sample_rate, bool) or not isinstance(sample_rate, int) or sample_rate <= 0:
        raise MetricError('sample_rate must be a positive integer')
    start, end = ((0.0, reference_array.shape[0] / float(sample_rate)) if interval is None
                  else (float(interval[0]), float(interval[1])))
    reference_segment = np.stack([_slice(reference_array[:, channel], start, end, sample_rate)
                                  for channel in range(2)], axis=1)
    candidate_segment = np.stack([_slice(candidate_array[:, channel], start, end,
                                         sample_rate, latency_samples)
                                  for channel in range(2)], axis=1)

    def balance(segment):
        left, right = _rms_channel(segment[:, 0]), _rms_channel(segment[:, 1])
        if left < EPSILON or right < EPSILON:
            return None
        return round(20.0 * math.log10(left / right), 3)

    def correlation(segment):
        left, right = segment[:, 0], segment[:, 1]
        if np.std(left) < EPSILON or np.std(right) < EPSILON:
            return None
        return round(float(np.corrcoef(left, right)[0, 1]), 4)

    def width(segment):
        mid = (segment[:, 0] + segment[:, 1]) / 2.0
        side = (segment[:, 0] - segment[:, 1]) / 2.0
        mid_rms, side_rms = _rms_channel(mid), _rms_channel(side)
        if mid_rms < EPSILON:
            return None
        return round(20.0 * math.log10(max(side_rms, EPSILON) / mid_rms), 3)

    def mid_side_spectral(segment):
        size = min(2048, 2 ** int(math.floor(math.log2(max(64, segment.shape[0])))))
        mid = (segment[:, 0] + segment[:, 1]) / 2.0
        side = (segment[:, 0] - segment[:, 1]) / 2.0
        hop = max(1, size // 2)
        mid_spectrum = np.abs(np.fft.rfft(_frame_view(mid, size, hop) * np.hanning(size),
                                          axis=1)).mean(axis=0)
        side_spectrum = np.abs(np.fft.rfft(_frame_view(side, size, hop) * np.hanning(size),
                                           axis=1)).mean(axis=0)
        return round(float(np.mean(np.abs(20.0 * np.log10(mid_spectrum + EPSILON)
                                          - 20.0 * np.log10(side_spectrum + EPSILON)))), 3)

    return {
        'status': 'diagnostic_only',
        'supported_for_qualification': False,
        'reason': 'stereo and room equivalence are not independently validated',
        'reference': {'balance_db': balance(reference_segment),
                      'correlation': correlation(reference_segment),
                      'width_db': width(reference_segment),
                      'mid_side_spectral_db': mid_side_spectral(reference_segment)},
        'candidate': {'balance_db': balance(candidate_segment),
                      'correlation': correlation(candidate_segment),
                      'width_db': width(candidate_segment),
                      'mid_side_spectral_db': mid_side_spectral(candidate_segment)},
        'interval': [start, end],
    }


def _rms_channel(values):
    if values.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(values))))


def weights_sha256():
    """Identity of the frozen weights, for binding a report to the version that scored it."""
    payload = json.dumps({'version': OBJECTIVE_VERSION, 'weights': WEIGHTS,
                          'scales': COMPONENT_SCALES, 'stft_durations': list(STFT_DURATIONS)},
                         sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


_IMPLEMENTATION_SHA256 = None


def implementation_sha256():
    """Hash of the measurement code itself, not only its settings."""
    global _IMPLEMENTATION_SHA256
    if _IMPLEMENTATION_SHA256 is None:
        source = Path(__file__).read_bytes()
        _IMPLEMENTATION_SHA256 = hashlib.sha256(source).hexdigest()
    return _IMPLEMENTATION_SHA256


def improvement(baseline, candidate):
    """Relative improvement of ``candidate`` over ``baseline``; positive means better."""
    if baseline is None or candidate is None:
        raise MetricError('two comparisons are required')
    if baseline.objective <= 0.0:
        return 0.0
    return (baseline.objective - candidate.objective) / baseline.objective
