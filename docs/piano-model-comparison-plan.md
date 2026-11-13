# Raw piano model comparison — developer implementation plan

Date: 13 November 2026  
Status: proposed implementation; no model installed, executed or activated by this plan

## 1. Objective and product outcome

Automatically transcribe one uploaded piano clip with several AI models, without our
correction stages, and let the owner compare their results on one page.

The owner uploads or selects a recording once. The backend runs the permitted models
in the background. The frontend offers Original / Basic Pitch / Kong / Transkun /
Onsets and Frames playback controls, a synchronized note display, and an automatically
generated results table. Each finished model becomes playable immediately; a slow,
failed or licence-blocked model must not hide successful results.

The purpose is to determine whether a stronger initial transcription model offers more
benefit than the current correction pipeline. This is a comparison tool, not automatic
model selection or a claim of identical audio. No result replaces the user's current
lesson automatically.

### Why we are doing this now

Our current correction pipeline has not demonstrated a meaningful overall quality
improvement on the recordings tested. On the complete public paired recording, it
removed only eight of 289 missing/extra-note errors (about 2.8%). Timing was effectively
unchanged, the duration/dynamics stage proposed no corrections, and the actual app-preview
audio comparison showed no meaningful overall gain. On the owner's current video, it
proposed no supported note, duration or velocity corrections. These are limited pilot
results, not proof that every correction method is ineffective, but they do not justify
relying on this implementation to repair an inadequate initial transcription.

We therefore want to prioritize **better initial model output**: identify the best
available, commercially usable model for our piano recordings before investing further
in downstream correction heuristics. A model that estimates notes, timing, velocity and
pedal more accurately at the outset may deliver more benefit than attempting to repair
Basic Pitch's output afterwards. This is a hypothesis to test, not an assumed result.

That is why the experiment disables our correction stages and compares each model's
own output under consistent conditions. It must reveal whether another model actually
outperforms Basic Pitch, which attributes improve or regress, and what runtime cost it
adds. "Best" means the strongest measured fit for the app's needs across these attributes;
it does not necessarily mean one model wins every category or reproduces the original
piano's exact sound. The comparison should support a model-selection decision, rather
than continuing to expand a correction process whose benefit remains unproven.

## 2. What is being compared

### Pilot decisions — settled on 13 November 2026

These decisions resolve the developer's three pre-implementation questions. Begin work
without waiting for further product clarification.

1. **Permissions:** Transkun and Onsets and Frames start as explicit `blocked_license`
   rows. Do not execute those checkpoints until the existing rights process approves
   the intended use with recorded evidence. Their unresolved status must not block
   implementing or running the rest of the comparison. Initially, execute Basic Pitch
   native decoding, Basic Pitch current-app decoding and the approved Kong route. That
   is **three variants of two independent model families**, with two additional model
   rows blocked; do not report it as five models tested. A complete four-family quality
   comparison remains pending until those two checkpoints can actually run.
2. **Fifth variant:** include **"Basic Pitch — current app decoder"** in the pilot scope.
   This is required, not optional: it tells us whether an alternative beats what the
   owner currently uses, as well as the native Basic Pitch baseline. Freeze the existing
   `piano-peaks-v1` decoding configuration/code as its own variant, while bypassing every
   downstream verification/expression correction. The two Basic Pitch variants may
   reuse exactly the same frozen neural activations; their decoded outputs and receipts
   must remain distinct. Do not replace the live worker's profile to create this test.
3. **Host/accelerator:** use the current Windows development machine as the backend
   pilot host. Verified hardware is **NVIDIA GeForce RTX 4060 Laptop GPU, 8,188 MiB
   (approximately 8 GB) VRAM**, driver 572.42. The existing `.venv` runtime reports
   PyTorch `2.8.0+cu128`, CUDA available, and that GPU. Reuse it for Kong where compatible;
   keep all model environments isolated. This decision is not permission to alter or
   reinstall the shared GPU driver or main API environment.

Run **one inference subprocess at a time across the whole comparison queue**, including
CPU jobs, to avoid resource competition during the pilot. Use CUDA for compatible
PyTorch adapters. Basic Pitch may retain the current ONNX CPU backend; do not introduce
an unverified GPU export solely to make the device labels match. Record each adapter's
actual device and backend prominently. CPU and GPU timings describe these deployment
paths and must not be presented as a controlled same-device speed ranking.

