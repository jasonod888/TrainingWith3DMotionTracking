# Independent review: Kong default and Original / Piano playback

13 November 2026. Review of the current working tree against `docs/kong-default-original-piano-playback-plan.md`.

## Verdict

The intended architecture is reasonable and much of the foundation exists. However, the statement “goal complete and verified” is premature. Several user-visible synchronization defects reproduce, preview audio can become stale after edits, the new route is insufficiently bound to its model, and the local test deployment is not migrated or registered for Kong.

This review changed no application code, live lessons, worker registrations or database schema. Additional probes use fake media, temporary SQLite databases and temporary profile files. The deployment inventory was read-only.

Changing only the selected model would have been a small task. The approved plan also requested a production upload adapter, correction bypass, retained preview audio, versioned alignment, a shared player, lesson finalisation and backward compatibility. Those explain a larger change. Elapsed development time alone does not establish a problem; the reproducible defects below do.

## Verification performed

- Seven existing Kong/profile/playback API tests passed.
- Thirteen existing conversion/draft handoff tests passed.
- Six existing pure playback helper tests passed.
- Additional probes exercised the actual React playback hook and canvas component, completion endpoints, review/edit endpoints and profile verification. These exposed failures not covered by those passing tests.
- Did not repeat the entire reported 911-test suite, run fresh model inference, or conduct real-device acoustic drift measurements. The review therefore does not independently certify the reported full-suite or platform acceptance claims.

Reproduction artifacts are under `.local/kong-default-review/`: `probes.mts`, `api_probes.py`, and `runtime_and_profile.py`.

## Required corrections, in priority order

### 1. P1 — The review keyboard and graph still use an independent player

Locations: `apps/web/src/music/MusicDraftReview.tsx:258`; `apps/web/src/music/DraftNotePreview.tsx:15` and `:22`.

The review page still renders `DraftNotePreview`, whose active keys depend on its own `playing` state and AudioContext clock. Neither source `currentTime` nor the new source player is passed to it. Playing Original or the new Piano audio does not drive this keyboard/graph. Its “Play proposed notes” button starts another synthesizer, which can overlap the main source. It also retains the first-1,000-note display/audition limit.

Required fix: make the review keyboard and roll controlled by the source player time and the full event list. Remove or clearly separate the old transport, and stop main playback before any independent short audition. Do not use a successful 1,200-note lesson canvas test as evidence that the review keyboard handles that case.

Regression: play source audio without pressing the old audition button; verify both keyboard and roll follow it. Repeat in Piano mode, during seek/pause/loop, and on a review draft with more than 1,000 events. Confirm no independent audio continues.

### 2. P1 — Lesson graph applies the global offset twice

Locations: `apps/web/src/music/MusicLessonHome.tsx:355`; `apps/web/src/music/PianoNoteRoll.tsx:20`.

The caller shifts each event onset by `syncOffset` and also passes `offsetSeconds={syncOffset}`. The canvas adds the offset again. A direct component probe with raw onset 1.000 s and +120 ms draws the note at 1.240 s instead of 1.120 s. The keyboard and piano audio therefore disagree with the graph.

Required fix: choose one owner for the display transformation. Pass raw events plus offset, or shifted events plus zero offset. Use the same mapping for graph, active keys and audio.

Regression: assert the canvas note position corresponds to 1.120 s, and compare the actual graph, key state and mapped audio time for both signs of offset.

### 3. P1 — Notes crossing source zero are discarded

Locations: `MusicDraftReview.tsx:99`; `PianoNoteRoll.tsx:21`.

Review filters out shifted onsets below zero. The canvas independently skips negative starts. A note beginning at raw 0.050 s, lasting 0.300 s, with −200 ms offset must remain active from source 0 to 0.150 s. The actual canvas probe draws zero notes. The pure `isNoteVisible` helper test passes, but the component does not use that logic.

Required fix: retain events whose shifted intervals intersect the source window. Crop their drawn rectangles at the edges without moving their effective endings. Do not re-trigger an attack when seeking into the already-progressing piano waveform.

Regression: exercise the real review and lesson components with that interval, not only the helper.

