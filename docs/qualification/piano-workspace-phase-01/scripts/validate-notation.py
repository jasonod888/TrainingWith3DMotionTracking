"""Phase 1 check: does the current builder's real-draft notation pass the server validator?

Read-only. Uses apps.api.music_notation.validate_notation against the review contract's
MusicEvent list, exactly as POST /music-draft/review or /music-revision would.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.contracts import MusicEvent
from apps.api.music_notation import validate_notation

base = Path(__file__).with_name('draft-document.json')
raw = base.read_bytes()
text = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8')
draft = json.loads(text)
notation = json.loads(Path(__file__).with_name('notation-real.json').read_text(encoding='utf-8'))

events = [MusicEvent.model_validate(event) for event in draft['events']]
print(f'events={len(events)} notation_events={len(notation["events"])} duration={draft["duration"]}')

try:
    validate_notation(notation, events, draft['duration'])
except ValueError as exc:
    print('REFUSED:', exc)
else:
    print('ACCEPTED: the current builder output satisfies validate_notation')

# A single-note pitch correction changes only the performance pitch; does the pair stay valid?
edited = [event.model_copy() for event in events]
target = next(event for event in edited if event.pitch == 69)
target.pitch = 70
try:
    validate_notation(notation, edited, draft['duration'])
except ValueError as exc:
    print('REFUSED after one pitch edit:', exc)
else:
    print('ACCEPTED after one pitch edit (server would not detect the disagreement)')
