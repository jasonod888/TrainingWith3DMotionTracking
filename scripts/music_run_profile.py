"""Exact run profile for the isolated music worker.

A profile binds the local model weights, worker code bundle, inference configuration,
sample rate and commercial evidence to one digest. The worker verifies the installed
bytes at startup and refuses missing or mismatched files; it never downloads a model or
falls back to a fixture. Fixture operation is an explicit separate flag.
"""
from __future__ import annotations

import hashlib
import json
import math
from importlib import metadata
from pathlib import Path
try:
    from .piano_expression_identity import estimator_sha256, measurement_sha256
    from .piano_settings import DEFAULT_SETTINGS, merge_settings
except ImportError:
    from piano_expression_identity import estimator_sha256, measurement_sha256
    from piano_settings import DEFAULT_SETTINGS, merge_settings

REQUIRED = ('schema_version', 'model', 'model_version', 'weights_sha256', 'code_sha256',
            'config_sha256', 'commercial_evidence_sha256', 'sample_rate', 'preprocessing', 'thresholds')
class VerifiedProfile(dict):
    """Locally verified bytes plus their private execution paths."""
    def __init__(self, data, paths):
        super().__init__(data)
        self.paths = paths

    def reverify(self):
        canonical = {key: value for key, value in self.items() if key != 'profile_sha256'}
        digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        if digest != self.get('profile_sha256'):
            raise ValueError('Run profile settings changed after verification.')
        if self.get('model')=='kong':
            verify_kong_bundle(self)
        for key, path in self.paths.items():
            expected = self.get(key + '_sha256', (self.get('verification') or {}).get(key + '_sha256'))
            actual = estimator_sha256(path.parent) if key == 'expression_code' else digest_file(path)
            if not path.is_file() or actual != expected:
                raise ValueError(f'Run profile {key} bytes changed after verification.')


DIGESTS = ('weights_sha256', 'code_sha256', 'config_sha256', 'commercial_evidence_sha256')


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


VERIFIER_KEYS = {
    'analysis': {'low_split_hz', 'low_fft', 'full_fft', 'hop', 'min_bin_hz', 'max_bin_hz',
                 'noise_percentile', 'attack_fft', 'attack_hop', 'attack_min_hz', 'attack_max_hz'},
    'tuning': {'max_cents', 'min_partial_hz', 'max_partial_hz'},
    'templates': {'max_partials', 'inharmonicity', 'attack_tilt', 'sustain_tilt',
                  'attack_rolloff_hz', 'sustain_rolloff_hz', 'velocity_tilt', 'sustain_decay_scale'},
    'decomposition': {'attack_tau_s', 'sustain_attack_s', 'ridge', 'sweeps', 'context_before_s',
                      'envelope_smear_frames', 'max_atoms', 'max_frames'},
    'regions': {'cluster_gap_s', 'before_s', 'after_s', 'max_regions', 'max_region_seconds',
                'max_region_notes', 'max_window_notes'},
    'checks': {'attack_tolerance_s', 'unmatched_attack_min_novelty', 'onset_step_s',
               'onset_min_shift_s', 'onset_min_attack', 'attack_lag_s', 'repetition_min_gap_s',
               'repetition_end_margin_s', 'repetition_min_novelty', 'repetition_min_broadband',
               'duplicate_gap_s', 'duplicate_second_attack', 'duplicate_attack_ratio',
               'missing_unexplained', 'missing_fundamental', 'missing_min_snr_db', 'candidate_limit'},
    'scoring': {'add_gain', 'shift_gain', 'repetition_min_gain', 'substitute_gain',
                'delete_max_gain', 'merge_max_gain', 'margin'},
    'insertion': {'min_gain', 'min_fundamental', 'min_attack_sharp', 'min_attack',
                  'min_decoder_onset', 'competing_ratio'},
    'limits': {'max_findings', 'budget_seconds', 'max_events', 'max_audio_seconds',
               'max_region_matrix'},
}


