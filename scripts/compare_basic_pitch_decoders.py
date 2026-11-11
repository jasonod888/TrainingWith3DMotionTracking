"""Decode retained Basic Pitch activations with controlled settings and score them.

Pitch/onset matching is one-to-one at a fixed 80 ms tolerance. Offset and duration
errors are reported separately: a long note is not a missing/extra note merely because
sustain extends its release. The synthetic fixtures are aligned MIDI+audio, not human
performances.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP
from basic_pitch.inference import run_inference
from basic_pitch.note_creation import model_output_to_notes

CONFIGS = {
    'current': {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7,
                'infer_onsets': True, 'melodia_trick': False, 'include_pitch_bends': False},
    'onset_0.35': {'onset_threshold': .35, 'frame_threshold': .3, 'minimum_note_length': 127.7,
                   'infer_onsets': True, 'melodia_trick': False, 'include_pitch_bends': False},
    'frame_0.40': {'onset_threshold': .5, 'frame_threshold': .4, 'minimum_note_length': 127.7,
                   'infer_onsets': True, 'melodia_trick': False, 'include_pitch_bends': False},
    'melodia_on': {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7,
                   'infer_onsets': True, 'melodia_trick': True, 'include_pitch_bends': False},
    'infer_onsets_off': {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7,
                         'infer_onsets': False, 'melodia_trick': False, 'include_pitch_bends': False},
    'pitch_bends_on': {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7,
                       'infer_onsets': True, 'melodia_trick': False, 'include_pitch_bends': True},
}
TOLERANCE = .08


def decode(model_output, config):
    min_note_len = int(np.round(config['minimum_note_length'] / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP)))
    _, notes = model_output_to_notes(
        model_output, onset_thresh=config['onset_threshold'], frame_thresh=config['frame_threshold'],
        infer_onsets=config['infer_onsets'], min_note_len=min_note_len,
        include_pitch_bends=config['include_pitch_bends'],
        multiple_pitch_bends=False, melodia_trick=config['melodia_trick'], midi_tempo=120)
    return [{'onset': float(note[0]), 'end': float(note[1]), 'pitch': int(note[2]), 'velocity': float(note[3])}
            for note in notes if math.isfinite(float(note[0])) and math.isfinite(float(note[1]))]


def score(reference, predicted):
    refs = sorted(reference, key=lambda note: (note['onset'], note['pitch']))
    used = set()
    matched = []
    matched_refs = set()
    for ref_index,note in enumerate(refs):
        candidates = [(index, item) for index, item in enumerate(predicted)
                      if index not in used and item['pitch'] == note['pitch']
                      and abs(item['onset'] - note['onset']) <= TOLERANCE]
        if not candidates:
            continue
        index, item = min(candidates, key=lambda pair: abs(pair[1]['onset'] - note['onset']))
        used.add(index)
        predicted_duration = max(0, item['end'] - item['onset'])
        matched_refs.add(ref_index)
        matched.append({'pitch': note['pitch'], 'ref_index': ref_index, 'ref_velocity': note.get('velocity'),
                        'pred_velocity': item.get('velocity'), 'onset_error': item['onset'] - note['onset'],
                        'offset_error': item['end'] - (note['onset'] + note['duration']),
                        'duration_error': predicted_duration - note['duration']})
    missing = len(reference) - len(matched)
    extra = len(predicted) - len(used)
    errors = [abs(item['onset_error']) for item in matched]
    offsets = [abs(item['offset_error']) for item in matched]
    durations = [abs(item['duration_error']) for item in matched]
    velocity_pairs = [(float(item['ref_velocity']), float(item['pred_velocity'])) for item in matched
                      if item.get('ref_velocity') is not None and item.get('pred_velocity') is not None]
    velocity_mae = round(sum(abs(a-b) for a,b in velocity_pairs)/len(velocity_pairs), 4) if velocity_pairs else None
    velocity_corr = None
    if len(velocity_pairs) > 1 and len({a for a,_ in velocity_pairs}) > 1 and len({b for _,b in velocity_pairs}) > 1:
        velocity_corr = round(float(np.corrcoef([a for a,_ in velocity_pairs],[b for _,b in velocity_pairs])[0,1]), 3)
    soft = [(a,b) for a,b in velocity_pairs if a < .34]
    loud = [(a,b) for a,b in velocity_pairs if a >= .6]
    def mae(values): return round(sum(abs(a-b) for a,b in values)/len(values), 4) if values else None
    repeated = sum(1 for before, after in zip(refs, refs[1:]) if before['pitch'] == after['pitch'])
    repeated_hits = sum(1 for index, (before, after) in enumerate(zip(refs, refs[1:]))
                        if before['pitch'] == after['pitch'] and index in matched_refs and index + 1 in matched_refs)
    return {'reference': len(reference), 'detected': len(predicted), 'matched': len(matched),
            'velocity_mae': velocity_mae, 'velocity_correlation': velocity_corr,
            'soft_velocity_mae': mae(soft), 'loud_velocity_mae': mae(loud),
            'missing': missing, 'extra': extra,
            'onset_mae_ms': round(1000 * sum(errors) / len(errors), 2) if errors else None,
            'offset_mae_ms': round(1000 * sum(offsets) / len(offsets), 2) if offsets else None,
            'duration_mae_ms': round(1000 * sum(durations) / len(durations), 2) if durations else None,
            'repeated_reference_pairs': repeated, 'repeated_pairs_recovered': repeated_hits}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--references', default='music-candidate-run/reference-set/references.json')
    parser.add_argument('--weights', default='music-candidate-run/basic-pitch-0.4.0/model.onnx')
    parser.add_argument('--output', default='docs/qualification/basic-pitch-decoder-comparison.json')
    parser.add_argument('--markdown', default='docs/qualification/basic-pitch-decoder-comparison.md')
    args = parser.parse_args()
    root = Path(args.references).parent
    references = json.loads(Path(args.references).read_text(encoding='utf-8'))
    raw = {}
    for ref in references:
        audio = root / ref['audio']
        raw[ref['name']] = (run_inference(audio, args.weights), hashlib.sha256(audio.read_bytes()).hexdigest())
    report = {'fixtures': {}, 'configs': {}, 'tolerance_ms': TOLERANCE * 1000,
              'note': 'Synthetic aligned MIDI+audio fixtures; not human performances.'}
    for name, config in CONFIGS.items():
        aggregate = {'reference': 0, 'detected': 0, 'matched': 0, 'missing': 0, 'extra': 0,
                     'onset_mae_ms': [], 'offset_mae_ms': [], 'duration_mae_ms': [], 'velocity_mae': [], 'soft_velocity_mae': [], 'loud_velocity_mae': [],
                     'repeated_reference_pairs': 0, 'repeated_pairs_recovered': 0}
        for ref in references:
            model_output, _ = raw[ref['name']]
            predicted = decode(model_output, config)
            score_value = score(ref['notes'], predicted)
            report['fixtures'].setdefault(ref['name'], {'notes': ref['notes'], 'category': ref['name']})[name] = {
                **score_value, 'detections': predicted}
            for key in ('reference', 'detected', 'matched', 'missing', 'extra', 'repeated_reference_pairs',
                        'repeated_pairs_recovered'):
                aggregate[key] += score_value[key]
            for key in ('onset_mae_ms', 'offset_mae_ms', 'duration_mae_ms', 'velocity_mae', 'soft_velocity_mae', 'loud_velocity_mae'):
                if score_value[key] is not None:
                    aggregate[key].append(score_value[key])
        for key in ('onset_mae_ms', 'offset_mae_ms', 'duration_mae_ms', 'velocity_mae', 'soft_velocity_mae', 'loud_velocity_mae'):
            values = aggregate[key]
            aggregate[key] = round(float(np.mean(values)), 2) if values else None
        aggregate['config'] = config
        report['configs'][name] = aggregate
        print(name, aggregate)
    report['bends_events_equal'] = all(
        report['fixtures'][fixture]['pitch_bends_on']['detections'] ==
        report['fixtures'][fixture]['current']['detections']
        for fixture in report['fixtures'])
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    rows = ['| Configuration | Ref | Detected | Matched | Missing | Extra | Onset MAE | Offset MAE | Duration MAE | Velocity MAE | Soft MAE | Loud MAE |',
            '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for name, value in report['configs'].items():
        rows.append(f"| {name} | {value['reference']} | {value['detected']} | {value['matched']} | "
                    f"{value['missing']} | {value['extra']} | {value['onset_mae_ms']} ms | "
                    f"{value['offset_mae_ms']} ms | {value['duration_mae_ms']} ms | "
                    f"{value['velocity_mae']} | {value['soft_velocity_mae']} | {value['loud_velocity_mae']} |")
    Path(args.markdown).write_text(
        '# Basic Pitch decoder comparison\n\n'
        'Synthetic aligned MIDI+audio fixtures, not human performances. Matching is '
        f'one-to-one by exact pitch within {TOLERANCE*1000:.0f} ms; offset/duration are reported separately.\n\n'
        + '\n'.join(rows) +
        f"\n\nVelocity MAE is separate from pitch/timing; soft <0.34 and loud >=0.60 groups.\n"
        f"Pitch-bend configuration leaves the extracted pitch/onset events identical: "
        f"**{report['bends_events_equal']}**.\n", encoding='utf-8')
    print('wrote', args.output)


if __name__ == '__main__':
    main()
