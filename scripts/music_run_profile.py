"""Exact run profile for the isolated music worker.

A profile binds the local model weights, worker code bundle, inference configuration,
sample rate and commercial evidence to one digest. The worker verifies the installed
bytes at startup and refuses missing or mismatched files; it never downloads a model or
falls back to a fixture. Fixture operation is an explicit separate flag.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

REQUIRED = ('schema_version', 'model', 'model_version', 'weights_sha256', 'code_sha256',
            'config_sha256', 'commercial_evidence_sha256', 'sample_rate', 'preprocessing', 'thresholds')
DIGESTS = ('weights_sha256', 'code_sha256', 'config_sha256', 'commercial_evidence_sha256')


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_profile(profile_path: Path, *, weights: Path, code: Path, config: Path, approval: Path) -> dict:
    data = json.loads(profile_path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('Run profile must be a schema_version 1 object.')
    missing = [key for key in REQUIRED if data.get(key) in (None, '')]
    if missing:
        raise ValueError('Run profile is missing ' + ', '.join(missing) + '.')
    unknown = set(data) - set(REQUIRED)
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
    if not isinstance(data['sample_rate'], int) or not 8000 <= data['sample_rate'] <= 192000:
        raise ValueError('Sample rate is outside the supported range.')
    if not isinstance(data['preprocessing'], str) or not data['preprocessing'] or len(data['preprocessing']) > 500:
        raise ValueError('Preprocessing description is invalid.')
    if not isinstance(data['thresholds'], dict) or not data['thresholds'] or len(data['thresholds']) > 50:
        raise ValueError('Inference thresholds must be a non-empty bounded object.')
    for key, value in data['thresholds'].items():
        if not isinstance(key, str) or not key or not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError('Inference thresholds must be numeric.')
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
    data['profile_sha256'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return data