### 4. P1 — Playback errors and buffering are not safely coordinated

Location: `apps/web/src/music/usePianoSourcePlayer.ts:15`.

The hook mutes the original and suppresses `target.play()` rejection with an empty catch. There is no returned error/readiness state and no fallback. A rejected playback probe leaves the original muted. Merely having a preview asset enables the Piano button; a failed download is not handled as an unavailable preview.

The `waiting` handler pauses piano, but the next `timeupdate` calls `play()` again when `source.paused` is false, even if the source remains buffering. This resumes piano without a corresponding `playing` event. The hook also does not pause on `seeking` before the seek finishes, coordinate volume/mute changes, or explicitly handle media replacement. Its effect depends on stable ref objects rather than mounted elements: a null-to-mounted-ref probe leaves zero playback listeners attached until another dependency changes.

Required fix: implement explicit readiness, playing, seeking, buffering and failure states. Attach/detach listeners when the actual elements/source identities change. Hold piano during seek/stall; resume on confirmed source playback. Surface failures and restore a working Original mode. Mirror intended volume/mute/rate behavior and stop all audio on source failure/end/unmount.

Regression: rejected `play()`, failed audio fetch, metadata arriving late, async element mounting, stalled source with intervening `timeupdate`, seek-in-progress, source replacement, source end, mute and volume changes. Verify behavior using the hook, then real browsers.

### 5. P2 — Fine alignment changes can be ignored by audio

Locations: `usePianoSourcePlayer.ts:24`; `piano-playback.ts:13`.

The 40 ms drift threshold is also used when applying an intentional alignment change. Changing offset from zero to +10 ms at source time 1.000 s leaves piano time at 1.000 rather than 0.990. The display changes immediately while audio does not. Recent-sync hysteresis can also suppress corrections up to 120 ms.

Required fix: force mapping on explicit seek, offset change, mode switch, loop wrap and initial ready state. Use drift hysteresis only during steady playback. Read the source clock at sufficiently frequent intervals to enforce the declared drift budget; `timeupdate` alone does not demonstrate it.

Regression: repeated 10 ms adjustments in both directions, a small seek immediately after a resync, and measured begin/middle/end drift. Keep player drift separate from model onset error.

### 6. P1 — Edited notes retain stale piano audio; finalized editing also loses pedal data

Locations: `apps/api/music_review.py:144`; `apps/api/music_edit.py:116`.

An isolated API probe changes a draft pitch before finalising. The result keeps exactly the old `piano_preview` and `preview_identity`. A second edit to the finalized lesson also keeps them. Consequently Piano audio can play different notes from the displayed/saved reference.

The finalized edit builds a new reference without pedal data while spreading the previous manifest, so the reference has no pedal field and the manifest still contains the previous pedal spans. This inconsistency also reproduces.

Required fix: bind preview identity to the selected event/pedal revision. Regenerate audio for changed performance content, or disable it as stale while regeneration is pending. Preserve valid pedal and playback metadata through edits; do not retain unsupported stale claims. Title-only changes may reuse a preview when performance identity is unchanged.

Regression: change pitch, onset, duration and velocity separately before finalisation and after saving a lesson; verify each causes a new matching preview or an unavailable state. Verify unchanged/title-only reuse and pedal consistency between reference and manifest.

### 7. P1 — Raw completion is chosen from payload labels rather than the assigned route

Location: `apps/api/conversions.py:576`.

`raw_model` is determined by `body.provenance.model == 'kong'` or its adapter label. It is not established from the server-assigned Kong pipeline. An isolated probe submits a non-Kong fixture payload with no piano preview to a `music-piano-kong-v1` job: completion returns 200 and stores `raw_model: false`. This demonstrates the route itself does not enforce the promised model or raw-completion policy. The probe used the existing test configuration without required profile approval; production profile enforcement is a separate guard and does not replace route/model binding.

Required fix: derive required model and correction behavior from the processing route. Bind approved profiles to that route/model. Reject mismatched provenance, forbid automatic corrections for every Kong-route completion, and require the promised preview or represent its preparation as an explicit subsequent state. Do not allow a payload label to select a correction policy on another route.

