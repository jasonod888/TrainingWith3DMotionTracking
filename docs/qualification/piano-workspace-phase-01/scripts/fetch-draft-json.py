"""Dump the real draft document JSON for the read-only audit scripts.

Read-only: SELECTs the draft document and copies it out of the database container.
The private recording and the full draft stay in the scratch directory and are never
committed.

Prerequisites are checked explicitly so a missing service produces a clear error.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/fetch-draft-json.py
  python docs/qualification/piano-workspace-phase-01/scripts/fetch-draft-json.py --lesson <id> --container <name> --database <name>
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import SCRATCH, fail

DEFAULT_LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
DEFAULT_CONTAINER = 'form-saas-postgres-1'
DEFAULT_DATABASE = 'form_ui_test'


def run(command: list[str], description: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        fail(f'{description}: command not found: {command[0]}',
             'Install Docker Desktop and make sure the local stack is running, or pass documented '
             'alternatives. Use --fixture on the other scripts to audit without live services.')
    except subprocess.TimeoutExpired:
        fail(f'{description}: timed out after 120 s')


def main() -> None:
    parser = argparse.ArgumentParser(description='Dump a music draft document to scratch (read-only).')
    parser.add_argument('--lesson', default=DEFAULT_LESSON)
    parser.add_argument('--container', default=DEFAULT_CONTAINER)
    parser.add_argument('--database', default=DEFAULT_DATABASE)
    parser.add_argument('--out', type=Path, default=SCRATCH / 'draft-document.json')
    args = parser.parse_args()

    if shutil.which('docker') is None:
        fail('docker is not on PATH', 'Start Docker Desktop and the local stack, or use --fixture elsewhere.')

    listing = run(['docker', 'ps', '--format', '{{.Names}}'], 'list containers')
    if args.container not in (listing.stdout or '').split():
        fail(f'container {args.container!r} is not running',
             'Start the local stack (docker compose up -d) or pass --container.')

    remote = '/tmp/phase1-draft.json'
    query = (f"select document::text from music_drafts where lesson_id='{args.lesson}' "
             "order by created_at desc limit 1")
    dump = run(['docker', 'exec', args.container, 'psql', '-U', 'form', '-d', args.database,
                '-t', '-A', '-c', query, '-o', remote], 'dump draft document')
    if dump.returncode != 0:
        fail(f'psql failed: {(dump.stderr or "").strip()[:400]}',
             'Check --database (the local UI-test database is form_ui_test, not form).')

    args.out.parent.mkdir(parents=True, exist_ok=True)
    copy = run(['docker', 'cp', f'{args.container}:{remote}', str(args.out)], 'copy dump out of container')
    if copy.returncode != 0 or not args.out.exists():
        fail(f'could not copy the dump: {(copy.stderr or "").strip()[:400]}')

    size = args.out.stat().st_size
    if size == 0:
        fail(f'no draft document was found for lesson {args.lesson} in {args.database}',
             'Verify the lesson id and database name, or use --fixture on the other scripts.')
    print(f'wrote {args.out} ({size} bytes) from {args.container}/{args.database}')


if __name__ == '__main__':
    main()