VERIFIER_RANGES = {
    ('regions', 'max_region_seconds'): (0.5, 60.0),
    ('regions', 'max_region_notes'): (1, 500),
    ('regions', 'max_window_notes'): (2, 1000),
    ('decomposition', 'max_atoms'): (1, 2000),
    ('decomposition', 'max_frames'): (1, 10000),
    ('limits', 'max_findings'): (1, 1000),
    ('limits', 'budget_seconds'): (1.0, 600.0),
    ('limits', 'max_audio_seconds'): (1.0, 3600.0),
    ('limits', 'max_region_matrix'): (1000, 50000000),
    ('checks', 'missing_unexplained'): (0.0, 1.0),
    ('checks', 'missing_fundamental'): (0.0, 1.0),
    ('checks', 'onset_min_attack'): (0.0, 1.0),
    ('checks', 'attack_tolerance_s'): (0.001, 0.2),
    ('checks', 'duplicate_gap_s'): (0.01, 1.0),
    ('checks', 'duplicate_second_attack'): (0.0, 1.0),
    ('checks', 'duplicate_attack_ratio'): (0.0, 1.0),
    ('scoring', 'add_gain'): (0.0, 10.0),
    ('scoring', 'shift_gain'): (0.0, 10.0),
    ('scoring', 'substitute_gain'): (0.0, 10.0),
    ('scoring', 'merge_max_gain'): (0.0, 10.0),
    ('insertion', 'min_gain'): (0.0, 10.0),
    ('insertion', 'min_fundamental'): (0.0, 1.0),
    ('insertion', 'min_attack_sharp'): (0.0, 10.0),
    ('insertion', 'min_attack'): (0.0, 1.0),
    ('insertion', 'min_decoder_onset'): (0.0, 1.0),
    ('insertion', 'competing_ratio'): (0.0, 1.0),
}
VERIFIER_INTEGERS = {
    ('regions', 'max_regions'), ('regions', 'max_region_notes'),
    ('regions', 'max_window_notes'), ('decomposition', 'max_atoms'),
    ('decomposition', 'max_frames'), ('limits', 'max_findings'),
    ('limits', 'max_events'), ('limits', 'max_region_matrix'),
}


def _validated_verifier_settings(settings):
    unknown = set(settings) - set(VERIFIER_KEYS)
    if unknown:
        raise ValueError('Verification settings have unknown sections: ' + ', '.join(sorted(unknown)) + '.')
    for section, values in settings.items():
        if not isinstance(values, dict) or set(values) - VERIFIER_KEYS[section]:
            raise ValueError(f'Verification {section} settings have unknown fields.')
    for (section, field), (low, high) in VERIFIER_RANGES.items():
        if section not in settings or field not in settings[section]:
            continue
        value = settings[section][field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise ValueError(f'Verification {section}.{field} must be between {low} and {high}.')
    for section, field in VERIFIER_INTEGERS:
        if section in settings and field in settings[section] and (
                isinstance(settings[section][field], bool)
                or not isinstance(settings[section][field], int)):
            raise ValueError(f'Verification {section}.{field} must be an integer.')


def _bounded_settings(value, depth=0):
    """Small helper for the optional verifier settings object."""
    if depth > 4:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, dict):
        if len(value) > 100:
            return False
        return all(isinstance(key, str) and 0 < len(key) <= 80 and _bounded_settings(item, depth + 1)
                   for key, item in value.items())
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    if isinstance(value, str):
        return len(value) <= 200
    return False


KONG_REQUIRED = ('schema_version', 'model', 'model_version', 'weights_sha256',
                 'code_sha256', 'config_sha256', 'commercial_evidence_sha256',
                 'sample_rate', 'preprocessing', 'package_path', 'package_version',
                 'device', 'package_sha256', 'implementation_sha256', 'runtime_versions')

KONG_IMPLEMENTATION = ('music_run_profile.py', 'music_kong_adapter.py', 'music_worker.py',
    'piano_performance.py', 'piano_render.py', 'piano_reconstruction_harness.py',
    'piano_reconstruction_metrics.py', 'render_piano_comparison.py', 'piano_rights.py')
KONG_PARAMETERS = {'onset_threshold', 'offset_threshold', 'frame_threshold', 'pedal_offset_threshold'}

