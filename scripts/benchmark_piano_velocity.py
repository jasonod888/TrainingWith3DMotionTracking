"""Public captured-MIDI velocity evaluation with separate fitting/calibration/holdout.

The SMD data and fitted research calibration are retained locally, not shipped as a
general piano calibration. No automatic policy is enabled by this program.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pretty_midi
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import piano_verifier as verifier
from scripts.benchmark_piano_expression import match
from scripts.benchmark_piano_verification import DECODING, THRESHOLDS
from scripts.music_basic_pitch_adapter import decode_predictions, note_events
from scripts.piano_expression_evidence import attribute
from scripts.piano_expression_identity import estimator_sha256, measurement_sha256
from scripts.piano_velocity_calibration import fit, predict, digest
from scripts.benchmark_piano_expression_v2 import _implementation

DOMAIN = 'smd-v2-disklavier-dcfiiism4pro-original-wav22'
INSPECTED = {'Chopin_Op028-01_003_20100611-SMD', 'Chopin_Op028-11_003_20100611-SMD'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-notes', type=int, default=100)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    identity = estimator_sha256()
    feature_identity = measurement_sha256(digest(verifier.DEFAULT_SETTINGS))
    paths = [p for p in sorted(args.pairs.glob('*.wav')) if p.with_suffix('.mid').exists()]
    if len(paths) < 10:
        parser.error('At least ten distinct paired performances are required.')
    all_rows = []
    for index, path in enumerate(paths):
        split = 'training' if index < 6 else 'calibration' if index < 8 else (
            'diagnostic' if path.stem in INSPECTED else 'holdout')
        key = digest({'audio': sha(path), 'measurement': feature_identity, 'weights': sha(args.weights),
                      'thresholds': THRESHOLDS, 'decoding': DECODING, 'max_notes': args.max_notes,
                      'midi': sha(path.with_suffix('.mid')), 'split': split})
        observation_path = args.output / (path.stem + '.json')
        cached = json.loads(observation_path.read_text()) if observation_path.exists() else {}
        if cached.get('key') == key:
            all_rows.extend(cached['rows'])
            print(path.stem, 'cached', flush=True)
            continue
        samples, rate = sf.read(path)
        if rate != 22050 or samples.ndim != 1:
            raise ValueError('Use original 22,050 Hz mono SMD excerpts.')
        duration = len(samples) / rate
        raw_path = args.output / (path.stem + '.npz')
        raw_key = digest({'audio': sha(path), 'weights': sha(args.weights)})
        receipt = raw_path.with_suffix('.sha256')
        if raw_path.exists() and receipt.exists() and receipt.read_text() == raw_key:
            raw = dict(np.load(raw_path, allow_pickle=False))
        else:
            raw = run_inference(path, args.weights)
            np.savez_compressed(raw_path, **raw); receipt.write_text(raw_key)
        _, decoded = decode_predictions(raw, THRESHOLDS, DECODING)
        events = note_events(decoded, duration)
        midi = pretty_midi.PrettyMIDI(str(path.with_suffix('.mid')))
        reference = [{'onset': n.start, 'duration': min(n.end, duration) - n.start,
                      'pitch': n.pitch, 'velocity': n.velocity}
                     for inst in midi.instruments if not inst.is_drum for n in inst.notes
                     if 0 <= n.start < duration and n.end > n.start]
        analysis = verifier.analyze_audio(samples, rate, verifier.DEFAULT_SETTINGS)
        pairs = match(events, reference)
        selected = np.linspace(0, max(0, len(pairs) - 1), min(args.max_notes, len(pairs)), dtype=int)
        rows = []
        for position in selected:
            ref_index, event_index = pairs[position]
            note, ref = events[event_index], reference[ref_index]
            evidence = attribute(analysis, note, events, verifier.DEFAULT_SETTINGS, verifier, purpose='attack')
            usable = evidence['usable'] and evidence.get('residual', 1.) <= .4 \
                and not evidence.get('harmonic_conflict')
            rows.append({'performance_id': path.stem, 'piece_id': path.stem.rsplit('_', 2)[0],
                         'split': split, 'pitch': note['pitch'], 'event_id': note['id'],
                         'velocity': ref['velocity'], 'baseline': note['velocity'],
                         'attack_level_db': evidence.get('attack_level_db'), 'usable': bool(usable),
                         'scope': evidence.get('scope', 'polyphonic'),
                         'audio_sha256': sha(path), 'reference_sha256': sha(path.with_suffix('.mid'))})
        observation_path.write_text(json.dumps({'key': key, 'rows': rows}, indent=2))
        all_rows.extend(rows)
        print(path.stem, split, len(rows), 'measured', sum(r['usable'] for r in rows), 'usable', flush=True)
    fitting = [r for r in all_rows if r['split'] in ('training', 'calibration') and r['usable']]
    calibration = fit(fitting, DOMAIN, feature_identity)
    (args.output / 'calibration.json').write_text(json.dumps(calibration, indent=2))
    evaluated = []
    for row in all_rows:
        if row['split'] not in ('holdout', 'diagnostic'):
            continue
        prediction, reason = predict(calibration, row['pitch'], row['attack_level_db'], DOMAIN, feature_identity) \
            if row['usable'] else (None, 'attribution_uncertain')
        after = row['baseline']
        suggested = False
        if prediction and not prediction['interval'][0] <= after <= prediction['interval'][1] \
                and abs(prediction['velocity'] - after) >= 8 / 127:
            after = prediction['velocity']; suggested = True
        target = row['velocity'] / 127
        evaluated.append({**row, 'proposed': after, 'suggested': suggested, 'reason': reason,
                          'prediction': prediction, 'before_error': abs(row['baseline'] - target),
                          'after_error': abs(after - target)})
    held = [r for r in evaluated if r['split'] == 'holdout']
    edits = [r for r in held if r['suggested']]
    implementation = _implementation(args.weights)
    implementation['calibration_sha256'] = digest(calibration)
    expression_trials = [{
        'trial_id': f"{r['performance_id']}:{r['event_id']}:velocity", 'performance_id': r['performance_id'],
        'piece_id': r['piece_id'], 'instrument': 'piano',
        'split': 'holdout' if r['split'] == 'holdout' else 'development',
        'category': 'relative_dynamics', 'source': 'natural_decoder', 'target': 'reference_velocity',
        'tolerance': 8 / 127, 'reference_value': r['velocity'] / 127,
        'before': r['baseline'], 'proposed': r['proposed'], 'suggested': r['suggested'],
        'scorable': True, 'scope': r['scope'], 'calibration_id': calibration['calibration_id']}
        for r in evaluated]
    result = {'scope': 'Public SMD research evaluation only; no policy enabled.',
        'evidence_kind': 'human', 'implementation': implementation,
        'calibration': calibration, 'expression_trials': expression_trials,
        'domain': DOMAIN, 'measurement_sha256': feature_identity, 'calibration_id': calibration['calibration_id'],
        'summary': {'holdout_performances': len({r['performance_id'] for r in held}),
            'matched_notes_sampled': len(held), 'suggestions': len(edits),
            'improved': sum(r['after_error'] < r['before_error'] - 1 / 127 for r in edits),
            'worsened': sum(r['after_error'] > r['before_error'] + 1 / 127 for r in edits),
            'damaged_correct': sum(r['before_error'] <= 8 / 127 and r['after_error'] > 8 / 127 for r in edits),
            'mae_before_midi_units': 127 * float(np.mean([r['before_error'] for r in held])),
            'mae_after_midi_units': 127 * float(np.mean([r['after_error'] for r in held]))},
        'trials': evaluated}
    (args.output / 'report.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result['summary'], indent=2), flush=True)


if __name__ == '__main__': main()
