"""Score human audible-ending intervals without substituting MIDI key releases.

Input annotation format is validated before matching. Unscorable notes are retained
in coverage but cannot qualify any correction. No production policy is enabled.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.validate_expression_reference import validate_document
from scripts.benchmark_piano_expression import match
from scripts.benchmark_piano_expression_v2 import _implementation
from scripts.benchmark_piano_verification import DECODING, THRESHOLDS
from scripts.music_basic_pitch_adapter import decode_predictions, note_events
from scripts.piano_expression import analyze
from scripts.piano_verifier import DEFAULT_SETTINGS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'evidence_kind': 'human', 'implementation': _implementation(args.weights),
              'scope': 'Reference scoring only; not a qualification policy.',
              'expression_trials': [], 'performances': []}
    seen = {}
    for path in sorted(args.references.glob('*.json')):
        reference = validate_document(json.loads(path.read_text()))
        identifier = reference['performance_id']
        if identifier in seen:
            raise ValueError('Duplicate performance or development/holdout leakage in reference set.')
        seen[identifier] = reference['split']
        wav = args.audio / (path.stem + '.wav')
        audio_sha = hashlib.sha256(wav.read_bytes()).hexdigest()
        expected_sha = reference.get('analysis_wav_sha256', reference['audio_sha256'])
        if audio_sha != expected_sha:
            raise ValueError('Reference audio identity does not match the actual analysis WAV.')
        samples, rate = sf.read(wav)
        if rate != 22050 or samples.ndim != 1:
            raise ValueError('References must identify the exact mono 22,050 Hz analysis WAV.')
        raw = run_inference(wav, args.weights)
        _, decoded = decode_predictions(raw, THRESHOLDS, DECODING)
        events = note_events(decoded, len(samples) / rate)
        result = analyze(wav, events, len(samples) / rate, DEFAULT_SETTINGS,
                         provenance={'audio_sha256': audio_sha})
        refs = [{'onset': n['onset_seconds'], 'pitch': n['pitch'],
                 'duration': max(.001, sum(n.get('audible_interval', [n['onset_seconds'] + .3] * 2)) / 2 - n['onset_seconds'])}
                for n in reference['notes']]
        candidates = {c['event_id']: c for c in result['candidates'] if c['attribute'] == 'audible_duration'}
        for ref_index, event_index in match(events, refs):
            annotation, note = reference['notes'][ref_index], events[event_index]
            candidate = candidates[note['id']]
            before = note['onset'] + note['duration']
            suggested = candidate['decision'] == 'change'
            proposed = note['onset'] + candidate['proposed'] if suggested else before
            if annotation['unscorable'] or reference['split'] == 'calibration':
                continue
            report['expression_trials'].append({
                'trial_id': f'{identifier}:{note["id"]}:audible-duration',
                'performance_id': identifier, 'piece_id': reference['piece_id'],
                'instrument': 'piano', 'split': reference['split'], 'category': 'audible_duration',
                'source': 'natural_decoder', 'target': 'audible_end_seconds', 'tolerance': .08,
                'reference_interval': annotation['audible_interval'], 'before': before,
                'proposed': proposed, 'suggested': suggested, 'scope': candidate.get('scope', 'isolated'),
                'scorable': True, 'audio_sha256': audio_sha,
                'annotation_sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        report['performances'].append({'performance_id': identifier, 'split': reference['split'],
            'reference_notes': len(refs), 'matched': len(match(events, refs)),
            'report_coverage': result['coverage']})
        (args.output / (path.stem + '-expression.json')).write_text(json.dumps(result, indent=2))
    if not report['performances']:
        raise ValueError('No checked expression references supplied; MIDI releases are not a substitute.')
    (args.output / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'performances': len(report['performances']),
                      'trials': len(report['expression_trials'])}, indent=2))


if __name__ == '__main__': main()
