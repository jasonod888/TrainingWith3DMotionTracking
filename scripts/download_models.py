"""Download official assets or a public mirror verified against upstream hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]

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