Keep the **180-second clip limit** and **15-minute inference timeout per attempt**.
Queue wait and asset acquisition are not inference time; weights should already be
pinned and available before a run is queued. Start with one CUDA stream/job and no
cross-recording batching; measure memory on the short owner clip before the full public
recording. Out-of-memory or unsupported CUDA execution produces an explicit failure,
with an optional separately recorded CPU retry. No silent fallback, partial-prefix
success or parallel second job is allowed. Revisit production concurrency only after
the actual per-adapter measurements exist.

| Adapter | Fixed initial variant | Scope | Current permission position |
|---|---|---|---|
| `basic-pitch-0.4.0` | Official 0.4.0 weights; explicit frozen model-native decoding | Multi-instrument model, evaluated here only on piano | Existing approved release |
| `basic-pitch-current-decoder` | Same weights + frozen existing `piano-peaks-v1` decoder; downstream corrections bypassed | Current piano app baseline | Existing approved model route; comparison-only variant identity |
| `kong-piano` | Author inference package 0.0.6 + the pinned Zenodo 4034264 checkpoint | Piano | Existing approved MIT package / CC BY 4.0 checkpoint route |
| `transkun-v2` | Pin the upstream bundled V2 No Pedal Extension checkpoint, commit and decoding settings | Piano | Exact checkpoint use remains unresolved in the current rights manifest |
| `onsets-frames-piano` | Pin the official MAESTRO piano checkpoint and compatible inference code | Piano | Code is Apache 2.0; exact checkpoint permission still needs documented confirmation |

Build all four model-family adapter interfaces and both Basic Pitch decoding variants.
Run each only after its exact code/checkpoint is permitted for the intended use by the
existing rights preflight. Track the two outstanding checkpoint decisions separately;
their `blocked_license` rows are an accepted initial-pilot state, not a reason to stop
development and not a completed four-model benchmark. Do not silently replace a checkpoint or use a fork as
licensing evidence. Benchmark/model-selection permission and hosted product inference
are separate uses. Initial UI is owner/developer-only, not a public commercial feature.

Use Kong's licensed inference distribution, not code copied from the separately
unlicensed ByteDance training checkout. Retain required attribution and notices.

**Basic Pitch baseline clarification:** the current app's `piano-peaks-v1` decoder is a
custom variant, not an untouched official decoder. The primary raw-model comparison
must use explicitly pinned native decoding. Also include the required fifth variant,
"Basic Pitch — current app decoder". Never mix its historical 36-note result with a native-decoder result under the
same model label. Native decoding is necessary to obtain notes; it is not our downstream
audio-verification correction stage.

## 3. Correction must be genuinely bypassed

Add an immutable experiment mode, e.g. `raw-model-comparison-v1`. It must enforce:

1. No call to `piano_verifier.verify_piano_transcription` for proposing corrections.
2. No `piano_expression.analyze`, velocity calibration, spectral refinement, duplicate
   merging, deletion, insertion, quantization or musical cleanup.
3. No call to `automatic_working_document` or `automatic_expression_document` when
   accepting comparison outputs. These currently run in `apps/api/conversions.py`;
   disabling a frontend panel or policy alone is insufficient.
4. No application of stored review decisions or old corrected working documents.
5. Comparison jobs cannot write to a lesson's `working_document`, `document`, correction
   history, publication pointer or current revision.
6. Raw output is stored before any display conversion. Read-only scoring and rendering
   are allowed; they must not change that output.

Record `correction_enabled=false`, `expression_correction_enabled=false`, and zero
correction operations in each receipt. Keep bypass scoped to the comparison mode;
preserve existing lesson history and rollback functionality. Existing production
correction categories remain disabled during this experiment.

## 4. Same source and reproducible runs

Freeze a source package containing the uploaded video, extracted master audio, hashes,
duration, channel count, sample rate, selected interval and extraction command/version.
Never overwrite a previous experiment when repeating a run.

All models receive the same audio content and time origin. Make deterministic,
model-required sample-rate/channel conversions from that master and record their hashes
and conversion rules. Different required sample rates are acceptable; different trims,
gain changes, denoising, silence removal or time stretching are not. Preserve the stereo
master for source listening and stereo diagnostics even if an adapter requires mono.

