# Reusable practice runtime

One practice authority now drives full-body, guitar/music and piano practice. It owns
start/pause/resume, section vs continuous progression, count-in, rest, repetitions,
attempt boundaries, final completion and interruption reasons. React routes own layout
and subject features; they do not reimplement those rules.

## Module map

| Module | Role |
| --- | --- |
| `packages/learning-engine/practice-plan.ts` | Validated plan (`lesson + revision + stable units`), deterministic plan identity, restored-position reconciliation. |
| `packages/learning-engine/practice-transport.ts` | Transport contract: observed time/ready/playing/buffering/ended/error/rate. `advance` exists only for an internal clock. |
| `packages/learning-engine/playback-transport.ts` | Body adapter. `Playback` is the single internal clock; the runtime advances it through the transport. |
| `packages/learning-engine/experience-mode.ts` | Canonical Watch/Practice/Challenge definitions, availability policy, and legacy `compete` adapter. |
| `packages/learning-engine/practice-runtime.ts` | The single session state machine. No timer, no DOM, no second clock. |
| `packages/learning-engine/practice-view.ts` | Derived primary/secondary actions, labels and status. |
| `packages/learning-engine/practice-capabilities.ts` | Supported/unsupported and on/off/unavailable capability model, count-in beat conversion. |
| `packages/learning-engine/practice-session.ts` | Compatibility facade over the runtime for the body controller and old engine/competition tests. It forwards every field/command; it owns no rules. |
| `packages/learning-engine/competition-session.ts` | Challenge policy over the same runtime (full sequence, 1×, scored). |
| `apps/web/src/practice/useMusicPractice.ts` | One scheduler per music session: count-in/rest deltas plus observed media time. |
| `apps/web/src/practice/media-transport.ts` | Observed `HTMLMediaElement` transport. `waiting`/`stalled` become `buffering`, not a user pause. |
| `apps/web/src/practice/PracticeShell.tsx` | Shared header, stage slot, dock, core actions, countdown/rest status, voice choice/opt-out, section picker, keyboard binding and settings. |
| `apps/web/src/practice/useVoiceStartCoordinator.ts` | One start/voice policy for body and music: ask, wait for observed listening, Without voice, retry/fallback, cancellation and remembered off. |
| `apps/web/src/practice/PracticeCommonSettings.tsx` | One common playback/timing settings surface consumed by body and the music shell. |
| `apps/web/src/practice/ExperienceModeSelector.tsx` | One compact native Watch/Practice/Challenge dropdown used by watch and practice surfaces in every subject. |
| `apps/web/src/practice/practice-input.ts` | One focused-input-safe Space/arrows/R/P mapping used by the shell and the body controller. |
| `apps/web/src/practice/PracticePrimaryActions.tsx` | Renders the common action descriptors; subject tools are additive. |
| `apps/web/src/practice/practice-voice.ts` | Provider selection, lifecycle, actual listening observation, retry/duplicate policy. |
| `apps/web/src/practice/usePracticeVoice.ts` | React binding; entry never requests microphone permission. |
| `apps/web/src/practice/practice-store.ts` | Progress/preferences keyed by lesson revision + plan; server adapter for body, local-first for music. |
| `apps/web/src/practice/practice-plans.ts` | Body/guitar/piano plan builders; bars/alignment generation stays subject-specific. |
| `apps/web/src/music/workspace/PianoPracticeWorkspace.tsx` | Dedicated piano practice composition; review editor/undo/save are not mounted. |
| `apps/web/src/music/workspace/PianoPracticeViews.tsx` | Notes / Waterfall / Piano keys child stages; inactive views are not mounted. |
| `apps/web/src/music/workspace/usePianoPerformanceAudio.ts` | Proven live grand/MIDI/WAV scheduler: source clock, pedal/velocity, onset-zero attack, held-note seek and volume. Consumed by both review and practice. |

## Clock and transport invariants

- Exactly one source advances per active session.
  - Body: `Playback` inside `PlaybackTransport`, advanced by the single practice scheduler.
  - Piano/guitar: the video or audio `currentTime` observed by `MediaTransport`; the scheduler only supplies count-in/rest deltas.
