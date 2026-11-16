# Phase 8 review — consolidated correction handoff

Reviewed 16 November 2026 (Singapore).
Branch `phase8/formatted-score`; submitted commit `1c49c1697147284ef4b0cb73338272a5dd4cfe01`, based on reviewed Phase 7 baseline `97172c2`.

## Decision

**Phase 8 needs corrections; it is not accepted yet.** The shared-document architecture and accurately labelled MusicXML-only scope are appropriate. The formatted view has functional rendering and read-only problems, and the new mode transition regresses existing correction-view/media behaviour.

This is the complete correction package for the submitted Phase 8 scope. Do not reopen the deferred Phase 7 optimisation/cap/hardware work, add hand separation or MIDI export, or migrate libraries as a new prerequisite. No PDF, beams, lyrics, dynamics or additional notation feature is required to close these findings; fundamental pitch/rhythm readability is required.

## Independent verification

| Check | Result |
|---|---|
| Exact submitted commit | Confirmed |
| TypeScript | Clean |
| Focused `formatted-score.test.tsx` suite | 3/3 pass, normal exit |
| Submitted page 1/page 2 captures | Visually inspected; missing staves and detached ledger-line blocks visible |
| Independent browser probes | **0/6 pass**, detailed below |
| Full 500-test suite/build and complete 16-script regression result | Developer-reported; not independently repeated in this review |

Commands from repo root, except the Node commands run inside `apps/web`:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-08/review-probes.py
```

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs --test tests/formatted-score.test.tsx
```

Raw independent output: `review-probes-results.json`. The probes use controlled API routes and a local source-video fixture; no real lesson/server data was changed. Only review files were added; product code was not changed.

The three unit tests establish placement counts and render-time immutability, but they do not prove visible notation, live-route read-only behaviour or mode-return lifecycle correctness. Their passing result is consistent with the browser failures.

## P8-R1 — formatted view must actually be read-only

**Reproduced:** select an occurrence, enter Formatted score, press Delete. The document changes from **1,338 to 1,337 occurrences**, history from 0 to 1. Hidden correction-mode shortcut handlers remain installed and accept the input because the formatted view is still inside the active workspace.

**Required repair:** block user editing/Undo/Redo shortcuts while formatted mode is active. Account for Delete, Backspace, Ctrl/Cmd+Z, redo, Add/Replace/Enter and any unfinished gesture/mode. Complete or cancel an in-progress interaction before switching, or refuse switching until it resolves; never allow a hidden edit to commit from the preview. Preserve normal correction-mode and outside-workspace shortcut behaviour.

**Pass evidence:** enter formatted view from a dirty edited document with a selection, attempt all supported edit/history shortcuts, and assert exact document, history, selection and dirty state unchanged. Return and prove the same actions still work in correction mode. Keep normal copy/navigation/export available. This is independent of the approval-gated 5k policy: formatted mode must be read-only for small lessons too.

## P8-R2 — mode switching must preserve correction and source-player state

The harness remains mounted, but the conditional JSX unmounts its entire correction subtree, including TimeRoll, ContinuousScore and the video/audio elements. Keeping only the parent mounted does not preserve native scroll/media state or rebind effects attached to the original video.

### Independent pure mode-switch result

No Delete/Undo was performed during this check:

| State | Before | After return |
|---|---:|---:|
| Roll vertical scroll | 25 | 50 |
| Roll horizontal scroll | 72 | 0 |
| Roll window start | 0.95517 s | 0 s |
| Roll window span | 10 s | 10 s |
| Score horizontal scroll | 117 | 117 |

The submitted 0/10 s test does not expose this non-default viewport reset.

### Independent loaded-video result

- Before preview: paused video at **1.5 s**, playback rate **0.75**.
- After return: a replacement video at **0 s**, playback rate **1**.
- Clicking Play advances the new video's currentTime to approximately **0.29 s**, but the workspace clock remains **1.50 s**. Thus the two note views no longer have a trustworthy source clock after preview switching.

**Required repair:** preserve the correction surface and media lifecycle, or explicitly snapshot/restore their complete state and rebind the existing clock/controller correctly. Do not introduce a second transport or editable document. Make the preview-entry playback policy explicit (for example, pause at the current position); either policy must preserve position/rate and return to a working source controller.

**Pass evidence:** nonzero time window and zoom, vertical roll pitch scroll, score scroll, selection and unsaved authored document survive repeated mode switches. With loaded source video, test paused and playing entry, return, play/pause/seek/rate, both cursors and Original/Piano state where available. No stale media listeners, free-running audition, duplicate video/clock or old playhead values. No new full Phase 7 performance matrix is requested for this repair; run the affected transport/focus/save regressions.

## P8-R3 — fix actual engraving, not only data attributes

### A. Staves are invisible

