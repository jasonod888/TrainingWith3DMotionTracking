"""Phase-C comparison harness: source audio versus a rendered performance.

The harness keeps everything a later reviewer needs to re-run or reject a comparison: the
source hash and header, the performance document and its resolved render identity, the
rendered samples, the codec actually delivered, the frozen objective identity, and both a
gain-calibrated and an absolute comparison of the float render *and* of the delivered file.

It removes a declared fixed renderer latency and never time-warps anything else. It also
states whether a result may be used for qualification; an approximate renderer or an
ignored control is diagnostic only, by construction.
"""
import argparse
import hashlib
import json
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

try:  # prefer the package path so error classes have one identity under pytest
    from scripts import piano_performance as performance_document
    from scripts import piano_reconstruction_metrics as metrics
    from scripts import piano_render as render
except ImportError:  # pragma: no cover - direct script execution
    import piano_performance as performance_document
    import piano_reconstruction_metrics as metrics
    import piano_render as render

SCHEMA = 'piano-reconstruction-comparison-2'
DURATION_TOLERANCE_SECONDS = 0.05
MAX_SOURCE_SECONDS = 900.0
SUPPORTED_WIDTHS = {1: 'uint8', 2: 'int16', 3: 'int24', 4: 'int32'}


class HarnessError(ValueError):
    """The comparison cannot be trusted or completed."""


class SourceTooLarge(HarnessError):
    """The source exceeds the bounded processing limit before arrays are allocated."""


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def inspect_wav(path):
    """Read and validate the header before allocating anything for the payload."""
    path = Path(path)
    try:
        with wave.open(str(path), 'rb') as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            frames = handle.getnframes()
    except wave.Error as error:
        raise HarnessError(f'{path} is not a readable PCM WAV: {error}') from error
    if width not in SUPPORTED_WIDTHS:
        raise HarnessError(f'unsupported sample width {width} in {path}')
    if channels not in (1, 2):
        raise HarnessError(f'unsupported channel count {channels} in {path}')
    if rate <= 0 or frames <= 0:
        raise HarnessError(f'{path} declares no audio')
    seconds = frames / float(rate)
    if seconds > MAX_SOURCE_SECONDS:
        raise SourceTooLarge(
            f'{path} is {seconds:.1f}s, beyond the {MAX_SOURCE_SECONDS:g}s bounded limit; '
            'chunk it explicitly rather than allocating the whole file')
    return {'channels': channels, 'sample_width': width, 'sample_format': SUPPORTED_WIDTHS[width],
            'sample_rate': rate, 'frames': frames, 'seconds': round(seconds, 4),
            'bytes_per_frame': channels * width}


def read_wav(path):
    """Read PCM WAV into ``(float32 [frames, channels], sample_rate)`` using only stdlib."""
    path = Path(path)
    header = inspect_wav(path)
    with wave.open(str(path), 'rb') as handle:
        raw = handle.readframes(header['frames'])
    width = header['sample_width']
    channels = header['channels']

    if width == 1:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        data = (data - 128.0) / 128.0
    elif width == 2:
        data = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 3:
        triplets = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        value = triplets[:, 0] | (triplets[:, 1] << 8) | (triplets[:, 2] << 16)
        value = np.where(value >= 1 << 23, value - (1 << 24), value)
        data = value.astype(np.float32) / float(1 << 23)
    else:
        data = (np.frombuffer(raw, dtype='<i4').astype(np.float64) / float(1 << 31)).astype(
            np.float32)
    if channels > 1:
        data = data.reshape(-1, channels)
    else:
        data = data.reshape(-1)
    return data, header['sample_rate']