Regression: wrong-model result on Kong route must be rejected; wrong-route result must be rejected; monkeypatch correction functions to raise if called and complete an approved Kong job successfully. Exercise worker upload through draft handoff rather than only constructing a draft object.

### 8. P2 — The Kong profile does not pin the implementation/configuration it claims to pin

Locations: `scripts/music_run_profile.py:156`; `scripts/music_kong_adapter.py:28` and `:45`.

The profile verifies the adapter file, checkpoint, configuration-file bytes and approval file. It only checks that `package_path` is a directory; it does not verify the package version or package contents. A probe changes package code after loading; `reverify()` accepts it and identity stays unchanged.

The loader also accepts profile config `{"onset_threshold": 0.99}` alongside an actual config file containing `{}`. The adapter constructs `PianoTranscription` without applying the declared configuration. Renderer/helper imports are outside the adapter-file digest too.

Required fix: pin a verified package/build artifact or hash the relevant package bundle and runtime dependencies. Compare declared configuration with the executed configuration, apply supported settings, and reject unsupported fields. Include the helper/render code required for reproducibility. Verify the imported package is the verified artifact, including in a long-running process.

Regression: package/helper mutations, version mismatch, conflicting configuration and an unsupported parameter must fail verification. An accepted decoding configuration must demonstrably reach the model/postprocessor.

### 9. P2 — Playback-setting lifecycle is incomplete

Locations: `apps/api/lessons.py:374`; `MusicLessonHome.tsx:47` and `:340`.

The endpoint selects the newest draft and accepts only an offset revision, not the draft identity the editor opened. A replacement draft can also have revision 1, allowing an old tab to update the replacement accidentally. It also accepts changes after finalisation: an API probe updates a reviewed draft successfully, while the existing immutable lesson manifest remains at its earlier offset.

The lesson page initializes local offset once from props and does not reset it on lesson/revision identity changes. Its numeric handler lacks the review page's finite/bounds handling. Original/Piano and volume preferences are not persisted as requested. These are gaps in the claim that everything else in the plan is implemented.

Required fix: bind draft updates to draft identity plus settings revision; reject edits to finalized drafts or create a defined new revision. Reset temporary lesson state when identity changes, validate local values, and clearly separate temporary learner adjustment from owner-saved settings. Implement the agreed preferences, or explicitly defer them in the delivery status.

Regression: stale tab after replacement, reviewed-draft mutation, switching lessons in one mounted component, invalid numeric input, reload/finalisation/share, and preference restoration.

### 10. Deployment blocker — The local app has not been rolled out

Read-only inventory of the existing `form_ui_test` database returned:

- Alembic version **0024**, not 0025.
- None of `music_drafts.playback`, `raw_model`, or `correction_operations` exists there.
- Registered workers include `music-piano-v1` and `sam-3d-body-v1`; no Kong worker is registered.
- The local API launcher still approves only the earlier Basic Pitch profile hash.

This confirms the developer's stated remaining rollout step. It is not evidence that the Kong inference algorithm is wrong. However, restarting new API code against this schema can break draft queries, and new Kong uploads cannot process without the corresponding approved worker.

Required rollout: fix the above issues, apply 0025 to the intended test database, install/approve the exact Kong profile, register/start its worker, restart the appropriate API, and perform one genuine new-upload end-to-end check. Verify source identity, worker/profile identity, zero corrections, preview readiness, both audio modes, note/key synchronization and saved alignment. Preserve existing jobs and lessons. Do not silently fall back to Basic Pitch.

## Recommended handoff

Retain the Kong adapter and overall architecture. Fix the player integration, offset handling, stale preview lifecycle and route binding first. Then repair profile guarantees and settings lifecycle, complete local rollout, and repeat acceptance against actual new uploads. Extend tests to assert actual synchronized keyboard/graph/audio behavior rather than only helper arithmetic, button states or seeded assets.

No new model research or correction engine is required to address these findings. The work should remain focused on making the already selected Kong path and audio switch reliable.
