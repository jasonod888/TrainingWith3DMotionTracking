"""Chord spread inside one notation event (read-only).

An event is a notational container, not an occurrence group: members can carry different
recorded onsets and lengths. Reports how often that happens in an emitted notation
document.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/chord-spread.py --fixture
  python docs/qualification/piano-workspace-phase-01/scripts/chord-spread.py --input=.local/phase1-audit/notation-real.json
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import SCRATCH, fail, read_json, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description='Measure recorded-onset spread within notation chords.')
    parser.add_argument('--input', type=Path, default=None)
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--out', type=Path, default=SCRATCH)
    args = parser.parse_args()

    path = Path(args.input) if args.input else args.out / ('notation-fixture.json' if args.fixture else 'notation-real.json')
    if not path.exists():
        fail(f'notation document not found: {path}',
             'Run emit-notation.ts first (use --fixture for the tracked fixture).')
    notation = read_json(path)
    performance = {item['id']: item for item in notation['performance']}
    spreads: list[float] = []
    durations_differ = 0
    chords = 0
    for event in notation['events']:
        if len(event['notes']) < 2:
            continue
        chords += 1
        onsets = [performance[linked]['onset'] for note in event['notes']
                  for linked in note['performance_ids'] if linked in performance]
        lengths = [performance[linked]['duration'] for note in event['notes']
                   for linked in note['performance_ids'] if linked in performance]
        if len(set(onsets)) > 1:
            spreads.append(max(onsets) - min(onsets))
        if len(set(lengths)) > 1:
            durations_differ += 1
    summary = {
        'input': str(path),
        'chord_events': chords,
        'chords_with_different_recorded_onsets': len(spreads),
        'median_spread_s': round(statistics.median(spreads), 4) if spreads else None,
        'max_spread_s': round(max(spreads), 4) if spreads else None,
        'chords_with_different_recorded_durations': durations_differ,
    }
    write_json(args.out / ('chord-spread-fixture.json' if args.fixture else 'chord-spread-real.json'), summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
