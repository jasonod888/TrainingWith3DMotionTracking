"""Transcription adapter for the isolated music worker.

Adapter contract: receives `--input` (analysis WAV), `--source` (uploaded clip),
`--job` (JSON) and `--output` (directory); writes `result.json` containing an
**unreviewed draft** proposal and `files` mapping asset roles to files in the output
directory. It never sets `reference_reviewed` and never approves anything.

Engines:
- `fixture` produces deterministic events for transport and handoff tests. It is not a
  model result and is labelled as such.
- `basic-pitch` uses the optional Basic Pitch package. It is **not installed** in this
  checkout and is never downloaded automatically; without it the adapter fails clearly.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

CODE_VERSION = 'music-transcription-v1'


def audio_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def fixture_events(duration: float, instrument: str) -> list[dict]:
    base = 60 if instrument == 'piano' else 64
    count = max(1, min(8, int(duration / 0.5))) if duration >= 0.5 else 1
    step = max(0.25, duration / (count + 1))
    events = []
    for index in range(count):
        onset = round(min(duration - 0.05, 0.25 + index * step), 3)
        if onset < 0:
            onset = 0.0
        events.append({
            'id': f'fixture-{index + 1}',
            'onset': onset,
            'duration': round(min(0.4, max(0.05, duration - onset)), 3),
            'pitch': base + index,
            'velocity': 0.8,
            'confidence': None,
            'optional': False,
        })
    return events


def fixture_document(job: dict, audio: Path) -> dict:
    duration = float(job['duration'])
    instrument = job['instrument']
    events = fixture_events(duration, instrument)
    reference = {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64}
    return {
        'draft_version': 1,
        'subject': job['subject'],
        'instrument': {'instrument': instrument},
        'duration': duration,
        'reference': reference,
        'events': events,
        'spans': [{'start': 0.2, 'end': round(max(0.25, duration), 3)}] if duration > 0.2 else [],
        'provenance': {
            'adapter': 'music-transcription',
            'engine': 'fixture',
            'model': None,
            'model_version': 'fixture-v1',
            'code_version': CODE_VERSION,
            'audio_sha256': audio_digest(audio),
        },
        'warnings': ['Fixture transcription for tests; it is not a model result.'],
    }


def basic_pitch_document(job: dict, audio: Path) -> dict:
    try:
        from basic_pitch.inference import predict  # type: ignore
        from basic_pitch import ICASSP_2022_MODEL_PATH  # type: ignore
        from importlib.metadata import version
    except ImportError as error:
        raise SystemExit('Basic Pitch is not installed in this worker environment; no model was downloaded.') from error
    duration = float(job['duration'])
    instrument = job['instrument']
    model_output, midi_data, note_events = predict(str(audio), ICASSP_2022_MODEL_PATH, onset_threshold=0.5)
    events = []
    for index, note in enumerate(midi_data.instruments[0].notes[:20000]):
        events.append({
            'id': f'basic-pitch-{index + 1}',
            'onset': round(max(0.0, note.start), 3),
            'duration': round(max(0.01, note.end - note.start), 3),
            'pitch': int(note.pitch),
            'velocity': round(min(1.0, max(0.0, note.velocity / 127)), 3),
            'confidence': None,
            'optional': False,
        })
    return {
        'draft_version': 1,
        'subject': job['subject'],
        'instrument': {'instrument': instrument},
        'duration': duration,
        'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64},
        'events': events,
        'spans': [{'start': 0.0, 'end': round(max(0.01, duration), 3)}],
        'provenance': {
            'adapter': 'music-transcription',
            'engine': 'basic-pitch',
            'model': 'basic-pitch',
            'model_version': version('basic-pitch'),
            'code_version': CODE_VERSION,
            'audio_sha256': audio_digest(audio),
        },
        'warnings': ['Transcription proposal only; every assessed passage needs instructor review.'],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('fixture', 'basic-pitch'), required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--job', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    job = json.loads(arguments.job.read_text(encoding='utf-8'))
    for key in ('id', 'subject', 'instrument', 'duration'):
        if key not in job:
            print(f'Job is missing {key}.', file=sys.stderr)
            return 2
    if not arguments.input.is_file() or arguments.input.stat().st_size == 0:
        print('Analysis audio is missing.', file=sys.stderr)
        return 2
    document = fixture_document(job, arguments.input) if arguments.engine == 'fixture' \
        else basic_pitch_document(job, arguments.input)
    output = arguments.output
    output.mkdir(parents=True, exist_ok=True)
    # The reference identity is filled by the worker after upload; a placeholder keeps the
    # draft self-contained without a circular hash of its own asset field.
    (output / 'reference.json').write_text(json.dumps(document, separators=(',', ':')), encoding='utf-8')
    (output / 'result.json').write_text(json.dumps({
        'draft': document,
        'files': {'reference': 'reference.json'},
    }), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
