"""Shared path, argument and JSON helpers for the Phase 1 audit scripts.

Every script resolves the repository root explicitly, so it works from its committed
location without being moved or having its imports repaired. Generated inputs and
outputs live in a scratch directory (default: ``.local/phase1-audit``) and are never
required to be committed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

MARKERS = ('packages/music-notation/index.ts', 'apps/api')


def repo_root(start: Path | None = None) -> Path:
    """Walk up from this file until the repository markers are found."""
    directory = (start or Path(__file__).resolve()).parent
    for _ in range(8):
        if all((directory / marker).exists() for marker in MARKERS):
            return directory
        if directory.parent == directory:
            break
        directory = directory.parent
    raise SystemExit(
        'Could not locate the repository root above '
        f'{Path(__file__).resolve()}: expected {", ".join(MARKERS)}. '
        'Run the script from a checkout of the repository.'
    )


ROOT = repo_root()
SCRATCH = ROOT / '.local' / 'phase1-audit'
FIXTURE = ROOT / 'docs' / 'qualification' / 'piano-workspace-phase-01' / 'fixtures' / 'phase1-draft-fixture.json'


def add_common_args(parser: argparse.ArgumentParser, input_help: str) -> None:
    parser.add_argument('--input', type=Path, default=None, help=input_help)
    parser.add_argument('--out', type=Path, default=SCRATCH, help='scratch directory for generated files')
    parser.add_argument('--fixture', action='store_true', help='use the tracked synthetic fixture instead of real data')


def resolve_input(args: argparse.Namespace) -> Path:
    if args.fixture:
        return FIXTURE
    return (args.input or SCRATCH / 'draft-document.json').resolve()


def read_json(path: Path) -> dict:
    raw = path.read_bytes()
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        text = raw.decode('utf-16')
    else:
        text = raw.decode('utf-8-sig')
    return json.loads(text)


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def fail(message: str, hint: str = '') -> None:
    print(f'ERROR: {message}', file=sys.stderr)
    if hint:
        print(f'HINT: {hint}', file=sys.stderr)
    raise SystemExit(2)