Each run binds source, interval, model ID/version, checkpoint SHA-256, adapter code,
native decoder configuration, runtime environment, hardware and correction-bypass mode.
Those values form the cache key. A changed checkpoint or decoder creates a new variant.
Do not reuse a cached result merely because its filename or model name matches.

For segmentation, use the model's documented inference scheme, record overlap and
stitching, preserve events crossing boundaries, and test for missing/duplicated attacks.
Model-required segment stitching is part of the declared native inference algorithm;
additional cross-model correction is prohibited.

## 5. Backend architecture and storage

Use the existing worker leasing/heartbeat concepts, but add a comparison parent and
model child runs. Do not create four ordinary lesson conversions that overwrite or
publish the same lesson. Suggested new files and types are proposals, not existing APIs.

### Records

- `PianoComparison`: ID, owner ID, optional lesson link, frozen source/interval identity,
  requested adapter variants, benchmark/reference ID if any, creation time, mode/version,
  retention/expiry and overall status.
- `PianoModelRun`: parent ID, exact variant identity, attempt/lease token, status,
  stage/progress, rights decision receipt, timestamps, inference/decoding/render/scoring
  durations, resource measurements, output manifest, error and warnings.
- Per-attribute metric records: value, unit, direction, status, denominator/coverage,
  tolerance, target semantics, reference/alignment identity and metric implementation.

Statuses: `blocked_license`, `queued`, `running`, `rendering`, `scoring`, `ready`,
`partial`, `failed`, `cancelled`. Parent status must distinguish complete from finished
with blocked/failed/partial runs. A blocked adapter is never shown as a successful result.

### Adapter contract

Each adapter accepts a validated source path, declared interval, output directory,
checkpoint/config identity and cancellation signal. It returns:

- Untouched native predictions where available, and native MIDI if supported.
- A canonical `piano-performance-1` document plus an explicit field-semantics manifest.
- Capabilities: pitch/onset, note-ending convention, estimated MIDI velocity, amplitude
  proxy, pedal types/values, pitch bends and segmentation behavior.
- Execution identity, warnings, actual processed interval, resource usage and failure data.

Adapter processes run in isolated pinned environments; reuse the existing Kong research
runtime where suitable rather than installing incompatible TensorFlow/PyTorch versions
into the API environment. Never deserialize arbitrary uploaded model files. Checkpoints
come only from the pinned server-side registry.

### Field semantics

Preserve physical key release, audible end, pedal-extended activity and written duration
as distinct fields. Interpret endings according to the exact checkpoint's training and
decoder convention. Where a predicted offset cannot be mapped honestly, retain it in a
versioned native sidecar with its convention; do not falsely label it physical release.
Extend the common contract deliberately if needed, with a schema version and tests.

Basic Pitch amplitude remains an amplitude proxy, not captured/calibrated MIDI velocity.
Kong/Transkun predicted MIDI velocities are labelled `model_estimated`, not measured or
perfectly calibrated. Preserve native pedal trajectories; absence means `not_estimated`,
not an all-off prediction. Written note values stay unknown unless a model actually
provides them. Do not apply a notation quantizer in this experiment.

### Proposed endpoints

- `POST /api/piano-comparisons`: existing lesson source or a completed comparison upload,
  interval and registry model IDs; returns parent/child identities and statuses.
- `GET /api/piano-comparisons/{id}`: owner-only progress and available model results.
- `GET /api/piano-comparisons/{id}/results`: versioned comparison table/metric records.
- `GET /api/piano-comparisons/{id}/runs/{run_id}/assets/{asset}`: authorized raw outputs,
  normalized events and rendered preview, using allowlisted asset IDs.
- `POST /api/piano-comparisons/{id}/runs/{run_id}/retry`: new immutable attempt, same inputs.
- `POST /api/piano-comparisons/{id}/cancel`: cancel queued/active child work.

Use the current authentication/CSRF patterns, owner authorization, expiring asset access
and private cache headers. Never accept executable adapter commands from the browser.
Keep reference annotations and private source assets owner/developer-only.

### Resource behavior

Initial benchmark input limit: 180 seconds, sufficient for the complete public recording.
Return an explicit unsupported-length response for longer inputs; never score a silent
prefix as a full run. For this pilot, run one inference subprocess total at a time on
the verified RTX 4060 development host, following the device choices in section 2.
Record memory use per adapter and check available resources before starting each job.
For the initial isolated pilot, use a configurable 15-minute per-model hard timeout and
cancel/terminate its child process cleanly on timeout. Record cold model load separately
from warm inference; do not rank a first-load run against a cached run as processing speed.
Do not present these initial engineering limits as measured production capacity.

