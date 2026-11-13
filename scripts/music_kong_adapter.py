"""Raw Kong transcription adapter for the isolated music worker.

Produces an unreviewed draft plus a common-renderer piano preview. No verifier, expression
correction or automatic document correction runs here. Predicted offsets stay render
durations; estimated MIDI velocity stays model-estimated, never captured keyboard velocity.
"""
import argparse
import hashlib
import json
import os
import sys
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import piano_performance as performance
from scripts import piano_reconstruction_harness as harness
from scripts import render_piano_comparison as previews

ADAPTER_VERSION = 'kong-adapter-1'

def _json_scalar(value):
    if isinstance(value,np.generic):return value.item()
    if isinstance(value,np.ndarray):return value.tolist()
    raise TypeError(f'Unsupported inference value: {type(value).__name__}')


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _load_package(package_path):
    path = Path(package_path)
    # Accept either the package directory itself or its parent.
    if path.name == 'piano_transcription_inference':
        path = path.parent
    path=path.resolve()
    sys.path.insert(0, str(path))
    import piano_transcription_inference as package
    if not Path(package.__file__).resolve().is_relative_to(path):
        raise ValueError('Imported Kong package is outside the verified bundle.')
    from piano_transcription_inference import PianoTranscription, sample_rate
    return PianoTranscription, int(sample_rate)


def transcribe(audio_path, profile, checkpoint, device):
    samples, rate = harness.read_wav(audio_path)
    if rate != int(profile['sample_rate']):
        raise ValueError(f'Kong needs {profile["sample_rate"]} Hz audio, got {rate}')
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    audio = np.ascontiguousarray(samples, dtype=np.float32)
    PianoTranscription, _rate = _load_package(profile['package_path'])
    model = PianoTranscription(device=device, checkpoint_path=str(checkpoint))
    for name,value in profile.get('config',{}).items():
        setattr(model,'offset_threshod' if name=='offset_threshold' else name,value)
    result = model.transcribe(audio, None)
    return result, audio


def build(duration, result, profile, audio_sha, checkpoint_sha):
    events = []
    native = []
    for index, event in enumerate(result['est_note_events']):
        onset = max(0.0, float(event['onset_time']))
        offset = min(duration, float(event['offset_time']))
        if onset >= duration or offset <= onset:
            continue
        velocity = int(event['velocity'])
        velocity = min(127, max(1, velocity))
        identifier = f'kong-{index + 1}'
        events.append({'id': identifier, 'onset': round(onset, 6),
                       'duration': round(offset - onset, 6),
                       'pitch': int(event['midi_note']),
                       'velocity': round(velocity / 127.0, 6),
                       'confidence': None, 'optional': False})
        native.append({'id': identifier, 'pitch': int(event['midi_note']),
                       'onset_seconds': onset, 'offset_seconds': offset})
    if not events:
        raise ValueError('Kong produced no notes inside the clip.')
    pedal = []
    for span in result.get('est_pedal_events') or []:
        start = max(0.0, float(span['onset_time']))
        end = min(duration, float(span['offset_time']))
        if end > start:
            pedal.append({'onset': round(start, 6), 'offset': round(end, 6),
                          'type': 'sustain'})
    provenance = {'adapter': 'kong-adapter', 'engine': 'pytorch', 'model': 'kong',
                  'model_version': profile['model_version'],
                  'code_version': ADAPTER_VERSION,
                  'profile_sha256': profile['profile_sha256'], 'audio_sha256': audio_sha}
    draft = {'draft_version': 1, 'subject': 'piano',
             'instrument': {'instrument': 'piano'}, 'duration': duration,
             'reference': {'key': 'reference.json', 'mime': 'application/json',
                           'bytes': 0, 'sha256': '0' * 64},
             'piano_preview': {'key': 'preview.wav', 'mime': 'audio/wav',
                               'bytes': 0, 'sha256': '0' * 64},
             'playback': {'sync_offset_seconds': 0.0, 'revision': 1},
             'events': events,
             'spans': [{'start': 0, 'end': duration, 'kind': 'playing'}],
             'guitar_chords': [], 'provenance': provenance, 'pedal': pedal,
             'warnings': ['Raw Kong proposal with no automatic correction.',
                          'Note lengths are model-predicted offsets, not measured release.',
                          'Velocity is model-estimated, not captured keyboard velocity.',
                          'Sustain pedal spans are model estimates, not captured controller truth.']}
    return draft, native


