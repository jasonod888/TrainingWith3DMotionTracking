"""Reproducible Basic Pitch comparison using locally supplied recorded piano samples.

Run in the music environment. Samples named C4.mp3, Ds4.mp3, Fs4.mp3, A4.mp3,
etc. are required; audio is not downloaded or redistributed. This renders known
performances, not human performances. Pedal is approximated by overlapping tails;
offset/key-release accuracy cannot be established from these mixtures.
"""
import argparse
import hashlib
import json
from pathlib import Path

import mir_eval
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from basic_pitch.inference import run_inference
try:
    from .music_basic_pitch_adapter import decode_predictions, DEFAULT_DECODING, PIANO_DECODING
except ImportError:
    from music_basic_pitch_adapter import decode_predictions, DEFAULT_DECODING, PIANO_DECODING

RATE = 22050
PIANO_THRESHOLDS = {'onset_threshold': .6, 'frame_threshold': .3,
    'minimum_note_length': 80., 'onset_prominence': .2, 'minimum_attack_spacing_ms': 70.}
BASELINE_THRESHOLDS = {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7}


def samples_from(folder):
    samples, identities = {}, []
    for path in sorted(folder.glob('*.mp3')):
        name = path.stem
        if name[:-1] not in ('C', 'Ds', 'Fs', 'A') or not name[-1:].isdigit():
            continue
        pitch = (int(name[-1]) + 1) * 12 + {'C': 0, 'Ds': 3, 'Fs': 6, 'A': 9}[name[:-1]]
        audio, rate = sf.read(path)
        if audio.ndim == 2: audio = audio.mean(axis=1)
        audio = resample_poly(audio, RATE, rate)
        samples[pitch] = audio / (max(abs(audio)) + .00001) * .65
        identities.append({'filename': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    if len(samples) < 8: raise ValueError('Supply at least eight recorded piano samples covering several octaves.')
    return samples, identities


def render(seed, samples):
    rng = np.random.default_rng(seed)
    notes, pedal = [], seed % 3 != 0
    root = int(rng.integers(45, 57)); scale = [0, 2, 4, 5, 7, 9, 11]
    for beat in range(12):
        onset = .35 + beat * .40 + float(rng.uniform(-.018, .018))
        notes.append(dict(onset=onset, pitch=root + [0, 7, 12, 7][beat % 4],
            duration=.24, velocity=float(rng.uniform(.30, .65))))
        if beat % 2 == 0:
            notes.append(dict(onset=onset, pitch=root + 12 + scale[(beat // 2) % 7], duration=.65, velocity=.3))
        top = root + 24 + scale[(beat // 2 + seed) % 7]
        notes.append(dict(onset=onset + .035, pitch=top, duration=float(rng.uniform(.14, .30)),
            velocity=float(rng.uniform(.17, .65))))
        if beat % 3 == 0:
            notes.append(dict(onset=onset + .22, pitch=top, duration=.13, velocity=.35))
    for index in range(5):
        notes.append(dict(onset=5.5 + index * .25, pitch=root + 7, duration=.13, velocity=.6 - index * .07))
    audio = np.zeros(RATE * 8)
    for note in notes:
        key = min(samples, key=lambda pitch: abs(pitch - note['pitch']))
        source = samples[key]; ratio = 2 ** ((note['pitch'] - key) / 12)
        tone = np.interp(np.arange(0, len(source) - 1, ratio), np.arange(len(source)), source) * note['velocity']
        ring = min(len(tone) / RATE, 2.2 if pedal else note['duration'] + .10)
        tone = tone[:int(ring * RATE)]
        release = min(len(tone), max(1, int((.35 if pedal else .08) * RATE)))
        tone[-release:] *= np.linspace(1, 0, release)
        start = round(note['onset'] * RATE); end = min(len(audio), start + len(tone))
        audio[start:end] += tone[:end - start]
    audio += rng.normal(0, .00008, len(audio))
    audio *= .9 / max(.9, max(abs(audio)))
    return audio, notes, pedal


def measure(reference, notes):
    ref_intervals = np.array([[n['onset'], n['onset'] + n['duration']] for n in reference])
    ref_hz = mir_eval.util.midi_to_hz(np.array([n['pitch'] for n in reference]))
    intervals = np.array([[float(n[0]), float(n[1])] for n in notes]).reshape(-1, 2)
    hz = mir_eval.util.midi_to_hz(np.array([n[2] for n in notes]))
    matches = mir_eval.transcription.match_notes(ref_intervals, ref_hz, intervals, hz,
        onset_tolerance=.05, offset_ratio=None)
    errors = [abs(reference[i]['onset'] - notes[j][0]) for i, j in matches]
    return {'matched': len(matches), 'extra': len(notes) - len(matches),
        'missing': len(reference) - len(matches), 'onset_error_sum': float(sum(errors))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.local/piano-benchmark'))
    parser.add_argument('--cases', type=int, default=36)
    args = parser.parse_args()
    samples, identities = samples_from(args.samples)
    args.output.mkdir(parents=True, exist_ok=True)
    settings = {
        'baseline': (BASELINE_THRESHOLDS, DEFAULT_DECODING),
        'piano_peaks': (PIANO_THRESHOLDS, {**DEFAULT_DECODING, 'decoding_version': PIANO_DECODING, 'infer_onsets': False}),
        'lower_threshold': ({**BASELINE_THRESHOLDS, 'onset_threshold': .35}, DEFAULT_DECODING),
        'inferred_off': (BASELINE_THRESHOLDS, {**DEFAULT_DECODING, 'infer_onsets': False}),
    }
    # First 12 cases used for selection; next 12 for diagnostics; final seeds have
    # not been used during selection. All share the sample bank: do not claim
    # generalization to human performances or other pianos.
    report = {'benchmark_version': 1, 'sample_identities': identities,
        'weights_sha256': hashlib.sha256(args.weights.read_bytes()).hexdigest(),
        'scope': 'Sample-rendered known notes, overlapping tails; not human-performed ground truth.',
        'settings': {name: {'thresholds': t, 'decoding': d} for name, (t, d) in settings.items()}, 'cases': []}
    for index in range(args.cases):
        seed = 100 + index if index < 24 else 1000 + index
        audio, reference, pedal = render(seed, samples)
        stem = args.output / f'case-{seed}'
        wav = stem.with_suffix('.wav'); raw_path = stem.with_suffix('.npz')
        sf.write(wav, audio, RATE, subtype='PCM_16')
        cache_key = hashlib.sha256(wav.read_bytes() + report['weights_sha256'].encode()).hexdigest()
        receipt = stem.with_suffix('.sha256')
        if not raw_path.exists() or not receipt.exists() or receipt.read_text() != cache_key:
            raw = run_inference(wav, args.weights)
            np.savez_compressed(raw_path, **raw); receipt.write_text(cache_key)
        else: raw = dict(np.load(raw_path, allow_pickle=False))
        case = {'seed': seed, 'split': 'selection' if index < 12 else 'diagnostic' if index < 24 else 'holdout',
            'overlapping_tails': pedal, 'reference': reference, 'metrics': {}}
        for name, (thresholds, decoding) in settings.items():
            _, notes = decode_predictions(raw, thresholds, decoding)
            case['metrics'][name] = measure(reference, notes)
        report['cases'].append(case)
    report['summary'] = {}
    for split in ('selection', 'diagnostic', 'holdout'):
        report['summary'][split] = {}
        for name in settings:
            totals = {key: sum(c['metrics'][name][key] for c in report['cases'] if c['split'] == split)
                for key in ('matched', 'extra', 'missing', 'onset_error_sum')}
            tp, fp, fn = (totals[k] for k in ('matched', 'extra', 'missing'))
            totals.update(precision=tp / max(1, tp + fp), recall=tp / max(1, tp + fn),
                f1=2 * tp / max(1, 2 * tp + fp + fn), onset_mae_ms=1000 * totals['onset_error_sum'] / max(1, tp))
            report['summary'][split][name] = totals
    (args.output / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__': main()