Store artifacts under `comparisons/{owner}/{comparison}/{run}/{attempt}/`. Freeze each
completed attempt and its hashes. Delete temporary files on cancellation and prune expired
experiments without deleting source lessons or immutable comparison receipts.

## 6. Fair listening and frontend behavior

Add an owner-only "Compare AI models" action on the piano review page, opening a separate
comparison page. Proposed component: `apps/web/src/music/PianoModelComparison.tsx`.

Show the source video, a shared seek bar, and buttons:

**Original audio · Basic Pitch — native · Basic Pitch — current app · Kong · Transkun · Onsets and Frames**

Each button shows processing, ready, failed or blocked state. Play is enabled only for
a completed render. Switching pauses the prior source and starts the selected source at
the same selected timestamp. One audio source plays at a time; video audio is muted
while a model preview plays. Note roll, keyboard and audio follow the same clock and
selected model. Seek and range-loop positions survive model switches. Mobile controls
must remain usable without a wide desktop table.

Use **one fixed renderer, preset and gain policy for all model previews**, not each model
repository's demo soundfont. Reuse `piano_render` for common backend WAV previews so the
frontend can use ordinary audio playback without scheduling caps. Keep the original
stereo source as its own button. The initial common renderer may be the existing
approximate reference renderer, visibly described as "Common synthetic preview"; a new
sfizz/SoundFont implementation is not a prerequisite for transcription benchmarking.

Provide a small optional "Notes and timing only" listening mode with fixed intensity
and a documented common duration convention. This isolates detection from dynamics and
ending-convention differences; it is a separate derived render, never the stored model
output. Default "As transcribed" preserves each model's declared ending and dynamics
semantics as far as the common renderer supports them.

If a model lacks MIDI velocity, any use of its amplitude proxy or a fixed fallback for
rendering must be disclosed. An estimated-velocity model and an amplitude-only model
cannot be declared equally calibrated because both sound through the same instrument.
Unsupported pedal or pitch-bend controls must be listed, not silently discarded. A
renderer without pedal support cannot support a listening conclusion about pedal.
The data table can still score supported native outputs independently of playback.

Render all notes over the full interval. Existing 1,000-note and 200-note preview caps
must not silently truncate comparison WAVs or pretend unplayed notes were auditioned.
Any deliberate excerpt is visibly labelled and scored only over its declared interval.
Store render identity, output checksum, duration, clipping and control support. Report
gain-normalized and fixed-common-gain audio diagnostics; normalization cannot hide level
differences. Do not introduce independently fitted time shifts to favor a model.

Do not add editing or "apply winner" to this first comparison page. Listening does not
alter the owner's current proposed notes. Downloads can expose raw MIDI/events separately.

## 7. Automatic results table: every attribute, honest evidence

Rows are attributes; columns are Original/reference, Basic Pitch native, Basic Pitch
current app, Kong, Transkun and Onsets and Frames. Include units and a short explanation of whether higher/lower is
better. Allow expanded details and downloadable JSON/CSV. Always distinguish model
capability from successful measurement.

| Attribute | Automatic measurement | Required evidence / important limitation |
|---|---|---|
| Detected notes | Event count and density | Observation only; more notes is not automatically better |
| Note correctness | Matched, missing, extra, precision, recall, F1 | Independent pitch/onset reference, fixed exact-pitch 50 ms correspondence |
| Fine timing | Onset MAE, p95, signed bias, all-reference within 20 ms | Same correspondence, reference-derived uncertainty/eligibility and fixed denominator |
| Note ending / duration | Ending error and within-tolerance coverage | Compare matching semantic targets; pedal-extended offset is not physical release |
| Physical key release | MAE, p95, bias and full-reference tolerance coverage | Captured note-off reference AND a candidate explicitly estimating this target |
| Audible ending | Error against independently annotated bounded endings | Captured MIDI note-off alone is insufficient; unavailable labels stay unavailable |
| MIDI velocity | MAE in 1–127 units, p95, bias, within 8/16 units and coverage | Captured MIDI reference and predicted MIDI velocity; Basic Pitch amplitude excluded |
| Relative dynamics | Rank agreement as a separately labelled diagnostic | Useful proxy only, never a replacement for calibrated velocity metrics |
| Pedal | Separate sustain/soft/sostenuto transition/state results, false-on/off time | Captured trajectory and matching binary/continuous capability; carry state into crops |
| Written rhythm | Explicit availability/status | No score without independent notation and a candidate notation output |
| Audio | Spectral, attack, loudness, pitch-energy, octave and decay components; fixed-gain view | Same source interval and renderer; diagnostic with an approximate voice |
| Stereo / room | Channel balance, width and correlation diagnostics | Preserve stereo reference; no room-equivalence claim from mono objective |
| Human similarity | Optional stored listening result with CI | No automatic human score; unavailable until real ratings exist |
| Practicality | Inference time, load time, total time, real-time factor, peak memory and failures | Same hardware/config; separate cold/warm runs and missing resource observations |

