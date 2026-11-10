"""Basic Pitch 0.4.0 ONNX adapter for the isolated music worker.

Uses the checkpoint supplied by MUSIC_MODEL_WEIGHTS and thresholds from the verified
MUSIC_RUN_PROFILE. Never downloads a model or falls back to a fixture.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

from basic_pitch.inference import predict


def main():
    parser = argparse.ArgumentParser()
    for name in ('input', 'source', 'job', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    profile = json.loads(os.environ['MUSIC_RUN_PROFILE'])
    weights = Path(os.environ['MUSIC_MODEL_WEIGHTS'])
    if hashlib.sha256(weights.read_bytes()).hexdigest() != profile['weights_sha256']:
        raise SystemExit('Model weights do not match the verified run profile.')
    thresholds = profile['thresholds']
    job = json.loads(Path(args.job).read_text(encoding='utf-8'))
    _, _, notes = predict(
        args.input,
        model_or_model_path=weights,
        onset_threshold=thresholds.get('onset_threshold', 0.5),
        frame_threshold=thresholds.get('frame_threshold', 0.3),
        minimum_note_length=thresholds.get('minimum_note_length', 127.7),
        melodia_trick=False,
    )
    duration = float(job['duration'])
    events = []
    for index, note in enumerate(sorted(notes, key=lambda item: (float(item[0]), int(item[2])))):
        onset, end, pitch, amplitude = float(note[0]), float(note[1]), int(note[2]), float(note[3])
        if onset >= duration:
            continue
        events.append({'id': f'bp-{index + 1}', 'onset': round(onset, 4),
                       'duration': round(max(0.01, min(end, duration) - onset), 4),
                       'pitch': pitch, 'velocity': round(amplitude, 4), 'confidence': None,
                       'optional': False})
        if len(events) >= 20000:
            break
    audio = Path(args.input)
    draft = {
        'draft_version': 1, 'subject': job['subject'], 'instrument': {'instrument': j_tool(job)},
        'duration': duration,
        'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64},
        'events': events, 'spans': [{'start': 0, 'end': duration, 'kind': 'playing'}],
        'guitar_chords': [],
        'provenance': {'adapter': 'basic-pitch-adapter', 'engine': 'onnx', 'model': 'basic-pitch',
                       'model_version': '0.4.0', 'code_version': 'basic-pitch-adapter-v1',
                       'profile_sha256': profile['profile_sha256'],
                       'audio_sha256': hashlib.sha256(audio.read_bytes()).hexdigest()},
        'warnings': ['Basic Pitch proposal; every note requires instructor review.'],
    }
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'reference.json').write_text(json.dumps(draft, separators=(',', ':')), encoding='utf-8')
    (out / 'result.json').write_text(json.dumps({'draft': draft, 'files': {'reference': 'reference.json'}}),
                                     encoding='utf-8')


def j_tool(job):
    return job.get('instrument') or job['subject']


if __name__ == '__main__':
    main()
