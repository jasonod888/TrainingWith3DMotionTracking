"""Re-decode a retained Basic Pitch analysis zip without rerunning inference."""
import argparse
import io
import json
import math
import zipfile
from pathlib import Path

import numpy as np
from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP
from basic_pitch.note_creation import model_output_to_notes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('analysis', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--onset', type=float)
    parser.add_argument('--frame', type=float)
    parser.add_argument('--min-ms', type=float)
    parser.add_argument('--infer-onsets', action=argparse.BooleanOptionalAction)
    parser.add_argument('--melodia', action=argparse.BooleanOptionalAction)
    parser.add_argument('--pitch-bends', action=argparse.BooleanOptionalAction)
    args = parser.parse_args()
    with zipfile.ZipFile(args.analysis) as archive:
        metadata = json.loads(archive.read('metadata.json'))
        raw = np.load(io.BytesIO(archive.read('raw.npz')))
        outputs = {name: raw[name] for name in ('note', 'onset', 'contour')}
    decoding = metadata['decoding']
    thresholds = metadata['thresholds']
    onset = args.onset if args.onset is not None else thresholds['onset_threshold']
    frame = args.frame if args.frame is not None else thresholds['frame_threshold']
    minimum = args.min_ms if args.min_ms is not None else metadata['minimum_note_length_ms']
    infer = args.infer_onsets if args.infer_onsets is not None else decoding['infer_onsets']
    melodia = args.melodia if args.melodia is not None else decoding['melodia_trick']
    bends = args.pitch_bends if args.pitch_bends is not None else decoding['include_pitch_bends']
    min_frames = int(np.round(minimum / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP)))
    _, notes = model_output_to_notes(outputs, onset_thresh=onset, frame_thresh=frame,
                                     infer_onsets=infer, min_note_len=min_frames,
                                     include_pitch_bends=bends, multiple_pitch_bends=False,
                                     melodia_trick=melodia, midi_tempo=decoding['midi_tempo'])
    events = [{'onset': round(float(note[0]), 4), 'end': round(float(note[1]), 4),
               'duration': round(float(note[1]) - float(note[0]), 4), 'pitch': int(note[2]),
               'velocity': round(float(note[3]), 4)}
              for note in notes if math.isfinite(float(note[0])) and math.isfinite(float(note[1]))
              and float(note[1]) > float(note[0])]
    result = {'source': str(args.analysis), 'audio_sha256': metadata['audio_sha256'],
              'profile_sha256': metadata['profile_sha256'], 'decoding': {
                  'onset_threshold': onset, 'frame_threshold': frame,
                  'minimum_note_length': minimum, 'infer_onsets': infer,
                  'melodia_trick': melodia, 'include_pitch_bends': bends},
              'note_count': len(events), 'events': events}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('wrote', args.output, 'notes', len(events))


if __name__ == '__main__':
    main()
