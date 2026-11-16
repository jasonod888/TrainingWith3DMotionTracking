# Shared correction timeline and playback following

Branch `phase8/formatted-score`. Final commit reported with submission. The working `NotationDocument` remains the only note authority; navigation writes no musical data.

## Implemented checklist

### 1. Shared horizontal geometry and navigation
- `timeline-layout.ts` is the single continuous authority: measure widths, `tickToX`, `xToTick`, fractional aligned `sourceSecondsToTick`, `sourceSecondsToX`, inverse source mapping, held detection and scroll clamping.
- Adjacent measure boundaries share one x; the old per-measure renderer padding is no longer the time map.
- Roll attacks/ends and the sheet use the same measure boxes; recorded timing is projected through alignment, so an early/late attack stays early/late.
- One native horizontal scrollbar (`[data-shared-scrollbar]`) owns the viewport. The roll's and sheet's internal horizontal bars are suppressed and mirror the canonical offset synchronously; one shared zoom factor rebuilds the same layout.
- Roll vertical pitch scrolling remains independent and does not touch the horizontal controller.

### 2. One cursor
- One measurement (`116 + sourceSecondsToX(playhead)`, with the roll's 46px label gutter) drives two clipped segments in the roll plot and sheet plot. Child/duplicate playheads are removed in shared mode.
- Both segments were verified at the same screen x (within 1.5 px) on desktop and mobile; the shared grid and sheet barline also match.

### 3. Follow
- Follow playback is on initially.
- Cursor moves across the stationary view; at 70% of usable width on desktop (60% below 700px measured viewport) the canonical scroll advances so the cursor stays near the right threshold.
- Reveals/seeks put the cursor near 25% when it is offscreen.
- Pause freezes scroll/cursor; rate changes still use the video clock.
- Held/explanation time keeps the musical cursor fixed and shows `Explanation · score paused`; before/after the scored passage shows `Outside scored passage`.

### 4. Manual inspection
- Manual bar/trackpad/shift-wheel horizontal input suspends Follow immediately (origin-aware commanded-offset tracking, not a one-frame boolean).
- Playback continues offscreen; the direction indicator reports “Playing to the right/left” or “Playhead…” when paused.
- `Resume follow` enables and reveals without seeking. Explicit Follow-off persists through pause/play and offers `Enable follow`.
- Starting playback while manually suspended does not clear the suspension.

### 5. Safe editing
- Gesture start freezes automatic following and sets the gesture lock; the roll maps time/resize candidates through the shared inverse layout and applies the authored offset once.
- Pitch drags preserve timing exactly. Invalid/held-derived candidates are refused rather than silently snapped.
- One released gesture is one undoable edit; cancelling leaves document/history unchanged. Evidence covers time, resize and pitch drags, with Undo restoration.

### 6. State preservation
- Collapse/reopen, formatted-mode switch/return, selection and document/history are preserved; formatted mode stops animation and retains its pause/read-only policy.
- Save/reopen and MusicXML use the existing document path; formatted layout is display-only.

## Verification evidence

- Pure geometry: `apps/web/tests/shared-timeline.test.ts` (boundary continuity, inverse round trip, zoom, alignment/offset, held policy, early/late attacks).
- Shared controller test: single scrollbar, manual suspension, Resume, shared zoom.
- `scripts/check-shared-timeline.py`: desktop and 390×844 mobile — multiple screenfuls of playback, threshold tracking, pause freeze, manual offscreen suspension, Resume, collapse/reopen, formatted restore, zoom, one-bar/page-overflow and cursor/grid alignment.
- `scripts/check-shared-gestures.py`: time/resize/pitch drags, one edit, suspension and Undo.
- Original review probes 6/6; edge probes 3/3; saved-only/MusicXML journey and repeated lifecycle pass.
- Ordinary suite: **511 passed, 0 failed**; TypeScript and production build clean; all **16 Phase 7 regression scripts** pass.
- Captures: `shared-expanded-*`, `shared-collapsed-*`, `shared-follow-*`, `shared-manual-*`, `shared-resume-*` for desktop/mobile.

## Limitations
- Horizontal sheet note dragging remains excluded.
- Paginated formatted-score automatic follow remains excluded.
- Mobile retains the existing sticky inspector over the lower viewport; timeline surfaces scroll above it. Physical-device qualification was not performed.
- Held passages are not expanded into a separate score axis; the cursor holds and the status is shown.
- No new beat detection, hand separation, PDF/MIDI export or alignment authoring.

## Unchanged Phase 7 carry-forward
- 5,000-occurrence restriction inactive pending owner approval and activation audit.
- H1–H9 physical hardware **HARDWARE BLOCKED / NOT RUN**.
- Deployment and final release unauthorised.
