"""Build aligned synthetic piano regression fixtures with known note references.

These are diagnostic fixtures, not human performances: the WAV is rendered from the
same note list used as the reference, so pitch/onset/offset alignment is exact.
"""
import json
import math
import wave
from pathlib import Path

import numpy as np

RATE = 22050
ROOT = Path('music-candidate-run/reference-set')


def piano_note(pitch, duration, amplitude=0.5, pedal=False):
    length = max(1, int(duration * RATE))
    times = np.arange(length) / RATE
    frequency = 440 * 2 ** ((pitch - 69) / 12)
    attack = np.minimum(1, times / 0.006)
    decay = 0.55 if pedal else 0.18
    envelope = attack * np.exp(-times / max(0.12, decay + duration * .22))
    phase = 2 * math.pi * frequency * times
    tone = np.sin(phase) + .45 * np.sin(2 * phase) + .22 * np.sin(3 * phase) + .10 * np.sin(4 * phase)
    return amplitude * envelope * tone


def render(name, notes, duration, pedal=False):
    data = np.zeros(int(duration * RATE), dtype=np.float64)
    for note in notes:
        start = int(note['onset'] * RATE)
        clip = piano_note(note['pitch'], note['duration'], note.get('velocity', .55), pedal)
        end = min(len(data), start + len(clip))
        data[start:end] += clip[:end - start]
    data += 0.002 * np.random.default_rng(7).normal(size=len(data))
    data = np.clip(data / max(.8, np.abs(data).max()), -1, 1)
    path = ROOT / f'{name}.wav'
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(RATE)
        handle.writeframes((data * 32767).astype('<i2').tobytes())
    reference = {'name': name, 'audio': path.name, 'sample_rate': RATE, 'duration': duration,
                 'notes': [{key: note[key] for key in ('onset', 'duration', 'pitch')} for note in notes]}
    return reference


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    references = []
    references.append(render('single-short', [
        {'onset': .25, 'duration': .12, 'pitch': 60, 'velocity': .5},
        {'onset': .75, 'duration': .12, 'pitch': 64, 'velocity': .45},
        {'onset': 1.25, 'duration': .20, 'pitch': 67, 'velocity': .5},
    ], 2.0))
    references.append(render('chords-overlap', [
        {'onset': .30, 'duration': 1.2, 'pitch': 48, 'velocity': .5},
        {'onset': .30, 'duration': 1.2, 'pitch': 52, 'velocity': .45},
        {'onset': .30, 'duration': 1.2, 'pitch': 55, 'velocity': .45},
        {'onset': .80, 'duration': .8, 'pitch': 60, 'velocity': .55},
        {'onset': 1.00, 'duration': 1.0, 'pitch': 72, 'velocity': .4},
    ], 2.5))
    references.append(render('repeated-pitch', [
        {'onset': .30, 'duration': .18, 'pitch': 60, 'velocity': .5},
        {'onset': .80, 'duration': .18, 'pitch': 60, 'velocity': .45},
        {'onset': 1.30, 'duration': .18, 'pitch': 60, 'velocity': .4},
        {'onset': 1.80, 'duration': .18, 'pitch': 60, 'velocity': .35},
    ], 2.4))
    references.append(render('soft-under-loud', [
        {'onset': .30, 'duration': 1.5, 'pitch': 36, 'velocity': .8},
        {'onset': .30, 'duration': 1.5, 'pitch': 43, 'velocity': .75},
        {'onset': .60, 'duration': .8, 'pitch': 72, 'velocity': .16},
        {'onset': 1.10, 'duration': .8, 'pitch': 76, 'velocity': .14},
    ], 2.5))
    references.append(render('pedal-sustain', [
        {'onset': .30, 'duration': 2.4, 'pitch': 48, 'velocity': .55},
        {'onset': .30, 'duration': 2.4, 'pitch': 55, 'velocity': .5},
        {'onset': .30, 'duration': 2.4, 'pitch': 64, 'velocity': .5},
    ], 3.2, pedal=True))
    (ROOT / 'references.json').write_text(json.dumps(references, indent=2), encoding='utf-8')
    print('wrote', len(references), 'references to', ROOT)


if __name__ == '__main__':
    main()
