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
    from .piano_settings import DEFAULT_SETTINGS, merge_settings
    from .piano_corrections import decoder_sha256
    from .piano_expression_identity import FILES, estimator_sha256, measurement_sha256
except ImportError:
    from music_run_profile import load_profile
    from piano_settings import DEFAULT_SETTINGS, merge_settings
    from piano_corrections import decoder_sha256
    from piano_expression_identity import FILES, estimator_sha256, measurement_sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--correction-policy', type=Path,
                        help='Qualification policy; omit for diagnostic owner-suggestion mode')
    parser.add_argument('--expression-policy', type=Path,
                        help='Phase-4 expression policy; requires --correction-policy')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--velocity-calibration', type=Path)
    parser.add_argument('--calibration-domain')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    config = root / 'docs/qualification/basic-pitch-piano-config.json'
    # Check inputs before producing a profile, and never replace a running one.
    paths = [args.weights, args.evidence, config]
    if args.correction_policy:
        paths.append(args.correction_policy)
    if args.expression_policy:
        paths.append(args.expression_policy)
    if args.expression_policy and not args.correction_policy:
        parser.error('--expression-policy requires --correction-policy')
    for path in paths:
        if not path.is_file(): parser.error(f'Missing input: {path}')
    if (args.output / 'run-profile.json').exists(): parser.error('Choose a new output directory; this profile already exists.')
    args.output.mkdir(parents=True, exist_ok=True)
    code = args.output / 'adapter.py'; copied_config = args.output / 'config.json'
    shutil.copyfile(root / 'scripts/music_basic_pitch_adapter.py', code)
    shutil.copyfile(root / 'scripts/piano_corrections.py', args.output / 'piano_corrections.py')
    shutil.copyfile(root / 'scripts/piano_expression.py', args.output / 'piano_expression.py')
    for name in FILES:
        if name != 'piano_expression.py':
            shutil.copyfile(root / 'scripts' / name, args.output / name)
    shutil.copyfile(config, copied_config)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    settings = json.loads(config.read_text())
    if args.correction_policy:
        policy = json.loads(args.correction_policy.read_text(encoding='utf-8'))
        effective_settings = merge_settings(DEFAULT_SETTINGS,
                                            settings['verification'].get('settings') or {})
        implementation = {
            'verifier_code_sha256': digest(root / 'scripts/piano_verifier.py'),
            'settings_sha256': hashlib.sha256(
                json.dumps(effective_settings, sort_keys=True,
                           separators=(',', ':')).encode()).hexdigest(),
            'weights_sha256': digest(args.weights),
            'model': 'basic-pitch', 'model_version': '0.4.0',
            'decoder': settings.get('decoding', {}).get('decoding_version'),
            'decoder_sha256': decoder_sha256(settings, code),
            'application_code_sha256': digest(root / 'scripts/piano_corrections.py'),
        }
        if policy.get('implementation') not in (None, implementation):
            parser.error('Correction policy implementation fingerprint does not match this code/settings/weights.')
        if any(item.get('enabled') for item in (policy.get('categories') or {}).values()) and \
                policy.get('implementation') is None:
            parser.error('Enabled correction categories require an implementation fingerprint.')
        shutil.copyfile(args.correction_policy, args.output / 'correction-policy.json')
        settings['verification']['mode'] = 'qualified'
        settings['verification']['correction_policy'] = policy
        settings['verification']['correction_policy_sha256'] = hashlib.sha256(
            json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if args.expression_policy:
        expression = json.loads(args.expression_policy.read_text(encoding='utf-8'))
        effective_settings = merge_settings(DEFAULT_SETTINGS,
                                            settings['verification'].get('settings') or {})
        expression_implementation = {
            'estimator_code_sha256': estimator_sha256(root / 'scripts'),
            'verifier_code_sha256': digest(root / 'scripts/piano_verifier.py'),
            'settings_sha256': hashlib.sha256(
                json.dumps(effective_settings, sort_keys=True,
                           separators=(',', ':')).encode()).hexdigest(),
            'weights_sha256': digest(args.weights),
            'model': 'basic-pitch', 'model_version': '0.4.0',
            'decoder': settings.get('decoding', {}).get('decoding_version'),
            'decoder_sha256': decoder_sha256(settings, code),
            'application_code_sha256': digest(root / 'apps/api/music_verification.py'),
        }
        if args.velocity_calibration:
            calibration = json.loads(args.velocity_calibration.read_text())
            if calibration.get('domain') != args.calibration_domain:
                parser.error('The explicit recording domain must match the velocity calibration.')
            if calibration.get('measurement_sha256') != measurement_sha256(
                    expression_implementation['settings_sha256'], root / 'scripts'):
                parser.error('Velocity calibration was measured with different estimator bytes.')
            settings['verification']['expression_calibration'] = calibration
            settings['verification']['expression_calibration_domain'] = args.calibration_domain
            expression_implementation['calibration_sha256'] = hashlib.sha256(
                json.dumps(calibration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if expression.get('implementation') not in (None, expression_implementation):
            parser.error('Expression policy implementation fingerprint does not match this code/settings/weights.')
        if any(item.get('enabled') for item in (expression.get('categories') or {}).values()) \
                and expression.get('implementation') is None:
            parser.error('Enabled expression categories require an implementation fingerprint.')
        shutil.copyfile(args.expression_policy, args.output / 'expression-policy.json')
        settings['verification']['expression_enabled'] = True
        settings['verification']['expression_mode'] = 'qualified'
        settings['verification']['expression_version'] = 'piano-expression-1'
        settings['verification']['expression_policy'] = expression
        settings['verification']['expression_policy_sha256'] = hashlib.sha256(
            json.dumps(expression, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if args.correction_policy or args.expression_policy:
        copied_config.write_text(json.dumps(settings, sort_keys=True, separators=(',', ':')),
                                 encoding='utf-8')
    if 'verification' in settings:
        if settings['verification'].get('expression_enabled'):
            settings['verification']['expression_code_sha256'] = estimator_sha256(args.output)
        verifier = args.output / 'piano_verifier.py'
        shutil.copyfile(root / 'scripts/piano_verifier.py', verifier)
        settings['verification']['code_sha256'] = digest(verifier)
        settings['verification']['settings_sha256'] = hashlib.sha256(
            json.dumps(settings['verification']['settings'], sort_keys=True,
                       separators=(',', ':')).encode()).hexdigest()
    profile = {'schema_version': 1, 'model': 'basic-pitch', 'model_version': '0.4.0',
        'weights_sha256': digest(args.weights), 'code_sha256': digest(code),
        'config_sha256': digest(copied_config), 'commercial_evidence_sha256': digest(args.evidence), **settings}
    path = args.output / 'run-profile.json'
    path.write_text(json.dumps(profile, sort_keys=True, separators=(',', ':')))
    verified = load_profile(path, weights=args.weights, code=code, config=copied_config, approval=args.evidence)
    print(json.dumps({'profile': str(path.resolve()), 'profile_sha256': verified['profile_sha256']}, indent=2))


if __name__ == '__main__': main()
