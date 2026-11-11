"""Assemble a separately versioned piano worker profile from existing pinned assets.

Does not download weights, approve licensing, edit an existing worker, or change
the server's profile allowlist. The supplied evidence remains operator-owned.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
try:
    from .music_run_profile import load_profile
except ImportError:
    from music_run_profile import load_profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    config = root / 'docs/qualification/basic-pitch-piano-config.json'
    # Check inputs before producing a profile, and never replace a running one.
    for path in (args.weights, args.evidence, config):
        if not path.is_file(): parser.error(f'Missing input: {path}')
    if (args.output / 'run-profile.json').exists(): parser.error('Choose a new output directory; this profile already exists.')
    args.output.mkdir(parents=True, exist_ok=True)
    code = args.output / 'adapter.py'; copied_config = args.output / 'config.json'
    shutil.copyfile(root / 'scripts/music_basic_pitch_adapter.py', code)
    shutil.copyfile(config, copied_config)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    settings = json.loads(config.read_text())
    profile = {'schema_version': 1, 'model': 'basic-pitch', 'model_version': '0.4.0',
        'weights_sha256': digest(args.weights), 'code_sha256': digest(code),
        'config_sha256': digest(copied_config), 'commercial_evidence_sha256': digest(args.evidence), **settings}
    path = args.output / 'run-profile.json'
    path.write_text(json.dumps(profile, sort_keys=True, separators=(',', ':')))
    verified = load_profile(path, weights=args.weights, code=code, config=copied_config, approval=args.evidence)
    print(json.dumps({'profile': str(path.resolve()), 'profile_sha256': verified['profile_sha256']}, indent=2))


if __name__ == '__main__': main()
