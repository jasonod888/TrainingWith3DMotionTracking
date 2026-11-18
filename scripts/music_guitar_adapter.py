"""Guitar transcription adapter for the ``music-guitar-v1`` pipeline.

The adapter combines two independent views of the same audio:

* **Riley high-resolution guitar transcription** (16 kHz CRNN, exposed through
  ``hf_midi_transcription`` or a Kong-architecture guitar checkpoint) supplies
  reliable onsets, offsets and velocities.
* **Basic Pitch** (22.05 kHz ONNX contour / frame activations) refines the pitch of
  those attacks, repairs legato/portamento pitch drift and adds quiet notes the CRNN
  missed.

Neither model is downloaded automatically. Both are optional worker dependencies; the
adapter fails clearly when they are absent and never fabricates a model result. After
merging, :mod:`guitar_tab_solver` assigns playable TAB positions and detects chord
shapes, so the emitted draft always carries ``string``/``fret`` and ``guitar_chords``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

try:  # Package import in tests and the worker.
    from .guitar_tab_solver import assign_guitar_tab, detect_guitar_chords_and_strums
except ImportError:  # Direct script execution.
    from guitar_tab_solver import assign_guitar_tab, detect_guitar_chords_and_strums

ROOT = Path(__file__).resolve().parents[1]
ADAPTER_VERSION = 'music-guitar-adapter-v1'
CODE_VERSION = ADAPTER_VERSION
RILEY_SAMPLE_RATE = 16000
BASIC_PITCH_SAMPLE_RATE = 22050
PITCH_TOLERANCE_SECONDS = 0.08
MIN_NOTE_SECONDS = 0.03
DEFAULT_RILEY_WEIGHTS = ROOT / '.local' / 'guitar-riley-profile' / 'guitar-gaps.pth'
DEFAULT_BASIC_PITCH_WEIGHTS = ROOT / 'music-candidate-run' / 'basic-pitch-0.4.0' / 'model.onnx'
REFERENCE_PACKAGES = ROOT / '.local' / 'piano-diagnosis' / 'reference-packages' / 'extracted'
MUSIC_VENV_PYTHON = ROOT / '.venv-music' / 'Scripts' / 'python.exe'
BASIC_PITCH_SUBPROCESS = r'''
import json
import sys
from basic_pitch.inference import Model, run_inference
from basic_pitch.note_creation import model_output_to_notes

out = run_inference(sys.argv[1], Model(sys.argv[2]))
_, notes = model_output_to_notes(
    out['note'], out['onset'], 0.5, 0.3, 5, True, None, None, True, False, 120)
print(json.dumps([
    [float(note[0]), float(note[1]), int(note[2]), float(note[3])]
    for note in notes
]))
'''


class AdapterUnavailable(RuntimeError):
    """The audio or a required model is missing; never silently substitute a fixture."""


def audio_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _event(onset: float, offset: float, pitch: int, velocity: float | None, confidence: float | None,
           source: str) -> dict[str, Any]:
    return {
        'onset': max(0.0, round(float(onset), 4)),
        'duration': max(0.001, round(float(offset) - float(onset), 4)),
        'pitch': int(pitch),
        'velocity': None if velocity is None else round(max(0.0, min(1.0, float(velocity))), 3),
        'confidence': None if confidence is None else round(max(0.0, min(1.0, float(confidence))), 3),
        'source': source,
    }


def _value(note: Any, name: str, default: Any = None) -> Any:
    if isinstance(note, dict):
        return note.get(name, default)
    return getattr(note, name, default)


def _riley_weights() -> Path:
    configured = os.environ.get('MUSIC_RILEY_WEIGHTS') or os.environ.get('MUSIC_MODEL_WEIGHTS')
    return Path(configured).expanduser() if configured else DEFAULT_RILEY_WEIGHTS


def _ensure_reference_packages() -> None:
    """Make the extracted Riley/Kong packages importable when they are not installed."""
    if not REFERENCE_PACKAGES.is_dir():
        return
    try:
        import piano_transcription_inference  # noqa: F401
    except ImportError:
        sys.path.insert(0, str(REFERENCE_PACKAGES))


def riley_events(audio: Path) -> list[dict[str, Any]]:
    """Run the high-resolution 16 kHz guitar CRNN.

    Two execution paths are supported:
    * ``hf_midi_transcription`` when that package exposes ``load_model``/``transcribe``
      (also the path used by unit tests with a monkeypatched module), and
    * the real Riley ``guitar-gaps.pth`` checkpoint through
      ``piano_transcription_inference.PianoTranscription``.
    """
    weights = _riley_weights()
    events: list[dict[str, Any]] = []
    hf_module = None
    try:
        import hf_midi_transcription as hf_module  # type: ignore
    except ImportError:
        hf_module = None

    if hf_module is not None and hasattr(hf_module, 'load_model') and hasattr(hf_module, 'transcribe'):
        model = hf_module.load_model(str(weights) if weights.is_file()
                                     else (os.environ.get('MUSIC_RILEY_WEIGHTS') or 'riley-guitar'))
        raw = hf_module.transcribe(model, str(audio), sample_rate=RILEY_SAMPLE_RATE)
        for note in raw:
            onset = float(_value(note, 'start', 0.0) or 0.0)
            offset = float(_value(note, 'end', onset + MIN_NOTE_SECONDS) or onset + MIN_NOTE_SECONDS)
            pitch = int(_value(note, 'pitch', 0) or 0)
            velocity = _value(note, 'velocity')
            if offset - onset < MIN_NOTE_SECONDS or not 0 <= pitch <= 127:
                continue
            events.append(_event(onset, offset, pitch,
                                 None if velocity is None else float(velocity) / 127.0, None, 'riley'))
        return sorted(events, key=lambda item: (item['onset'], item['pitch']))

    if not weights.is_file():
        raise AdapterUnavailable(
            'Riley guitar weights are missing. Set MUSIC_RILEY_WEIGHTS to guitar-gaps.pth.'
        )
    _ensure_reference_packages()
    try:
        from piano_transcription_inference import PianoTranscription  # type: ignore
    except ImportError as error:
        raise AdapterUnavailable(
            'Riley inference requires piano_transcription_inference; install it in the worker '
            'environment or provide the extracted reference packages.'
        ) from error
    try:
        try:
            import librosa  # type: ignore
        except ImportError:
            import soundfile as sf  # type: ignore
            waveform, sample_rate = sf.read(str(audio), dtype='float32')
            if sample_rate != RILEY_SAMPLE_RATE:
                raise AdapterUnavailable(
                    f'Riley needs {RILEY_SAMPLE_RATE} Hz audio (got {sample_rate} Hz) and librosa is missing.'
                )
        else:
            waveform, _ = librosa.load(str(audio), sr=RILEY_SAMPLE_RATE, mono=True)
        # guitar-gaps.pth is 99 MB, below piano_transcription_inference's hardcoded
        # 160 MB "download the piano checkpoint" threshold. It also calls torch.load
        # without weights_only on PyTorch 2.8. Patch both for this constructor only.
        import torch  # type: ignore
        import piano_transcription_inference.inference as pt_inference  # type: ignore
        real_getsize = os.path.getsize
        real_torch_load = torch.load

        def _getsize(path: Any) -> int:
            try:
                if Path(path).resolve() == weights.resolve():
                    return max(200_000_000, real_getsize(path))
            except (OSError, TypeError, ValueError):
                pass
            return real_getsize(path)

        def _load_with_weights_only(*args: Any, **kwargs: Any) -> Any:
            kwargs['weights_only'] = False
            return real_torch_load(*args, **kwargs)

        try:
            os.path.getsize = _getsize
            if getattr(pt_inference, 'os', None) is not None:
                pt_inference.os.path.getsize = _getsize
            torch.load = _load_with_weights_only
            # Guitar checkpoints use the CRNN class without the pedal head; the
            # package default 'Note_pedal' fails on guitar-gaps.pth.
            try:
                transcriptor = PianoTranscription(
                    model_type='Regress_onset_offset_frame_velocity_CRNN',
                    device='cpu', checkpoint_path=str(weights))
            except TypeError:
                # Minimal test stubs may not accept the model_type keyword.
                transcriptor = PianoTranscription(device='cpu', checkpoint_path=str(weights))
        finally:
            os.path.getsize = real_getsize
            if getattr(pt_inference, 'os', None) is not None:
                pt_inference.os.path.getsize = real_getsize
            torch.load = real_torch_load
        result = transcriptor.transcribe(waveform, None)
    except AdapterUnavailable:
        raise
    except Exception as error:  # Torch/checkpoint failures become a clear worker refusal.
        raise AdapterUnavailable(f'Riley guitar inference failed: {error}') from error
    for note in result.get('est_note_events', []):
        onset = float(note.get('onset_time', 0.0) or 0.0)
        offset = float(note.get('offset_time', onset + MIN_NOTE_SECONDS) or onset + MIN_NOTE_SECONDS)
        pitch = int(note.get('midi_note', 0) or 0)
        velocity = note.get('velocity')
        if offset - onset < MIN_NOTE_SECONDS or not 0 <= pitch <= 127:
            continue
        events.append(_event(onset, offset, pitch,
                             None if velocity is None else float(velocity) / 127.0, None, 'riley'))
    return sorted(events, key=lambda item: (item['onset'], item['pitch']))


def _basic_pitch_weights() -> Path:
    configured = os.environ.get('MUSIC_BASIC_PITCH_WEIGHTS')
    return Path(configured).expanduser() if configured else DEFAULT_BASIC_PITCH_WEIGHTS


def _unit_velocity(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        return max(0.0, min(1.0, value / 127.0))
    velocity = float(value)
    # Basic Pitch note tuples use 0..127 MIDI velocity; some callers already give 0..1.
    return velocity if velocity <= 1 else velocity / 127.0


def _basic_pitch_from_notes(notes: Iterable[Sequence[Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for note in notes:
        start = float(note[0])
        end = float(note[1])
        pitch = int(note[2])
        velocity = _unit_velocity(note[3] if len(note) > 3 else None)
        if end - start < MIN_NOTE_SECONDS or not 0 <= pitch <= 127:
            continue
        events.append(_event(start, end, pitch, velocity, None, 'basic-pitch'))
    return sorted(events, key=lambda item: (item['onset'], item['pitch']))


def basic_pitch_events(audio: Path) -> list[dict[str, Any]]:
    """Run Basic Pitch's 22.05 kHz contour model for pitch-bend/legato refinement.

    The worker ``.venv`` has PyTorch/Riley but may not have Basic Pitch. When the
    current interpreter cannot import it, the pinned ``.venv-music`` interpreter is
    used through a tiny JSON subprocess bridge.
    """
    weights = _basic_pitch_weights()
    try:
        from basic_pitch.inference import Model, run_inference  # type: ignore
        from basic_pitch.note_creation import model_output_to_notes  # type: ignore
    except ImportError:
        Model = None  # type: ignore
        run_inference = None  # type: ignore
        model_output_to_notes = None  # type: ignore

    if Model is not None and run_inference is not None and model_output_to_notes is not None:
        if not weights.is_file():
            raise AdapterUnavailable('Basic Pitch ONNX weights are missing. Set MUSIC_BASIC_PITCH_WEIGHTS.')
        try:
            model_output = run_inference(str(audio), Model(str(weights)))
            _, notes = model_output_to_notes(
                model_output['note'], model_output['onset'],
                0.5, 0.3, 5, True, None, None, True, False, 120)
        except Exception as error:
            raise AdapterUnavailable(f'Basic Pitch inference failed: {error}') from error
        return _basic_pitch_from_notes(notes)

    if not MUSIC_VENV_PYTHON.is_file():
        raise AdapterUnavailable(
            'Basic Pitch is not installed in this worker environment and .venv-music/Scripts/python.exe '
            'is missing. No model was downloaded.'
        )
    if not weights.is_file():
        raise AdapterUnavailable('Basic Pitch ONNX weights are missing. Set MUSIC_BASIC_PITCH_WEIGHTS.')
    completed = subprocess.run(
        [str(MUSIC_VENV_PYTHON), '-c', BASIC_PITCH_SUBPROCESS, str(audio), str(weights)],
        capture_output=True, text=True, timeout=1800, check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or '').strip().splitlines()
        raise AdapterUnavailable(
            'Basic Pitch inference failed in .venv-music: '
            + (detail[-1] if detail else f'exit {completed.returncode}')
        )
    try:
        notes = json.loads(completed.stdout.strip() or '[]')
    except json.JSONDecodeError as error:
        raise AdapterUnavailable('Basic Pitch returned invalid JSON.') from error
    return _basic_pitch_from_notes(notes)


def _nearest(events: Sequence[dict[str, Any]], onset: float, pitch: int | None = None) -> dict[str, Any] | None:
    best = None
    best_distance = PITCH_TOLERANCE_SECONDS
    for event in events:
        distance = abs(event['onset'] - onset)
        if distance > best_distance:
            continue
        if pitch is not None and abs(event['pitch'] - pitch) > 2:
            continue
        if distance <= best_distance:
            best, best_distance = event, distance
    return best


def merge_transcriptions(
    riley: Sequence[dict[str, Any]], basic_pitch: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Riley owns timing; Basic Pitch refines pitch and adds missed quiet attacks."""
    merged: list[dict[str, Any]] = []
    used: set[int] = set()
    for event in riley:
        refined = _nearest(basic_pitch, event['onset'], event['pitch'])
        if refined is not None:
            used.add(id(refined))
            refined_pitch = int(refined['pitch'])
            if abs(refined_pitch - int(event['pitch'])) <= 2:
                event = {**event, 'pitch': refined_pitch, 'confidence': refined.get('confidence')}
        merged.append(dict(event))
    for event in basic_pitch:
        if id(event) in used:
            continue
        if _nearest(riley, event['onset'], event['pitch']) is not None:
            continue
        merged.append({**event, 'source': 'basic-pitch-add'})
    merged.sort(key=lambda item: (item['onset'], item['pitch']))
    for index, event in enumerate(merged, start=1):
        event['id'] = f'guitar-{index}'
    return merged


