"""Read-only structural analysis of the real piano draft document.

Developer diagnostic only; no production import, no mutation.
"""
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

path = Path(__file__).with_name('draft-document.json')
raw = path.read_bytes()
text = raw.decode('utf-16' if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else 'utf-8')
data = json.loads(text)

print('TOP-LEVEL KEYS:', list(data.keys()))
print('duration:', data.get('duration'))
print('subject:', data.get('subject'))
print('instrument:', json.dumps(data.get('instrument'))[:200])
print('spans:', len(data.get('spans') or []))
print('pedal:', len(data.get('pedal') or []))
print('guitar_chords:', len(data.get('guitar_chords') or []))
print('warnings:', data.get('warnings'))
print('playback:', json.dumps(data.get('playback')))
print('piano_preview:', json.dumps(data.get('piano_preview'))[:400])
print('preview_identity:', json.dumps(data.get('preview_identity'))[:300])
print('source_video:', json.dumps(data.get('source_video'))[:300])
print('provenance:', json.dumps(data.get('provenance'))[:400])
print('has notation key:', 'notation' in data, '| has alignment key:', 'alignment' in data)
print('reference:', json.dumps(data.get('reference'))[:300])

events = data.get('events') or []
print('\nEVENTS:', len(events))
print('EVENT KEYS:', sorted({k for e in events for k in e}))
print('first 3 events:', json.dumps(events[:3], indent=None)[:600])
print('last event:', json.dumps(events[-1])[:300])

onsets = [float(e['onset']) for e in events]
ends = [float(e['onset']) + float(e['duration']) for e in events]
print('\nONSET min/max: %.4f / %.4f' % (min(onsets), max(onsets)))
print('END max: %.4f  (clip duration %s)' % (max(ends), data.get('duration')))

vel = [e.get('velocity') for e in events if e.get('velocity') is not None]
print('velocity count:', len(vel), 'min/max:', (min(vel), max(vel)) if vel else None)

pitches = Counter(e['pitch'] for e in events)
print('distinct pitches:', len(pitches))
print('most repeated:', pitches.most_common(8))

# same-onset groups = chords
by_onset = defaultdict(list)
for e in events:
    by_onset[round(float(e['onset']), 6)].append(e)
groups = [g for g in by_onset.values() if len(g) > 1]
print('\nchord groups (same onset, >1 note):', len(groups))
print('max chord size:', max((len(g) for g in groups), default=1))
print('example chord:', json.dumps(sorted(groups[0], key=lambda e: e['pitch']) if groups else None)[:400])

# exact duplicate pitch+onset pairs (would collide in a naive id scheme)
dupes = [k for k, g in by_onset.items() if len({e['pitch'] for e in g}) != len(g)]
print('same pitch+onset duplicates:', len(dupes))

# gaps between successive distinct onsets
uniq = sorted({round(float(e['onset']), 6) for e in events})
gaps = [round(b - a, 3) for a, b in zip(uniq, uniq[1:])]
big = [(a, round(b - a, 2)) for a, b in zip(uniq, uniq[1:]) if b - a > 3]
print('\ndistinct onsets:', len(uniq))
print('median gap: %.3f  max gap: %.3f' % (statistics.median(gaps), max(gaps)))
print('gaps > 3 s (possible explanation passages):', big)

durs = [float(e['duration']) for e in events]
print('\nduration min/median/max: %.3f / %.3f / %.3f' % (min(durs), statistics.median(durs), max(durs)))

print('\nGAP TO CLIP END: %.3f' % (float(data['duration']) - max(ends)))

# structural read of event ordering
ordered = all(float(events[i]['onset']) <= float(events[i + 1]['onset']) + 1e-9 for i in range(len(events) - 1))
print('events sorted by onset:', ordered)
