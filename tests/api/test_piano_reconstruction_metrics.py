"""Objective v2 is complete-interval, deterministic and degrades for the right reason."""
import numpy as np
import pytest

import scripts.piano_reconstruction_metrics as metrics

SR = 22050
SECONDS = 1.5


def burst(onset, frequency, duration=0.35, tau=0.12, amplitude=0.5, seconds=SECONDS):
    times = np.arange(int(seconds * SR)) / SR
    local = times - onset
    active = (local >= 0) & (local < duration)
    signal = np.zeros_like(times)
    signal[active] = amplitude * np.sin(2 * np.pi * frequency * local[active]) \
        * np.exp(-local[active] / tau)
    return signal


def reference():
    return burst(0.3, 440.0) + burst(0.9, 660.0, amplitude=0.35)


def test_identity_is_zero():
    source = reference()
    comparison = metrics.compare(source, source.copy(), SR)
    assert comparison.objective == pytest.approx(0.0, abs=1e-9)
    assert comparison.ranking == pytest.approx(0.0, abs=1e-9)
    assert comparison.gain_db == pytest.approx(0.0, abs=1e-9)
    assert comparison.complete is True
    assert set(comparison.components) == set(metrics.WEIGHTS)


def test_objective_is_the_declared_weighted_sum():
    source = reference()
    comparison = metrics.compare(source, np.roll(source, 300), SR)
    expected = sum(metrics.WEIGHTS[name] * value
                   for name, value in comparison.components.items())
    assert comparison.objective == pytest.approx(expected, abs=1e-12)
    assert all(0.0 <= value < 1.0 for value in comparison.components.values())
    assert comparison.ranking > 0.0
    assert all(value >= 0.0 for value in comparison.raw_components.values())


def test_heavily_shifted_onsets_degrade_attack_alignment():
    source = reference()
    shifted = np.zeros_like(source)
    offset = int(0.04 * SR)
    shifted[offset:] = source[:-offset]
    comparison = metrics.compare(source, shifted, SR)
    assert comparison.raw_components['attack'] > 0.3
    assert comparison.objective > metrics.compare(source, source.copy(), SR).objective + 0.02


def test_a_wrong_pitch_degrades_pitch_energy():
    source = reference()
    wrong = burst(0.3, 554.37) + burst(0.9, 660.0, amplitude=0.35)
    comparison = metrics.compare(source, wrong, SR)
    assert comparison.raw_components['pitch_energy'] > 0.1
    assert comparison.objective > metrics.compare(source, source.copy(), SR).objective


def test_an_octave_drop_is_visible_in_octave_evidence():
    source = reference()
    dropped = burst(0.3, 220.0) + burst(0.9, 660.0, amplitude=0.35)
    comparison = metrics.compare(source, dropped, SR)
    assert comparison.raw_components['octave_balance'] > 0.05


def test_a_missing_note_degrades_the_objective():
    source = reference()
    incomplete = burst(0.3, 440.0)
    comparison = metrics.compare(source, incomplete, SR)
    assert comparison.objective > 0.02
    assert comparison.raw_components['pitch_energy'] > 0.0


def test_global_gain_is_reported_and_calibrated():
    source = reference()
    quieter = source * 0.5
    normalized = metrics.compare(source, quieter, SR, gain_normalize=True)
    absolute = metrics.compare(source, quieter, SR, gain_normalize=False)
    assert normalized.gain_db == pytest.approx(-6.02, abs=0.05)
    assert normalized.objective == pytest.approx(0.0, abs=1e-6)
    assert absolute.objective > normalized.objective
    assert any('gain calibration' in warning for warning in normalized.warnings)


def test_declared_latency_is_removed_exactly():
    source = reference()
    offset = int(0.02 * SR)
    delayed = np.concatenate([np.zeros(offset), source])   # latency, tail preserved
    corrected = metrics.compare(source, delayed, SR, latency_samples=offset)
    assert corrected.objective == pytest.approx(0.0, abs=1e-9)


def test_a_short_candidate_cannot_score_a_perfect_prefix():
    """Review P0: truncating both signals to the shorter length hid missing audio."""
    times = np.arange(2 * SR) / SR
    source = (0.4 * np.sin(2 * np.pi * 440 * times)).astype(np.float32)
    prefix = source[:SR]
    with pytest.raises(metrics.IncompleteCandidate, match='missing'):
        metrics.compare(source, prefix, SR)

    partial = metrics.compare(source, prefix, SR, require_complete=False)
    assert partial.complete is False
    assert partial.padded_seconds == pytest.approx(1.0, abs=0.01)
    assert partial.objective > 0.0
    assert any('padded' in warning for warning in partial.warnings)


