# UI refinements — collapsible roll, complete drag preview, score context

Branch `phase8/formatted-score`. Final commit reported with submission. Shared `NotationDocument` remains the only note authority; no second transcription or save format.

## 1. Collapsible piano roll

- The roll is an accordion and starts **collapsed**; its header is a keyboard-operable button with `aria-expanded`/`aria-controls`.
- The roll body remains mounted and is hidden with `hidden`, so its time window/zoom, scroll offsets, and selection survive repeated collapse/reopen without playback interruption.
- The score area moves up when collapsed; no gap is left where the roll was.
- Durable app test asserts collapsed default, reopen, and preserved `scrollTop`/`scrollLeft`/selection.
- Browser evidence (`check-ui-refinements.py`) verifies on desktop and 390×844 mobile that scroll top/left, score scroll, roll window start/span, and selection are identical before/after collapse–reopen.
- Captures: `captures/roll-collapsed-desktop.png`, `roll-collapsed-mobile.png`, `roll-expanded-desktop.png`, `roll-expanded-mobile.png`.

## 2. Complete note-drag preview

- During a vertical sheet drag the preview drives the whole event:
  - notehead `cy`;
  - shared chord stem `y1/y2` (computed from preview-aware chord ys);
  - flags follow the stem end;
  - accidentals are recomputed from the preview spelling and key;
  - augmentation dots follow the preview notehead;
  - ledger lines follow the preview notehead;
  - tie endpoints use the preview-aware position map.
- Releasing commits one normal workspace command (one undo step); Escape/pointer-cancel leaves the document and history unchanged.
- Cancelling also clears preview state; entering formatted mode still refuses a late commit.
- Horizontal dragging was not added.
- Durable app test checks preview notehead/stem change and cancel leaves document/history unchanged.
- Browser evidence uses a real **chord** event and records both a changed notehead `cy` and changed shared stem endpoints; capture `captures/drag-preview-desktop.png`.

## 3. Left-side musical context

### Correction sheet (`ContinuousScore`)

- Clefs sit on extended staff lines at the staff start; context width is 116 units so nothing is clipped.
- Time signature is stacked on **both** treble and bass staves, after the key area.
- The floating key letter is gone. A visible caption outside the staff reads `Key: C major · 4/4` (`data-score-key`).
- Conventional key-signature accidentals render on both staves from the shared `keySignature` fifths/mode definition; zero-signature keys render none.

### Formatted score

- Staff lines extend under clef/key/meter with a starting barline and brace.
- Clefs are larger and anchored to the staff lines; meter is stacked on both staves.
- Toolbar caption reads `Key: … · 4/4`; conventional accidentals use the same shared definition (all 30 supported keys).
- Captures: `captures/fixture-bbm.png` (five flats on both staves), refreshed real pages `formatted-real-page1.png` / `formatted-real-page2.png`.

## Verification

- Web suite: **510 passed, 0 failed**; TypeScript and production build clean.
- Focused UI tests (formatted + workspace journeys): 23 passed.
- Original review probes: **6/6**; edge probes: **3/3**.
- Mode lifecycle and saved-only reopen/MusicXML journeys: pass.
- Phase 7 regression set: all **16 scripts** pass after making their roll-open setup accordion-aware.
- `scripts/ui-refinements-results.json` holds desktop/mobile accordion, chord-preview and cancel evidence.

## Limits / carry-forward

- Horizontal note dragging is deferred by scope.
- Lightweight engraver: no beams, dynamics, lyrics, non-tie slurs, hand separation or PDF/MIDI export.
- Mobile retains the existing sticky inspector over the lower viewport; the roll and score remain scrollable above it.
- 5,000-occurrence restriction remains inactive pending owner approval/activation audit.
- H1–H9 remains **HARDWARE BLOCKED** (NOT RUN).
- Deployment and final release remain unauthorised.
