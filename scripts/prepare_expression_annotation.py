"""Prepare honest audible-ending annotation templates from captured MIDI/audio.

Every ending starts unscorable. MIDI key releases are retained separately and are
never promoted to audible-ending truth. This is an internal data-preparation tool.
"""
import argparse
import hashlib
import json
from pathlib import Path

import pretty_midi
import soundfile as sf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--midi', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--performance-id', required=True)
    parser.add_argument('--piece-id', required=True)
    parser.add_argument('--split', choices=('development', 'calibration', 'holdout'), required=True)
    args = parser.parse_args()
    info = sf.info(args.audio)
    if info.samplerate != 22050 or info.channels != 1:
        parser.error('Identify the exact mono 22,050 Hz analysis WAV.')
    sha = hashlib.sha256(args.audio.read_bytes()).hexdigest()
    midi = pretty_midi.PrettyMIDI(str(args.midi))
    notes = sorted([n for inst in midi.instruments if not inst.is_drum for n in inst.notes
                    if n.start < info.duration], key=lambda n: (n.start, n.pitch))
    reference = {'reference_version': 1, 'performance_id': args.performance_id,
        'piece_id': args.piece_id, 'instrument': 'piano', 'split': args.split,
        'audio_sha256': sha, 'analysis_wav_sha256': sha,
        'source_midi_sha256': hashlib.sha256(args.midi.read_bytes()).hexdigest(),
        'annotation_status': 'unannotated', 'notes': [
            {'event_id': f'reference-{i + 1}', 'pitch': n.pitch, 'onset_seconds': n.start,
             'audible_end': {'unscorable': True, 'reason': 'requires_independent_listening_annotation'},
             'key_release_seconds': n.end, 'captured_midi_velocity': n.velocity,
             'calibration_id': None} for i, n in enumerate(notes)]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(reference, indent=2) + '\n')
    print(json.dumps({'notes': len(notes), 'scorable_endings': 0,
                      'status': 'Awaiting checked audible-ending intervals.'}, indent=2))


if __name__ == '__main__': main()
