"""Structural analysis of a draft document (read-only).

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/analyze-draft.py --fixture
  python docs/qualification/piano-workspace-phase-01/scripts/analyze-draft.py --input=.local/phase1-audit/draft-document.json
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import add_common_args, read_json, resolve_input, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description='Summarise a draft document.')
    add_common_args(parser, 'draft document JSON (default: <scratch>/draft-document.json)')
    args = parser.parse_args()
    data = read_json(resolve_input(args))
    events = data.get('events') or []

    onsets = [float(event['onset']) for event in events]
    ends = [float(event['onset']) + float(event['duration'] or 0.25) for event in events]
    by_onset = defaultdict(list)
    for event in events:
        by_onset[round(float(event['onset']), 6)].append(event)
    groups = [group for group in by_onset.values() if len(group) > 1]
    duplicates = [key for key, group in by_onset.items() if len({event['pitch'] for event in group}) != len(group)]
    distinct = sorted(by_onset)
    gaps = [round(b - a, 3) for a, b in zip(distinct, distinct[1:])]

    summary = {
        'input': str(resolve_input(args)),
        'keys': sorted(data.keys()),
        'duration': data.get('duration'),
        'event_count': len(events),
        'span_count': len(data.get('spans') or []),
        'spans': data.get('spans'),
        'has_notation': 'notation' in data,
        'has_alignment': 'alignment' in data,
        'playback': data.get('playback'),
        'first_onset': min(onsets) if onsets else None,
        'last_end': max(ends) if ends else None,
        'distinct_onsets': len(distinct),
        'chord_groups': len(groups),
        'largest_chord': max((len(group) for group in groups), default=1),
        'notes_in_chords': sum(len(group) for group in groups),
        'same_pitch_same_onset_duplicates': len(duplicates),
        'median_gap_s': statistics.median(gaps) if gaps else None,
        'longest_gap_s': max(gaps) if gaps else None,
        'null_duration_events': sum(1 for event in events if event.get('duration') is None),
        'null_velocity_events': sum(1 for event in events if event.get('velocity') is None),
        'distinct_pitches': len({event['pitch'] for event in events}),
        'most_repeated': Counter(event['pitch'] for event in events).most_common(8),
    }
    write_json(args.out / ('analysis-fixture.json' if args.fixture else 'analysis-real.json'), summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
