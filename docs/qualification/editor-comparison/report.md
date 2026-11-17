# Signal and Smoosic evaluation for the piano correction workspace

Tested: 14 November 2026. This extends the separate VexFlow experiment. No product files, lesson data, Git branches or developer implementation were changed.

## Decision supported by this evaluation

**Both projects contain useful reusable functionality. Neither is a demonstrated drop-in replacement for our three-view workspace.** Signal is a promising source for piano-roll behaviour and UI; Smoosic provides a much more complete notation editor than a renderer alone, but its score-editing defaults and model require substantial adaptation to our occurrence-preserving correction workflow.

Finish/review Phase 6, then pause further custom-editor expansion and compare the actual editing journeys. Do not choose a replacement merely from screenshots, and do not continue custom work merely because it already exists. The evidence here supports a targeted integration trial, not immediate migration or a claim that either repository is better overall.

## Scope and versions

- Same real local audit snapshot as the VexFlow trial: **209.594 seconds, 1,338 recorded occurrences, 127 measures**. No new transcription and no upload of that recording or its notes to a hosted editor.
- Signal source archive: commit **`dc5e0313c1b1fd279c3f65b505f177532bd113ab`**. Tested actual upstream `Song`, `Track` and `createPianoRollEditor` code. An isolated export adapter avoids importing unrelated app/cloud/audio services; it does not replace the tested algorithms with mocks.
- Smoosic: npm **2.0.3**, its packaged browser bundle, local styles/assets, real browser and its actual XML importer, selection and editing operations.
- Chrome **157.0.8103.78**, headless desktop; Node **22.18.0** for Signal's model tests.
- Source archives/packages were extracted in `.local/editor-evaluation/`. No package installation scripts or product dependency files were changed.

## 1. Signal — actual editing-engine results

Signal separates its `@signal-app/pianoroll-editor` facade from the visual React piano-roll feature. The facade operates on its own Song/Track models and plain note fields: numeric id, tick, duration, noteNumber and velocity. The feature additionally supplies canvas/GPU rendering, keyboard/grid, tools, selection state and application providers.

### Runtime checks

| Check using the real 1,338-note performance | Result |
| --- | --- |
| Load all recorded notes into a track | **1,338/1,338**, about **9.2 ms** |
| Convert seconds to fractional ticks and back | Maximum error about **2.84 × 10^-14 s** |
| Nudge one onset by 10 ms | Exactly one note changed; all 1,338 remained |
| Transpose one member of a real two-note written chord | Exactly one numeric note id changed pitch |
| Extend one recorded duration by 480 ticks | All 1,338 notes remained; no neighbour deletion |
| Twenty mutations in one transaction | One change notification |
| Fractional duration | `123.456` ticks retained by the facade |
| Duplicate insertion | Remains a separate note; host must supply duplicate warnings |

Seven automated checks passed. A supplementary 100-update model-only sample measured about **0.0073 ms median / 0.0209 ms p95** for one-note updates. These exclude drawing, React rendering, audio, our validation and history; they must not be compared directly with VexFlow SVG render times.

The experiment used a fixed conversion of 960 ticks/second (480 PPQ at 120 BPM) to preserve performance seconds. This is not evidence that a fixed-tempo grid correctly interprets the recording's rhythm. Our written-time/alignment model remains necessary.

### What this makes reusable

- Existing move/resize, selection-area, transpose, duplicate, quantise and clipboard operations.
- Transaction composition and observable state boundaries.
- Potentially the visual React piano roll, keyboard and gesture behaviour, after a separate mounting/integration trial.

### What is not established

The visual React editor was **not successfully mounted or benchmarked**. An attempt to open its official hosted editor failed with `ERR_NETWORK_ACCESS_DENIED`. The attempt allowed static GET requests only and blocked uploads/cloud APIs, sockets and beacons; the MIDI input was generated locally but was not opened in the hosted editor. No remote-data test result is claimed. The locally tested engine ran independently of that hosted attempt.

The engine facade alone is not a ready-made React widget. Its UI feature relies on Signal's core, providers, selection/tool state, geometry and playback architecture. We did not measure drag feel, GPU rendering, touch, keyboard accessibility or native UI undo/redo.

Signal assigns numeric ids; our occurrence ids need a stable external mapping. Its tested note shape has no written spelling, voice, logical-note/occurrence links or video/explanation alignment. Retain our canonical seconds and written interpretation. Standard MIDI interchange has integer-tick resolution; successful fractional-tick storage in memory does not prove lossless MIDI export.

One transaction notification is useful, but it is **not** proof that our complete shared undo/redo policy comes for free. Our command/history layer must remain authoritative or an alternative must prove equivalent behaviour.

## 2. Smoosic — real score import, rendering and editing

Generated MusicXML from our existing written interpretation and imported it into Smoosic's actual score model. This is a written-score adapter, not a performance-occurrence adapter.

| Check | Result |
| --- | --- |
| Real score import | **2 staves × 127 measures** |
| Written content | **2,335 note/rest objects; 2,078 sounding pitch segments**, matching our source written segments |
| Import time, final run | About **116 ms** |
| Application configuration, final run | About **127 ms**; excludes the later asynchronous rendering wait |
| Individual chord pitch via selection API | C#4 → D4; companion G#5 unchanged |
| Native chord-note clicks | First click selected the chord; second click on its lower head selected pitch index 0; clicking the upper head selected index 1 |
| Horizontal layout | Worked through `updateScorePreferences(horizontalDisplay: true)`; internal scroll area **34,272 px** wide in a **1,206 px** panel |
| Headless horizontal scroll sample | 89 requestAnimationFrame intervals: median **7.0 ms**, p95 **7.1 ms**; final scrollLeft **33,066 px** |

