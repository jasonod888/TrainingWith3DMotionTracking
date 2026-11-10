# UI-L1 and initial library renderer integration

10 November 2026. Follow-up to `ffe1827`. **Implemented, default off; not deployed.**

## Review findings and corrections

- The isolated chart labelled C had G/C-sharp/G positions, not an open C chord. Corrected
  the fixture to muted low E, A-string fret 3, D-string fret 2, open G, B-string fret 1 and open high E (x32010). This is
  hand-authored fixture data, not an inferred or reviewed lesson chord.
- The spike module declaration accepted arbitrary props. Replaced it with an explicit
  used public interface shared under `src/types/react-piano.d.ts`.
- Chose the installed library's `ControlledPiano` for production display. It has no
  uncontrolled active-note state; no-op input/audio callbacks and no shortcuts prevent
  clicks from becoming played-note evidence. Explicit height prevents collapse.
- Fretboard cleanup removes its event listeners and the entire ref-owned host subtree;
  `clear()` alone is insufficient. Resize recreates only when width changes; normal
  note updates reuse one instance. Errors from observer/render operations enter the
  drawing boundary instead of breaking the player.
- Existing guitar positions numbered low-to-high are converted to standard 1=high E,
  6=low E. Unsupported left-handed geometry now produces an honest unavailable notice,
  alongside existing capo/tuning refusal. Conflicting same-string positions remain hidden.
- An initial production build exposed a circular chunk dependency when the piano
  renderer imported the shared reference reader for note labels. Labels now come from
  an application-owned callback, leaving the renderer independent of the music screen.
- The spike check now spies on AudioContext creation as well as device/sample/font
  requests, matching the no-audio claim.

## Implemented boundary

`InstrumentGuideStage` replaces the inline keyboard/fretboard JSX inside the existing
music player. It receives a validated reference and active reviewed events from the
existing source clock. It creates no controller, MIDI access, audio, score or history
request. Review hashes, event identities, timing and body contracts are unchanged.

The legacy diagram is the flag-off path and the loading/error fallback. The video,
transport, current note text, sections, practice and Back remain outside the drawing
boundary and keep working if a library import fails. Reference changes remount the stage.
The UI does not expose a library preference or implementation controls to learners.

Independent operator settings and additive capabilities:

| Setting (default false) | Capability |
| --- | --- |
| `MUSIC_PIANO_LIBRARY_UI_ENABLED` | `music_piano_library_ui` |
| `MUSIC_GUITAR_LIBRARY_UI_ENABLED` | `music_guitar_library_ui` |

Both flags are propagated through the app preview and the generic music host. They do
not enable processing, MIDI setup, history, sharing or scores. Missing capabilities mean
false. These are deployment-wide settings, not an account-targeting system; use a test
API/environment for the internal comparison. No .env/deployed value was changed here.

## Scope of the installed renderers

- **Piano:** physical note-range clamp and stable natural endpoints; controlled reference
  highlights, read-only interaction, contained scrolling for a large range and existing
  accessible note text. This is not an onscreen performance input or synthesizer.
- **Guitar:** standard six strings, frets 0–12, canonical string/pitch mapping, explicit
  top-to-bottom tuning legend, contained scroll and illustrative-position notice. It
  does not introduce reviewed shapes, alternate tuning/capo/left-handed support or guitar
  assessment. SVGuitar remains isolated in the spike and is not imported by the app.

This completes UI-L1's integration boundary and delivers an initial UI-L2/UI-L3
implementation for their supported scope. Broader long-session/memory/accessibility
qualification and removal of the comparison path remain UI-L5 acceptance work. UI-L4
reviewed chord authoring/cards remain deferred; the spike is not chord authoring.

## Bundle accounting

Existing initial-library headroom and the 16 KiB music-shell cap are unchanged. Added
the handoff's 25 KiB **additional per-instrument** closure limit to the baseline/checker.
The checker measures JS+CSS with transitive static imports, excludes already-loaded
initial/shell assets once, reports total active-music cost and refuses importing the
other renderer. Dynamic imports are measured, not used to conceal growth.

Final production measurements are recorded after verification. Spike React costs must
not be added again to the app's initial React closure. The production build excludes
`spike.html`; the separately built spike still carries its intentionally heavy chord
comparison and is not a production destination.

## Browser evidence

`verify_music_library_guides.py` checks the real app with mocked lesson data:

- Default-off legacy diagrams and no renderer module request.
- Piano flag on: exact C4/accidental highlights and clearing; no guitar imports; clicks
  and page keys cannot change the reference highlight or create input evidence.
- Guitar flag on: low E at string 6, high E at string 1, fret 1 at F2. Actual SVG marker
  vertical coordinates confirm the top/bottom convention, not just view-model labels.
- Phone/landscape/desktop sizing, one SVG after resize and unavailable capo markers.
- Aborted piano module import: basic guide and seek still work, with no page errors.
- No camera/mic/MIDI permission, audio context, sample/font or history request.

The body feed script additionally supports `MUSIC_LIBRARY_UI_TEST_FLAGS=1`, proving
both flags can be on without movement navigation importing an instrument module.
Legacy guide/history/spike and movement preview/practice/compete regressions are run
separately. Screenshots are in ignored `test-results/music-library-*` files; representative
phone piano and desktop guitar images were visually inspected.

No physical keyboard, real transcription, scored result, deployment or new data schema
is qualified by these browser tests. No commits/pushes were made in this continuation.


## Final verification

| Check | Result |
| --- | --- |
| Full configured Python suite | **306 passed, 13 skipped** |
| Web suite | **282 passed** |
| TypeScript / production build | Passed (existing large unrelated chunk warning remains) |
| Isolated spike build/check | Passed; corrected C fixture and no audio contexts |
| Library-guide integration | Passed; exact pitches/string orientation, lazy isolation, resize and import-failure fallback |
| Existing guide / history | Passed |
| Feed / preview / live practice / compete | All four passed |
| Movement feed with both flags on | Passed; no instrument-module imports |
| Diff check | Clean |

Final measured gzip bytes: initial **129,279**; music shell **14,566**; piano additional
**7,662** (active music **22,228**); guitar additional **16,816** (active music **31,382**).
All existing caps and the explicit additional-renderer caps pass. No hardware/microphone/
model or learner-rollout approval is inferred. The checks use mocked reference data and
browser evidence, not actual commercially qualified transcription.


## UI-L2/L3 acceptance (10 November 2026)

`verify_music_library_guides.py` passes end to end in the real application with both
library flags off then on:

- independent piano/guitar flags and isolated lazy imports (piano does not download the
  guitar renderer or fretboard, and vice versa);
- piano active-pitch mapping at reviewed times and guitar string/fret positions including
  the 1=high E / 6=low E contract;
- read-only interaction (key presses do not create performance input);
- resize/re-mount cleanup and the legacy fallback when a lazy import fails;
- phone and desktop screenshots; no device, audio or history requests.

This accepts the piano and neck renderers behind default-off flags for the existing
player. It does not accept SVGuitar chord cards, physical MIDI qualification or scoring.