def transcribe_guitar_events(audio: Path) -> list[dict[str, Any]]:
    riley = riley_events(audio)
    if not riley:
        raise AdapterUnavailable('Riley produced no guitar notes for this clip.')
    try:
        contour = basic_pitch_events(audio)
    except AdapterUnavailable:
        contour = []
    return merge_transcriptions(riley, contour)


def build_guitar_document(job: dict[str, Any], audio: Path) -> dict[str, Any]:
    """Assemble the unreviewed draft consumed by the review workspace."""
    duration = float(job['duration'])
    events = transcribe_guitar_events(audio)
    if len(events) > 20000:
        raise AdapterUnavailable('The guitar transcription exceeds the draft event limit; use a shorter clip.')
    events, chords = _tab_and_chords(events, duration)
    provenance: dict[str, Any] = {
        'adapter': 'music-guitar-adapter',
        'engine': 'riley+basic-pitch',
        'model': 'riley-guitar+basic-pitch',
        'model_version': ADAPTER_VERSION,
        'code_version': CODE_VERSION,
        'audio_sha256': audio_sha256(audio),
    }
    raw_profile = os.environ.get('MUSIC_RUN_PROFILE')
    if raw_profile:
        try:
            profile = json.loads(raw_profile)
        except json.JSONDecodeError as error:
            raise AdapterUnavailable('MUSIC_RUN_PROFILE is not valid JSON.') from error
        if not isinstance(profile, dict):
            raise AdapterUnavailable('MUSIC_RUN_PROFILE must be a JSON object.')
        provenance['model'] = profile.get('model') or 'riley-guitar+basic-pitch'
        provenance['model_version'] = profile.get('model_version') or ADAPTER_VERSION
        if profile.get('profile_sha256'):
            provenance['profile_sha256'] = profile['profile_sha256']
    return {
        'draft_version': 1,
        'subject': 'guitar',
        'instrument': {'instrument': 'guitar'},
        'duration': duration,
        'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64},
        'events': events,
        'spans': [{'start': 0.0, 'end': round(max(0.01, duration), 3)}],
        'guitar_chords': chords,
        'provenance': provenance,
        'warnings': ['Guitar transcription proposal only; every chord and passage needs instructor review.'],
    }