The scroll figures describe callback cadence in this headless environment, not physical-display frame presentation, mobile performance or editing latency. The application renders asynchronously; import/configuration times are not a full page-load benchmark. They are not directly comparable with the VexFlow prototype's synchronous render measurement.

### Important duration-edit finding

The actual `SmoOperation.doubleDuration` test on a short real passage changed more than the target:

- Before: A4 quarter (4096 native ticks), **A4 sixteenth (1024)**, A5 eighth (2048).
- Extend the A4 sixteenth to an eighth.
- After: A4 quarter (4096), **A4 eighth (2048)**, **A4 sixteenth (1024)**.

The following A5 was consumed/replaced as part of the stretch, and the involved note objects received new ids. The upstream stretch actor explicitly describes removing future notes as required. This is a score-editor policy, and it is incompatible with our requirement to reject collisions or explicitly scope destructive changes while preserving recorded occurrences.

Therefore we cannot adopt its duration actions unchanged. Even if we reuse its UI, gestures must be translated into our validated commands, with our history and performance mappings protected. This is a concrete integration cost, not a hypothetical concern.

### Model and integration implications

- The importer preserved the **written pitch-segment count**. It did not reconstruct our 1,338 exact attacks and ownership mappings: MusicXML here carries interpreted score data, not our custom occurrence metadata.
- Imported notes received ids such as `smo32882`, not our performance ids. Operations can replace/clamp/split score objects, so maintaining identity requires an explicit adapter and tests.
- The inspected imported note model did not provide our recorded onset/duration fields. Keep performance seconds and written duration distinct in our existing document; do not round-trip exact attacks through a notation/MIDI conversion and assume fidelity.
- The full editor brings its own score state, stored-score copy, selection, undo, navigation and audio facilities. Those need clear boundaries with our single document/video clock/history.
- Smoosic uses its own VexFlow fork (`vexflow_smoosic` dependency 4.2.17 in this package). Adopting Smoosic is an alternative sheet-editor strategy; it is not simply adding an independent VexFlow 5 renderer alongside it.

### Packaging issues observed, not hidden

The isolated packaged app required dynamic constructor initialisation and font-metric registration **before** calling the XML converter. Before that was corrected, the importer caught the error and returned an empty default score. The final result above checks actual counts rather than treating an opened page as a successful import.

The package emitted warnings for two malformed `.woff2` text-font assets and a missing local resource; usable `.woff` fallbacks and the notation font allowed rendering. It also tried to fetch a piano SoundFont from an external host; that request was intentionally blocked, so audible playback was not evaluated. These are prototype/packaging integration issues to resolve, not evidence that the project cannot work.

## 3. Comparison for our decision

| Candidate | Evidence now available | Likely reuse value | Principal unresolved cost |
| --- | --- | --- | --- |
| VexFlow 5 | Real-score rendering, per-glyph geometry and virtual horizontal strip tested separately | Engraving with maximum control over our existing UX/model | We implement interaction, hit targets and layout adapter |
| Signal | Real-note model/facade operations tested, 7 checks pass | Piano-roll engine and potentially its visual feature/gestures | Visual feature mounting and compatibility with our shared authority remain unproven |
| Smoosic | Real-score importer, browser rendering, horizontal mode and pitch editing tested | A fuller notation editor, controls, navigation and formatting | Model/identity conversion, duration semantics, selection/history and playback ownership |

**Recommended next decision step:** compare the finished Phase 6 journeys with these findings, then choose a narrow integration target. If custom sheet appearance is the weak point, VexFlow has the smallest demonstrated model disruption. If full notation editing remains the weak point, Smoosic is worth a bounded command-adapter trial, specifically rejecting its default destructive stretch behaviour. If piano-roll gestures are weak, mount Signal's actual visual feature next; do not infer its UI superiority from engine timings.

Do not replace the Phase 2–5 command, alignment and persistence work on the strength of these library tests. Do not reject reuse either: substantial editor functionality already exists in both projects. Their value depends on whether we can integrate it with less complexity than maintaining our equivalent surfaces.

## Evidence and reproduction

- `signal-results.json`: actual-source engine checks and timings.
- `signal-ui-results.json`: hosted visual test blocked; no UI performance claim.
- `smoosic-results.json`: browser/model results, selection, duration before/after and horizontal measurements.
- `smoosic-desktop.png` / `smoosic-horizontal.png`: local application rendering of the real written score.
- Existing VexFlow report: `../vexflow-evaluation/report.md`.

Isolated implementation and inputs: `.local/editor-evaluation/`. Run from the repository root:

```powershell
node .local/editor-evaluation/build-signal.cjs
node .local/editor-evaluation/test_signal.cjs
python .local/editor-evaluation/test_smoosic.py
```

The source archives and extracted dependencies are already present there; the build uses the repository's existing esbuild without installing packages or running dependency scripts. Smoosic's test starts/closes its own temporary localhost server and isolated Chrome, blocking non-local requests. The Signal engine test does not need a browser or service.

Official repositories: https://github.com/ryohey/signal and https://github.com/Smoosic/smoosic. Both identify their code as MIT licensed; production integration must retain relevant notices and separately account for fonts/sound assets actually shipped. This experiment did not replace the developer's Phase 6 implementation or send them instructions.