def write_wav(path, audio, sample_rate, bit_depth=24):
    """Write PCM. ``bit_depth`` 24 is the default research depth: re-encoding a reference
    to 16 bit raises the measurement floor of the spectral, decay and loudness components.
    """
    if bit_depth not in (16, 24):
        raise HarnessError('bit_depth must be 16 or 24')
    path = Path(path)
    array = np.asarray(audio, dtype=np.float32)
    if array.ndim == 1:
        array = array[:, None]
    clipped = np.clip(array, -1.0, 1.0)
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(array.shape[1])
        handle.setsampwidth(bit_depth // 8)
        handle.setframerate(int(sample_rate))
        if bit_depth == 16:
            handle.writeframes(np.round(clipped * 32767.0).astype('<i2').tobytes())
        else:
            value = np.round(clipped * (2 ** 23 - 1)).astype('<i4')
            handle.writeframes(value.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())
    return path


def encode_delivered(audio, sample_rate, bit_depth, directory=None):
    """Encode and decode the delivered representation, so the score describes the file."""
    if directory is None:
        with tempfile.TemporaryDirectory() as temporary:
            return encode_delivered(audio, sample_rate, bit_depth, Path(temporary))
    path = write_wav(Path(directory) / 'render.wav', audio, sample_rate, bit_depth)
    decoded, rate = read_wav(path)
    return {'audio': decoded, 'sample_rate': rate, 'path': path,
            'sha256': file_sha256(path), 'bit_depth': bit_depth,
            'bytes': path.stat().st_size,
            'format': f'wav-pcm-{bit_depth}'}


def load_performance(path):
    text = Path(path).read_text(encoding='utf-8')
    return performance_document.from_json(text)


def verify_source_identity(document, source_path, source_samples, source_rate):
    """Refuse a performance that was built against a different source file."""
    warnings = []
    declared_sha = document['source'].get('sha256')
    actual_sha = file_sha256(source_path)
    if declared_sha is not None and declared_sha != actual_sha:
        raise HarnessError(
            'the performance document was built against a different source: '
            f'declared {declared_sha[:12]}..., file is {actual_sha[:12]}...')
    if declared_sha is None:
        warnings.append('performance does not declare a source hash; identity is unverified')

    declared_duration = float(document['source']['duration_seconds'])
    actual_duration = source_samples.shape[0] / float(source_rate)
    if abs(declared_duration - actual_duration) > DURATION_TOLERANCE_SECONDS:
        warnings.append(
            f'declared source duration {declared_duration:.3f}s differs from the file '
            f'({actual_duration:.3f}s); check for a trimmed or untrimmed source')
    return actual_sha, warnings


def coverage(document):
    """Disclose what the performance does not measure rather than implying full coverage."""
    notes = document['notes']

    def end_status(note):
        return (note.get('audible_end') or {}).get('status')

    return {'notes': len(notes), 'pedal_events': len(document['pedal']),
            'notes_without_key_release': sum(1 for note in notes
                                             if note.get('key_release_seconds') is None),
            'notes_with_measured_release': sum(1 for note in notes
                                               if note.get('key_release_seconds') is not None),
            'notes_without_velocity': sum(1 for note in notes
                                          if note.get('velocity_midi') is None),
            'notes_with_measured_velocity': sum(1 for note in notes
                                                if note.get('velocity_midi') is not None),
            'notes_without_audible_end': sum(1 for note in notes
                                             if note.get('audible_end') is None),
            'audible_end_scorable': sum(1 for note in notes
                                        if end_status(note) == 'scorable'),
            'audible_end_uncertain': sum(1 for note in notes
                                         if end_status(note) == 'uncertain'),
            'notes_with_legacy_only': sum(1 for note in notes
                                          if note.get('legacy') is not None),
            'pedal_value_semantics': render.pedal_semantics(document)}


QUALIFICATION_TARGETS = ('audio_fidelity', 'stereo_room_fidelity', 'release', 'velocity',
                         'audible_end', 'pedal')
PEDAL_CAPABILITIES = ('sustain_pedal', 'soft_pedal', 'sostenuto_pedal', 'half_pedal')


def qualification(document, result, comparisons, *, source_identity=None, determinism_verified=False):
    """State which targets this comparison may support, and why any target is blocked.

    Identity is global: an undeclared or mismatched source hash invalidates every target,
    because nothing downstream can be attributed to the intended recording. Evidence gaps are
    target-specific, so a missing audible end does not forbid an independently evidenced
    target, and an approximate renderer is reported as diagnostic without silently approving
    fidelity.
    """
    identity = dict(source_identity or {})
    global_blockers = []
    advisory = []

    declared = bool(identity.get('declared'))
    verified = bool(identity.get('verified'))
    if not declared:
        global_blockers.append('the performance does not declare a source identity')
    elif not verified:
        global_blockers.append('the source audio does not match the performance declaration')

    incomplete = [name for name, comparison in comparisons.items() if not comparison.complete]
    if not comparisons:
        global_blockers.append('no audio comparisons were supplied')
    if incomplete:
        global_blockers.append(f'incomplete candidate in {incomplete}')

    targets = {name: {'valid': True, 'reasons': []} for name in QUALIFICATION_TARGETS}

    def block(target, reason):
        targets[target]['valid'] = False
        targets[target]['reasons'].append(reason)

    for blocker in global_blockers:
        for name in QUALIFICATION_TARGETS:
            block(name, blocker)

    approximate = bool(getattr(result, 'approximate', False)) or result.renderer == render.ADDITIVE
    if approximate:
        block('audio_fidelity', 'renderer is approximate; it cannot establish audible fidelity')
    if not determinism_verified:
        block('audio_fidelity', 'render determinism has not been verified')
    if result.control_support is None or 'stereo' not in metrics.SUPPORTED_FEATURES:
        block('stereo_room_fidelity',
              'objective v2 is mono-mixed; stereo and room similarity are unmeasured')
    if not approximate and not getattr(result, 'asset_sha256', None):
        block('audio_fidelity', 'renderer asset identity is not recorded')
    uses = render.used_controls(document)
    missing_pedal = [name for name in PEDAL_CAPABILITIES
                     if uses.get(name) and not getattr(result.control_support, name, False)]
    if missing_pedal:
        block('pedal', f'pedal capability not honoured: {missing_pedal}')
        block('audio_fidelity', f'pedal capability not honoured: {missing_pedal}')
    for control, target in (('velocity', 'velocity'), ('key_release', 'release')):
        if uses.get(control) and not getattr(result.control_support, control, False):
            reason = f'the renderer does not honour {control}'
            block(target, reason)
            block('audio_fidelity', reason)
    if any('ignored unsupported control' in warning for warning in result.warnings):
        advisory.append('the render used an explicitly downgraded control')

    sources = result.release_sources or {}
    if sources.get('assumed'):
        block('release', f'{sources["assumed"]} note release(s) were assumed')
    if sources.get('legacy'):
        block('release', f'{sources["legacy"]} note release(s) are legacy estimates')

    counts = coverage(document)
    if not counts['notes']:
        for target in ('release', 'velocity', 'audible_end'):
            block(target, 'no note evidence was supplied for this target')
    if not counts['pedal_events']:
        block('pedal', 'no measured pedal trajectory or explicit pedal-off state was supplied')
    if counts['notes_without_key_release']:
        block('release', f'{counts["notes_without_key_release"]} note(s) have no measured '
                         'key release')
    if counts['notes_without_velocity']:
        block('velocity', f'{counts["notes_without_velocity"]} note(s) have no measured '
                          'velocity')
    if counts['notes_without_audible_end']:
        block('audible_end', f'{counts["notes_without_audible_end"]} note(s) have no audible '
                             'end')
    if counts['audible_end_uncertain']:
        block('audible_end', f'{counts["audible_end_uncertain"]} audible end(s) are uncertain '
                             'and therefore unscorable')

    blocked_targets = sorted(name for name, value in targets.items() if not value['valid'])
    qualified_targets = sorted(name for name, value in targets.items() if value['valid'])
    diagnostic_only = bool(approximate) or bool(global_blockers) or not qualified_targets

    return {'diagnostic_only': diagnostic_only,
            'valid_for_qualification': not diagnostic_only,
            'blocking_reasons': global_blockers,
            'advisory': advisory,
            'blocked_targets': blocked_targets,
            'qualified_targets': qualified_targets,
            'targets': targets,
            'identity': {'declared': declared, 'verified': verified,
                         'source_sha256': identity.get('sha256')}}


def _comparison_pair(reference, candidate, sample_rate, latency, interval, require_complete,
                     fixed_gain_db=None):
    normalized = metrics.compare(reference, candidate, sample_rate, interval=interval,
                                 latency_samples=latency, gain_normalize=True,
                                 require_complete=require_complete,
                                 fixed_gain_db=fixed_gain_db)
    absolute = metrics.compare(reference, candidate, sample_rate, interval=interval,
                               latency_samples=latency, gain_normalize=False,
                               require_complete=require_complete,
                               fixed_gain_db=fixed_gain_db)
    return normalized, absolute


def run(source_path, performance_path, output_dir=None, *, output_spec=None,
        renderer=None, latency_samples=None, verify_determinism=True, strict=True,
        delivered_bit_depth=24, interval=None, require_complete=True, fixed_gain_db=None):
    """Render a performance, compare it with its source and return a report dict."""
    started = time.time()
    source_path = Path(source_path)
    performance_path = Path(performance_path)
    header = inspect_wav(source_path)
    source_samples, source_rate = read_wav(source_path)
    document = load_performance(performance_path)
    source_sha, warnings = verify_source_identity(document, source_path, source_samples,
                                                  source_rate)

    if output_spec is None:
        output_spec = render.OutputSpec(sample_rate=source_rate,
                                        channels=(2 if source_samples.ndim == 2 else 1))
    if output_spec.sample_rate != source_rate:
        raise HarnessError(
            f'renderer output rate {output_spec.sample_rate} Hz must match the source rate '
            f'{source_rate} Hz in v2; resampling the reference is not part of this harness')

    renderer = renderer or render.get_renderer()
    first = renderer.render(document, output_spec, strict=strict)
    determinism = {'renders': 1, 'stable': None}
    if verify_determinism:
        second = renderer.render(document, output_spec, strict=strict)
        stable = render.render_sha256(first) == render.render_sha256(second)
        determinism = {'renders': 2, 'stable': stable}
        if not stable:
            raise HarnessError('renderer output is not deterministic; the comparison would '
                               'not be reproducible')

    if latency_samples is None:
        resolved_latency = int(first.latency_samples)
        latency_source = 'renderer'
    else:
        resolved_latency = int(latency_samples)
        latency_source = 'override'
        if resolved_latency != int(first.latency_samples):
            warnings.append(
                f'latency overridden to {resolved_latency} samples while the renderer '
                f'reported {first.latency_samples}; the override is recorded')

    try:
        float_normalized, float_absolute = _comparison_pair(
            source_samples, first.audio, source_rate, resolved_latency, interval,
            require_complete, fixed_gain_db)
    except metrics.IncompleteCandidate as error:
        raise HarnessError(str(error)) from error

    directory = Path(output_dir) if output_dir is not None else Path(tempfile.mkdtemp())
    directory.mkdir(parents=True, exist_ok=True)
    delivered = encode_delivered(first.audio, first.sample_rate, delivered_bit_depth,
                                 directory)
    delivered_normalized, delivered_absolute = _comparison_pair(
        source_samples, delivered['audio'], source_rate, resolved_latency, interval,
        require_complete, fixed_gain_db)

    comparisons = {'float': float_normalized, 'delivered': delivered_normalized}
    declared_sha = document['source'].get('sha256')
    source_identity = {'declared': declared_sha is not None,
                       'verified': declared_sha is not None and declared_sha == source_sha,
                       'sha256': source_sha}
    report = {
        'schema': SCHEMA,
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': {'path': str(source_path), 'sha256': source_sha,
                   'sample_rate': source_rate,
                   'seconds': round(source_samples.shape[0] / float(source_rate), 4),
                   'channels': int(source_samples.shape[1]) if source_samples.ndim == 2 else 1,
                   'header': header},
        'performance': {'path': str(performance_path),
                        'schema': document['schema'],
                        'semantics_version': document['semantics_version'],
                        'sha256': performance_document.document_sha256(document),
                        'render_identity': first.identity,
                        'coverage': coverage(document)},
        'renderer': {'name': first.renderer, 'version': first.renderer_version,
                     'asset_sha256': first.asset_sha256,
                     'latency_samples': resolved_latency, 'latency_source': latency_source,
                     'control_support': first.control_support.to_dict(),
                     'approximate': bool(getattr(renderer, 'approximate', False)),
                     'release_sources': dict(first.release_sources or {}),
                     'warnings': list(first.warnings)},
        'output': {'sample_rate': first.sample_rate, 'frames': first.frames,
                   'seconds': round(first.duration_seconds, 4),
                   'channels': int(first.audio.shape[1]),
                   'float_sha256': render.render_sha256(first),
                   'delivered': {'sha256': delivered['sha256'],
                                 'format': delivered['format'],
                                 'bit_depth': delivered['bit_depth'],
                                 'bytes': delivered['bytes']},
                   'peak': round(first.peak(), 6),
                   'clipped': bool(first.peak() >= 0.999)},
        'objective': {'version': metrics.OBJECTIVE_VERSION,
                      'weights_sha256': metrics.weights_sha256(),
                      'implementation_sha256': metrics.implementation_sha256(),
                      'fixed_gain_db': fixed_gain_db,
                      'float': {'normalized': float_normalized.to_dict(),
                                'absolute': float_absolute.to_dict()},
                      'delivered': {'normalized': delivered_normalized.to_dict(),
                                    'absolute': delivered_absolute.to_dict()}},
        'qualification': qualification(document, first, comparisons,
                                      source_identity=source_identity,
                                      determinism_verified=verify_determinism and determinism['stable'] is True),
        'determinism': determinism,
        'warnings': warnings,
        'elapsed_seconds': None,
    }

    if output_dir is not None:
        output_dir = Path(output_dir)
        np.save(output_dir / 'render.f32.npy', first.audio)
        (output_dir / 'performance.json').write_text(performance_document.to_json(document),
                                                     encoding='utf-8')
        report['artifacts'] = {'wav': str(delivered['path']),
                               'floats': str(output_dir / 'render.f32.npy'),
                               'performance': str(output_dir / 'performance.json'),
                               'report': str(output_dir / 'report.json')}
        report['elapsed_seconds'] = round(time.time() - started, 3)
        (output_dir / 'report.json').write_text(
            json.dumps(report, indent=2, sort_keys=True), encoding='utf-8')
    report['elapsed_seconds'] = report['elapsed_seconds'] or round(time.time() - started, 3)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Compare rendered piano performance audio with its source recording.')
    parser.add_argument('--source', type=Path, required=True, help='source PCM WAV')
    parser.add_argument('--performance', type=Path, required=True,
                        help='versioned performance document JSON')
    parser.add_argument('--output', type=Path, help='directory for artifacts and report.json')
    parser.add_argument('--renderer', default=render.ADDITIVE,
                        choices=sorted(render.RENDERERS))
    parser.add_argument('--latency-samples', type=int, default=None,
                        help='override the declared renderer latency (recorded in the report)')
    parser.add_argument('--tail-seconds', type=float, default=2.0)
    parser.add_argument('--bit-depth', type=int, default=24, choices=(16, 24),
                        help='delivered PCM depth scored by the report')
    parser.add_argument('--interval', type=float, nargs=2, metavar=('START', 'END'),
                        help='scored source interval in seconds (default: whole source)')
    parser.add_argument('--allow-incomplete', action='store_true',
                        help='score a short candidate with silent padding instead of '
                             'rejecting it; the report stays incomplete')
    parser.add_argument('--no-determinism-check', action='store_true')
    parser.add_argument('--allow-unsupported', action='store_true',
                        help='render even when the performance uses an unsupported control; '
                             'the result is labelled invalid for fidelity')
    arguments = parser.parse_args(argv)

    try:
        spec = render.OutputSpec(sample_rate=inspect_wav(arguments.source)['sample_rate'],
                                 tail_seconds=arguments.tail_seconds)
        report = run(arguments.source, arguments.performance, arguments.output,
                     output_spec=spec, renderer=render.get_renderer(arguments.renderer),
                     latency_samples=arguments.latency_samples,
                     verify_determinism=not arguments.no_determinism_check,
                     strict=not arguments.allow_unsupported,
                     delivered_bit_depth=arguments.bit_depth,
                     interval=tuple(arguments.interval) if arguments.interval else None,
                     require_complete=not arguments.allow_incomplete)
    except (HarnessError, render.RenderError, performance_document.PerformanceError,
            metrics.MetricError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    summary = {
        'float_objective': report['objective']['float']['normalized']['objective'],
        'delivered_objective': report['objective']['delivered']['normalized']['objective'],
        'gain_db': report['objective']['delivered']['normalized']['gain_db'],
        'components': report['objective']['delivered']['normalized']['components'],
        'complete': report['objective']['delivered']['normalized']['complete'],
        'deterministic': report['determinism']['stable'],
        'valid_for_qualification': report['qualification']['valid_for_qualification'],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
