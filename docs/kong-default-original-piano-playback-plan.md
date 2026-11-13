# Kong default transcription with Original / Piano audio playback

Developer implementation plan — 13 November 2026.

## 1. Objective and reason

For new piano uploads, use Kong's raw transcription as the default. Do not run automatic note correction, duration refinement, velocity correction or expression correction between inference and the lesson. Give users a simple choice between hearing the original recording and hearing a synthesized piano rendition of those same detected notes. Both choices must show the same synchronized note roll and piano keyboard.

The owner prefers Kong after listening to the model comparison. On the available public performance, Kong also produced substantially better pitch/onset results than the current Basic Pitch route. That is a diagnostic result from one performance, not a universal accuracy guarantee. The earlier correction stage showed limited benefit and has not established improvements across expression attributes. This release therefore prioritizes the preferred raw model and reliable playback.

Playing the original audio preserves its actual instrument sound, dynamics, pedal, room and timing. It avoids requiring a synthesized piano to sound identical. The animated notes remain model estimates: original-audio playback does not prove their correctness.

This document is a plan only. Its scope is the main piano lesson experience, not another model-comparison experiment.

## 2. Required user experience

The piano review and lesson playback pages provide:

- A visible source video, or a source audio player for audio-only material.
- One shared transport: play/pause, seek, time, loop and supported playback speed.
- Two clearly labelled options: **Original audio** and **Piano audio**. Default to Original audio on a new device/session with no preference.
- A keyboard and note roll driven by the same detected events in either audio mode.
- A small optional **Sync notes** control: Earlier, Later, a signed millisecond value, and Reset. Explain: “Moves all detected notes and piano playback together. Original audio stays unchanged.”

Switching audio must preserve position, play/pause state, loop and speed. Only one audio source is audible. The video stays visible in Piano mode, with its audio muted. Do not restart the lesson when changing modes.

The normal experience must not ask the user to inspect correction reports, compare model outputs or approve automatic edits. The existing comparison page remains available as a separate diagnostic tool.

Use short disclosures where relevant: “Detected notes: Kong”; “Piano audio is synthesized”; “Note lengths are model estimates.” Keep technical provenance in details rather than the main controls.

## 3. Current gap and integration points

The comparison implementation already runs Kong, preserves native predictions and produces playable previews. That does not make Kong the normal upload default. The main worker/profile route and draft completion path still need explicit integration.

The main review page also has a source video and a separate synthesized audition clock. Reusing these independently will leave playback, the keyboard and the roll able to disagree.

Inspect and update these areas:

| Area | Existing integration points | Required change |
|---|---|---|
| Upload routing | `apps/api/processing_routes.py`, worker credentials and settings | Select a versioned Kong route for new piano uploads; preserve other subjects |
| Inference | `scripts/music_worker.py`, `scripts/music_run_profile.py`, `scripts/piano_model_adapters.py` | Add a production Kong adapter/profile using the existing tested inference implementation |
| Completion | `apps/api/conversions.py`, `apps/api/music_verification.py` | Explicit raw-model completion policy; bypass correction application and correction job generation |
| Lesson contracts | `apps/api/contracts.py`, music review/finalisation endpoints, `packages/lesson-schema/index.ts` and parsers | Versioned alignment settings, provenance and authorized preview assets |
| Review playback | `apps/web/src/music/MusicDraftReview.tsx`, `DraftNotePreview.tsx` | Shared playback controller and audio selector |
| Lesson playback | `MusicLessonHome.tsx`, `music-practice.ts`, `renderers/InstrumentGuideStage.tsx`, `renderers/PianoGuide.tsx`, and their owning transport | Use the same clock, alignment and audio-selection contract |
| Piano rendering | `scripts/render_piano_comparison.py`, `scripts/piano_render.py` | Extract/reuse the native-prediction render bridge for normal lessons |
| Model comparison | `PianoModelComparison.tsx`, `apps/api/piano_comparisons.py` | Retain diagnostic functionality and the fixed lesson-source binding |

Follow the actual component ownership when implementing; avoid copying a second player into each page. Introduce one reusable controller and reusable controls.

## 4. Backend: Kong without correction

1. Create a pinned Kong inference profile covering package, checkpoint hash, adapter code, configuration, preprocessing and runtime. Use the already approved inference package/checkpoint and retain required attribution. Do not depend on an unlicensed training repository.
2. Convert the retained source to Kong's required input format without silence removal, time stretching or content trimming. Preserve the selected clip's time origin and record any container timestamp normalization. Resampling must preserve elapsed time.
3. Reuse the tested Kong inference adapter, with a bridge into the main music draft contract. Preserve pitch, onset, native predicted offset, estimated MIDI velocity and supported pedal predictions. Retain raw output and provenance independently of editable lesson data.
4. Preserve semantics: predicted offsets are not verified physical key releases; estimated velocity is not captured keyboard velocity. Do not label sustain-expanded lengths as written rhythm or audible ending ground truth.
5. Add an explicit server-owned `raw_model` processing policy for this route. Do not invoke the Basic Pitch verifier, expression pipeline or either automatic document-correction function. A disabled UI or a disabled policy category alone is insufficient.
6. Record `correction_enabled: false`, zero automatic correction operations, model/checkpoint/profile identity, source identity and event count in the completion receipt. Validate the receipt against the server-owned route; do not trust a worker Boolean as authorization to select behavior.
7. Fail honestly if Kong is unavailable. Keep a retryable job with a clear error; do not silently substitute Basic Pitch. Report worker availability for the new route.
8. Make Kong the default for new piano uploads only. Existing Basic Pitch lessons keep their actual provenance and notes. Reprocessing an old lesson is a separate explicit operation that preserves the old revision.

