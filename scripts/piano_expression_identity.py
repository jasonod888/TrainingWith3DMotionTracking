"""Pure, relocatable identity for every expression runtime dependency."""
import hashlib
import json
from pathlib import Path

FILES = ('piano_expression.py', 'piano_expression_evidence.py',
         'piano_velocity_calibration.py', 'piano_expression_identity.py')


def estimator_sha256(folder=None):
    root = Path(folder) if folder is not None else Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in FILES:
        digest.update(name.encode() + b'\0')
        digest.update(hashlib.sha256((root / name).read_bytes()).digest())
    return digest.hexdigest()


def measurement_sha256(settings_sha256, folder=None):
    root = Path(folder) if folder is not None else Path(__file__).resolve().parent
    payload = {'estimator_code_sha256': estimator_sha256(root),
               'verifier_code_sha256': hashlib.sha256((root / 'piano_verifier.py').read_bytes()).hexdigest(),
               'settings_sha256': settings_sha256}
    return measurement_identity(payload)


def measurement_identity(implementation):
    payload = {key: implementation[key] for key in
               ('estimator_code_sha256', 'verifier_code_sha256', 'settings_sha256')}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