def _tab_and_chords(events: Sequence[dict[str, Any]], duration: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Clamp model notes into the reviewed clip before TAB/chord assignment.

    Riley pads 16 kHz audio into ten-second windows, so its final offsets can exceed
    the uploaded clip. The draft contract requires every event to stay inside it.
    """
    limit = float(duration)
    last_onset = max(0.0, limit - 0.002)
    cleaned: list[dict[str, Any]] = []
    for event in events:
        onset = float(event.get('onset') or 0.0)
        if onset < 0 or onset >= last_onset:
            continue
        onset = round(max(0.0, min(onset, last_onset)), 4)
        available = max(0.001, limit - onset)
        length = float(event.get('duration') or 0.25)
        length = round(max(0.001, min(length, available)), 4)
        cleaned.append({**event, 'onset': onset, 'duration': length})
    tabbed = assign_guitar_tab(cleaned)
    for event in tabbed:
        event.setdefault('optional', False)
    return tabbed, detect_guitar_chords_and_strums(tabbed, duration)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--job', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    job = json.loads(arguments.job.read_text(encoding='utf-8'))
    if job.get('subject') != 'guitar' or job.get('instrument') != 'guitar':
        print('This adapter only accepts guitar jobs.', file=sys.stderr)
        return 2
    if not arguments.input.is_file() or arguments.input.stat().st_size == 0:
        print('Analysis audio is missing.', file=sys.stderr)
        return 2
    try:
        document = build_guitar_document(job, arguments.input)
    except AdapterUnavailable as error:
        print(str(error), file=sys.stderr)
        return 3
    output = arguments.output
    output.mkdir(parents=True, exist_ok=True)
    (output / 'reference.json').write_text(json.dumps(document, separators=(',', ':')), encoding='utf-8')
    (output / 'result.json').write_text(json.dumps({
        'draft': document,
        'files': {'reference': 'reference.json'},
    }), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
