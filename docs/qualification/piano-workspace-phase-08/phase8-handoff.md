# Phase 8 handoff — read-only formatted score (P8-R1–R4 correction)

Branch `phase8/formatted-score`. Final commit identity reported with this submission. Based on Phase 7 baseline `97172c2`.

## Status

| Requirement | Status |
| --- | --- |
| P8-R1 genuinely read-only formatted mode | **PASS** |
| P8-R2 editor/media lifecycle across switches | **PASS** |
| P8-R3 visible engraving | **PASS** (lightweight engraver; limits below) |
| P8-R4 saved/reopened + exact MusicXML agreement | **PASS** |
| Phase 8 acceptance | Submitted for review |
| Phase 7 carry-forward | Unchanged (limit inactive; H1–H9 hardware blocked) |

## C1–C3 edge corrections (final)

### C1 — unfinished pointer transactions

- Passing `editingEnabled=false` on entering formatted mode now cancels an active roll or sheet drag: pointer capture is released, global pointer listeners are removed, the drag/candidate state is cleared, and late pointer-up commits are refused.
- The gesture callback independently refuses edits while formatted mode is active.
- Durable tests start a real pitch drag, switch via the formatted button, release the pointer, and prove document/history unchanged; return and prove a normal drag commits exactly once. Add/Replace cancellation remains covered.
- `review-edge-probes.py` case `preview-cancels-in-flight-pointer-transaction` passes.

### C2 — all supported keys

- The formatted signature now derives from the shared engine `keySignature` fifths/mode; the separate major-key map is removed.
- All **30 supported major/minor keys** render the correct sharp/flat count on both staves; zero-signature keys render none. The edge runner passes all 30, including Em/Dm/Bbm and 7-accidental extremes.
- MusicXML continues to use the shared key helper. Fixture capture: `captures/fixture-bbm.png` (5 flats per staff).

### C3 — complete ledger range

- The five-ledger cap is removed; ledgers are drawn for the actual pitch and staff geometry.
- A0 renders **6** ledger lines and C8 renders **9**, attached to the correct staff/system; system height was increased to 280 and page height to 1500 so extreme notes remain unclipped.
- Fixture captures: `captures/fixture-a0.png`, `captures/fixture-c8.png`.
- E4/F5/A3 anchors, segment/occurrence coverage and original review probes remain passing.
- Durable tests in `formatted-score.test.tsx` cover all 30 keys and the A0/C8 ledger counts; `workspace-editing-journeys.test.tsx` covers drag cancellation and ordinary editing after return.
- `review-edge-probes.py`: **3/3 pass**.


## P8-R1 — read-only formatted mode

- The hidden correction subtree cannot receive edits: the main Delete/Backspace, Undo/Redo shortcuts, add-mode Enter and replace interactions all return early while formatted mode is active.
- Entering formatted mode cancels active Add/Replace/duplicate modes, so no hidden transaction can commit.
- Durable tests in `workspace-editing-journeys.test.tsx`:
  - dirty document + selection → formatted → Delete, Backspace, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, `a`; complete document, history, selection and dirty state unchanged.
  - Return to correction and prove Delete/Ctrl+Z work again.
  - Add/Replace cancellation across the switch.
- Independent review probe `formatted-preview-blocks-delete` passes (1,338 notes/history unchanged).

## P8-R2 — lifecycle across mode switches

Correction surfaces are no longer unmounted: the correction subtree remains mounted and is hidden while the formatted page is shown. The same `<video>` element and its clock/controller remain alive. Entering preview explicitly pauses the shared source at the current position and preserves rate; returning does not replace or recreate the element.

`check-mode-lifecycle.py` (three repeated switches) verifies:

- dirty document, selection and history preserved;
- roll `scrollTop=25`, `scrollLeft`/window start ~1.955 s, span 8 s (after Zoom in), sheet `scrollLeft=117` preserved;
- same video element, position 1.5 s and rate 0.75 preserved;
- after return, Play advances the same video and the workspace clock follows (1.64 s vs 1.77 s native at sample);
- entering preview while playing pauses at 0.4119 s; return stays paused at the same position/rate.

Raw results: `scripts/mode-lifecycle-results.json`. The independent review probe's scroll and media cases pass.

## P8-R3 — visible engraving

- Staff lines are visible (correct `.formatted-staff` CSS), five lines per staff on every system.
- Shared staff geometry: 8-unit line spacing and 4-unit diatonic step; the review's exact anchors now pass (treble E4/F5, bass A3). Ledger lines are system-relative, aligned to staff-line positions, and drawn only near the staff.
- Note values are visually distinct: hollow whole/half, stemmed quarter, and standard flags for eighth–sixty-fourth. Dotted values retain dots.
- Clef, key-signature and meter context: treble/bass clefs, key signature glyphs on both staves for sharp/flat keys (G/F fixtures verified), and stacked 4/4 meter numbers.
- Ties use correct endpoints: outgoing continuations start at the source's right edge; incoming continuations approach the target's left edge. 350 continuation paths on the real recording.
- Measure widths expand up to 320 units (minimum 120) for dense chords/accidentals/rests. The real recording now lays out as 16 pages / 62 systems; extreme-register systems use the enlarged 280-unit system height.

Compact fixtures in `formatted-score.test.tsx` cover both-staff line/space anchors, ledger notes above/below, whole/half/quarter/eighth/sixteenth values and flags, dotted values, rests, sharp/flat keys, chords and ties within/across systems. Real pages re-captured and visually inspected after the repair: `captures/formatted-real-page1.png`, `captures/formatted-real-page2.png`.

## P8-R4 — saved/reopened and MusicXML agreement

Full controlled journey on the real recording:

1. Edit occurrence `bp-14`: pitch `64→65`, written duration `480`, spelling `E#4`.
2. Formatted view: selected occurrence renders `data-pitch=65`, `data-spelling=E#4`, `data-formatted-value=quarter`; complete document unchanged across the switch.
3. MusicXML: parsed with ElementTree and matched in the edited **measure/staff/voice** as step `E`, alter `1`, octave `4`, type `quarter`, no spurious tie.
4. Return to correction: selection and 0/10 s viewport restored; pitch 65 verified.
5. Save privately, reload through the actual saved-only `music-review` route with the saved revision manifest/reference; reopened correction contains pitch 65, spelling E#4 and written duration 480; formatted view shows the same note.
6. Saved reference payload and export agree; no rebuild from performance.

Raw result: `phase8-formatted.json` (`saved_reopened=true`, `musicxml=true`, `broken_ties=350`).

## Verification

- Web suite: **508 passed, 0 failed**; TypeScript and production build clean.
- Phase 7 regression set: all **16 scripts** pass on this branch.
- Independent review probes: **6/6 pass**.
- Phase 8 focused: 5 formatted-score fixtures + 2 application-level mode tests, all pass.
- Mode-lifecycle script: PASS.
- Saved-point eviction regression: pass.

## Limits

- No PDF; MusicXML is the only export and is labelled accurately.
- Lightweight engraver: no beams, dynamics, lyrics, slurs beyond ties, articulation or hand separation.
- Session-only selection/viewport are not part of save persistence; the same-session mode switch preserves them.
- Phase 7 carry-forward unchanged: 5,000/512 restriction inactive pending owner approval and activation audit; H1–H9 physical testing **HARDWARE BLOCKED** (NOT RUN); deployment/final release unauthorised.
