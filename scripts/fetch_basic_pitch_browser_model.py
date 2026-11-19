#!/usr/bin/env python3
"""Extract the pinned Basic Pitch browser model from its published package.

The ONNX binary is not committed. The caller downloads the exact PyPI package
(`basic-pitch==0.4.0`); this script locates the packaged model in either a wheel or
source distribution, verifies size and SHA-256, and writes only the verified artifact.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import tarfile
import tempfile
import zipfile
from pathlib import Path

MEMBER_SUFFIX = 'basic_pitch/saved_models/icassp_2022/nmp.onnx'
SIZE = 230444
SHA256 = '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec'


def read_member(path: Path) -> bytes:
    if path.suffix == '.whl':
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.endswith(MEMBER_SUFFIX)]
            if len(names) != 1:
                raise SystemExit(f'{path}: expected exactly one {MEMBER_SUFFIX}, found {len(names)}')
            return archive.read(names[0])
    if path.suffixes[-2:] == ['.tar', '.gz'] or path.suffix == '.tgz':
        with tarfile.open(path, 'r:*') as archive:
            names = [member for member in archive.getmembers()
                     if member.isfile() and member.name.endswith(MEMBER_SUFFIX)]
            if len(names) != 1:
                raise SystemExit(f'{path}: expected exactly one {MEMBER_SUFFIX}, found {len(names)}')
            handle = archive.extractfile(names[0])
            if handle is None:
                raise SystemExit(f'{path}: model member cannot be read')
            return handle.read()
    raise SystemExit(f'{path}: unsupported package format; provide a wheel or sdist')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    candidates = sorted(path for path in args.source_dir.iterdir()
                        if path.name.startswith('basic_pitch-0.4.0')
                        and path.suffix in {'.whl', '.gz', '.tgz'})
    if len(candidates) != 1:
        raise SystemExit(f'expected one basic_pitch-0.4.0 wheel/sdist in {args.source_dir}, found {len(candidates)}')
    data = read_member(candidates[0])
    if len(data) != SIZE:
        raise SystemExit(f'Basic Pitch browser model size mismatch: got {len(data)}, expected {SIZE}')
    actual = hashlib.sha256(data).hexdigest()
    if actual != SHA256:
        raise SystemExit(f'Basic Pitch browser model hash mismatch: got {actual}, expected {SHA256}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='basic-pitch-', suffix='.onnx', dir=args.output.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
        os.replace(temporary, args.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'Verified Basic Pitch browser model: {args.output} ({len(data)} bytes, sha256 {actual})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
