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
from pathlib import Path

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
        for key, path in self.paths.items():
            if not path.is_file() or digest_file(path) != self[key + '_sha256']:
                raise ValueError(f'Run profile {key} bytes changed after verification.')


DIGESTS = ('weights_sha256', 'code_sha256', 'config_sha256', 'commercial_evidence_sha256')


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_profile(profile_path: Path, *, weights: Path, code: Path, config: Path, approval: Path) -> dict:
    data = json.loads(profile_path.read_text(encoding='utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite profile value.')))
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data.get('schema_version') != 1:
        raise ValueError('Run profile must be a schema_version 1 object.')
    missing = [key for key in REQUIRED if data.get(key) in (None, '')]
    if missing:
        raise ValueError('Run profile is missing ' + ', '.join(missing) + '.')
    unknown = set(data) - set(REQUIRED) - {'decoding'}
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
    configuration = json.loads(config.read_text(encoding='utf-8'))
    expected = {key: data[key] for key in ('sample_rate', 'preprocessing', 'thresholds')}
    if 'decoding' in data: expected['decoding']=data['decoding']
    if configuration != expected:
        raise ValueError('Inference configuration must match the run profile settings exactly.')
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
    data['profile_sha256'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return VerifiedProfile(data, {'weights': weights.resolve(), 'code': code.resolve(),
        'config': config.resolve(), 'commercial_evidence': approval.resolve()})
