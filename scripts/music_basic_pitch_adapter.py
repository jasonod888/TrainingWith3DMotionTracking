"""Basic Pitch 0.4.0 ONNX adapter for the isolated music worker.

Decoding is explicit: the verified run profile carries every choice, the raw model
activations and MIDI are retained in an internal analysis zip, and the proposal is
derived from those same activations. No model download or fixture fallback.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
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


def _run_expression(folder, audio, reference, events, duration, report,
                    policy, mode, settings, summary, duration_enabled=True,
                    dynamics_enabled=True, calibration=None, calibration_domain=None):
    """Run Phase 4 over the exact Phase 3 working events, independently of Phase 3."""
    try:
        try:
            import piano_corrections
        except ImportError:
            from apps.api.music_corrections import apply_qualified_corrections
        else:
            apply_qualified_corrections = piano_corrections.apply_qualified_corrections
        working = events
        if report.get('mode') == 'qualified' and any(
                finding.get('status') == 'suggested' and finding.get('correction_status') == 'qualified'
                for finding in report.get('findings') or []):
            working, _history, _policy = apply_qualified_corrections(events, report, duration)
        working_path = folder / 'working-events.json'
        identity = {key: (report.get('source') or {}).get(key) for key in
                    ('model', 'model_version', 'decoder', 'weights_sha256', 'decoder_sha256')}
        identity['audio_sha256'] = hashlib.sha256(Path(audio).read_bytes()).hexdigest()
        working_path.write_text(json.dumps({'events': working, 'provenance': identity}), encoding='utf-8')
        policy_path = folder / 'expression-policy.json'
        policy_path.write_text(json.dumps(policy), encoding='utf-8')
        output = folder / 'expression.json'
        command = [sys.executable, str(Path(__file__).with_name('piano_expression.py')),
                   '--audio', str(audio), '--reference', str(working_path),
                   '--duration', str(duration), '--policy', str(policy_path),
                   '--mode', mode, '--output', str(output)]
        if not duration_enabled:
            command.append('--no-analyze-duration')
        if not dynamics_enabled:
            command.append('--no-analyze-dynamics')
        if calibration is not None:
            calibration_path = folder / 'velocity-calibration.json'
            calibration_path.write_text(json.dumps(calibration), encoding='utf-8')
            command += ['--velocity-calibration', str(calibration_path),
                        '--calibration-domain', str(calibration_domain)]
        if settings:
            settings_path = folder / 'expression-settings.json'
            settings_path.write_text(json.dumps(settings), encoding='utf-8')
            command += ['--settings', str(settings_path)]
        completed = subprocess.run(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=90, env=os.environ.copy())
        if completed.returncode != 0 or not output.is_file():
            summary['expression_reason'] = 'expression-failed'
            return None
        return json.loads(output.read_text(encoding='utf-8'))
    except subprocess.TimeoutExpired:
        summary['expression_reason'] = 'expression-timeout'
        return None
    except Exception as error:
        summary['expression_reason'] = type(error).__name__
        return None


def _verification_summary(profile, audio, events, model_output, duration, reference, audio_sha):
    """Run the optional diagnostic verifier without ever changing the draft.

    A failure or mismatch leaves the baseline proposal usable and records that
    verification was unavailable.
    """
    block = profile.get('verification')
    if not block:
        return {'status': 'not-configured', 'mode': None, 'version': None}, None, None
    summary = {'status': 'unavailable', 'mode': block.get('mode'),
               'version': block.get('version'), 'code_sha256': block.get('code_sha256'),
               'settings_sha256': block.get('settings_sha256')}
    if block.get('enabled') is not True:
        summary['status'] = 'disabled'
        return summary, None, None
    try:
        import piano_verifier
        verifier_path = Path(__file__).with_name('piano_verifier.py')
        if hashlib.sha256(verifier_path.read_bytes()).hexdigest() != block.get('code_sha256'):
            summary['reason'] = 'verifier-code-mismatch'
            return summary, None, None
        if piano_verifier.VERIFIER_VERSION != block.get('version'):
            summary['reason'] = 'verifier-version-mismatch'
            return summary, None, None
        mode = block.get('mode') or 'diagnostic'
        policy = block.get('correction_policy')
        expression_enabled = block.get('expression_enabled') is True
        expression_mode = block.get('expression_mode') or 'qualified'
        expression_policy = block.get('expression_policy')
        if mode == 'qualified':
            if not isinstance(policy, dict):
                summary['reason'] = 'correction-policy-missing'
                return summary, None, None
            digest = piano_verifier.correction_policy_digest(policy)
            if digest != block.get('correction_policy_sha256'):
                summary['reason'] = 'correction-policy-digest-mismatch'
                return summary, None, None
        if expression_enabled:
            try:
                from piano_expression_identity import estimator_sha256
            except ImportError:
                from scripts.piano_expression_identity import estimator_sha256
            expression_sha = block.get('expression_code_sha256')
            if expression_sha is not None and expression_sha != estimator_sha256(Path(__file__).parent):
                expression_enabled = False
                summary['expression_reason'] = 'expression-code-mismatch'
            if expression_mode == 'qualified' and not isinstance(expression_policy, dict):
                expression_enabled = False
                summary['expression_reason'] = 'expression-policy-missing'
            elif expression_policy is not None and piano_verifier.expression_policy_digest(
                    expression_policy) != block.get('expression_policy_sha256'):
                expression_enabled = False
                summary['expression_reason'] = 'expression-policy-digest-mismatch'
        # Run verification in its own process so a crash, timeout or memory failure
        # cannot take down the adapter or lose the decoded baseline.
        with tempfile.TemporaryDirectory(prefix='verify-', dir=reference.parent) as temporary:
            folder = Path(temporary)
            activations = folder / 'activations.npz'
            np.savez_compressed(activations, **model_output)
            report_path = folder / 'verification.json'
            # Execution identity belongs beside the immutable reference, whose public
            # provenance contract intentionally has no decoder/configuration fields.
            try:
                from piano_corrections import decoder_sha256
            except ImportError:
                from scripts.piano_corrections import decoder_sha256
            execution_path = folder / 'execution.json'
            execution_path.write_text(json.dumps({
                'model': profile.get('model'), 'model_version': profile.get('model_version'),
                'profile_sha256': profile.get('profile_sha256'),
                'decoder': (profile.get('decoding') or {}).get('decoding_version'),
                'weights_sha256': profile.get('weights_sha256'),
                'decoder_sha256': decoder_sha256(profile, Path(__file__)),
            }), encoding='utf-8')
            command = [sys.executable, str(verifier_path), '--audio', str(audio),
                       '--reference', str(reference), '--activations', str(activations),
                       '--duration', str(duration), '--output', str(report_path),
                       '--mode', mode, '--execution-metadata', str(execution_path)]
            if block.get('settings'):
                settings_path = folder / 'settings.json'
                settings_path.write_text(json.dumps(block['settings']), encoding='utf-8')
                command += ['--settings', str(settings_path)]
            if policy is not None:
                policy_path = folder / 'correction-policy.json'
                policy_path.write_text(json.dumps(policy), encoding='utf-8')
                command += ['--correction-policy', str(policy_path)]
            completed = subprocess.run(command, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       timeout=120, env=os.environ.copy())
            if completed.returncode != 0 or not report_path.is_file():
                summary['reason'] = 'verifier-failed'
                return summary, None, None
            report = json.loads(report_path.read_text(encoding='utf-8'))
            expression_report = None
            if expression_enabled:
                expression_report = _run_expression(
                    folder, audio, reference, events, duration, report, expression_policy,
                    expression_mode, block.get('settings'), summary,
                    block.get('expression_analyze_duration', True) is not False,
                    block.get('expression_analyze_dynamics', True) is not False,
                    block.get('expression_calibration'), block.get('expression_calibration_domain'))
        summary.update({'status': report.get('status', 'complete'),
                        'mode': report.get('mode', mode),
                        'correction_policy_sha256': (report.get('correction_policy') or {}).get('policy_sha256'),
                        'finding_count': report['summary']['finding_count'],
                        'suggested_count': report['summary']['suggested_count'],
                        'unresolved_count': report['summary']['unresolved_count'],
                        'qualified_count': report['summary'].get('qualified_count', 0),
                        'withheld_count': report['summary'].get('withheld_count', 0),
                        'expression_status': (expression_report or {}).get('status', 'unavailable' if expression_enabled else 'disabled'),
                        'expression_count': ((expression_report or {}).get('summary') or {}).get('proposal_count', 0),
                        'expression_policy_sha256': ((expression_report or {}).get('policy') or {}).get('policy_sha256'),
                        'runtime_seconds': report['summary']['runtime_seconds'],
                        'report': 'verification.json'})
        if expression_report is not None:
            summary['expression_report'] = 'expression.json'
            summary['_expression_report_value'] = expression_report
        if summary.get('expression_reason'):
            summary['expression_status'] = 'unavailable'
        revised = None
        if report['edits']:
            try:
                revised_events = piano_verifier.apply_edits(events, report['edits'])
            except ValueError:
                summary['revised_error'] = 'conflicting-edits'
                revised_events = None
            if revised_events is not None:
                revised = {'schema_version': 1,
                           'derived_from_proposal_sha256': report['source']['proposal_sha256'],
                           'note': 'Alternative proposal from verification; not reviewed, applied or publishable.',
                           'edits': report['edits'], 'events': revised_events}
                summary.update({'revised_proposal': 'verification-proposal.json',
                                'revised_note_count': len(revised_events)})
        return summary, report, revised
    except subprocess.TimeoutExpired:
        summary['reason'] = 'verifier-timeout'
        return summary, None, None
    except Exception as error:  # Verification is optional; the draft must survive.
        summary['reason'] = type(error).__name__
        return summary, None, None


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
    verification, verification_report, verification_revised = _verification_summary(
        profile, audio, events, model_output, duration, out / 'reference.json', audio_sha)
    verification_expression = verification.pop('_expression_report_value', None)
    metadata['verification'] = verification
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
        if verification_report is not None:
            archive.writestr('verification.json', json.dumps(verification_report, indent=2, sort_keys=True))
        if verification_expression is not None:
            archive.writestr('expression.json', json.dumps(verification_expression, indent=2, sort_keys=True))
        if verification_revised is not None:
            archive.writestr('verification-proposal.json',
                             json.dumps(verification_revised, indent=2, sort_keys=True))
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