The renderer creates `.formatted-staff`, but CSS styles `.ws-formatted-staff`. The browser reports `stroke: none` on the five staff lines. Both supplied captures visibly show this problem.

### B. Pitch and ledger geometry use inconsistent units/origins

Staff lines are 8 SVG units apart; one diatonic step must therefore be 4, not 4.5. The independent layout probe finds:

| Note | Actual y | Correct staff-line y |
|---|---:|---:|
| E4, treble bottom line | 162 | 162 |
| F5, treble top line | 126 | 130 |
| A3, bass top line | 200 | 204 |

Ledger calculations compare page-absolute note y to staff-local bounds and add lines every 4.5 units instead of every staff-line interval. This produces the detached black line blocks in the supplied screenshots. A correct `data-pitch` does not make a note visually correct if its head is on the wrong line.

### C. Written values and key context must be legible

`noteGlyph` draws the same filled head and unflagged stem for quarter, eighth, sixteenth, thirty-second and sixty-fourth notes. Their `data-formatted-value` differs but their rhythm is not visually distinguishable. Beaming can remain out of scope; shorter values still require the correct flags or equivalent standard notation.

The key is currently printed as a bare name such as `C` or `G` rather than a conventional key signature. For a non-C key, notes may suppress their local accidental according to that key, so the formatted score must make those sharps/flats unambiguous. Render the appropriate key signature and readable meter/clef context for the grand staff. Do not require the reader to infer suppressed alterations from a stray letter.

### D. Tie continuations need endpoint correctness

The same-system tie path has actual endpoints, but every broken stub is drawn rightwards. For an incoming tie, the source currently starts at `to.x - 6` and extends 16 units rightward, crossing past the target note instead of approaching its left edge. The count of 218 `.is-broken` elements does not establish a correct outgoing/incoming pair.

**Required repair:** use consistent shared engraving primitives/coordinates for staff steps, noteheads, ledgers, note values and ties. Reuse existing continuous-score primitives where helpful. Fix spacing sufficiently that supported dense chords/accidentals/rests remain readable; do not compress every dense measure into the fixed 190-unit maximum if that forces collisions. A new notation library is not required by this review.

**Pass evidence:** inspect the real recording pages after the repair, plus compact labelled fixtures covering both-staff line/space anchors, ledger notes above/below, whole/half/quarter/eighth/sixteenth/shorter and dotted values, rests, a sharp key and a flat key, chords and ties within a system/across a system/across a page. Verify visible geometry and the correct tied endpoint/pitch identities; do not rely only on attributes or element counts. All musical segments/measures must still be retained without mutation.

## P8-R4 — complete saved/reopened and export agreement

The original phase explicitly requires reopening finalised material and comparing correction, formatted view and export. The submission demonstrates a saved payload but does not run that reopen journey. A real authenticated backend is not required to close the UI evidence gap: a valid controlled manifest/reference fixture exercising the actual saved-only route is sufficient, alongside existing API contract evidence.

The current MusicXML assertions search the entire file for `<step>E</step>`, `<alter>1</alter>` and `<type>quarter</type>` independently. In a long score, those strings may belong to different notes. Locate the edited note in its measure/staff/voice and verify spelling, octave, written duration/value and ties together.

**Pass evidence:** edit pitch, independent recorded/written durations and spelling -> formatted preview -> MusicXML parse -> Return -> save privately -> reload saved-only route with proposal unavailable -> inspect the same authored occurrence in correction, formatted view and export. Preserve IDs/mappings, other notes, written state and alignment; do not silently rebuild from performance. Use a valid versioned manifest and correct reference hash. Include a non-default session viewport in the same-session mode-return check. Do not demand cross-reload persistence of session-only selection/viewport if it was never part of the save contract.

## Single resubmission and scope boundary

Complete P8-R1 through P8-R4 together before the next acceptance submission. Deliver:

1. Final branch/SHA and concise repair explanation.
2. Passing independent six-case probe (or compatible improved assertions), durable application-level read-only/state/media tests, geometry/value/context/tie fixtures and a real saved-only route journey.
3. Fresh visually inspected page 1/page 2 and notation-fixture captures; exact edited-note MusicXML assertions.
4. Ordinary tests, TypeScript/build and affected existing editing/transport/save regressions. Rerun broader checks only where the changes justify them; no new 1,200-sample Phase 7 run is required merely for score rendering.
5. The unchanged explicit Phase 7 carry-forward record: cap inactive, pre-activation audit/approval pending, physical H1-H9 blocked. Deployment/final release remain separate.

No PDF or MIDI export is requested. No dynamics, lyrics, hand detection or professional engraving feature expansion is added. The required result is a readable and genuinely read-only formatted view of the existing notes, with a safe return to the working editor and matching saved/exported music.