- A buffer is a distinct condition: the runtime freezes source time and keeps the
  attempt open. When the media plays again, the same attempt continues. A user pause
  finishes it with the user's reason.
- Count-in/rest use monotonic scheduler deltas. They never advance source position.
- Seek completion and asynchronous `play()` promises are generation-guarded; a stale
  rejection/seek cannot start or finish an attempt.
- A media source that is absent has no runtime clock. Practice is disabled with a
  reason; the UI does not fabricate a video clock.

## Plan identity and restoration

`PracticePlan` carries lesson/revision, duration and stable units. Its ID hashes the
unit IDs and bounds. Restoration stores revision + plan + unit + time:

- same revision and unit: exact resume;
- same revision, changed plan (edited body section, different piano bars-per-chunk):
  match stable unit first, else source time, else nearest unit start;
- different revision: never restore silently.

Count-in options carry both seconds and, where the subject counts beats, the explicit
beats/tempo. A label such as “4 beats” is only shown with its converted scheduler
seconds.

## Canonical state → action

| State | Primary | Secondary |
| --- | --- | --- |
| idle | Start practice | — |
| restored pause | Resume section N | Repeat section, Start over |
| selected unit | Start section N | — |
| count-in | Cancel count-in | — |
| playing | Pause practice | Repeat section |
| paused mid-attempt | Resume section N | Repeat section, Start over |
| section complete, next exists | Next section | Repeat section |
| lesson complete | Practise again | Repeat section |
| buffering | Pause practice (status: waiting for video) | Repeat section |
| play failed | Try practice again | error reason |

“Practise again” is the only completion action and means restart lesson. “Repeat
section” and “Start over” remain distinct. A restored pause reads “Resume section N”
in every subject; a completed section reads “Next section” because it is a different
state.

## Capabilities and settings

`PracticeCapabilities` separates:

- unsupported features (hidden);
- supported but currently unavailable features (visible with a reason);
- learner-off features (visible as off).

Body advertises Challenge, camera, recording, scoring and server progress. Music
advertises neither Challenge nor camera/scoring; its audio source is a subject setting,
not a lesson mode. Guitar keeps its 1.25× speed as a declared capability. Piano/guitar
count-in labels use beat/tempo conversion; body uses explicit seconds.

The shared settings panel owns speed, progression, repeat/repetitions/rest, count-in
and voice. Subject extensions live in `settingsExtra` (piano bars-per-chunk, source
audio, volume, MIDI/lesson settings).

## Voice lifecycle

`PracticeVoice` wraps the existing shared `VoiceCommands` controller:

- capability check does not request microphone permission;
- `listening` is reported only when recognition actually starts;
- local app recognition is preferred, browser speech is the fallback;
- pause works during playback (piano no longer ignores commands while playing);
- 900 ms duplicate suppression and bounded reconnects remain;
- disabling/unmounting aborts recognition and releases the microphone.

Body and music share `useVoiceStartCoordinator`. A Start asks first (or starts
immediately when voice is unsupported), waits for observed listening, offers
“Without voice”, and never calls recognition.start() for that choice. Explicit off is
remembered for the session; cancellation clears the pending continuation. The body's
camera preparation is supplied as the continuation/precondition. Keyboard, buttons,
voice and remote display commands dispatch the same normalized commands; one shared
Space/arrows/R/P binding is used by the shell and body, and voice phrases map through
one helper parameterized by each subject's allowed speed presets.

Body and music consume `PracticeCommonSettings`; body-specific camera, calibration,
metronome, recording and Challenge slots remain around those common rows.

## Progress and preferences

`PracticeStore` records include revision, plan, unit, time, speed, mode, repeat,
count-in and rest. Body keeps its existing server endpoint as the position authority
and stores the richer fields locally beside it. Music is local-first with the same
record shape and a revision-level latest pointer, so changing a piano plan remaps the
last position instead of discarding it. Saves are debounced, flush on hide/unmount and
are ignored when their identity no longer matches the active lesson.

## Subject integration

### Full body

