"""Offline tests of the existing expression estimators; never enables a policy.

Controlled targets are known audible stem endings and linear rendering gains, not
physical key releases or calibrated MIDI velocities. Human MIDI velocity and release
comparisons are reported separately, with that limitation explicit.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import mir_eval
import numpy as np
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.benchmark_piano_decoding import RATE, samples_from
from scripts.benchmark_piano_verification import THRESHOLDS, DECODING
from scripts.music_basic_pitch_adapter import decode_predictions, note_events
from scripts.piano_expression import estimate_duration, estimate_dynamics
from scripts.piano_verifier import DEFAULT_SETTINGS, analyze_audio


def scenarios(seed):
    rng = np.random.default_rng(seed)
    transpose = (seed % 3) * 3
    isolated = [(60 + transpose, .4 + i * 1.8, .55, v) for i, v in
                enumerate([.22, .4, .6, .78])]
    cases = {'isolated_same_pitch': isolated,
             'equal_gain_different_pitches': [(p, .4 + i * 1.8, .55, .5)
                                              for i, p in enumerate([48, 60, 72, 84])],
             'chords': [(p + transpose, .4 + i * 1.8, .65, v)
                        for i in range(4) for p, v in [(48, .65), (64, .25), (67, .4)]],
             'quiet_melody_over_bass': [(p + transpose, .4 + i * 1.8 + delta, dur, v)
                        for i in range(4) for p, delta, dur, v in
                        [(48, 0, 1.3, .75), (72, .08, .45, .2)]],
             'pedal_overlap': [(p + transpose, .4 + i * .6, 1.8, v)
                               for i, (p, v) in enumerate([(48, .6), (60, .35), (64, .5),
                                                          (67, .3), (72, .55)])],
             'repeated_same_pitch': [(60 + transpose, .4 + i * .3, .8, v)
                                     for i, v in enumerate([.3, .65, .4, .75, .3])],
             'quiet_recording': isolated,
             'noisy_recording': isolated}
    for name, notes in cases.items():
        yield name, [(p, t + float(rng.uniform(-.008, .008)), d, v)
                     for p, t, d, v in notes]


def render(notes, samples, name, seed):
    audio = np.zeros(RATE * 8)
    refs = []
    gain = .25 if name == 'quiet_recording' else .7
    for i, (pitch, onset, length, velocity) in enumerate(notes):
        key = min(samples, key=lambda x: abs(pitch - x))
        source = samples[key]
        ratio = 2 ** ((pitch - key) / 12)
        stem = np.interp(np.arange(0, len(source) - 1, ratio), np.arange(len(source)), source)
        stem = stem[:int(length * RATE)] * velocity * gain
        fade = min(len(stem), int(.04 * RATE))
        stem[-fade:] *= np.linspace(1, 0, fade)
        start = round(onset * RATE)
        audio[start:start + len(stem)] += stem
        # Independent target: last 10 ms RMS window above -40 dB of this
        # isolated stem's peak RMS. Does not use the estimator's harmonic SNR.
        window = max(1, int(.01 * RATE))
        energy = np.convolve(stem * stem, np.ones(window) / window, mode='valid')
        active = np.flatnonzero(energy >= max(float(energy.max()) * 1e-4, 1e-12))
        end = onset + (int(active[-1]) + window) / RATE
        next_strike = min([t for p, t, _d, _v in notes if p == pitch and t > onset + .01],
                          default=99)
        refs.append({'id': f'ref-{i}', 'pitch': pitch, 'onset': onset,
                     'duration': end - onset, 'velocity': velocity,
                     'audible_end_scorable': next_strike >= end})
    noise = .0015 if name == 'noisy_recording' else .00004
    audio += np.random.default_rng(seed + 400).normal(0, noise, len(audio))
    # Avoid clipping without changing relative gains.
    audio *= min(1.0, .9 / max(float(np.max(np.abs(audio))), .9))
    return audio, refs


def match(events, refs):
    if not events or not refs:
        return []
    intervals = lambda ns: np.array([[n['onset'], n['onset'] + n['duration']] for n in ns])
    pitches = lambda ns: mir_eval.util.midi_to_hz(np.array([n['pitch'] for n in ns]))
    return mir_eval.transcription.match_notes(intervals(refs), pitches(refs),
        intervals(events), pitches(events), onset_tolerance=.05, offset_ratio=None)


def evaluate(analysis, events, refs, label, scenario, seed):
    duration = {str(n['id']): estimate_duration(analysis, n, len(analysis.samples) / RATE, events)
                for n in events}
    dynamics = estimate_dynamics(analysis, events)
    rows = []
    for ref_index, event_index in match(events, refs):
        ref, note = refs[ref_index], events[event_index]
        for attribute, target, before, proposed, tolerance in [
            ('audible_duration', ref['onset'] + ref['duration'], note['onset'] + note['duration'],
             note['onset'] + duration[str(note['id'])] if duration[str(note['id'])] is not None else None, .08),
            ('relative_dynamics', ref['velocity'], note['velocity'],
             dynamics[str(note['id'])][0] if str(note['id']) in dynamics else None, 8 / 127)]:
            scorable = attribute != 'audible_duration' or ref.get('audible_end_scorable', True)
            after = before if proposed is None else proposed
            before_error, after_error = abs(before - target), abs(after - target)
            rows.append({'seed': seed, 'scenario': scenario, 'proposal': label,
                'event_id': note['id'], 'pitch': note['pitch'], 'attribute': attribute,
                'target': target, 'before': before, 'after': after, 'suggested': proposed is not None,
                'scorable': scorable, 'before_error': before_error, 'after_error': after_error,
                'improved': proposed is not None and after_error < before_error - .005,
                'worsened': proposed is not None and after_error > before_error + .005,
                'damaged_correct': before_error <= tolerance and after_error > tolerance})
    return rows


def summary(rows):
    result = {}
    for attribute in ('audible_duration', 'relative_dynamics'):
        selected = [r for r in rows if r['attribute'] == attribute and r['scorable']]
        if not selected:
            continue
        edits = [r for r in selected if r['suggested']]
        result[attribute] = {'matched_scorable_notes': len(selected), 'suggestions': len(edits),
            'improved': sum(r['improved'] for r in edits),
            'worsened': sum(r['worsened'] for r in edits),
            'damaged_correct': sum(r['damaged_correct'] for r in edits),
            'mae_before': float(np.mean([r['before_error'] for r in selected])),
            'mae_after': float(np.mean([r['after_error'] for r in selected])),
            'unscorable_suggestions': sum(r['suggested'] for r in rows
                if r['attribute'] == attribute and not r['scorable'])}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seeds', type=int, default=3)
    parser.add_argument('--human-results', type=Path)
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error('--seeds must be positive')
    args.output.mkdir(parents=True, exist_ok=True)
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    samples, identities = samples_from(args.samples)
    report = {'scope': 'Diagnostic only. No qualification or policy changes.',
        'controlled_targets': {'duration': 'Isolated stem end above -40 dB RMS, 10 ms window; seconds.',
            'dynamics': 'Known linear render gain, 0–1; not calibrated MIDI velocity.'},
        'code_sha256': sha(Path(__file__).with_name('piano_expression.py')),
        'verifier_code_sha256': sha(Path(__file__).with_name('piano_verifier.py')),
        'benchmark_code_sha256': sha(Path(__file__)),
        'settings': DEFAULT_SETTINGS, 'thresholds': THRESHOLDS, 'decoding': DECODING,
        'weights_sha256': sha(args.weights), 'samples': identities, 'trials': [], 'cases': []}
    for seed in range(args.seeds):
        for name, notes in scenarios(seed):
            audio, refs = render(notes, samples, name, seed)
            stem = args.output / f'{name}-{seed}'
            wav = stem.with_suffix('.wav')
            sf.write(wav, audio, RATE, subtype='PCM_16')
            extracted, rate = sf.read(wav)
            analysis = analyze_audio(extracted, rate, DEFAULT_SETTINGS)
            raw_path = stem.with_suffix('.npz')
            receipt = stem.with_suffix('.sha256')
            key = hashlib.sha256(wav.read_bytes() + report['weights_sha256'].encode()).hexdigest()
            if raw_path.exists() and receipt.exists() and receipt.read_text() == key:
                raw = dict(np.load(raw_path, allow_pickle=False))
            else:
                raw = run_inference(wav, args.weights)
                np.savez_compressed(raw_path, **raw)
                receipt.write_text(key)
            _, decoded = decode_predictions(raw, THRESHOLDS, DECODING)
            variants = {'correct_reference': refs,
                'too_short_flat_velocity': [{**n, 'duration': .15, 'velocity': .5} for n in refs],
                'too_long_correct_velocity': [{**n, 'duration': min(2.2, 8 - n['onset'])} for n in refs],
                'ai_decoder': note_events(decoded, 8.0)}
            for label, events in variants.items():
                report['trials'].extend(evaluate(analysis, events, refs, label, name, seed))
            report['cases'].append({'seed': seed, 'scenario': name, 'reference': refs,
                                     'ai_events': variants['ai_decoder'], 'audio_sha256': sha(wav)})
            print(f'{name}-{seed}: {len(refs)} reference, {len(variants["ai_decoder"])} AI notes', flush=True)
    report['summary'] = {label: summary([r for r in report['trials'] if r['proposal'] == label])
                         for label in variants}
    report['by_scenario'] = {name: {label: summary([r for r in report['trials']
                                if r['scenario'] == name and r['proposal'] == label])
                            for label in variants} for name, _notes in scenarios(0)}
    if args.human_results:
        human = []
        for path in sorted(args.human_results.glob('*-notes.json')):
            payload = json.loads(path.read_text())
            audio, rate = sf.read(args.human_results / path.name.replace('-notes.json', '.wav'))
            assert rate == RATE
            analysis = analyze_audio(audio, rate, DEFAULT_SETTINGS)
            refs = payload['reference']
            # These are key releases, not annotated audible endings.
            human.extend(evaluate(analysis, payload['decoder'], refs, 'ai_decoder', path.stem, 0))
        human_summary = summary(human)
        human_summary['key_release_diagnostic'] = human_summary.pop('audible_duration')
        human_summary['normalized_midi_velocity_diagnostic'] = human_summary.pop('relative_dynamics')
        report['human_comparison'] = {'scope': 'MIDI key release and normalized strike velocity diagnostics only; '
            'neither establishes audible end or calibrated audio-to-MIDI velocity accuracy.',
            'summary': human_summary, 'trials': human}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2), flush=True)
    if 'human_comparison' in report:
        print(json.dumps(report['human_comparison']['summary'], indent=2), flush=True)


if __name__ == '__main__':
    main()