def tree_sha256(root):
    root=Path(root).resolve()
    files=sorted(path for path in root.rglob('*') if path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc','.pyo'))
    return hashlib.sha256(json.dumps([(path.relative_to(root).as_posix(),digest_file(path)) for path in files],separators=(',',':')).encode()).hexdigest()

def kong_implementation_sha256():
    root=Path(__file__).resolve().parent
    return hashlib.sha256(json.dumps([(name,digest_file(root/name)) for name in KONG_IMPLEMENTATION],separators=(',',':')).encode()).hexdigest()

def kong_runtime_versions():
    return {name:metadata.version(name) for name in ('torch','numpy','scipy','librosa','soundfile')}

def verify_kong_bundle(data):
    root=Path(data['package_path']).resolve()
    if root.name=='piano_transcription_inference':root=root.parent
    version_file=root/f"piano_transcription_inference-{data['package_version']}.dist-info"/'METADATA'
    if not version_file.is_file() or f"Version: {data['package_version']}" not in version_file.read_text(encoding='utf-8').splitlines():
        raise ValueError('Kong package version metadata does not match.')
    if tree_sha256(root)!=data['package_sha256']:
        raise ValueError('Kong package bytes changed.')
    if kong_implementation_sha256()!=data['implementation_sha256']:
        raise ValueError('Kong implementation bytes changed.')
    if kong_runtime_versions()!=data['runtime_versions']:
        raise ValueError('Kong runtime versions do not match.')


def load_kong_profile(profile_path: Path, *, weights: Path, code: Path, config: Path,
                      approval: Path) -> VerifiedProfile:
    """Load a pinned Kong inference profile (16 kHz mono PCM, PyTorch package)."""
    data = json.loads(profile_path.read_text(encoding='utf-8'),
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError('Non-finite profile value.')))
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int \
            or data.get('schema_version') != 1:
        raise ValueError('Kong profile must be a schema_version 1 object.')
    missing = [key for key in KONG_REQUIRED if data.get(key) in (None, '')]
    if missing:
        raise ValueError('Kong profile is missing ' + ', '.join(missing) + '.')
    unknown = set(data) - set(KONG_REQUIRED) - {'config', 'profile_sha256'}
    if unknown:
        raise ValueError('Kong profile has unknown fields: ' + ', '.join(sorted(unknown)) + '.')
    if data['model'] != 'kong':
        raise ValueError('This is not a Kong run profile.')
    if data['sample_rate'] != 16000 or data['preprocessing'] != 'mono-pcm-s16le':
        raise ValueError('Kong requires 16000 Hz mono-pcm-s16le input.')
    if data['device'] not in ('cpu', 'cuda'):
        raise ValueError('Kong device must be cpu or cuda.')
    if not isinstance(data['package_path'], str) or not Path(data['package_path']).is_dir():
        raise ValueError('The pinned Kong inference package is missing.')
    if not isinstance(data.get('config', {}), dict):
        raise ValueError('Kong configuration must be an object.')
    configuration=json.loads(config.read_text(encoding='utf-8'))
    if configuration!=data.get('config',{}):
        raise ValueError('Kong configuration must match the profile exactly.')
    if set(configuration)-KONG_PARAMETERS or any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<value<1 for value in configuration.values()):
        raise ValueError('Unsupported Kong configuration parameter or threshold.')
    for key in ('weights_sha256', 'code_sha256', 'config_sha256',
                'commercial_evidence_sha256'):
        value = str(data[key]).lower()
        if len(value) != 64 or any(character not in '0123456789abcdef' for character in value):
            raise ValueError(f'{key} must be a sha256 digest.')
        data[key] = value
    for key, path, label in (('weights_sha256', weights, 'weights'),
                             ('code_sha256', code, 'code bundle'),
                             ('config_sha256', config, 'configuration'),
                             ('commercial_evidence_sha256', approval, 'commercial evidence')):
        if not path.is_file():
            raise ValueError(f'The {label} file is missing.')
        if digest_file(path) != data[key]:
            raise ValueError(f'The {label} bytes do not match the run profile.')
    verify_kong_bundle(data)
    data.pop('profile_sha256',None)
    data['profile_sha256'] = hashlib.sha256(json.dumps(
        data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return VerifiedProfile(data, {'weights': weights, 'code': code, 'config': config,
                                  'commercial_evidence': approval})


def load_profile(profile_path: Path, *, weights: Path, code: Path, config: Path, approval: Path) -> dict:
    data = json.loads(profile_path.read_text(encoding='utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite profile value.')))
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data.get('schema_version') != 1:
        raise ValueError('Run profile must be a schema_version 1 object.')
    missing = [key for key in REQUIRED if data.get(key) in (None, '')]
    if missing:
        raise ValueError('Run profile is missing ' + ', '.join(missing) + '.')
    unknown = set(data) - set(REQUIRED) - {'decoding', 'verification'}
    if unknown:
        raise ValueError('Run profile has unknown fields: ' + ', '.join(sorted(unknown)) + '.')
    if not isinstance(data['model'], str) or not data['model'] or len(data['model']) > 120:
        raise ValueError('Model identity is invalid.')
    if not isinstance(data['model_version'], str) or not data['model_version'] or len(data['model_version']) > 80:
        raise ValueError('Model version is invalid.')
    for key in DIGESTS:
        value = str(data[key]).lower()
        if len(value) != 64 or any(character not in '0123456789abcdef' for character in value):
            raise ValueError(f'{key} must be a sha256 digest.')
        data[key] = value
    for key, path, label in (('weights_sha256', weights, 'weights'), ('code_sha256', code, 'code bundle'),
                             ('config_sha256', config, 'configuration'),
                             ('commercial_evidence_sha256', approval, 'commercial evidence')):
        if not path.is_file():
            raise ValueError(f'The {label} file is missing.')
        if digest_file(path) != data[key]:
            raise ValueError(f'The {label} bytes do not match the run profile.')
    if type(data['sample_rate']) is not int or not 8000 <= data['sample_rate'] <= 192000:
        raise ValueError('Sample rate is outside the supported range.')
    if data['preprocessing'] != 'mono-pcm-s16le':
        raise ValueError('Only mono-pcm-s16le preprocessing is implemented.')
    if not isinstance(data['thresholds'], dict) or not data['thresholds'] or len(data['thresholds']) > 50:
        raise ValueError('Inference thresholds must be a non-empty bounded object.')
    for key, value in data['thresholds'].items():
        if not isinstance(key, str) or not key or not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError('Inference thresholds must be numeric.')
    if 'decoding' in data:
        decoding=data['decoding']
        if not isinstance(decoding,dict) or set(decoding)-{'decoding_version','infer_onsets','melodia_trick','include_pitch_bends','multiple_pitch_bends','midi_tempo','minimum_frequency','maximum_frequency'}:
            raise ValueError('Decoding settings have unknown or missing fields.')
        if not isinstance(decoding.get('decoding_version'),str) or not decoding['decoding_version'] or len(decoding['decoding_version'])>80:
            raise ValueError('Decoding version is invalid.')
        for key in ('infer_onsets','melodia_trick','include_pitch_bends','multiple_pitch_bends'):
            if type(decoding.get(key)) is not bool:
                raise ValueError(f'Decoding {key} must be boolean.')
        for key in ('minimum_frequency','maximum_frequency'):
            value=decoding.get(key)
            if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0):
                raise ValueError(f'Decoding {key} must be positive or null.')
        tempo=decoding.get('midi_tempo')
        if isinstance(tempo,bool) or not isinstance(tempo,(int,float)) or not math.isfinite(tempo) or not 20<=tempo<=400:
            raise ValueError('Decoding midi_tempo must be numeric.')
        if decoding['decoding_version'] == 'basic-pitch-0.4.0/piano-peaks-v1':
            limits = {'onset_threshold': (0, 1), 'frame_threshold': (0, 1),
                      'minimum_note_length': (1, 1000), 'onset_prominence': (0, 1),
                      'minimum_attack_spacing_ms': (1, 250)}
            if data['model'] != 'basic-pitch' or data['sample_rate'] != 22050:
                raise ValueError('Piano peak decoding requires Basic Pitch at 22050 Hz.')
            for key, (low, high) in limits.items():
                value = data['thresholds'].get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                    raise ValueError(f'Piano decoding {key} is missing or outside its range.')
            if decoding['infer_onsets'] or decoding['melodia_trick']:
                raise ValueError('Piano peak decoding requires explicit onsets and no Melodia.')
    if 'verification' in data:
        verification = data['verification']
        allowed = {'enabled', 'mode', 'version', 'code_sha256', 'settings', 'settings_sha256',
                   'correction_policy', 'correction_policy_sha256', 'expression_enabled',
                   'expression_mode', 'expression_version', 'expression_policy',
                   'expression_policy_sha256', 'expression_analyze_duration',
                   'expression_analyze_dynamics', 'expression_code_sha256',
                   'expression_calibration', 'expression_calibration_domain'}
        if not isinstance(verification, dict) or set(verification) - allowed:
            raise ValueError('Verification settings have unknown fields.')
        if type(verification.get('enabled')) is not bool:
            raise ValueError('Verification enabled must be boolean.')
        if verification.get('mode') not in ('diagnostic', 'qualified'):
            raise ValueError('Verification mode must be diagnostic or qualified.')
        if type(verification.get('expression_enabled', False)) is not bool:
            raise ValueError('Expression enabled must be boolean.')
        for key in ('expression_analyze_duration', 'expression_analyze_dynamics'):
            if type(verification.get(key, True)) is not bool:
                raise ValueError('Expression analysis switches must be boolean.')
        if verification.get('expression_mode', 'qualified') not in ('diagnostic', 'qualified'):
            raise ValueError('Expression mode must be diagnostic or qualified.')
        if not isinstance(verification.get('version'), str) or not 0 < len(verification['version']) <= 80:
            raise ValueError('Verification version is invalid.')
        code_digest = str(verification.get('code_sha256', '')).lower()
        if len(code_digest) != 64 or any(character not in '0123456789abcdef' for character in code_digest):
            raise ValueError('Verification code_sha256 must be a sha256 digest.')
        if data.get('decoding', {}).get('decoding_version') != 'basic-pitch-0.4.0/piano-peaks-v1':
            raise ValueError('Verification is only implemented for the piano peak decoder.')
        settings = verification.get('settings')
        if not isinstance(settings, dict) or not _bounded_settings(settings):
            raise ValueError('Verification settings must be a bounded JSON object.')
        _validated_verifier_settings(settings)
        if verification.get('settings_sha256') != hashlib.sha256(
                json.dumps(settings, sort_keys=True, separators=(',', ':')).encode()).hexdigest():
            raise ValueError('Verification settings digest does not match.')
        policy = verification.get('correction_policy')
        if verification.get('mode') == 'qualified':
            if not isinstance(policy, dict) or not policy:
                raise ValueError('Qualified verification requires a correction policy.')
            policy_digest = hashlib.sha256(
                json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            if verification.get('correction_policy_sha256') != policy_digest:
                raise ValueError('Correction policy digest does not match.')
        elif policy is not None:
            raise ValueError('A correction policy is only valid in qualified mode.')
        if verification.get('expression_enabled'):
            expression_path = code.with_name('piano_expression.py')
            expression_sha = verification.get('expression_code_sha256')
            if not isinstance(expression_sha, str) or len(expression_sha) != 64 \
                    or not expression_path.is_file() or estimator_sha256(expression_path.parent) != expression_sha:
                raise ValueError('Expression estimator bytes do not match the run profile.')
            calibration = verification.get('expression_calibration')
            if calibration is not None:
                effective_sha = hashlib.sha256(json.dumps(merge_settings(DEFAULT_SETTINGS,
                    verification.get('settings')), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if not isinstance(calibration, dict) or calibration.get('domain') != verification.get('expression_calibration_domain') \
                        or calibration.get('measurement_sha256') != measurement_sha256(effective_sha, code.parent):
                    raise ValueError('Expression calibration does not match this recording domain/estimator.')
            if not isinstance(verification.get('expression_version'), str) or not 0 < len(verification['expression_version']) <= 80:
                raise ValueError('Expression version is invalid.')
            expression_policy = verification.get('expression_policy')
            if verification.get('expression_mode', 'qualified') == 'qualified':
                if not isinstance(expression_policy, dict) or not expression_policy:
                    raise ValueError('Qualified expression mode requires an expression policy.')
                expression_digest = hashlib.sha256(
                    json.dumps(expression_policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if verification.get('expression_policy_sha256') != expression_digest:
                    raise ValueError('Expression policy digest does not match.')
            elif expression_policy is not None:
                raise ValueError('An expression policy is only valid in qualified expression mode.')
        elif verification.get('expression_policy') is not None:
            raise ValueError('An expression policy requires expression_enabled.')
        verification['code_sha256'] = code_digest
    configuration = json.loads(config.read_text(encoding='utf-8'))
    expected = {key: data[key] for key in ('sample_rate', 'preprocessing', 'thresholds')}
    if 'decoding' in data: expected['decoding']=data['decoding']
    if 'verification' in data:
        keys = ['enabled', 'mode', 'version', 'settings']
        if data['verification'].get('mode') == 'qualified':
            keys += ['correction_policy', 'correction_policy_sha256']
        if data['verification'].get('expression_enabled'):
            keys += ['expression_enabled', 'expression_mode', 'expression_version']
            for key in ('expression_policy', 'expression_policy_sha256',
                        'expression_analyze_duration', 'expression_analyze_dynamics',
                        'expression_calibration', 'expression_calibration_domain'):
                if key in data['verification']:
                    keys.append(key)
        expected['verification'] = {key: data['verification'][key] for key in keys}
    if configuration != expected:
        raise ValueError('Inference configuration must match the run profile settings exactly.')
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
    data['profile_sha256'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    paths = {'weights': weights.resolve(), 'code': code.resolve(),
             'config': config.resolve(), 'commercial_evidence': approval.resolve()}
    if (data.get('verification') or {}).get('expression_enabled'):
        paths['expression_code'] = code.with_name('piano_expression.py').resolve()
    return VerifiedProfile(data, paths)
