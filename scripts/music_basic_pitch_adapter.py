"""Basic Pitch 0.4.0 ONNX adapter for the isolated music worker.

Decoding is explicit: the verified run profile carries every choice, the raw model
activations and MIDI are retained in an internal analysis zip, and the proposal is
derived from those same activations. No model download or fixture fallback.
"""
import argparse
import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from basic_pitch.constants import AUDIO_SAMPLE_RATE, FFT_HOP
from basic_pitch.inference import run_inference
from basic_pitch.note_creation import model_output_to_notes
from scipy.signal import find_peaks

PIANO_DECODING = 'basic-pitch-0.4.0/piano-peaks-v1'

DEFAULT_DECODING = {
    'decoding_version': 'basic-pitch-0.4.0/decoding-v1',
    'infer_onsets': True,
    'melodia_trick': False,
    'include_pitch_bends': False,
    'multiple_pitch_bends': False,
    'midi_tempo': 120,
    'minimum_frequency': None,
    'maximum_frequency': None,
}


def decode_predictions(model_output, thresholds, decoding):
    """Decode an immutable prediction, optionally using piano attack peak selection.

    Peak prominence rejects broad activation humps; distance prevents several maxima
    of one attack from becoming repeated strikes. Selection is per pitch, so chords
    and genuine octaves are never suppressed because another key is louder.
    Keep this implementation in the profiled entry point so its bytes are hashed.
    """
    output = {key: value.copy() for key, value in model_output.items()}
    if decoding['decoding_version'] == PIANO_DECODING:
        if decoding['infer_onsets'] or decoding['melodia_trick']:
            raise ValueError('Piano peak decoding requires explicit onsets and no Melodia.')
        peaks = np.zeros_like(output['onset'])
        spacing = max(1, round(thresholds['minimum_attack_spacing_ms'] / 1000 * AUDIO_SAMPLE_RATE / FFT_HOP))
        for pitch in range(peaks.shape[1]):
            indices, _ = find_peaks(output['onset'][:, pitch],
                height=thresholds['onset_threshold'],
                prominence=thresholds['onset_prominence'], distance=spacing, wlen=25)
            peaks[indices, pitch] = output['onset'][indices, pitch]
        output['onset'] = peaks
    elif decoding['decoding_version'] != DEFAULT_DECODING['decoding_version']:
        raise ValueError('Unsupported Basic Pitch decoding version.')
    min_note_len = int(np.round(float(thresholds['minimum_note_length']) / 1000 * AUDIO_SAMPLE_RATE / FFT_HOP))
    return model_output_to_notes(output,
        onset_thresh=float(thresholds['onset_threshold']), frame_thresh=float(thresholds['frame_threshold']),
        infer_onsets=decoding['infer_onsets'], min_note_len=min_note_len,
        min_freq=decoding.get('minimum_frequency'), max_freq=decoding.get('maximum_frequency'),
        include_pitch_bends=decoding['include_pitch_bends'], multiple_pitch_bends=decoding['multiple_pitch_bends'],
        melodia_trick=decoding['melodia_trick'], midi_tempo=float(decoding['midi_tempo']))


