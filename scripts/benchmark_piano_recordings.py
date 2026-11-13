"""Compare decoder and verifier on local recordings with synchronized reference MIDI.

The recordings are not downloaded or redistributed by this script. Suggested edits
are evaluated with the production applier under an evaluation-only policy; this
does not qualify or enable any correction category in the application.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import pretty_midi
import soundfile as sf
from basic_pitch.inference import run_inference

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.benchmark_piano_verification import (
    DECODING, THRESHOLDS, apply_suggestions, match_stats,
)
from scripts.music_basic_pitch_adapter import DEFAULT_DECODING, decode_predictions, note_events
from scripts.piano_corrections import current_application_sha256, decoder_sha256
from scripts.piano_verifier import DEFAULT_SETTINGS, verify_piano_transcription


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=20.0)
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error('--seconds must be positive')
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parent
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    config = {'sample_rate': 22050, 'preprocessing': 'mono-pcm-s16le',
              'thresholds': THRESHOLDS, 'decoding': DECODING}
    provenance = {'model': 'basic-pitch', 'model_version': '0.4.0',
                  'weights_sha256': sha(args.weights), 'decoder': DECODING['decoding_version'],
                  'decoder_sha256': decoder_sha256(config, root / 'music_basic_pitch_adapter.py')}
    implementation = {**provenance,
        'verifier_code_sha256': sha(root / 'piano_verifier.py'),
        'settings_sha256': hashlib.sha256(json.dumps(DEFAULT_SETTINGS, sort_keys=True,
            separators=(',', ':')).encode()).hexdigest(),
        'application_code_sha256': current_application_sha256()}
    rows = []
    for wav in sorted(args.pairs.glob('*.wav')):
        midi = wav.with_suffix('.mid')
        if not midi.exists():
            continue
        audio, rate = sf.read(wav)
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        if rate != 22050:
            audio = librosa.resample(audio, orig_sr=rate, target_sr=22050)
        audio = audio[:int(args.seconds * 22050)]
        duration = len(audio) / 22050
        extracted = args.output / wav.name
        sf.write(extracted, audio, 22050, subtype='PCM_16')
        reference = [{'id': f'ref-{i}', 'pitch': n.pitch, 'onset': n.start,
                      'duration': min(n.end, duration) - n.start, 'velocity': n.velocity / 127}
                     for i, n in enumerate(n for inst in pretty_midi.PrettyMIDI(str(midi)).instruments
                                           if not inst.is_drum for n in inst.notes)
                     if n.start < duration and n.end > n.start]
        cache = args.output / (wav.stem + '.npz')
        receipt = cache.with_suffix('.sha256')
        key = hashlib.sha256(extracted.read_bytes() + provenance['weights_sha256'].encode()).hexdigest()
        if cache.exists() and receipt.exists() and receipt.read_text() == key:
            raw = dict(np.load(cache, allow_pickle=False))
        else:
            raw = run_inference(extracted, args.weights)
            np.savez_compressed(cache, **raw)
            receipt.write_text(key)
        _, baseline = decode_predictions(raw, {'onset_threshold': .5,
            'frame_threshold': .3, 'minimum_note_length': 127.7}, DEFAULT_DECODING)
        _, peak = decode_predictions(raw, THRESHOLDS, DECODING)
        events = note_events(peak, duration)
        report = verify_piano_transcription(audio=extracted, events=events, activations=raw,
            duration=duration, provenance=provenance)
        corrected, applied, conflicts = apply_suggestions(events, report, implementation, duration)
        before = match_stats(events, reference)
        after = match_stats(corrected, reference)
        row = {'recording': wav.name, 'audio_sha256': sha(wav), 'reference_sha256': sha(midi),
               'seconds': duration, 'reference_notes': len(reference),
               'baseline': match_stats(note_events(baseline, duration), reference),
               'piano_decoder': before, 'after_suggested_corrections': after,
               'applied': applied, 'conflicts': conflicts,
               'correct_notes_damaged': len(set(before['matched_ref_indices']) - set(after['matched_ref_indices'])),
               'findings': report['summary']}
        rows.append(row)
        (args.output / (wav.stem + '-verification.json')).write_text(json.dumps(report, indent=2))
        (args.output / (wav.stem + '-notes.json')).write_text(json.dumps({
            'reference': reference, 'decoder': events, 'corrected': corrected}, indent=2))
        print(json.dumps(row), flush=True)
    result = {'scope': 'Diagnostic evaluation only, not a production qualification study.',
              'implementation': implementation, 'recordings': rows}
    (args.output / 'report.json').write_text(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