Manual note editing may remain available. It must produce an explicit edited revision, not alter the retained raw model baseline or re-enable automatic correction.

## 5. One timeline and one global offset

Define the contract in seconds:

`source_note_time = raw_model_note_time + sync_offset_seconds`

Positive offset means all notes appear/play **later**; negative means **earlier**. Example: a model attack at 5.120 s should align with a source attack at 5.000 s, so the offset is −0.120 s. Apply the same transformation to starts, native endings and pedal transitions.

The retained source media is the master timeline. Preserve leading silence. Equal output durations do not establish matching attack times: a renderer can pad an incorrectly aligned result to the source length.

Implementation rules:

- Start with offset zero. Do not add an inferred shift merely because the first detected note is late; the source may contain silence or a genuinely missed note.
- Use a fine control with 10 ms steps and an initial ±2 s adjustment range. Allow a validated numeric value up to ±10 s for exceptional cases. Treat these as product limits, not claims about model accuracy.
- Move the complete transcription once. Do not quantize, stretch, move individual notes or infer tempo changes.
- Keep raw timestamps unchanged. Store the offset separately and apply it exactly once in playback, display and any explicitly source-aligned export.
- Intersect visual activity with the source playback window. With a negative offset, a note starting before source time zero can still be active at zero; do not discard it just because its shifted onset is negative.
- Stop at the source interval end. Do not extend or modify the original clip to accommodate synthesized tails.
- A global offset cannot fix drift, wrong notes, missed attacks or incorrect durations. If beginning/middle/end require different offsets, record that as a synchronization defect to investigate, not something this control fixes.

Automatic offset estimation is outside this release. Manual alignment is an optional convenience, not a required upload step.

## 6. Playback architecture

Use the source video/audio element's `currentTime` as the authority. Drive visual updates with animation frames while playing, and media events while paused, seeking or buffering. Do not advance the roll using an independent elapsed-time counter.

For Piano mode, use a pre-rendered piano audio asset on the raw model timeline. This reuses the existing server render path and makes mid-note seeking possible without reconstructing oscillator state in the browser. The renderer must declare/compensate its own rendering origin so asset time zero corresponds to model time zero.

The nominal mapping is:

`piano_asset_time = source_media.currentTime - sync_offset_seconds`

The piano asset itself is not regenerated when the user changes alignment. At a negative target time, keep it silent until it reaches zero. Beyond its available extent, remain silent. Seek into the existing waveform when switching in the middle of a sustained note; do not restart that note's attack.

Controller responsibilities:

1. Coordinate play/pause and readiness for both media elements. Handle rejected browser playback promises without claiming playback started.
2. Pause piano audio when the source stalls/seeks; resume from the mapped position when the source resumes. The hidden/muted piano element must never free-run after source pause or navigation.
3. On seek, loop wrap, audio switch or offset change, immediately recompute position and active notes. Clear stale highlights on stop/end/unmount.
4. Match playback rate and request pitch preservation on both elements where supported. Hide unsupported speeds or explain platform limitations; do not quietly produce different speeds.
5. Measure media drift and resynchronize when necessary. Use an initial 40 ms drift threshold with hysteresis, avoiding repeated seeks during normal playback. Document measured platform behavior; separate media drift from transcription timing error.
6. Preload enough piano data before enabling its button. Original audio remains usable while Piano audio is preparing or has failed. Recover from an audio switch failure to the previous working mode.
7. Ensure source and piano are never both audible during switching. Preserve the user's volume preference, but keep renderer headroom independent of that volume.
8. Define short note/cell auditions during main playback: pause main playback before auditioning and offer normal resume. Do not leave an independent synthesizer playing over the original.

Two media elements are not sample-locked. This design targets stable lesson synchronization, not phase-coherent mixing. If device testing cannot meet the timing acceptance criteria, revise the audio transport before release rather than claiming exact overlap.

## 7. Piano audio preparation

Reuse the existing common renderer with native predicted endings mapped through an explicitly named render-duration convention. Preserve Kong's estimated velocity and supported pedal controls. Unsupported renderer controls must be disclosed rather than silently described as reproduced.

Keep the established pre-saturation headroom policy and verify no clipping on dense passages. Do not fix already-clipped samples by reducing browser volume. Do not normalize each individual note, which would erase dynamics. Original audio remains unchanged.