def test_a_short_candidate_is_penalised_by_the_silence_padding():
    times = np.arange(2 * SR) / SR
    source = (0.4 * np.sin(2 * np.pi * 440 * times)).astype(np.float32)
    full = metrics.compare(source, source.copy(), SR)
    partial = metrics.compare(source, source[:SR], SR, require_complete=False)
    assert partial.objective > full.objective + 0.01


def test_sound_beyond_the_interval_is_reported_separately():
    source = reference()
    extra = np.concatenate([source, 0.4 * np.random.default_rng(0).standard_normal(SR)])
    comparison = metrics.compare(source, extra, SR, interval=(0.0, SECONDS))
    assert comparison.complete is True
    assert comparison.extra_energy_db is not None
    assert any('beyond the scored interval' in warning for warning in comparison.warnings)


def test_an_interval_restricts_what_is_scored():
    source = reference()
    damaged = source.copy()
    damaged[int(1.2 * SR):] = 0.0          # damage outside the scored interval
    restricted = metrics.compare(source, damaged, SR, interval=(0.0, 1.0))
    whole = metrics.compare(source, damaged, SR)
    assert restricted.objective < whole.objective
    assert restricted.interval == (0.0, 1.0)
    assert restricted.duration_seconds == pytest.approx(1.0, abs=0.01)


def test_interval_bounds_are_validated():
    source = reference()
    with pytest.raises(metrics.MetricError, match='invalid comparison interval'):
        metrics.compare(source, source, SR, interval=(0.5, 0.5))
    with pytest.raises(metrics.MetricError, match='exceeds the reference duration'):
        metrics.compare(source, source, SR, interval=(0.0, 5.0))
    with pytest.raises(metrics.MetricError, match='latency'):
        metrics.compare(source, source, SR, latency_samples=-1)


def test_determinism():
    source = reference()
    candidate = np.roll(source, 128)
    first = metrics.compare(source, candidate, SR).to_dict()
    second = metrics.compare(source, candidate, SR).to_dict()
    assert first == second


def test_samples_are_rejected_when_too_short():
    with pytest.raises(metrics.MetricError, match='at least'):
        metrics.compare(np.zeros(100), np.zeros(100), SR)


def test_sample_rate_is_validated():
    source = reference()
    with pytest.raises(metrics.MetricError, match='sample_rate'):
        metrics.compare(source, source, 0)
    with pytest.raises(metrics.MetricError, match='sample_rate'):
        metrics.compare(source, source, 22050.0)


def test_stereo_is_mixed_and_labeled():
    source = reference()
    stereo = np.stack([source, source * 0.5], axis=1)
    comparison = metrics.compare(stereo, stereo.copy(), SR)
    assert comparison.objective == pytest.approx(0.0, abs=1e-9)
    assert any('stereo' in warning for warning in comparison.warnings)
    assert 'stereo width' in comparison.to_dict()['unsupported_features']


def test_improvement_reports_relative_gain():
    source = reference()
    clean = metrics.compare(source, source.copy(), SR)
    degraded = metrics.compare(source, np.roll(source, 900), SR)
    assert metrics.improvement(degraded, clean) > 0.0
    assert metrics.improvement(clean, degraded) < 0.0
    assert metrics.improvement(clean, clean) == 0.0
    with pytest.raises(metrics.MetricError):
        metrics.improvement(None, clean)


def test_report_pins_the_objective_identity():
    source = reference()
    payload = metrics.compare(source, source.copy(), SR).to_dict()
    assert payload['objective_version'] == metrics.OBJECTIVE_VERSION
    assert payload['weights'] == metrics.WEIGHTS
    assert payload['supported_features']
    assert payload['implementation_sha256'] == metrics.implementation_sha256()
    assert len(metrics.implementation_sha256()) == 64
    assert metrics.weights_sha256() == metrics.weights_sha256()


def test_fft_sizes_follow_the_sample_rate():
    low = metrics.fft_sizes(22050)
    high = metrics.fft_sizes(48000)
    assert low == tuple(sorted(low))
    assert high != low
    assert all(size >= 256 for size in low + high)


def test_silence_against_silence_is_zero():
    silent = np.zeros(int(SECONDS * SR))
    assert metrics.compare(silent, silent, SR).objective == 0.0