Every cell carries a machine-readable state, for example `measured`, `diagnostic_only`,
`reference_unavailable`, `not_estimated`, `unsupported_semantics`, `partial`,
`failed`, `blocked_license` or `not_run`. Translate these to plain text in the UI.
Do not use a numeric zero, a dash without explanation, a green pass or 100% for unknowns.

Examples:

- Ordinary video: "36 notes detected; correctness not measured — no reference."
- Public captured MIDI + Basic Pitch: "Velocity not estimated in comparable MIDI units."
- Model with velocity output: show its error against the public captured values.
- No pedal output: "Not estimated", not "pedal off" with a good silence score.
- Empty reference/candidate note sets: not applicable where required by the existing
  scorer, not a perfect transcription.

Do not invent an overall "percentage matching the original" or declare an automatic
winner from a weighted average of unrelated attributes. Highlight per-attribute results
only when they are comparable, with coverage and evidence status visible. Audio scores
from synthetic previews must not override independently measured note errors.

## 8. Reuse the measurement implementation and fix integration gaps

Reuse `piano_quality_reference`, `piano_quality_events`, `piano_quality_expression`,
`piano_performance`, `piano_reconstruction_metrics`, `piano_reconstruction_harness`,
`piano_rights` and existing reference/alignment validators. Preserve their metric versions,
minimum-distance one-to-one correspondence, uncertainty masks and null empty cases.

`benchmark_piano_quality.evaluate` is currently A/C-oriented and sets correction-oriented
improvement/activation fields. Add a thin multi-model orchestration layer rather than a
new matcher or a new accuracy formula. Produce independent per-model scorecards and a
comparison aggregate; raw model comparison must never imply correction qualification.
Reuse the same saved correspondence for that model's release/velocity measurements.

Current candidate loading derives some semantics from populated fields. Extend it to
honor explicit adapter `model_estimated`/`not_estimated`/offset-convention metadata;
non-null predicted values must not be relabelled as captured measurements. Preserve
amplitude-only and native pedal data without inventing missing values.

Aggregate any multi-recording benchmark by performance, with reference population and
coverage retained. Several windows of Vienna p01 are one performance. Do not tune a
decoder on the comparison clip and advertise its result as an untouched holdout score.

## 9. Initial evaluation inputs and reporting

1. **Owner's exact current lesson:**
   `3ee8ce618f69406fa9313d17d4ebfee2`, frozen source video SHA-256
   `aa0a545ebc137595a558ff7148fde40f84ac595f92ff45063912f3393fca1a10`.
   Video duration 15.633333 s; extracted audio 15.616009 s. Use source-only diagnostics
   and listening. Do not accidentally substitute the historical 14.677 s / 34-note clip.
2. **Complete public Vienna Chopin Op.38 p01 recording:** 128.199274 s, corrected captured
   MIDI, approved existing rights receipt. Score supported event/expression attributes.
   Its alignment remains unverified, so retain diagnostic status until independently
   checked. Captured pedal and velocity availability does not create audible-end labels.
3. After the first comparison works, add more distinct paired performances, pianos and
   recording conditions under approved terms. Do not select a universal winner from the
   two pilot inputs. Do not auto-download noncommercial corpora into commercial model
   selection merely because a model was trained on them.

All model outputs must be frozen before examining scores and choosing any later tuning.
If the user clip later receives independent annotations, score the existing immutable
outputs against the new reference version rather than rerunning/tuning to fit it.