Cache assets using source identity, event/revision hash, model/profile identity, native sidecar hash, duration convention, renderer settings and gain policy. An alignment change does not invalidate the unshifted audio; a note edit does. Reject stale preview receipts and only serve owner/viewer-authorized lesson assets.

Playback must include every note. Avoid the existing audition cap becoming a hidden omission in the new route. Large inputs may render asynchronously with progress, cancellation and bounded resources; they must not silently lose events.

## 8. Persistence, revisions and exports

Add a versioned playback-settings object to the draft/reviewed lesson contract containing at least `sync_offset_seconds` and a settings revision. Missing settings on old lessons mean zero offset. Validate finite values and bounds on the server and client.

Only the owner/editor can save lesson alignment. Use optimistic concurrency so an older tab cannot overwrite a newer offset or note revision. Carry the saved setting through finalisation, reopening, sharing and lesson playback. A learner can temporarily adjust their own playback if supported, but must not overwrite the lesson's saved setting.

Store Original/Piano preference and listening volume separately as per-user/device preferences; these do not create lesson revisions. Default to Original when no preference exists, or when the preferred piano preview is unavailable, with a visible reason for fallback.

Define exports explicitly: raw-model export retains raw timing; a source-aligned export includes the global shift and documents any boundary cropping. Do not silently change existing MIDI export semantics. Derive edited exports from the selected lesson revision, never relabel them as raw Kong output.

## 9. Required tests and acceptance evidence

| Test | Passing behavior |
|---|---|
| New piano upload | Kong profile/weights verified; no verifier/expression/correction function called; raw baseline retained |
| Correction bypass regression | Stub automatic correction functions to fail if invoked; the new route still completes |
| Other subjects and old lessons | Guitar/movement unchanged; old Basic Pitch provenance retained; zero offset default |
| Three seconds of leading silence | Source remains silent; notes and piano do not jump to time zero |
| Offsets +120 / −120 ms | Start/end/pedal and piano move by exactly the signed amount; source bytes/timing remain unchanged |
| Note crosses source time zero | Correct highlight and already-progressing piano sound, without a fresh attack |
| Mid-note switch and seek | Same position and note state; no restart, double audio or stuck keys |
| Pause, buffering, loop, end, navigation | Both playback paths follow source state and stop cleanly |
| Rate changes | Shared rate and supported pitch behavior at 0.5×, 1× and 1.5× |
| Long/dense input | More than 1,000 notes represented and rendered; no silent cap; clipping false |
| Preview failure | Original remains usable; Piano shows unavailable/retry rather than apparent success |
| Settings permissions/concurrency | Unauthorized saves rejected; stale saves conflict; reopen/finalise preserves alignment |
| Identity/staleness | Wrong source, old event revision or changed native endings cannot reuse an accepted preview |

Add deterministic clock/controller tests plus real browser tests on desktop Chrome and a mobile browser, including iOS Safari if supported by the product. Test background/foreground transitions and an actual user-initiated playback gesture.

Initial engineering targets: visual state within 50 ms of the source-clock mapping during foreground playback; piano/source mapped media drift within 40 ms in steady state; recovery within 250 ms after a completed seek or mode switch once media is ready. Measure and report deviations rather than hiding them. These targets describe the player, not the model's note accuracy or acoustic output-device latency.

Run end-to-end acceptance on the owner's full `river flows.mp4`, a short clip and the existing public recording. Confirm the displayed title, duration and source identity match the selected lesson; preserve the recent source-selection fixes. Inspect several attacks near the beginning, middle and end. Record any constant offset separately from drift and model mistakes.

Deliver a short acceptance report with tested browsers, source/model identities, observed synchronization errors, render clipping checks, and proof of correction bypass. Do not report an invented audio-match percentage or claim perfect notes from this test.

## 10. Delivery sequence and completion criteria

1. **Contracts and route:** add versioned settings, Kong profile and explicit raw completion behavior. Validate backwards compatibility.
2. **Draft and rendering bridge:** produce a normal Kong draft plus authorized piano preview. Validate conservation of native predictions and absence of correction operations.
3. **Shared player:** implement Original/Piano switching, keyboard/roll synchronization and offset controls in review.
4. **Lesson playback:** reuse the controller in finalized lessons; persist settings and handle manual edits/cache invalidation.
5. **Acceptance and rollout:** complete the test matrix, document remaining limitations and enable Kong for new piano uploads. Keep operational rollback available without rewriting existing lessons or silently changing their model.

Done means a fresh piano upload enters the normal app through Kong, requires no correction workflow, plays original audio by default, can switch to piano audio without losing position, and shows the same notes on a source-driven clock in either mode. A saved global alignment works across reload and finalisation. Existing lessons and source identities are preserved. Model-comparison access remains separate and functional.

This release does not promise perfect transcription, physical key-release recovery, written rhythm inference or identical synthesized piano timbre. It provides the owner's preferred model and the original recording's sound with synchronized detected-note guidance.
