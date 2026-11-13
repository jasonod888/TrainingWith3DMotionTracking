"""Package 5: common-render previews for every model, with one fixed gain policy.

Both listening modes use the same renderer, sample rate, channel layout and gain policy:

* **as transcribed** keeps each model's declared velocity (or amplitude-derived render
  intensity) and pedal, with the renderer's documented release assumption when the model
  has no physical release;
* **notes and timing only** ignores velocity and pedal entirely and uses one fixed
  intensity and one documented duration, isolating detection from dynamics.

No per-model normalization is applied. Clipping, peak and RMS are recorded so a level
difference cannot masquerade as a quality difference. Every note is resolved and counted:
a silent preview cap is refused.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

try:
    from scripts import piano_performance as performance
    from scripts import piano_render as render
    from scripts import piano_reconstruction_harness as harness
except ImportError:  # pragma: no cover - direct script execution
    import piano_performance as performance
    import piano_render as render
    import piano_reconstruction_harness as harness

SCHEMA = 'piano-model-preview-1'
VERSION = '1.0.0'
SAMPLE_RATE = 22050
CHANNELS = 1
TAIL_SECONDS = 1.0
COMMON_GAIN_DB = 0.0
# One declared common headroom for every model preview, applied inside the renderer before
# its internal saturation. It is fixed, not fitted per model.
COMMON_HEADROOM_DB = -24.0
NOTES_ONLY_INTENSITY = 0.6
NOTES_ONLY_DURATION_SECONDS = 0.5
NATIVE_OFFSET_SEMANTICS = 'legacy-not-release'


class PreviewError(ValueError):
    """The preview cannot be produced honestly."""


def _dbfs(value):
    return round(20.0 * math.log10(max(float(value), 1e-9)), 3)


def _sidecar_sha256(native):
    return hashlib.sha256(json.dumps(native, sort_keys=True, separators=(',', ':'))
                          .encode('utf-8')).hexdigest()


def preview_document(document, *, native=None, notes_only=False):
    """Derive the render-only document and record exactly which mapping was used.

    The canonical model document is never modified. As transcribed uses the declared
    native offset as a *render duration* (never as physical release) and maps Basic Pitch
    amplitude to an uncalibrated intensity. Notes-only deliberately fixes both.
    """
    source = json.loads(json.dumps(document))
    mapping = {'native_offsets': None, 'amplitude_to_intensity': None}
    if notes_only:
        for note in source['notes']:
            note['velocity_midi'] = None
            note['render_intensity'] = NOTES_ONLY_INTENSITY
            note['key_release_seconds'] = (float(note['onset_seconds'])
                                           + NOTES_ONLY_DURATION_SECONDS)
            note['legacy'] = None
            note['audible_end'] = None
        source['pedal'] = []
        performance.validate(source)
        return source, mapping

    events = {}
    if native:
        events = {str(event['id']): event for event in native['events']}
        mapping['native_offsets'] = {
            'convention': native.get('offset_convention'),
            'sidecar_sha256': _sidecar_sha256(native),
            'notes': 0,
        }
    amplitude_notes = 0
    for note in source['notes']:
        event = events.get(str(note['id']))
        if event and event.get('offset_seconds') is not None:
            duration = float(event['offset_seconds']) - float(event['onset_seconds'])
            if duration > 0:
                note['legacy'] = {'duration_seconds': round(duration, 6),
                                  'velocity_amplitude': None,
                                  'semantics': NATIVE_OFFSET_SEMANTICS}
                mapping['native_offsets']['notes'] += 1
        provenance = note.get('velocity_provenance') or {}
        if note.get('velocity_midi') is None and provenance.get('kind') == 'amplitude_proxy':
            amplitude = provenance.get('amplitude')
            if isinstance(amplitude, (int, float)):
                note['render_intensity'] = float(min(max(amplitude, 0.0), 1.0))
                amplitude_notes += 1
            if mapping['amplitude_to_intensity'] is None:
                mapping['amplitude_to_intensity'] = {
                    'rule': 'clamp(amplitude_proxy, 0, 1) -> render_intensity',
                    'calibrated_midi_velocity': False,
                }
    if amplitude_notes:
        mapping['amplitude_to_intensity']['notes'] = amplitude_notes
    performance.validate(source)
    return source, mapping


def notes_only_document(document):
    """Compatibility helper: the derived notes-only document."""
    source, _mapping = preview_document(document, notes_only=True)
    return source


def _preview_renderer(renderer=None):
    if renderer is not None:
        return renderer
    factory = getattr(render, 'AdditiveReferenceRenderer', None)
    if factory is not None:
        return factory(headroom_db=COMMON_HEADROOM_DB)
    return render.get_renderer()


def render_preview(document, output, *, notes_only=False, native=None, renderer=None,
                   sample_rate=SAMPLE_RATE, channels=CHANNELS, strict=True):
    """Render one complete preview and return its manifest entry."""
    source, mapping = preview_document(document, native=native, notes_only=notes_only)
    renderer = _preview_renderer(renderer)
    spec = render.OutputSpec(sample_rate=sample_rate, channels=channels,
                             tail_seconds=TAIL_SECONDS)
    request = renderer.resolve(source, spec)
    if len(request.notes) != len(source['notes']):
        raise PreviewError('the renderer dropped notes; a truncated preview is not a result')
    result = renderer.render(source, spec, strict=strict)
    audio = np.asarray(result.audio, dtype=np.float32)
    if COMMON_GAIN_DB:
        audio = audio * (10.0 ** (COMMON_GAIN_DB / 20.0))
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
    output = Path(output)
    harness.write_wav(output, audio, sample_rate, bit_depth=24)
    warnings = list(result.warnings)
    if mapping['native_offsets'] and mapping['native_offsets']['notes']:
        warnings.append('native predicted offsets used as render durations for '
                        f"{mapping['native_offsets']['notes']} note(s); they are not "
                        'measured physical key release')
    if mapping['amplitude_to_intensity'] and mapping['amplitude_to_intensity'].get('notes'):
        warnings.append('amplitude proxy mapped to uncalibrated render intensity for '
                        f"{mapping['amplitude_to_intensity']['notes']} note(s); not MIDI "
                        'velocity')
    preview_identity = hashlib.sha256(json.dumps({
        'render_identity': result.identity,
        'native_sidecar_sha256': ((mapping['native_offsets'] or {}).get('sidecar_sha256')),
        'mapping': mapping,
        'headroom_db': COMMON_HEADROOM_DB,
    }, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    return {
        'schema': SCHEMA,
        'version': VERSION,
        'file': output.name,
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'seconds': round(audio.shape[0] / float(sample_rate), 6),
        'sample_rate': sample_rate,
        'channels': int(audio.shape[1]) if audio.ndim > 1 else 1,
        'note_count': len(source['notes']),
        'rendered_notes': len(request.notes),
        'mode': 'notes_only' if notes_only else 'as_transcribed',
        'gain_policy': {'common_gain_db': COMMON_GAIN_DB, 'normalization': 'none',
                        'headroom_db': COMMON_HEADROOM_DB},
        'mapping': mapping,
        'preview_identity': preview_identity,
        'peak_dbfs': _dbfs(peak),
        'rms_dbfs': _dbfs(rms),
        'clipping': peak >= 0.999,
        'renderer': result.renderer,
        'renderer_version': result.renderer_version,
        'asset_sha256': result.asset_sha256,
        'identity': result.identity,
        'controls': result.control_support.to_dict(),
        'release_sources': dict(result.release_sources),
        'warnings': warnings,
        'notes_only_convention': ({'intensity': NOTES_ONLY_INTENSITY,
                                   'duration_seconds': NOTES_ONLY_DURATION_SECONDS}
                                  if notes_only else None),
    }


def render_run(document_path, output_dir, native_path=None):
    """Render both preview modes for one model run and write the manifest."""
    if isinstance(document_path, dict):
        document = document_path
    else:
        document = json.loads(Path(document_path).read_text(encoding='utf-8'))
    performance.validate(document)
    native = None
    if native_path is not None:
        native = (native_path if isinstance(native_path, dict) else
                  json.loads(Path(native_path).read_text(encoding='utf-8')))
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    as_transcribed = render_preview(document, output_dir / 'preview.wav', native=native)
    notes_only = render_preview(document, output_dir / 'preview-notes.wav',
                                notes_only=True, native=native)
    manifest = {'schema': SCHEMA, 'version': VERSION,
                'variant': document['performance_id'],
                'native_sidecar_sha256': (_sidecar_sha256(native) if native else None),
                'common': {'renderer': as_transcribed['renderer'],
                           'renderer_version': as_transcribed['renderer_version'],
                           'sample_rate': SAMPLE_RATE, 'channels': CHANNELS,
                           'gain_policy': as_transcribed['gain_policy']},
                'previews': {'as_transcribed': as_transcribed,
                             'notes_only': notes_only},
                'notes': [
                    'Both modes use one renderer, preset, gain and headroom policy.',
                    'As transcribed uses declared native offsets as render durations and '
                    'amplitude proxies as uncalibrated intensity; neither is a measured '
                    'physical quantity.',
                    'Notes only ignores native offsets and amplitude and fixes intensity '
                    'and duration.',
                    'No per-model normalization is applied; clipping and level are recorded.',
                ]}
    (output_dir / 'preview.json').write_text(json.dumps(manifest, indent=2, sort_keys=True),
                                             encoding='utf-8')
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description='Render common model previews.')
    parser.add_argument('--document', type=Path, required=True)
    parser.add_argument('--native', type=Path,
                        help='native sidecar carrying predicted offsets/amplitude')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--json', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        manifest = render_run(arguments.document, arguments.output,
                              native_path=arguments.native)
    except (PreviewError, render.RenderError, performance.PerformanceError, OSError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(json.dumps(manifest, indent=2, sort_keys=True) if arguments.json
          else f"Rendered {arguments.output / 'preview.wav'} and preview-notes.wav")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
