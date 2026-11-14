# Piano correction workspace — Phase 6 submission

Complete visual editing interactions in the isolated workspace.

| | |
| --- | --- |
| Phase | 6 — Complete visual editing interactions |
| Branch | `phase6/visual-editing` |
| Scope | Gesture editing, explicit modes, indicators, safe tie scope; Phase 5 pipeline reused |
| Phase 7 | Not started |

## 0. What was added

| Area | Behaviour |
| --- | --- |
| Roll pitch drag | 5 px threshold, first dominant axis locks, pitch preview with bounded audition, Escape/pointer-cancel restores, one completed drag = one command = one undo step |
| Roll time drag | Horizontal drag moves the exact recorded onset (Snap Off keeps the exact value); pitch and length unchanged |
| Roll recorded-length resize | Right-edge handle changes recorded duration only, never the written value or pitch |
| Sheet drag | Individual notehead drag moves by diatonic staff steps, shows the candidate spelling before release, respects the key signature, Escape cancels |
| Replace pitch | Explicit target mode; a key click commits exactly that occurrence, mode exits, Escape changes nothing, the original key is a no-op; other inspector edits are disabled while replacing |
| Add note | Ghost placement in the roll, Insert/Enter commits, Escape/Cancel discards, duplicate placement warns and offers to select the existing note |
| Keyboard | Selection by sounding occurrence with an overlap picker; no-sounding keys audition only |
| Indicators | Selection, sounding notes, ghost (and invalid ghost), drag axis, replace banner, tie scope |
| Touch / numeric alternatives | Handles and drags use pointer events with `touch-action: none`; all values remain editable numerically in the inspector |
| Tie scope | Inspector states “Entire tied note: N linked segments”; pitch replacement/delete target the logical note; independent segment editing is not claimed |

## 1. Acceptance gate

| Criterion | Evidence |
| --- | --- |
| Roll journeys 6.2/6.6 | Pitch drag 60→62, Escape leaves 60 with no history, exact time drag 2.0→2.6 s at the measured scale, resize to 1.0964 s (`phase6-editing.json`) |
| Sheet 6.3 | Notehead drag C4→D4 with candidate label; key signature respected by `diatonicStep` |
| Replace pitch 6.4 | 60→62 committed once, mode exited; Escape no change; same key reports “same pitch, no change” |
| Add note 6.5 | Ghost shown, Insert 4→5 notes, Escape inserts nothing, duplicate warns with Select existing |
| Duration scope | Inspector labels written value vs recorded length, and actions state their scope |
| Edit isolation | Chord/occurrence edits act on the selected occurrence; ambiguous mappings are refused or opened in the overlap picker |
| Save/reopen 6.7 | Pitch correction saved (`saved: 63`) and reopened (`reopened: 63`) through the Phase 5 reference pipeline |
| Undo/redo | One drag is one undo step; Escape/cancel adds none; shared history across views |

## 2. Evidence

- Interaction tests: `apps/web/tests/workspace-gestures.test.tsx` (8 tests) — gesture arithmetic, roll pitch/time/resize, Escape, sheet drag, Replace pitch, Add note/duplicate.
- Browser script: `docs/qualification/piano-workspace-phase-06/scripts/check-editing.py` — real Chromium pointer drags, screenshots and a saved/reopened correction.
- Captures: `pitch-drag.png`, `time-drag.png`, `resize.png`, `sheet-drag.png`, `replace-pitch.png`, `add-ghost.png`, `duplicate-warning.png`, `saved-round-trip.png`.
- Results: `phase6-editing.json` (no failures); web suite **462 passed**; `tsc` clean.

## 3. Limitations

- Evidence is screenshots plus assertions, not video recordings; the reviewer may ask for short clips.
- Touch gestures are pointer-event based and CSS-hardened but were exercised with a mouse in Chromium, not on a touch device.
- Splitting a tie into independently editable segments is **not** implemented; the inspector states the logical scope and the UI does not pretend otherwise.
- Free-form score-position authoring (`written beat-position` control) is not added; written duration and recorded values are editable explicitly.
- The overlap picker lists occurrences by onset/duration; it does not preview audio per candidate.

## 4. Scope statement

No persistence changes, no page replacement, no publication. Phase 7 has not started.