`PracticeWorkspace` still owns camera setup, calibration, recording, pairing, challenge
results and the `Playback` reference. It now constructs `PracticeSession` with the
normalized body plan, restores through the runtime, and derives core labels from
`derivePracticeView`. `CompetitionSession` uses the same runtime/mode authority.
`LessonWorkspace` uses `createBodyPracticeStore` and the shared preferences record.

### Guitar/music

`MusicLessonHome` uses `musicPracticePlan`, `useMusicPractice` and `PracticeShell`.
Initial plan unit/mode selection happens once; every later core action goes directly to
the runtime. Restored Resume, pause/resume at the same position, next/repeat and restart
lesson no longer pass through a “start fresh” reset. Settings are authoritative in the
runtime (the legacy drawer writes the same setters rather than overlaying React state).
MIDI feedback, timing calibration, save gates and history remain; run clocks are reset
per attempt/repetition and at interruption. A stable visibility/pagehide effect pauses
the authoritative transport, saves, and does not pause on ordinary snapshot renders.
If a lesson has no playable source, practice is explicitly disabled.

### Piano

`PianoWorkspaceHarness` is now a thin dispatch boundary:

- review returns `PianoReviewWorkspace` (the existing editor/undo/save workflow);
- practice returns `PianoPracticeWorkspace`, which loads the reviewed notation and
  alignment, builds a bar plan and uses the shared runtime/shell.

Practice stages are small subject modules in `PianoPracticeViews.tsx`. A persisted
native **Practice view** selector defaults to Waterfall and offers exactly Notes,
Waterfall and Piano keys. Only the selected module mounts:

- **Notes** mounts the score and owns `layoutMeasures`/`buildTimelineLayout`, the clock
  follow subscription, shared horizontal scroll state/scrollbar and Resume-follow.
- **Waterfall** mounts the falling-note view plus its keyboard reference.
- **Piano keys** mounts the keyboard alone.

Review keeps its own `PianoWaterfall`/`TimeRoll`/`ContinuousScore` editor. Practice no
longer imports or renders `TimeRoll`; roll toggles/windows and Compact/Guide/Sheet
practice controls were removed. Keyboard range/ResizeObserver work exists only in the
mounted keyboard views. Source audio, video/PiP, fullscreen, shared transport,
alignment/intervals and the performance-audio scheduler remain parent-owned so changing
view keeps playback, section, speed, voice and time intact. Exact A0–C8 at desktop width
with a clamped window below, hand colours, saved alignment/anchors, verified reference
hash, MIDI/pedal playback and volume remain.

## Migration notes

- `PracticeSession` remains as a forwarding compatibility facade for old tests and the
  body controller. It must not gain independent rules.
- `music/music-practice.ts` is no longer used by the application. It is retained only
  as a legacy module; new code must use `PracticeRuntime`.
- `PianoWorkspaceHarness`'s review body still contains dormant practice branches from
  the old composition. They are unreachable from the practice route and must not be
  treated as an active authority.
- Multi-discipline decision D8 and R2 (“music runs on its own controller”) are
  superseded by this shared runtime. Subject stage generation and optional features
  remain modular.
- No backend schema change was made. Body progress remains the existing endpoint;
  music progress/preferences are local-first.

## Shared fullscreen

`usePracticeFullscreen(rootRef)` owns the complete practice-surface fullscreen lifecycle:
request/exit, `fullscreenchange`/Escape synchronization, honest unsupported/rejection
errors, and cleanup that exits only the root it owns. `PracticePlayerDock` renders the one
shared Maximize/Minimize button at the right of the common tools for body, guitar and
piano; no subject supplies a duplicate fullscreen button.

The target is the shell root (stage, dock and overlays), so the dock and subject stage
remain usable in fullscreen. Body instructor focus remains a specialized policy layered on
the same controller and fallback; its existing camera/Challenge restrictions and in-app
focus fallback are retained. An in-app focus fallback is never reported as browser
fullscreen. Future subjects extend only their root/extension slots, not the fullscreen
controller.



## Canonical playback controls

`PracticePlayerDock` is the single owner of the shared timeline/heading, primary and
secondary action rendering, toolbar order, dock padding and responsive wrap. It consumes
the `PracticeView` plus the common command callback, so body instructor practice, guitar
and piano use the same `PracticePrimaryActions` renderer rather than reassembling labels.
Subjects contribute only extension slots: mode/source/voice tools, fullscreen, camera
preparation/recording, Challenge and stage regions.