def note_events(notes, duration):
    events = []
    for note in sorted(notes, key=lambda item: (float(item[0]), int(item[2]))):
        onset, end, pitch, amplitude = float(note[0]), float(note[1]), int(note[2]), float(note[3])
        if not np.isfinite([onset, end, amplitude]).all() or onset >= duration:
            continue
        onset, end = max(0, onset), min(end, duration)
        if end <= onset:
            continue
        # Do not extend short notes past the media boundary to enforce a minimum.
        events.append({'id': f'bp-{len(events) + 1}', 'onset': round(onset, 4),
            'duration': round(end - onset, 4), 'pitch': pitch,
            'velocity': round(amplitude, 4), 'confidence': None, 'optional': False})
        if len(events) >= 20000:
            break
    return events


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
    decoding = {**DEFAULT_DECODING, **(profile.get('decoding') or {})}
    job = json.loads(Path(args.job).read_text(encoding='utf-8'))
    if decoding['decoding_version'] == PIANO_DECODING and j_tool(job) != 'piano':
        raise ValueError('The piano decoder cannot be used for another instrument.')
    audio = Path(args.input)
    audio_sha = hashlib.sha256(audio.read_bytes()).hexdigest()

    model_output = run_inference(audio, weights)
    required = {'note', 'onset', 'contour'}
    if set(model_output) != required:
        raise SystemExit('Basic Pitch returned unexpected activation arrays.')
    for name, value in model_output.items():
        if not isinstance(value, np.ndarray) or not np.isfinite(value).all():
            raise SystemExit(f'Basic Pitch returned an invalid {name} activation array.')
    minimum_note_length = float(thresholds.get('minimum_note_length', 127.7))
    min_note_len = int(np.round(minimum_note_length / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP)))
    midi, notes = decode_predictions(model_output, thresholds, decoding)
    duration = float(job['duration'])
    events = note_events(notes, duration)

    draft = {
        'draft_version': 1, 'subject': job['subject'], 'instrument': {'instrument': j_tool(job)},
        'duration': duration,
        'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 0, 'sha256': '0' * 64},
        'events': events, 'spans': [{'start': 0, 'end': duration, 'kind': 'playing'}],
        'guitar_chords': [],
        'provenance': {'adapter': 'basic-pitch-adapter', 'engine': 'onnx', 'model': 'basic-pitch',
                       'model_version': '0.4.0', 'code_version': 'basic-pitch-adapter-v3',
                       'profile_sha256': profile['profile_sha256'],
                       'audio_sha256': audio_sha},
        'warnings': ['Basic Pitch proposal; every note requires instructor review.'],
    }
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'reference.json').write_text(json.dumps(draft, separators=(',', ':')), encoding='utf-8')

    metadata = {
        'analysis_version': 1,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'model': 'basic-pitch', 'model_version': '0.4.0', 'engine': 'onnx',
        'weights_sha256': profile['weights_sha256'], 'profile_sha256': profile['profile_sha256'],
        'audio_sha256': audio_sha, 'source_sha256': hashlib.sha256(Path(args.source).read_bytes()).hexdigest(),
        'sample_rate': AUDIO_SAMPLE_RATE, 'preprocessing': profile['preprocessing'],
        'thresholds': thresholds, 'decoding': decoding,
        'minimum_note_length_ms': minimum_note_length, 'minimum_note_length_frames': min_note_len,
        'raw_arrays': {name: {'shape': list(value.shape), 'dtype': str(value.dtype)}
                       for name, value in model_output.items()},
        'note_count': len(events),
        'retention_days': 30,
    }
    raw_path = out / 'raw.npz'
    np.savez_compressed(raw_path, **model_output)
    midi_path = out / 'proposal.mid'
    midi.write(str(midi_path))
    metadata['duration'] = duration
    baseline = None
    if decoding['decoding_version'] == PIANO_DECODING:
        baseline_thresholds = {'onset_threshold': .5, 'frame_threshold': .3, 'minimum_note_length': 127.7}
        _, baseline_notes = decode_predictions(model_output, baseline_thresholds, DEFAULT_DECODING)
        baseline = {**draft, 'events': note_events(baseline_notes, duration)}
        metadata['baseline'] = {'thresholds': baseline_thresholds, 'decoding': DEFAULT_DECODING,
            'note_count': len(baseline['events']), 'artifact': 'baseline-reference.json',
            'note': 'Comparison only; provenance identifies this run, not a historical draft.'}
    metadata['midi_sha256'] = hashlib.sha256(midi_path.read_bytes()).hexdigest()
    metadata['analysis_sha256'] = hashlib.sha256(
        json.dumps(metadata, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    analysis_path = out / 'analysis.zip'
    with zipfile.ZipFile(analysis_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(raw_path, 'raw.npz')
        archive.write(midi_path, 'proposal.mid')
        archive.write(out / 'reference.json', 'proposed-reference.json')
        if baseline is not None:
            archive.writestr('baseline-reference.json', json.dumps(baseline, separators=(',', ':')))
        archive.writestr('metadata.json', json.dumps(metadata, indent=2, sort_keys=True))
    for path in (raw_path, midi_path):
        path.unlink()
    (out / 'result.json').write_text(json.dumps(
        {'draft': draft, 'files': {'reference': 'reference.json', 'analysis': 'analysis.zip'}}),
        encoding='utf-8')


def j_tool(job):
    return job.get('instrument') or job['subject']


if __name__ == '__main__':
    main()
