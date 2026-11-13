"""Expression benchmark v2: target-based scoring over the expression report.

This is a diagnostic benchmark. Controlled audible endings are independent stem RMS
endings; dynamics are not converted to MIDI velocity without calibration. The old
benchmark results remain frozen for regression comparison.
"""
import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import mir_eval
import numpy as np
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.benchmark_piano_decoding import samples_from
from scripts.benchmark_piano_expression import (DECODING, RATE, THRESHOLDS, match,
                                                render, scenarios)
from scripts.music_basic_pitch_adapter import decode_predictions, note_events
from scripts.piano_corrections import decoder_sha256
from scripts.piano_expression_identity import estimator_sha256
from scripts.piano_expression import analyze
from scripts.piano_verifier import DEFAULT_SETTINGS


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _implementation(weights):
    return {
        'estimator_code_sha256': estimator_sha256(),
        'verifier_code_sha256': _sha(Path(__file__).with_name('piano_verifier.py')),
        'settings_sha256': hashlib.sha256(
            json.dumps(DEFAULT_SETTINGS, sort_keys=True,
                       separators=(',', ':')).encode()).hexdigest(),
        'weights_sha256': _sha(weights), 'model': 'basic-pitch',
        'model_version': '0.4.0',
        'decoder': DECODING['decoding_version'],
        'decoder_sha256': decoder_sha256({'sample_rate': RATE, 'preprocessing': 'mono-pcm-s16le',
            'thresholds': THRESHOLDS, 'decoding': DECODING},
            Path(__file__).with_name('music_basic_pitch_adapter.py')),
        'application_code_sha256': _sha(Path(__file__).resolve().parents[1] /
                                         'apps/api/music_verification.py'),
    }


def _source(variant):
    return {'correct_reference': 'clean_reference',
            'too_short_flat_velocity': 'corruption',
            'too_long_correct_velocity': 'corruption',
            'ai_decoder': 'natural_decoder'}[variant]


def trials_for(analysis, events, refs, variant, scenario, seed):
    rows = []
    matches = match(events, refs)
    matched_events = {event_index: ref_index for ref_index, event_index in matches}
    by_id = {str(candidate['event_id']): candidate for candidate in analysis['candidates']
             if candidate['attribute'] == 'audible_duration'}
    for event_index, note in enumerate(events):
        ref_index = matched_events.get(event_index)
        if ref_index is None:
            continue
        ref = refs[ref_index]
        expected = float(ref['onset']) + float(ref['duration'])
        baseline = float(note['onset']) + float(note['duration'] or 0.0)
        candidate = by_id.get(str(note['id']))
        suggested = bool(candidate and candidate.get('decision') == 'change')
        proposed = (float(note['onset']) + float(candidate['proposed'])
                    if suggested else baseline)
        scorable = ref.get('audible_end_scorable', True)
        rows.append({
            'trial_id': f'{scenario}-{seed}-{variant}-{note["id"]}',
            'performance_id': f'{scenario}-{seed}', 'piece_id': scenario,
            'instrument': 'piano', 'split': 'holdout', 'category': 'audible_duration',
            'source': _source(variant), 'target': 'audible_end_seconds',
            'tolerance': 0.08, 'reference_value': expected,
            'before': baseline, 'proposed': proposed, 'suggested': suggested,
            'scorable': scorable,
            'scope': candidate.get('scope', 'isolated') if candidate else 'isolated',
            'candidate_interval': candidate.get('candidate_interval') if candidate else None,
            'reason': candidate.get('reason') if candidate else 'no_candidate',
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seeds', type=int, default=3)
    parser.add_argument('--start-seed', type=int, default=0)
    parser.add_argument('--split', choices=('development', 'holdout'), default='development')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    samples, identities = samples_from(args.samples)
    report = {
        'schema_version': 2, 'evidence_kind': 'rendered',
        'scope': 'Diagnostic expression evidence; no automatic category is enabled.',
        'targets': {
            'audible_duration': {'units': 'seconds', 'target': 'audible_end',
                                 'tolerance': 0.08,
                                 'reference': 'independent stem RMS end above -40 dB'},
            'relative_dynamics': {'units': 'db', 'target': 'relative_attack_level',
                                  'application': 'none without calibrated velocity'},
        },
        'implementation': _implementation(args.weights),
        'weights_sha256': _sha(args.weights), 'samples': identities,
        'limits': {'events': 20000, 'analysis_events': 500},
        'expression_trials': [], 'cases': [],
    }
    for seed in range(args.start_seed, args.start_seed + args.seeds):
        for scenario, notes in scenarios(seed):
            audio, refs = render(notes, samples, scenario, seed)
            wav = args.output / f'{scenario}-{seed}.wav'
            sf.write(wav, audio, RATE, subtype='PCM_16')
            extracted, rate = sf.read(wav)
            raw = run_inference(wav, args.weights)
            _, decoded = decode_predictions(raw, THRESHOLDS, DECODING)
            variants = {
                'correct_reference': refs,
                'too_short_flat_velocity': [{**n, 'duration': .15, 'velocity': .5} for n in refs],
                'too_long_correct_velocity': [{**n, 'duration': min(2.2, 8 - n['onset'])}
                                              for n in refs],
                'ai_decoder': note_events(decoded, 8.0),
            }
            for variant, events in variants.items():
                expression = analyze(wav, events, 8.0, DEFAULT_SETTINGS, None,
                                     'diagnostic', analyze_dynamics=False,
                                     provenance={'audio_sha256': _sha(wav),
                                                 'model': 'basic-pitch',
                                                 'model_version': '0.4.0',
                                                 'decoder': DECODING['decoding_version'],
                                                 'weights_sha256': _sha(args.weights)})
                trials = trials_for(expression, events, refs, variant, scenario, seed)
                for trial in trials:
                    trial['split'] = args.split
                report['expression_trials'].extend(trials)
                report['cases'].append({'seed': seed, 'scenario': scenario,
                                        'variant': variant, 'audio_sha256': _sha(wav),
                                        'working_sha256': expression['working_sha256'],
                                        'coverage': expression['coverage'],
                                        'candidates': len(expression['candidates']),
                                        'abstentions': len(expression['abstentions'])})
            print(f'{scenario}-{seed}: {len(refs)} references', flush=True)
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'trials': len(report['expression_trials']),
                      'cases': len(report['cases'])}, indent=2))


if __name__ == '__main__':
    main()
