"""Package 2: raw model adapters, canonical performance output and field semantics.

Every adapter returns three separate things:

1. a canonical `piano-performance-1` document containing only honestly mapped fields;
2. a versioned native sidecar retaining predictions that cannot be mapped (predicted
   offsets, amplitude proxies, pedal spans);
3. a receipt binding source, interval, checkpoint, decoder, runtime and the correction
   bypass.

No adapter calls a correction stage. No predicted offset is relabelled as physical key
release, and no amplitude proxy is relabelled as captured MIDI velocity.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

try:
    from scripts import piano_model_registry as registry_module
    from scripts import piano_reconstruction_harness as harness
    from scripts import piano_performance as performance
except ImportError:  # pragma: no cover - direct script execution
    import piano_model_registry as registry_module
    import piano_reconstruction_harness as harness
    import piano_performance as performance

SCHEMA_RECEIPT = 'piano-model-run-receipt-1'
SCHEMA_NATIVE = 'piano-model-native-1'
SCHEMA_FIELDS = 'piano-model-field-semantics-1'
ADAPTER_VERSION = 'piano-model-adapters-1'
MODE = 'raw-model-comparison-v1'
BASIC_PITCH_SAMPLE_RATE = 22050
KONG_SAMPLE_RATE = 16000
DATASET_PATH = (Path(__file__).resolve().parents[1] / '.local' / 'piano-diagnosis'
                / 'reference-packages' / 'extracted')


class AdapterError(ValueError):
    """The adapter cannot produce an honest raw result."""


class ConservationError(AdapterError):
    """Native predictions and the canonical document disagree."""


class AdapterUnavailable(AdapterError):
    """The model runtime or checkpoint is not installed on this host."""


def _sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _json_sha256(value):
    return _sha256_bytes(json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8'))


def field_manifest(entry):
    """Declare what each field means for this variant, including what is absent."""
    capabilities = entry['capabilities']
    velocity = capabilities['velocity']
    pedal = capabilities['pedal']
    return {
        'schema': SCHEMA_FIELDS,
        'version': 1,
        'variant': entry['id'],
        'fields': {
            'pitch_onset': {'status': 'measured', 'source': 'native'},
            'key_release': {'status': 'not_estimated', 'source': None,
                            'note': 'a predicted offset is not a physical key release'},
            'audible_end': {'status': 'not_estimated', 'source': None,
                            'note': 'no independently annotated audible ending exists'},
            'predicted_offset': {'status': 'native_sidecar',
                                 'convention': capabilities['ending_convention'],
                                 'source': 'native'},
            'velocity_midi': {
                'status': ('amplitude_proxy' if velocity == 'amplitude_proxy'
                           else 'model_estimated'),
                'units': capabilities.get('velocity_units'),
                'source': 'native',
                'note': ('amplitude is a proxy, never calibrated strike velocity'
                         if velocity == 'amplitude_proxy'
                         else 'predicted MIDI velocity, not a captured measurement'),
            },
            'pedal': {'status': ('none' if pedal == 'none' else 'native_trajectory'),
                      'types': [] if pedal == 'none' else ['sustain'],
                      'source': 'native' if pedal != 'none' else None},
            'written_duration': {'status': 'not_estimated', 'source': None},
        },
    }


def _method(entry, name):
    family = entry['family']
    if family == 'basic-pitch':
        return 'amplitude'
    if family in ('kong', 'transkun', 'onsets-frames'):
        return 'velocity'
    raise AdapterError(f'{entry["id"]}: unknown family {family!r} for {name}')


def canonicalise(entry, notes, *, source, duration, interval=None, pedal_spans=()):
    """Map native notes into a canonical document plus a native sidecar.

    ``notes`` carry ``id``, ``pitch``, ``onset_seconds``, ``offset_seconds`` and either
    ``velocity`` (model-estimated MIDI) or ``amplitude`` (proxy). The family decides which
    one is legal; passing the wrong unit is an error rather than a silent relabelling.
    """
    start, end = (0.0, float(duration)) if interval is None else (
        float(interval[0]), float(interval[1]))
    if not 0.0 <= start < end <= float(duration) + 1e-6:
        raise AdapterError(f'invalid interval {interval!r} for duration {duration}')

    method = _method(entry, 'velocity')
    kept = []
    dropped = 0
    offset_beyond = 0
    seen_ids = set()
    for note in notes:
        identifier = str(note['id'])
        if identifier in seen_ids:
            raise AdapterError(f'duplicate native event id {identifier!r}')
        seen_ids.add(identifier)
        onset = float(note['onset_seconds'])
        offset = float(note['offset_seconds'])
        if not (math.isfinite(onset) and math.isfinite(offset)):
            raise AdapterError(f'{identifier}: non-finite time')
        if offset < onset:
            raise AdapterError(f'{identifier}: offset precedes onset')
        if not start <= onset <= end:
            dropped += 1
            continue
        if offset > end + 1e-9:
            offset_beyond += 1
        if method == 'amplitude':
            if note.get('velocity') is not None:
                raise AdapterError(f'{identifier}: an amplitude proxy is not MIDI velocity')
            if note.get('amplitude') is None:
                raise AdapterError(f'{identifier}: Basic Pitch needs an amplitude value')
            value = float(note['amplitude'])
            if not 0.0 <= value <= 1.0:
                raise AdapterError(f'{identifier}: amplitude must be within 0..1')
            velocity_midi = None
            provenance = {'kind': 'amplitude_proxy', 'amplitude': round(value, 6)}
        else:
            if note.get('velocity') is None:
                raise AdapterError(f'{identifier}: this family needs a MIDI velocity')
            if note.get('amplitude') is not None:
                raise AdapterError(f'{identifier}: cannot mix velocity and amplitude')
            velocity_midi = int(round(float(note['velocity'])))
            if not 1 <= velocity_midi <= 127:
                raise AdapterError(f'{identifier}: velocity must be within 1..127')
            provenance = {'kind': 'model_estimated', 'model': entry['family']}
        kept.append({'id': identifier, 'pitch': int(note['pitch']),
                     'onset_seconds': round(onset, 6), 'offset_seconds': round(offset, 6),
                     'velocity': note.get('velocity'), 'amplitude': note.get('amplitude'),
                     'velocity_midi': velocity_midi, 'provenance': provenance})

    if not kept:
        raise AdapterError('the model produced no events inside the declared interval')

    document = performance.new_document(
        performance_id=f'{entry["id"]}-{source["sha256"][:12]}',
        source=source, origin='model')
    for event in kept:
        performance.add_note(
            document, note_id=event['id'], pitch_midi=event['pitch'],
            onset_seconds=event['onset_seconds'], velocity_midi=event['velocity_midi'],
            velocity_provenance=event['provenance'], key_release_seconds=None,
            audible_end=None)

    pedal_native = []
    if pedal_spans:
        if entry['capabilities']['pedal'] == 'none':
            raise AdapterError(f'{entry["id"]}: pedal spans supplied for a no-pedal variant')
        for index, span in enumerate(pedal_spans):
            onset = float(span['onset_seconds'])
            offset = float(span['offset_seconds'])
            if offset < onset:
                raise AdapterError('pedal span offset precedes onset')
            if not start <= onset <= end:
                continue
            pedal_native.append({'onset_seconds': round(onset, 6),
                                 'offset_seconds': round(offset, 6)})
            performance.add_pedal(document, pedal_id=f'pedal-{index}-on',
                                  pedal_type='sustain', onset_seconds=onset, value=1.0,
                                  provenance={'kind': 'model_estimated',
                                              'model': entry['family']})
            performance.add_pedal(document, pedal_id=f'pedal-{index}-off',
                                  pedal_type='sustain', onset_seconds=offset, value=0.0,
                                  provenance={'kind': 'model_estimated',
                                              'model': entry['family']})
    performance.validate(document)

    native = {
        'schema': SCHEMA_NATIVE,
        'version': 1,
        'variant': entry['id'],
        'family': entry['family'],
        'offset_convention': entry['capabilities']['ending_convention'],
        'note_count': len(kept),
        'dropped_outside_interval': dropped,
        'offset_beyond_interval': offset_beyond,
        'events': [{'id': event['id'], 'pitch': event['pitch'],
                    'onset_seconds': event['onset_seconds'],
                    'offset_seconds': event['offset_seconds'],
                    ('amplitude' if method == 'amplitude' else 'velocity'):
                        event.get('amplitude') if method == 'amplitude'
                        else event.get('velocity')}
                   for event in kept],
        'pedal': {'status': ('native_trajectory'
                             if entry['capabilities']['pedal'] != 'none' else 'not_estimated'),
                  'types': ['sustain'] if entry['capabilities']['pedal'] != 'none' else [],
                  'spans': pedal_native},
        'field_semantics': field_manifest(entry),
    }
    return {'document': document, 'native': native,
            'counts': {'notes': len(kept), 'dropped_outside_interval': dropped,
                       'offset_beyond_interval': offset_beyond,
                       'pedal_spans': len(pedal_native)}}


def verify_conservation(document, native):
    """Every native event must survive into the document once, with honest semantics."""
    if len(document['notes']) != native['note_count']:
        raise ConservationError('note count changed during canonicalisation')
    by_id = {note['id']: note for note in document['notes']}
    if set(by_id) != {event['id'] for event in native['events']}:
        raise ConservationError('native event ids do not match the document')
    method = 'amplitude' if 'amplitude' in native['events'][0] else 'velocity'
    for event in native['events']:
        note = by_id[event['id']]
        if note['pitch_midi'] != event['pitch']:
            raise ConservationError(f'{event["id"]}: pitch changed')
        if abs(note['onset_seconds'] - event['onset_seconds']) > 1e-6:
            raise ConservationError(f'{event["id"]}: onset changed')
        if note['key_release_seconds'] is not None:
            raise ConservationError(f'{event["id"]}: predicted offset was labelled a release')
        if method == 'amplitude':
            if note['velocity_midi'] is not None:
                raise ConservationError(f'{event["id"]}: amplitude became a MIDI velocity')
        else:
            if note['velocity_midi'] != int(round(event['velocity'])):
                raise ConservationError(f'{event["id"]}: velocity changed')
        if abs(event['onset_seconds'] - event['offset_seconds']) <= 0:
            raise ConservationError(f'{event["id"]}: empty predicted duration')
    expected_pedal = 2 * len(native['pedal']['spans'])
    if len(document['pedal']) != expected_pedal:
        raise ConservationError('pedal events do not match the native spans')
    return True


def prepare_audio(source, output, *, interval, sample_rate, channels=1):
    """Deterministic trim/downmix/resample from the frozen master; record the rule."""
    source = Path(source)
    samples, rate = harness.read_wav(source)
    if samples.ndim == 1:
        samples = samples[:, None]
    frames = samples.shape[0]
    start, end = float(interval[0]), float(interval[1])
    if not 0.0 <= start < end <= frames / rate + 1e-6:
        raise AdapterError(f'invalid interval {interval!r} for {frames / rate:.6f}s of audio')
    first = int(round(start * rate))
    last = min(int(round(end * rate)), frames)
    segment = samples[first:last]
    rules = ['trim']
    if segment.shape[1] != channels:
        if channels != 1:
            raise AdapterError('only mono downmix is supported')
        segment = segment.mean(axis=1, keepdims=True)
        rules.append('downmix-to-mono')
    if rate != sample_rate:
        from math import gcd
        from scipy.signal import resample_poly
        divisor = gcd(int(rate), int(sample_rate))
        segment = resample_poly(segment, sample_rate // divisor, rate // divisor, axis=0)
        rules.append(f'resample-poly:{rate}->{sample_rate}')
    segment = np.asarray(segment, dtype=np.float32)
    harness.write_wav(output, segment, sample_rate, bit_depth=24)
    return {'path': str(output), 'sha256': _sha256_file(output),
            'bytes': Path(output).stat().st_size, 'sample_rate': sample_rate,
            'channels': int(segment.shape[1]), 'frames': int(segment.shape[0]),
            'seconds': segment.shape[0] / float(sample_rate),
            'conversion': {'rules': rules, 'source_sha256': _sha256_file(source),
                           'interval': [start, end]}}


def _decode_basic_pitch(entry, audio_path, weights):
    """Run the pinned Basic Pitch inference and native/piano-peaks decoding."""
    try:
        from scripts.music_basic_pitch_adapter import (
            DEFAULT_DECODING, PIANO_DECODING, decode_predictions, note_events)
        from basic_pitch.inference import run_inference
    except ImportError as error:  # pragma: no cover - runtime dependent
        raise AdapterUnavailable(f'Basic Pitch is not installed: {error}') from error
    if _sha256_file(weights) != entry['checkpoint']['sha256']:
        raise AdapterError('weights do not match the pinned checkpoint digest')
    model_output = run_inference(Path(audio_path), Path(weights))
    if set(model_output) != {'note', 'onset', 'contour'}:
        raise AdapterError('Basic Pitch returned unexpected activation arrays')
    thresholds = entry['decoder']['thresholds'] or {}
    decoding = {**DEFAULT_DECODING, **(entry['decoder']['decoding'] or {})}
    if entry['decoder']['profile'] == PIANO_DECODING and not decoding['decoding_version'] == \
            PIANO_DECODING:
        raise AdapterError('current-app variant must use the piano-peaks decoder')
    midi, notes = decode_predictions(model_output, thresholds, decoding)
    seconds = harness.inspect_wav(audio_path)['seconds']
    events = note_events(notes, seconds)
    native = [{'id': event['id'], 'pitch': event['pitch'],
               'onset_seconds': event['onset'],
               'offset_seconds': event['onset'] + event['duration'],
               'amplitude': event['velocity']} for event in events]
    return native, [], {'device': entry['environment']['device'],
                        'backend': entry['environment']['backend'],
                        'model_output_sha256': _json_sha256(
                            {key: hashlib.sha256(np.asarray(value).tobytes()).hexdigest()
                             for key, value in model_output.items()})}


def _decode_kong(entry, audio_path, checkpoint, device):
    """Run the pinned Kong inference; pedal spans and model-estimated velocity survive."""
    try:
        if str(DATASET_PATH) not in sys.path:
            sys.path.insert(0, str(DATASET_PATH))
        from piano_transcription_inference import PianoTranscription, sample_rate
    except ImportError as error:  # pragma: no cover - runtime dependent
        raise AdapterUnavailable(f'Kong inference package is not available: {error}') from error
    if _sha256_file(checkpoint) != entry['checkpoint']['sha256']:
        raise AdapterError('checkpoint does not match the pinned digest')
    # The prepared audio is already the package's 16 kHz mono float input. Loading it
    # directly avoids the vendored audioread/librosa helper, whose private API differs
    # across librosa versions; the samples are identical either way.
    samples, rate = harness.read_wav(audio_path)
    if rate != sample_rate:
        raise AdapterError(f'Kong needs {sample_rate} Hz audio, got {rate}')
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    audio = np.ascontiguousarray(samples, dtype=np.float32)
    transcriptor = PianoTranscription(device=device, checkpoint_path=str(checkpoint))
    result = transcriptor.transcribe(audio, None)
    notes = [{'id': f'kong-{index + 1}', 'pitch': int(event['midi_note']),
              'onset_seconds': float(event['onset_time']),
              'offset_seconds': float(event['offset_time']),
              'velocity': int(event['velocity'])}
             for index, event in enumerate(result['est_note_events'])]
    pedals = [{'onset_seconds': float(event['onset_time']),
               'offset_seconds': float(event['offset_time'])}
              for event in (result['est_pedal_events'] or [])]
    return notes, pedals, {'device': str(device),
                           'backend': 'pytorch',
                           'sample_rate': int(sample_rate)}

def run(entry, source, interval, output_dir, *, weights=None, checkpoint=None,
        device=None, created_at=None):
    """Prepare the common audio, run one raw adapter, and freeze its outputs."""
    if entry['status'] != registry_module.STATUS_READY:
        raise AdapterError(f'{entry["id"]} is not runnable: {entry["status"]}')
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    sample_rate = (BASIC_PITCH_SAMPLE_RATE if entry['family'] == 'basic-pitch'
                   else KONG_SAMPLE_RATE)
    prepared = prepare_audio(source, output_dir / 'prepared.wav', interval=interval,
                             sample_rate=sample_rate)
    started = time.time()
    if entry['family'] == 'basic-pitch':
        local_weights = Path(weights) if weights else _locate_basic_pitch_weights()
        notes, pedals, execution = _decode_basic_pitch(entry, prepared['path'],
                                                       local_weights)
        identity = {'weights_sha256': _sha256_file(local_weights)}
    elif entry['family'] == 'kong':
        local_checkpoint = Path(checkpoint) if checkpoint else Path(
            entry['checkpoint']['locator'])
        notes, pedals, execution = _decode_kong(entry, prepared['path'], local_checkpoint,
                                                device or entry['environment']['device'])
        identity = {'checkpoint_sha256': _sha256_file(local_checkpoint)}
    else:
        raise AdapterUnavailable(f'{entry["id"]}: adapter is not implemented yet')
    elapsed = round(time.time() - started, 3)

    source_identity = {
        'sha256': prepared['sha256'], 'duration_seconds': prepared['seconds'],
        'sample_rate': prepared['sample_rate'], 'channels': prepared['channels'],
        'path_hint': str(output_dir / 'prepared.wav')}
    canonical = canonicalise(entry, notes, source=source_identity,
                             duration=prepared['seconds'], interval=[0.0, prepared['seconds']],
                             pedal_spans=pedals)
    verify_conservation(canonical['document'], canonical['native'])
    (output_dir / 'native.json').write_text(
        json.dumps(canonical['native'], indent=2, sort_keys=True), encoding='utf-8')
    (output_dir / 'document.json').write_text(performance.to_json(canonical['document']),
                                              encoding='utf-8')
    semantics = field_manifest(entry)
    (output_dir / 'semantics.json').write_text(
        json.dumps(semantics, indent=2, sort_keys=True), encoding='utf-8')
    receipt = {
        'schema': SCHEMA_RECEIPT,
        'version': 1,
        'adapter_version': ADAPTER_VERSION,
        'mode': MODE,
        'variant': entry['id'],
        'family': entry['family'],
        'status': 'ready',
        'correction_enabled': False,
        'expression_correction_enabled': False,
        'correction_operations': 0,
        'created_at': created_at or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': {'master_sha256': prepared['conversion']['source_sha256'],
                   'prepared_sha256': prepared['sha256'],
                   'interval': prepared['conversion']['interval'],
                   'conversion': prepared['conversion']},
        'identity': {**identity,
                     'checkpoint_sha256': entry['checkpoint'].get('sha256'),
                     'decoder_profile': entry['decoder']['profile'],
                     'decoder_profile_sha256': entry['decoder'].get('source_profile_sha256'),
                     'adapter_sha256': _sha256_file(__file__),
                     'environment': entry['environment']},
        'runtime': {**execution, 'seconds': elapsed},
        'outputs': {'document': 'document.json',
                    'document_sha256': _sha256_file(output_dir / 'document.json'),
                    'native': 'native.json',
                    'native_sha256': _sha256_file(output_dir / 'native.json'),
                    'semantics': 'semantics.json',
                    'counts': canonical['counts']},
        'warnings': [],
    }
    (output_dir / 'receipt.json').write_text(
        json.dumps(receipt, indent=2, sort_keys=True), encoding='utf-8')
    return receipt


def _locate_basic_pitch_weights():
    try:
        import basic_pitch
    except ImportError as error:  # pragma: no cover - runtime dependent
        raise AdapterUnavailable(f'Basic Pitch is not installed: {error}') from error
    path = Path(basic_pitch.__file__).parent / 'saved_models' / 'icassp_2022' / 'nmp.onnx'
    if not path.is_file():
        raise AdapterUnavailable('the installed Basic Pitch package has no pinned weights')
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description='Raw piano model adapters.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    fields = subparsers.add_parser('fields', help='show the field-semantics manifest')
    fields.add_argument('--variant', required=True)
    fields.add_argument('--json', action='store_true')
    prepare = subparsers.add_parser('prepare', help='create the deterministic model audio')
    prepare.add_argument('--source', type=Path, required=True)
    prepare.add_argument('--output', type=Path, required=True)
    prepare.add_argument('--start', type=float, default=0.0)
    prepare.add_argument('--end', type=float, required=True)
    prepare.add_argument('--sample-rate', type=int, default=BASIC_PITCH_SAMPLE_RATE)
    run_parser = subparsers.add_parser('run', help='run one adapter into a frozen directory')
    run_parser.add_argument('--variant', required=True)
    run_parser.add_argument('--source', type=Path, required=True)
    run_parser.add_argument('--start', type=float, default=0.0)
    run_parser.add_argument('--end', type=float, required=True)
    run_parser.add_argument('--output', type=Path, required=True)
    run_parser.add_argument('--weights', type=Path)
    run_parser.add_argument('--checkpoint', type=Path)
    run_parser.add_argument('--device')
    arguments = parser.parse_args(argv)
    try:
        built = registry_module.build()
        entry = registry_module.variant(built, arguments.variant)
        if arguments.command == 'fields':
            manifest = field_manifest(entry)
            print(json.dumps(manifest, indent=2, sort_keys=True) if arguments.json
                  else json.dumps(manifest['fields'], indent=2, sort_keys=True))
            return 0
        if arguments.command == 'prepare':
            info = prepare_audio(arguments.source, arguments.output,
                                 interval=[arguments.start, arguments.end],
                                 sample_rate=arguments.sample_rate)
            print(json.dumps(info, indent=2, sort_keys=True))
            return 0
        receipt = run(entry, arguments.source, [arguments.start, arguments.end],
                      arguments.output, weights=arguments.weights,
                      checkpoint=arguments.checkpoint, device=arguments.device)
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0
    except (AdapterError, registry_module.RegistryError, harness.HarnessError, OSError,
            json.JSONDecodeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
