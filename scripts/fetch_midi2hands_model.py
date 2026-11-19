#!/usr/bin/env python3
"""Fetch and verify the optional, pinned midi2hands ONNX artifact.

The model is intentionally not committed. This script is the reproducible CI/local
provisioning path; it verifies both byte size and SHA-256 before writing.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
import urllib.request
from pathlib import Path

URL = ('https://raw.githubusercontent.com/pianoviz/midi2hands/'
       '78e546b520144b301de5e793ceb83be61356a65d/src/midi2hands/models/onnex/model.onnx')
SIZE = 252047
SHA256 = '6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('tools/midi2hands/model.onnx'))
    parser.add_argument('--url', default=URL)
    args = parser.parse_args()
    destination = args.output
    if destination.is_file() and destination.stat().st_size == SIZE and digest(destination) == SHA256:
        print(f'Verified existing midi2hands model: {destination}')
        return 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(args.url, headers={'User-Agent': 'form-saas-ci/1'})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if len(data) != SIZE:
        raise SystemExit(f'midi2hands model size mismatch: got {len(data)}, expected {SIZE}')
    actual = hashlib.sha256(data).hexdigest()
    if actual != SHA256:
        raise SystemExit(f'midi2hands model hash mismatch: got {actual}, expected {SHA256}')
    descriptor, temporary = tempfile.mkstemp(prefix='midi2hands-', suffix='.onnx', dir=destination.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'Verified midi2hands model: {destination} ({len(data)} bytes, sha256 {actual})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