Deliver one comparison receipt for each input, listing every requested model, completed
and blocked work, all attributes and evidence gaps. No fabricated or example values may
appear in the real-results table.

## 10. Developer work packages and order

1. **Registry and rights:** exact model/checkpoint identities, environment locks,
   licence receipts, capabilities and native decoding profiles. Resolve the outstanding
   Transkun/Magenta permissions for the intended pilot use.
2. **Raw adapter CLI:** Basic Pitch and Kong first, then Transkun and Onsets and Frames
   as permissions/runtimes allow. Verify native file → canonical document conservation
   before queue/UI work. No source-model corrections.
3. **Parent/child backend jobs:** records/migration, leases, isolated subprocesses,
   idempotency, cancellation, private assets and correction-bypass enforcement.
4. **Per-model scoring:** existing scorers + semantic capability/status mapping,
   independent-reference and source-only paths, immutable JSON/CSV aggregate.
5. **Common render:** identical renderer/preset/gain conventions, complete audio,
   supported-control manifest and checksum. Ready outputs playable independently.
6. **Comparison page:** progress, original/model buttons, shared seek/loop, note views,
   results table, mobile layout, failure/blocked states and no automatic lesson mutation.
7. **Pilot execution:** process the two exact inputs end to end, save real artifacts,
   review every metric state, and report actual musical results and runtime costs.

Packages 2–6 must proceed without waiting for the two unresolved checkpoint permissions.
The initial pilot is complete when its three permitted variants actually run on both
inputs, their results/playback are verified, and the two blocked rows are explicit.
The broader four-family experiment remains incomplete until the blocked models can
run. Do not repeatedly ship scaffolding and label it a completed quality comparison.

## 11. Required verification and acceptance

### Tests that matter

- Correction/expression functions are patched to raise: comparison inference, result
  ingestion, scoring and playback still complete without calling them.
- Existing correction policies can be enabled in a test fixture: comparison mode still
  cannot write corrected notes or consume old review decisions.
- Input hash/interval/checkpoint/config mismatches reject stale output; retry tokens
  prevent an old worker from overwriting a newer attempt.
- Import preserves pitches, onsets, native endings, velocity units and pedal events;
  unsupported semantics remain explicit. No guesses fill missing fields.
- Notes crossing native inference chunks are retained once. Long input/partial output
  cannot receive a full-coverage score.
- Known reference fixtures exercise repeated notes, quiet-under-loud chords, note-off
  versus pedal sustain, missing velocity, continuous pedal, unknown attributes and
  empty/silent inputs. Use the existing exact correspondence and frozen tolerances.
- Owner-only job/assets/reference access; cross-owner requests fail; retries/cancel are
  idempotent and terminate only their own inference process.
- A blocked or failed model does not stop others or appear ready. Scoring/rendering
  failures are visible independently of successful transcription.
- Browser acceptance: all completed model buttons play distinct intended assets;
  switching/seek preserves source time, only one source is audible, displayed notes
  follow the selected asset, and the original video audio does not overlap accidentally.
- More than 1,000 notes render completely or produce an explicit unsupported result;
  no hidden scheduling cap. Unsupported pedal/velocity controls remain visible.
- Same common rendering/config for all variants; clipping/gain/latency are recorded.
  Distinguish tiny browser/numerical variation from meaningful score changes.
- Snapshot the existing lesson before/after the real pilot: baseline, working document,
  correction history, decisions and published revision remain unchanged.

### Definition of done

The owner selects a source once and all permitted requested models run automatically in
the backend. Every completed model has a playable common-render preview, synchronized
note view, immutable native output and accurate results row/cells. Every blocked or
failed model is clearly identified. Corrections are demonstrably bypassed. The two real
pilot comparisons are saved and reviewed, not just covered by synthetic software tests.

Successful software delivery does not require inventing missing ground truth or proving
one model wins every attribute. It does require exposing where the models differ and
where evidence is insufficient, so a model choice can be made from real results.

## 12. Expected benefit

The app gains a reusable way to compare transcription engines before committing to one.
The owner can hear differences immediately, while the public paired benchmark explains
whether those differences are fewer note errors, better timing, stronger expression,
unsupported output or merely a rendering effect. Future model upgrades can be tested
through the same path without rebuilding correction machinery first.