def render_preview(draft, native, audio_path, output):
    source = {'sha256': _sha256(audio_path), 'duration_seconds': draft['duration'],
              'sample_rate': 16000, 'channels': 1}
    document = performance.new_document(performance_id='kong-draft', source=source)
    for event in draft['events']:
        performance.add_note(
            document, note_id=event['id'], pitch_midi=event['pitch'],
            onset_seconds=event['onset'],
            velocity_midi=max(1, min(127, int(round(event['velocity'] * 127)))),
            velocity_provenance={'kind': 'model_estimated', 'model': 'kong'})
    for index, span in enumerate(draft.get('pedal') or []):
        performance.add_pedal(document, pedal_id=f'pedal-{index}-on', pedal_type='sustain',
                              onset_seconds=span['onset'], value=1.0,
                              provenance={'kind': 'model_estimated', 'model': 'kong'})
        performance.add_pedal(document, pedal_id=f'pedal-{index}-off', pedal_type='sustain',
                              onset_seconds=span['offset'], value=0.0,
                              provenance={'kind': 'model_estimated', 'model': 'kong'})
    sidecar = {'schema': 'piano-model-native-1', 'variant': 'kong-draft',
               'offset_convention': 'kong/native-offset',
               'events': [{'id': event['id'], 'pitch': event['pitch'],
                           'onset_seconds': event['onset_seconds'],
                           'offset_seconds': event['offset_seconds'],
                           'velocity': next(
                               int(round(item['velocity'] * 127))
                               for item in draft['events'] if item['id'] == event['id'])}
                          for event in native]}
    entry = previews.render_preview(document, output, native=sidecar)
    if entry['clipping']:
        raise ValueError('The common preview clipped; refusing a clipped lesson preview.')
    return entry


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('input', 'source', 'job', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    profile = json.loads(os.environ['MUSIC_RUN_PROFILE'])
    checkpoint = Path(os.environ['MUSIC_MODEL_WEIGHTS'])
    job = json.loads(Path(args.job).read_text(encoding='utf-8'))
    duration = float(job['duration'])
    result, audio = transcribe(args.input, profile, checkpoint,
                               profile.get('device', 'cpu'))
    audio_sha = hashlib.sha256(Path(args.input).read_bytes()).hexdigest()
    draft, native = build(duration, result, profile, audio_sha, _sha256(checkpoint))
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    preview_entry = render_preview(draft, native, args.input, out / 'preview.wav')
    draft['preview_identity'] = preview_entry['preview_identity']
    (out / 'native.json').write_text(json.dumps({'events':native,'pedal':result.get('est_pedal_events',[]),'preview':preview_entry},default=_json_scalar),encoding='utf-8')
    with zipfile.ZipFile(out/'analysis.zip','w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('raw-note-events.json',json.dumps({'notes':result['est_note_events'],'pedal':result.get('est_pedal_events',[])},default=_json_scalar))
        archive.writestr('metadata.json',json.dumps({'schema':'kong-raw-analysis-1','profile':profile,
            'audio_sha256':audio_sha,'weights_sha256':_sha256(checkpoint),'correction_enabled':False,
            'correction_operations':0,'preview':preview_entry}))
        archive.write(out/'native.json','native.json')
    draft['analysis']={'key':'analysis.zip','mime':'application/zip','bytes':0,'sha256':'0'*64}
    (out / 'reference.json').write_text(json.dumps(draft, separators=(',', ':')),
                                       encoding='utf-8')
    (out / 'result.json').write_text(json.dumps(
        {'draft': draft, 'files': {'reference': 'reference.json',
                                   'piano_preview': 'preview.wav','analysis':'analysis.zip'}}), encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