`practice-player.css` and `practice-timeline.css` own the transport typography, button
height/padding/radius, gaps, focus/disabled states and compact breakpoints. These styles
no longer depend on `.mimic-shell.mimic-immersive`, don’t inherit editor button rules,
and the active music shell/dock overrides that previously changed the dock to a light
theme or a grid have been removed. The shared dock remains dark and compact on every
subject. Labels and actions still come only from `derivePracticeView`; identical snapshots
and capabilities therefore produce identical primary/secondary classes and labels.



## Experience modes

Watch / Practice / Challenge are canonical `ExperienceMode` values in
`packages/learning-engine/experience-mode.ts`. They are separate from runtime
progression (`sections`/`continuous`) and from audio source (`Original`/`Piano`/WAV).
The policy supplies availability plus an optional disabled reason/status; the shared
`ExperienceModeSelector` renders one compact native dropdown with the same order,
labels, placement and accessibility on watch and practice surfaces for every subject.
Practice availability is derived from the existing `PracticeCapabilities.challenge`
truth, so a future subject Challenge changes one capability rather than toggling a
separate mode constant. The shared policy supplies the coming-soon metadata when that
capability is unsupported.

Music declares Challenge unsupported with the visible “Coming soon” status and reason;
it never starts scoring or a challenge runtime. Body keeps its existing Challenge route
and locks mode changes while an attempt, recording, camera setup or voice choice is in
progress. Adding a future subject Challenge requires only a capability contribution and
its route adapter, not a second selector. Legacy routes that still say `compete` pass
through one `experienceModeToLegacy`/`legacyModeToExperience` adapter.

The shared mode paths are:

- Watch: `PracticePreview` (body and music) → `LibraryApp` preview → practice.
- Practice: body `PracticeWorkspace` and music `PracticeShell` render the selector in the
  common dock tools, ahead of voice/audio tools, → `LibraryApp`
  `LessonExperienceHost` → `PracticePreview` for Watch.
- Challenge: body `LibraryApp` compete route; music option is disabled before any
  runtime is created.



## Focused verification

From `apps/web` (the maintained runner cannot spawn children in some sandboxes, so the
same TypeScript loader can run a file in-process):

```powershell
node --import ./tests/runner/register.mjs ../../tests/engine/practice-runtime.test.ts
node --import ./tests/runner/register.mjs ../../tests/engine/practice-session.test.ts
node --import ./tests/runner/register.mjs ../../tests/engine/competition-session.test.ts
node --import ./tests/runner/register.mjs tests/practice-contract.test.ts
node --import ./tests/runner/register.mjs tests/practice-store.test.ts
node --import ./tests/runner/register.mjs tests/practice-voice.test.mjs
node --import ./tests/runner/register.mjs tests/practice-shell.test.tsx
node --import ./tests/runner/register.mjs tests/practice-chunks.test.mjs
node --import ./tests/runner/register.mjs tests/practice-timeline.test.mjs
node --import ./tests/runner/register.mjs tests/piano-playback.test.tsx
node --import ./tests/runner/register.mjs tests/piano-compact-view.test.tsx
node --import ./tests/runner/register.mjs tests/workspace-piano-integration.test.tsx
node --import ./tests/runner/register.mjs tests/music-practice-runtime.test.tsx
npx tsc --noEmit
npm run build
```

Known manual checks: real browser/microphone voice behavior, real media buffering on a
throttled network, iOS/Android dock layout and camera/Challenge flows. JSDOM tests use
media doubles and do not prove real codec, audio-device or microphone behavior.

## Current verification status

The reviewer changed this pass to functional-first development. After the final source
changes, one `npx tsc --noEmit` was run and passed. Regression suites were not rerun
against the final source and are **deferred/unverified** for this revision; earlier
matrices predate the shared voice coordinator, common settings extraction, review audio
hook reuse, compact Guide/Sheet, shared scrollbar and native-control removal. The
reviewer independently established that the production build succeeds before this
change, and no production build was repeated here.
