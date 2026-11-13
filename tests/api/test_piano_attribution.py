"""Attribution and independently calibrated velocity, without production approval."""
import copy
import math
from pathlib import Path

import numpy as np
import pytest

from scripts import piano_verifier as verifier
from scripts.piano_expression_evidence import attribute, ending
from scripts.piano_velocity_calibration import fit, predict, digest


def calibration_rows():
    return [{'performance_id': name, 'split': split, 'pitch': pitch, 'velocity': velocity,
             'attack_level_db': -95 + pitch * .1 + 8 * math.log2(velocity)}
            for name, split in [('train-a', 'training'), ('train-b', 'training'),
                                ('uncertainty', 'calibration')]
            for pitch in [48, 60, 72] for velocity in [24, 36, 48, 60, 72, 84, 96, 108]]


def test_velocity_prediction_is_independent_of_baseline_and_domain_bound():
    artifact = fit(calibration_rows(), 'known-piano-and-gain', 'a' * 64)
    result, reason = predict(artifact, 60, -95 + 6 + 8 * math.log2(72),
                             'known-piano-and-gain', 'a' * 64)
    assert reason is None and abs(result['velocity'] * 127 - 72) < 1
    assert predict(artifact, 60, -30, 'another-piano', 'a' * 64)[0] is None
    assert predict(artifact, 61, -30, 'known-piano-and-gain', 'a' * 64)[0] is None
    broken = copy.deepcopy(artifact); broken['slope_db_per_octave'] += 1
    assert predict(broken, 60, -30, 'known-piano-and-gain', 'a' * 64)[0] is None


def test_calibration_rejects_training_holdout_leakage():
    rows = calibration_rows()
    rows[-1]['split'] = 'holdout'
    with pytest.raises(ValueError, match='qualification/holdout'):
        fit(rows, 'domain', 'a' * 64)
    rows = calibration_rows(); rows[-1]['performance_id'] = 'train-a'
    with pytest.raises(ValueError, match='leaked'):
        fit(rows, 'domain', 'a' * 64)


def test_attribution_does_not_trust_draft_offsets_or_velocities():
    rate = 22050
    t = np.arange(rate * 3) / rate
    audio = np.zeros(len(t))
    for pitch, onset, end in [(60, .3, 1.), (67, .6, 1.4)]:
        f = 440 * 2 ** ((pitch - 69) / 12)
        active = (t >= onset) & (t < end)
        for harmonic in range(1, 12):
            audio += active * .04 / harmonic * np.sin(2 * np.pi * f * harmonic * (t - onset))
    analysis = verifier.analyze_audio(audio, rate, verifier.DEFAULT_SETTINGS)
    notes = [{'id': 'a', 'onset': .3, 'duration': .1, 'pitch': 60, 'velocity': .2},
             {'id': 'b', 'onset': .6, 'duration': .1, 'pitch': 67, 'velocity': .9}]
    first = attribute(analysis, notes[0], notes, verifier.DEFAULT_SETTINGS, verifier)
    changed = [{**n, 'duration': 2., 'velocity': 1 - n['velocity']} for n in notes]
    second = attribute(analysis, changed[0], changed, verifier.DEFAULT_SETTINGS, verifier)
    np.testing.assert_array_equal(first['envelope'], second['envelope'])


def test_ending_abstains_when_independent_views_disagree():
    times = np.arange(0, 2, .01)
    envelope = (times < 1.).astype(float)
    evidence = {'usable': True, 'times': times, 'envelope': envelope, 'peak': 1.,
                'noise': .0001, 'residual': .1, 'coherence': .1, 'harmonic_conflict': False,
                'groups': [{'envelope': (times < cutoff).astype(float), 'peak': 1., 'noise': .0001}
                           for cutoff in (.7, 1.3)]}
    assert ending(evidence, .2) is None


def test_noninteger_audio_resampling_is_bounded(tmp_path):
    import wave
    path = tmp_path / '48k.wav'
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(48000)
        stream.writeframes(np.zeros(4800, dtype='<i2').tobytes())
    samples, rate = verifier.load_audio(path)
    assert rate == 22050 and len(samples) == 2205
