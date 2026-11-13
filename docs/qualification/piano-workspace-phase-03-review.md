# Piano correction workspace — Phase 3 review

Reviewed: 13 November 2026.
Submission: `86b3d3a30b1cc2fcc9bd57f3903da96ccfb827c7`.
Decision: **CHANGES REQUIRED — Phase 4 is not authorised yet.**

The overall isolated desktop arrangement and time-window/culling approach match the intended direction. Missing score playhead, linked scrolling, alignment, drag editing and persistence are accepted as later-phase work. The issues below concern the Phase 3 viewports, responsive layout and correct rendering of the existing musical document.

## Independent checks

- Read the handoff, viewport helpers, TimeRoll, ContinuousScore, ClipOverview, width hook, harness and CSS.
- Inspected the committed desktop and mobile PNGs. Desktop shows the intended compact three-surface arrangement; mobile still visibly contains roughly five octaves despite the stated three-octave mode.
- Independently ran the 11 viewport tests: **11 passed, 0 failed**.
- Independently ran TypeScript checking: **passed**.
- Reproduced four component defects in a controlled JSDOM harness using the submitted React components. No live authentication, throttling changes or product writes were used.
- Did not independently rerun the complete 399-test suite, production build or live recording/browser capture script. Those results remain developer-provided evidence.

## R1 — Selection reveal pins the time window and reverses manual navigation (high)

Location: `apps/web/src/music/workspace/TimeRoll.tsx`, selection-reveal effect.

The effect depends on `window`, `document` and `onWindowChange` as well as `revealOccurrenceId`. Once a note is selected, manually panning or using the overview changes `window`, causing the effect to reveal the same old note again. The visible selection effectively becomes an unintended navigation lock.

Independent reproduction: select a note at 5 s with a 0–10 s window, then rerender with a manually requested 40–50 s window while selection stays unchanged. `onWindowChange` immediately requests `{start: 0, span: 10}`.

Required: make reveal an explicit navigation event/request, triggered when selection changes or the user asks to reveal it, not on every viewport update. Keep needed current viewport information without treating user pan/zoom as another reveal request. Preserve selection while navigating elsewhere. A relevant timing edit may explicitly request reveal, but must not create a perpetual loop.

Test scroll, overview click/drag and zoom **after selection**, not just before it. Verify requested window persists, playhead/document remain unchanged and reselect/Reveal still brings the note into view. Later Follow playback is a separate Phase 4 feature, not a reason to reverse manual panning now.

## R2 — Responsive keyboard width is never measured after the async load (medium)

Location: `useElementWidth.ts` and its use in `PianoWorkspaceHarness.tsx`.

The hook's mount-only effect runs while the harness returns its loading placeholder. The keyboard host does not exist, so the effect returns and never attaches an observer when the loaded content mounts. `keyboardWidth` stays 0 and `compactKeyboard` remains false. This explains the five-octave, very short keybed in the mobile evidence.

Independent reproduction: render a component using the hook with a loading placeholder, then mount a host whose `clientWidth` is 600. Observed width remains **0**.

Required: use a callback ref/element-state dependency or another reliable lifecycle that observes a newly attached node, disconnects old nodes and handles subsequent resizes. Verify a fresh asynchronous load at 390 px as well as desktop-to-mobile resizing. The measured keyboard must actually switch to the intended narrow range and proportions. Do not just alter the screenshot description.

## R3 — Wider piano pitch ranges are clipped and inaccessible (high)

Location: `TimeRoll.tsx` pitch geometry and `workspace.css` roll viewport.

`rowHeight` has a 5 px minimum but the SVG and label column remain approximately 174 px tall. A wide pitch span therefore places low notes outside the SVG; `overflow-y: hidden` and lack of a pitch viewport make them unreachable.

Independent reproduction: ordinary piano extremes A0/MIDI 21 and C8/MIDI 108. Low-note y is **466.5 px**, while the SVG height is **174 px**. Selecting/revealing that occurrence horizontally does not make it visible.

Required: provide accessible pitch navigation or a scrollable pitch canvas whose geometry and fixed labels stay aligned. Alternatively fit a defined range with a clear vertical zoom/range mechanism that can reveal every supported note. Do not reduce rows to unreadable fractions merely to fit 88 keys in 150 px. Selection reveal must account for pitch as well as time when pitch lies outside the visible range.

Test 88-key extremes, sparse wide-range material and the full MIDI domain the document permits. Assert that selected low/high notes can actually be brought into view and clicked. This is not later touch-target qualification; missing rendered notes fails Phase 3's basic readable/selectable view requirement.

## R4 — New continuous score loses written musical values (high)

Location: `ContinuousScore.tsx`, notehead/stem/flag/rest rendering.

The new renderer draws every notehead solid, every sounding segment with a stem, and the same single flag for eighths and sixteenths. It never renders augmentation dots and represents every rest as the same square. Consequently, different written values in the approved document appear as identical or incorrect notation.

Independent rendering checks:

- Whole, half and quarter: identical notehead class/fill; each has one stem.
- Eighth and sixteenth: each has one flag.
- No dotted-value glyph path exists.

Required: render supported whole/half/quarter/eighth/sixteenth and other supported segment values with correct hollow/filled heads, stem presence, flag counts/dots and duration-specific rests. Preserve ledger lines, chords, ties, accidental meanings and selectability. This does not require final publication engraving or pagination (Phase 8); a correction score must already tell the instructor what note value they are reviewing.

Use small representative fixtures with each value and a dotted value and inspect the resulting score visually as well as structurally. Add component coverage so a compressed/continuous-layout replacement cannot silently discard musical semantics. Reuse/extend the existing notation rendering logic where practical.

Related selection safeguard: `ContinuousScore` currently uses `performance_ids[0]` for every click. Where a logical note maps multiple occurrences, preserve an explicitly selected mapped occurrence or report/pick ambiguity; never silently select the first repetition. A complete polished picker may wait for gesture UX, but arbitrary occurrence selection must not return through this new surface.

## Evidence-script and process notes (non-blocking)

- `check-layout.py` catches failures and writes JSON without returning a failing process status. Treat it as capture evidence until acceptance conditions are actual assertions with a nonzero failure exit.
- Its `OUT = Path(__file__).with_name('captures')` points under `scripts/`, whereas the committed receipts live in the parent phase evidence folder. Make output/input/auth configuration explicit and reproducible, following the Phase 1 repairs.
- Reuse an authenticated disposable test session for captures to avoid repeated login throttling. Do not add production throttle changes to this work. No throttle or authentication changes were made by the reviewer.
- Short clips below the 2-second minimum currently receive a span larger than the clip despite the helper's “inside clip” claim. Decide a documented short-clip viewport policy and add a boundary test; this is not a blocker for the long-example layout correction.

## Follow-up

Submit a Phase 3 correction commit addressing R1–R4 with targeted component tests and refreshed desktop/narrow captures. Keep the normal review routes, persistence and Phase 2 musical commands unchanged unless a demonstrated regression requires a specific fix. Stop for review before Phase 4.

Reviewer reproducer, from repository root:

```powershell
& 'C:/Program Files/nodejs/node.exe' --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-03-review-repro.ts
```

All four component checks fail on `86b3d3a`. The whole-note check is only a minimal regression example; it is not the entire notation-accuracy acceptance test. The pitch check can be adapted if the corrected implementation uses a viewBox or pitch viewport instead of dynamic SVG height, provided actual visibility/accessibility is asserted.

Only reviewer documentation and the diagnostic script were added; product implementation was not modified during review.
