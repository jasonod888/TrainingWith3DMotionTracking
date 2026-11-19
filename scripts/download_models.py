"""Download official assets or a public mirror verified against upstream hashes.

Two families of asset are handled:

* The gated SAM 3D Body checkpoint (or the hash-checked public redistribution) and
  the MHR rig assets, used by the ``sam-3d-body-v1`` pipeline.
* The ungated MediaPipe Pose Landmarker (heavy, float16, v1), used by the CPU
  ``body-mediapipe-v1`` pipeline. It is small enough for CPU inference and is the
  only model that route needs -- no SAM 2 checkpoint and no MHR rig.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]

# Official MediaPipe Pose Landmarker, heavy float16 v1. The browser bundle already
# vendors this exact file at web/dist/assets, so the repo has an authoritative local
# pin; an operator can override it with FORM_POSE_LANDMARKER_SHA256.
POSE_LANDMARKER = {
    'file': 'pose_landmarker_heavy.task',
    'url': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
    'env': 'FORM_POSE_LANDMARKER_SHA256',
    'destination': ROOT / 'models',
}
VENDORED_POSE_LANDMARKER = ROOT / 'web/dist/assets/pose_landmarker_heavy.task'


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def pose_landmarker_digest():
    """The SHA-256 a downloaded landmarker must match.

    Verification is mandatory: a truncated or replaced model must never be loaded by
    the worker. The vendored browser copy is the default pin because both pipelines
    must run the same weights; an operator can pin a different (still exact) digest
    through the environment, for example when refreshing both copies together.
    """
    value = os.environ.get(POSE_LANDMARKER['env'], '').strip().lower()
    if value:
        if not re.fullmatch(r'[a-f0-9]{64}', value):
            raise ValueError(f"{POSE_LANDMARKER['env']} must be a 64-character SHA-256 hex digest.")
        return value
    if VENDORED_POSE_LANDMARKER.is_file():
        return sha256(VENDORED_POSE_LANDMARKER)
    raise ValueError(
        "No pinned SHA-256 for pose_landmarker_heavy.task. Set "
        f"{POSE_LANDMARKER['env']} to the official digest, or vendor the file at "
        f"{VENDORED_POSE_LANDMARKER.relative_to(ROOT)}. Refusing to accept an unverified model.")


def fetch_pose_landmarker():
    """Download and verify the CPU landmarker once; return its provenance."""
    destination = POSE_LANDMARKER['destination'] / POSE_LANDMARKER['file']
    expected = pose_landmarker_digest()
    if destination.is_file():
        actual = sha256(destination)
        if actual != expected:
            raise ValueError(f'{destination.name} does not match the pinned SHA-256; delete it and download again.')
        print(f'{destination.name} already present and verified.', flush=True)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.download')
        print(f"Downloading {destination.name}...", flush=True)
        # Download beside the destination so a failed transfer never leaves a model
        # that a later run would trust.
        urllib.request.urlretrieve(POSE_LANDMARKER['url'], temporary)
        actual = sha256(temporary)
        if actual != expected:
            temporary.unlink(missing_ok=True)
            raise ValueError(f'{destination.name} failed SHA-256 verification; do not load it.')
        temporary.replace(destination)
        print(f'Verified {destination.name}', flush=True)
    provenance = {'source': POSE_LANDMARKER['url'], 'sha256': expected,
                  'size': destination.stat().st_size,
                  'license': 'MediaPipe model card terms; see the upstream documentation.'}
    (POSE_LANDMARKER['destination'] / 'pose_landmarker_heavy.provenance.json').write_text(
        json.dumps(provenance, indent=2), encoding='utf-8')
    return provenance


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets-only', action='store_true')
    parser.add_argument('--verified-mirror', action='store_true', help='Use the public BlendCap redistribution only after matching upstream metadata')
    args = parser.parse_args()
    if not args.assets_only:
        from huggingface_hub import HfApi, hf_hub_download
        from huggingface_hub.errors import GatedRepoError
        try:
            official = 'facebook/sam-3d-body-dinov3'
            repo = 'Blendcap/sam-3d-body' if args.verified_mirror else official
            info = HfApi().model_info(official, files_metadata=True, token=False)
            source = HfApi().model_info(repo, files_metadata=True, token=False)
            upstream_files = {f.rfilename: f for f in info.siblings}
            source_files = {f.rfilename: f for f in source.siblings}
            local_dir = ROOT / 'models/sam-3d-body-dinov3'
            verified = {}
            for name in ('LICENSE', 'model_config.yaml', 'model.ckpt', 'assets/mhr_model.pt'):
                expected, candidate = upstream_files[name], source_files[name]
                if expected.blob_id != candidate.blob_id:
                    raise ValueError(f'{name}: mirror does not match official metadata')
                if expected.lfs and expected.lfs.sha256 != candidate.lfs.sha256:
                    raise ValueError(f'{name}: mirror SHA256 does not match upstream')
                print(f'Downloading and verifying {name} from {repo}...', flush=True)
                path = Path(hf_hub_download(repo, name, revision=source.sha,
                                           token=False if args.verified_mirror else None, local_dir=local_dir))
                digest = hashlib.sha256() if expected.lfs else hashlib.sha1()
                if not expected.lfs:
                    digest.update(f'blob {path.stat().st_size}\0'.encode())
                with path.open('rb') as f:
                    while chunk := f.read(8 * 1024 * 1024):
                        digest.update(chunk)
                target = expected.lfs.sha256 if expected.lfs else expected.blob_id
                if digest.hexdigest() != target:
                    raise ValueError(f'{name}: downloaded file failed hash verification; do not load it')
                verified[name] = {'digest': target, 'size': path.stat().st_size}
                print(f'Verified {name}', flush=True)
            (local_dir / 'provenance.json').write_text(json.dumps({
                'upstream': official, 'upstream_revision': info.sha,
                'download_source': repo, 'download_revision': source.sha,
                'files': verified, 'license': 'SAM License; retained as LICENSE',
            }, indent=2))
        except GatedRepoError:
            print('Official model access is required: https://huggingface.co/facebook/sam-3d-body-dinov3')
            print('Accept/request access there, then authenticate locally with: .venv\\Scripts\\hf.exe auth login')
            return 2
    # The CPU landmarker is ungated and is needed by the MediaPipe route, so it is
    # fetched (and verified) even in --assets-only mode. A missing pin is an error:
    # an unverified model is never accepted.
    fetch_pose_landmarker()
    assets = ROOT / 'models/mhr'
    assets.mkdir(parents=True, exist_ok=True)
    if not list(assets.rglob('compact_v6_1.model')):
        archive = assets / 'assets.zip'
        url = 'https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip'
        if not archive.exists():
            print('Downloading official MHR rig assets...', flush=True)
            urllib.request.urlretrieve(url, archive)
        with zipfile.ZipFile(archive) as z:
            # Validate every destination before extraction.
            for member in z.infolist():
                if not (assets / member.filename).resolve().is_relative_to(assets.resolve()):
                    raise ValueError('Archive member escapes the MHR asset folder')
            z.extractall(assets)
    print('Model/rig download step complete.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
