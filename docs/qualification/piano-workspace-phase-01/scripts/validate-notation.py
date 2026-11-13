"""Run the server-side notation validator against an emitted notation document (read-only).

This is the same check the review and revision endpoints apply, executed without touching
either endpoint or the database.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/validate-notation.py --fixture
  python docs/qualification/piano-workspace-phase-01/scripts/validate-notation.py --input=.local/phase1-audit/draft-document.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import ROOT, SCRATCH, add_common_args, read_json, resolve_input, write_json

sys.path.insert(0, str(ROOT))
from apps.api.contracts import MusicEvent          # noqa: E402
from apps.api.music_notation import validate_notation  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description='Validate emitted notation against draft events.')
    add_common_args(parser, 'draft document JSON (default: <scratch>/draft-document.json)')
    parser.add_argument('--notation', type=Path, default=None, help='emitted notation JSON')
    args = parser.parse_args()

    draft_path = resolve_input(args)
    draft = read_json(draft_path)
    notation_path = args.notation or args.out / ('notation-fixture.json' if args.fixture else 'notation-real.json')
    if not notation_path.exists():
        print(f'ERROR: notation document not found: {notation_path}\n'
              'HINT: run emit-notation.ts first (use --fixture for the tracked fixture).', file=sys.stderr)
        raise SystemExit(2)
    notation = read_json(notation_path)

    events = [MusicEvent.model_validate(event) for event in draft['events']]
    result = {
        'draft': str(draft_path),
        'notation': str(notation_path),
        'events': len(events),
        'notation_events': len(notation['events']),
        'duration': draft['duration'],
    }
    try:
        validate_notation(notation, events, draft['duration'])
    except ValueError as exc:
        result['builder_output'] = f'REFUSED: {exc}'
    else:
        result['builder_output'] = 'ACCEPTED'

    # A single occurrence pitch change must not silently pass while notation disagrees.
    edited = [event.model_copy() for event in events]
    target = next((event for event in edited if event.pitch == 60), edited[0])
    target.pitch = target.pitch + 1 if target.pitch < 127 else target.pitch - 1
    try:
        validate_notation(notation, edited, draft['duration'])
    except ValueError as exc:
        result['after_one_pitch_edit'] = f'REFUSED: {exc}'
    else:
        result['after_one_pitch_edit'] = 'ACCEPTED (server would not detect the disagreement)'

    write_json(args.out / ('validation-fixture.json' if args.fixture else 'validation-real.json'), result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
