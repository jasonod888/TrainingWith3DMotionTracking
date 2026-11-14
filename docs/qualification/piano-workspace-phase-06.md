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

---

## 5. Review corrections (this commit)

| Review item | Resolution |
| --- | --- |
| R1 pointer transaction | Both surfaces now have one gesture lifecycle: an owned pointer id, capture-element tracking, separate commit/cancel paths, `pointercancel` and `lostpointercapture` cancel without touching the document, unmount tears the transaction down, and element/global handlers cannot double-commit. A normal release still commits once. |
| R2 sheet geometry | Pointer pixels are converted to SVG units, one diatonic step is half a staff line (5 units), the candidate notehead and label move to the engraved position, and returning to the origin clears the preview and commits nothing (authored accidentals preserved). |
| R3 insertion boundary | Every insertion (roll placement, playhead and add-to-chord buttons, keyboard pitch) goes through `insertionPlacement`: displayed seconds minus offset once, held/explanation passages and out-of-clip targets rejected, and written ticks derived from the alignment map (via a shared helper) with the recorded onset left exact. Written ticks snap to the sixteenth grid without changing the performance time. |
| R4 exclusive modes | Replace and Add are mutually exclusive: both surfaces stop editing while either is active, inspector edits, history and reopen are disabled while replacing, the other entry point is disabled, and a vanished target cancels the mode. Commands are validated with `applyCommand` before dispatch, so rejections keep the mode and show the rejection; no success message on a rejected or unchanged edit. |
| R5 tie vs occurrences | The inspector now derives written segments from `document.segments` per logical note and reports recorded attacks separately. It states that pitch replacement edits only the selected attack (splitting the written note if shared) and precisely what each delete action removes. |
| R6 controls and evidence | Add-note ghost has recorded-length and written-value controls whose values drive the ghost width and the committed command; a written beat-position control dispatches `move-written-start` without moving the recorded onset; Delete/Ctrl+Z/Ctrl+Y shortcuts are scoped and ignore typing fields; sharp/flat/natural/respell, chord isolation, the overlap picker and tie scope have surface checks; and a saved/reopened **1,338-note** correction is captured with before/after counts, exact onset and unrelated-note checks. |

### Verification

| Check | Result |
| --- | --- |
| Reviewer edge-case probes | **8/8** |
| Interaction + journey tests | **14** (8 gesture, 6 journey) |
| Web suite | **468 passed**, `tsc` clean |
| Browser editing script | exit 0, including {pitch drag 60→62, time 2.0→2.6 s, resize 1.0964 s, sheet C4→D4, replace 60→62, duplicate warning, accidentals/respell, chord isolation, overlap picker of 2, saved/reopened 60→63, and the long example 1,338 notes with target 69→72 and unrelated notes preserved} |

Evidence: `phase6-editing.json`, `captures/` (accidentals-respell, chord-isolation, overlap-picker, long-saved-reopened and the original surfaces), `scripts/workspace-gestures.test.tsx`, `scripts/workspace-editing-journeys.test.tsx`, `scripts/check-editing.py`, `scripts/workspace-phase6-review-repro.tsx`.

---

## 6. Correction review F1–F6 (this commit)

| Item | Resolution |
| --- | --- |
| F1 written duration | Insertions now send `durationTicks` (the chosen written value) independently of `durationSeconds`; all entry points carry the remembered written value. A deliberately different pair is tested: 0.25 s recorded with a half note yields **960 written ticks**, and inspection confirms recorded 0.250 s. |
| F2 history shortcuts | Undo/redo shortcuts follow the same transaction policy as the buttons: blocked while Replace or Add is active (and for Add in the toolbar too), scoped to an active workspace via a pointer-focus guard, and the replacement target is not edited underneath the banner. |
| F3 written position | The control exposes an explicit **This note / Whole written event** scope. Single-note events move; a chord member in note scope is rejected with an explanation instead of silently moving the chord; whole-event movement requires choosing that scope. The draft is controlled and re-bound on selection change, so no stale value leaks to another note. |
| F4 invalid insertion | Ghosts are no longer clamped: placing before the offset stores the attempted source time, shows an invalid ghost and the reason, and Insert is rejected without a command or history entry (count unchanged). |
| F5 pointer ownership | Element-level commit/cancel handlers now check pointer id as well as the global handlers, and a second pointer cannot replace an active transaction. `data-pitch` reports the committed document pitch while the drag preview is exposed separately, so a refused foreign release leaves the original transaction and pitch untouched. |
| F6 sheet preview | The candidate notehead and label follow the staff position (`cy` 84 → 79 for one space) and the browser check compares the committed spelling (C4 → D4), not a “selected” label suffix. A separate committed-spelling assertion and the collision rejection remain distinct. |

### Verification (correction)

| Check | Result |
| --- | --- |
| Independent six correction browser checks | **6/6** |
| Original eight reviewer probes | **8/8** |
| Gesture + journey tests | **17** (8 gesture, 9 journey) |
| Web suite | **471 passed**, `tsc` clean |
| Long fixture save/reopen | 1,338 notes; target 69→72; **every** unrelated event identical (pitch, onset, duration); reopened pitch preserved |
| Submitted browser script | exit 0; sheet check now asserts the committed spelling (C4→D4) and candidate head movement |

Evidence files: `phase6-editing.json` (own surfaces + long example), `scripts/check-correction.py` and `phase6-correction.json` (reviewer checks), `scripts/workspace-editing-journeys.test.tsx`, `scripts/workspace-gestures.test.tsx`, `scripts/workspace-phase6-review-repro.tsx`.
