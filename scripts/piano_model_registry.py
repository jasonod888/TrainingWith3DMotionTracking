"""Package 1: the pinned model registry and rights gate for the raw-model comparison.

The registry is intentionally declarative. It records what will run, against which exact
artifacts, under which licence decision, with which capabilities. It never guesses an
identity: a missing checkpoint hash keeps a variant out of the runnable set instead of
filling a placeholder.

Pilot scope (settled 13 November 2026): three runnable variants of two independent model
families, plus two explicit `blocked_license` rows. This is not a four-family benchmark.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

try:
    from scripts import piano_rights as rights
except ImportError:  # pragma: no cover - direct script execution
    import piano_rights as rights

SCHEMA = 'piano-model-registry-1'
VERSION = '1.0.0'
USE = 'model_selection'
MANIFEST_PATH = Path(__file__).resolve().parents[1] / 'docs' / 'piano-reconstruction-rights-manifest.json'
PIANO_CONFIG_PATH = (Path(__file__).resolve().parents[1] / 'docs' / 'qualification'
                     / 'basic-pitch-piano-config.json')
NATIVE_PROFILE_PATH = (Path(__file__).resolve().parents[1] / 'docs' / 'qualification'
                       / 'basic-pitch-profile.json')

STATUS_READY = 'ready'
STATUS_IDENTITY = 'identity_unresolved'
STATUS_BLOCKED = 'blocked_license'


class RegistryError(ValueError):
    """The registry cannot be built as specified."""


def _sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _piano_decoder_profile():
    """The frozen current-app decoder profile, with verification removed for raw output."""
    value = json.loads(PIANO_CONFIG_PATH.read_text(encoding='utf-8'))
    return {
        'profile': value['decoding']['decoding_version'],
        'thresholds': value['thresholds'],
        'decoding': value['decoding'],
        'preprocessing': value['preprocessing'],
        'sample_rate': value['sample_rate'],
        'verification_enabled': False,
        'source_profile_sha256': _sha256_file(PIANO_CONFIG_PATH),
        'note': ('frozen existing decoder; the downstream verification stage is disabled so '
                 'the output is raw. Amplitude stays an amplitude proxy, not velocity.'),
    }


def _native_decoder_profile():
    """The existing pinned native decoding profile, with downstream verification off."""
    value = json.loads(NATIVE_PROFILE_PATH.read_text(encoding='utf-8'))
    return {
        'profile': value['decoding']['decoding_version'],
        'thresholds': value['thresholds'],
        'decoding': value['decoding'],
        'verification_enabled': False,
        'source_profile_sha256': _sha256_file(NATIVE_PROFILE_PATH),
        'profile_weights_sha256': value.get('weights_sha256'),
        'note': ('Official model-native decoding from the existing Basic Pitch profile. '
                 'Verification is disabled so the output is raw.'),
    }


def _variants():
    """The five requested variants, with identities pinned where they are actually known."""
    basic_pitch_weights = {
        'name': 'basic-pitch-0.4.0/icassp-2022-nmp.onnx',
        'sha256': '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
        'bytes': 230444,
        'locator': ('python:basic_pitch.saved_models.icassp_2022.nmp.onnx '
                    '(installed package asset)'),
    }
    kong_checkpoint = {
        'name': 'CRNN_note_F1=0.9677_pedal_F1=0.9186.pth',
        'sha256': 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
        'bytes': 171966578,
        'locator': '.local/piano-diagnosis/reference-packages/piano.pth',
    }
    return [
        {
            'id': 'basic-pitch-native',
            'label': 'Basic Pitch — native',
            'family': 'basic-pitch',
            'adapter': 'basic-pitch-native',
            'rights_sources': ['basic-pitch-0.4.0'],
            'checkpoint': basic_pitch_weights,
            'decoder': _native_decoder_profile(),
            'environment': {'runtime': '.venv-music', 'backend': 'onnx', 'device': 'cpu',
                            'isolation': 'separate from the API environment'},
            'capabilities': {
                'pitch_onset': True,
                'ending': 'predicted_offset',
                'ending_convention': 'basic-pitch-native/offset',
                'velocity': 'amplitude_proxy',
                'velocity_units': None,
                'pedal': 'none',
                'pitch_bend': False,
                'segmentation': 'model_native',
            },
            'notes': ['native decoding is required for the untouched baseline',
                      'amplitude is never calibrated into captured MIDI velocity here'],
        },
        {
            'id': 'basic-pitch-current-app',
            'label': 'Basic Pitch — current app',
            'family': 'basic-pitch',
            'adapter': 'basic-pitch-current-app',
            'rights_sources': ['basic-pitch-0.4.0'],
            'checkpoint': basic_pitch_weights,
            'decoder': _piano_decoder_profile(),
            'environment': {'runtime': '.venv-music', 'backend': 'onnx', 'device': 'cpu',
                            'isolation': 'separate from the API environment'},
            'capabilities': {
                'pitch_onset': True,
                'ending': 'predicted_offset',
                'ending_convention': 'basic-pitch-piano-peaks-v1/offset',
                'velocity': 'amplitude_proxy',
                'velocity_units': None,
                'pedal': 'none',
                'pitch_bend': False,
                'segmentation': 'model_native',
            },
            'notes': ['comparison-only variant identity; do not replace the live worker profile',
                      'shares the frozen neural activations with the native variant, but the '
                      'decoded output and receipt stay distinct'],
        },
        {
            'id': 'kong-piano',
            'label': 'Kong',
            'family': 'kong',
            'adapter': 'kong-piano',
            'rights_sources': ['kong-piano-inference-package',
                               'kong-piano-checkpoint-4034264'],
            'checkpoint': kong_checkpoint,
            'decoder': {'profile': 'kong-0.0.6/native', 'thresholds': None,
                        'decoding': None, 'verification_enabled': False,
                        'source_profile_sha256': None,
                        'note': 'author inference package with its documented decoding'},
            'environment': {'runtime': '.venv', 'backend': 'pytorch', 'device': 'cuda',
                            'isolation': 'separate model environment'},
            'capabilities': {
                'pitch_onset': True,
                'ending': 'predicted_offset',
                'ending_convention': 'kong/native-offset',
                'velocity': 'model_estimated',
                'velocity_units': 'midi_1_127',
                'pedal': 'sustain',
                'pitch_bend': False,
                'segmentation': 'model_native',
            },
            'notes': ['predicted MIDI velocities are model_estimated, not captured measurements',
                      'verify the artifact digest before use; a mirror is not this artifact'],
        },
        {
            'id': 'transkun-v2',
            'label': 'Transkun',
            'family': 'transkun',
            'adapter': 'transkun-v2',
            'rights_sources': ['transkun-checkpoint'],
            'checkpoint': {'name': 'Transkun V2 No Pedal Extension checkpoint (unpinned)',
                           'sha256': None, 'bytes': None, 'locator': None},
            'decoder': {'profile': 'transkun-v2/native', 'thresholds': None,
                        'decoding': None, 'verification_enabled': False,
                        'source_profile_sha256': None,
                        'note': 'exact commit and checkpoint digest must be recorded before use'},
            'environment': {'runtime': 'isolated', 'backend': 'pytorch', 'device': 'cuda',
                            'isolation': 'separate model environment'},
            'capabilities': {
                'pitch_onset': True,
                'ending': 'predicted_offset',
                'ending_convention': 'transkun/native-offset',
                'velocity': 'model_estimated',
                'velocity_units': 'midi_1_127',
                'pedal': 'none',
                'pitch_bend': False,
                'segmentation': 'model_native',
            },
            'notes': ['V2 No Pedal Extension: pedal is not estimated, not pedal-off',
                      'blocked until model_selection is approved with recorded evidence'],
        },
        {
            'id': 'onsets-frames-piano',
            'label': 'Onsets and Frames',
            'family': 'onsets-frames',
            'adapter': 'onsets-frames-piano',
            'rights_sources': ['maestro'],
            'checkpoint': {'name': 'MAESTRO piano checkpoint (unpinned)',
                           'sha256': None, 'bytes': None, 'locator': None},
            'decoder': {'profile': 'onsets-frames/native', 'thresholds': None,
                        'decoding': None, 'verification_enabled': False,
                        'source_profile_sha256': None,
                        'note': 'checkpoint permission is separate from the Apache-2.0 code'},
            'environment': {'runtime': 'isolated', 'backend': 'tensorflow', 'device': 'cpu',
                            'isolation': 'separate model environment'},
            'capabilities': {
                'pitch_onset': True,
                'ending': 'predicted_offset',
                'ending_convention': 'onsets-frames/native-offset',
                'velocity': 'model_estimated',
                'velocity_units': 'midi_1_127',
                'pedal': 'none',
                'pitch_bend': False,
                'segmentation': 'model_native',
            },
            'notes': ['MAESTRO model_selection is prohibited in the current manifest',
                      'a fork or a different checkpoint is not a grant'],
        },
    ]


def _identity_problem(variant, artifacts, check_files):
    """Return the reason an approved variant still cannot run, or None.

    Without file checking, a pinned digest is enough for the declarative registry. With it,
    the local artifact must exist and match; a missing file is `identity_unresolved`.
    """
    checkpoint = variant['checkpoint']
    if not checkpoint.get('sha256'):
        return 'checkpoint digest is not pinned'
    if not check_files:
        return None
    path = (artifacts or {}).get(variant['id']) or (artifacts or {}).get(variant['family'])
    if path is None:
        return 'checkpoint artifact is not available for verification'
    candidate = Path(path)
    if not candidate.is_file():
        return f'checkpoint artifact is missing: {candidate}'
    if _sha256_file(candidate) != checkpoint['sha256']:
        return 'checkpoint artifact does not match the pinned digest'
    if checkpoint.get('bytes') is not None and candidate.stat().st_size != checkpoint['bytes']:
        return 'checkpoint artifact size does not match the pinned identity'
    return None


def build(manifest=None, artifacts=None, verify=False, built_at=None):
    """Build the registry, applying the rights preflight to every requested variant.

    ``verify`` checks local checkpoint files against the pinned digests. Without it, an
    approved variant with no local artifact is reported as `identity_unresolved`, never as
    ready and never blocked for the wrong reason.
    """
    manifest = manifest if manifest is not None else rights.load_manifest(MANIFEST_PATH)
    rights.validate_manifest(manifest)
    variants = []
    for definition in _variants():
        decision = rights.decide(manifest, definition['rights_sources'], USE)
        identity_problem = None
        if decision.status == 'approved':
            identity_problem = _identity_problem(definition, artifacts, verify)
        if decision.status != 'approved':
            status = STATUS_BLOCKED
        elif identity_problem:
            status = STATUS_IDENTITY
        else:
            status = STATUS_READY
        variants.append({
            **definition,
            'rights': {
                'use': USE,
                'status': decision.status,
                'blockers': list(decision.blockers),
                'conditions': list(decision.conditions),
                'attributions': list(decision.attributions),
            },
            'identity_complete': identity_problem is None,
            'identity_problem': identity_problem,
            'status': status,
            'runnable': status == STATUS_READY,
        })
    registry = {
        'schema': SCHEMA,
        'version': VERSION,
        'rights_use': USE,
        'rights_manifest_sha256': rights.manifest_sha256(manifest),
        'built_at': built_at or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'variants': variants,
        'pilot': {
            'requested': [variant['id'] for variant in variants],
            'runnable': [variant['id'] for variant in variants if variant['runnable']],
            'blocked': [variant['id'] for variant in variants
                        if variant['status'] == STATUS_BLOCKED],
            'identity_unresolved': [variant['id'] for variant in variants
                                    if variant['status'] == STATUS_IDENTITY],
            'runnable_families': sorted({variant['family'] for variant in variants
                                         if variant['runnable']}),
            'complete_four_family_benchmark': False,
            'note': ('Three runnable variants of two model families is the initial pilot. '
                     'It is not a completed four-family benchmark.'),
        },
        'notes': [
            'A blocked or identity-unresolved row is never shown as a successful result.',
            'Benchmark/model-selection permission does not imply hosted product inference.',
            'No variant may substitute a checkpoint or decoder without a new registry entry.',
        ],
    }
    validate(registry)
    return registry


def validate(registry):
    if registry.get('schema') != SCHEMA:
        raise RegistryError(f'unsupported schema {registry.get("schema")!r}')
    identifiers = [variant['id'] for variant in registry['variants']]
    if len(identifiers) != len(set(identifiers)):
        raise RegistryError('variant ids must be unique')
    for variant in registry['variants']:
        if variant['status'] == STATUS_BLOCKED and not variant['rights']['blockers']:
            raise RegistryError(f'{variant["id"]}: a blocked row needs a recorded blocker')
        if variant['runnable'] and not variant['identity_complete']:
            raise RegistryError(f'{variant["id"]}: a runnable variant needs a complete identity')
        if variant['runnable'] and variant['rights']['status'] != 'approved':
            raise RegistryError(f'{variant["id"]}: a runnable variant needs an approved right')
        if not variant['capabilities'].get('pitch_onset'):
            raise RegistryError(f'{variant["id"]}: a transcription variant must produce notes')
        profile_weights = variant['decoder'].get('profile_weights_sha256')
        if profile_weights and profile_weights != variant['checkpoint'].get('sha256'):
            raise RegistryError(f'{variant["id"]}: decoder profile weights do not match the '
                                'pinned checkpoint')
    basic_pitch = [variant for variant in registry['variants']
                   if variant['family'] == 'basic-pitch']
    if len(basic_pitch) == 2:
        first, second = basic_pitch
        if first['checkpoint']['sha256'] != second['checkpoint']['sha256']:
            raise RegistryError('the two Basic Pitch variants must share frozen neural weights')
        if first['decoder']['profile'] == second['decoder']['profile']:
            raise RegistryError('the two Basic Pitch variants must declare distinct decoders')
    if not registry['pilot']['runnable'] and not registry['pilot']['blocked'] \
            and not registry['pilot']['identity_unresolved']:
        raise RegistryError('the pilot needs at least one variant with a recorded state')
    return registry


def variant(registry, identifier):
    for entry in registry['variants']:
        if entry['id'] == identifier:
            return entry
    raise RegistryError(f'unknown variant {identifier!r}')


def markdown(registry):
    lines = ['# Piano model comparison registry', '',
             f"Rights use: `{registry['rights_use']}`; manifest "
             f"`{registry['rights_manifest_sha256'][:12]}…`", '',
             '| variant | family | status | rights | checkpoint | device |',
             '|---|---|---|---|---|---|']
    for entry in registry['variants']:
        digest = (entry['checkpoint'].get('sha256') or 'unpinned')[:12]
        lines.append(f"| {entry['label']} | {entry['family']} | {entry['status']} "
                     f"| {entry['rights']['status']} | {digest} | "
                     f"{entry['environment']['device']} |")
    blocked = [entry for entry in registry['variants']
               if entry['status'] == STATUS_BLOCKED]
    if blocked:
        lines += ['', '## Blocked rows', '']
        for entry in blocked:
            lines.append(f"- **{entry['label']}**: {', '.join(entry['rights']['blockers'])}")
    if registry['pilot'].get('identity_unresolved'):
        lines += ['', 'Identity still unresolved: '
                  + ', '.join(registry['pilot']['identity_unresolved'])]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Show the pinned model comparison registry.')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--verify', action='store_true',
                        help='check locally pinned checkpoint files')
    parser.add_argument('--artifacts', type=Path,
                        help='JSON object mapping variant id to a local checkpoint path')
    arguments = parser.parse_args(argv)
    artifacts = None
    if arguments.artifacts:
        artifacts = json.loads(arguments.artifacts.read_text(encoding='utf-8'))
    try:
        registry = build(artifacts=artifacts, verify=arguments.verify)
    except (RegistryError, rights.RightsError, OSError, json.JSONDecodeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(json.dumps(registry, indent=2, sort_keys=True) if arguments.json
          else markdown(registry))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
