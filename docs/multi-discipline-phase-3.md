# Multi-discipline Phase 3: preparation

Started 5 November 2026. **Preparation only; music uploads and both music processing
routes remain disabled.** The movement creation path has not changed. No model or
runtime dependency was added in this slice.

## First audio-preparation evidence

`scripts/verify_music_preparation.py` exercises the existing development-only harness
at `/spike/music-prepare.html`. It generates its own six-second colour video with a
440 Hz tone using ffmpeg, selects seconds 1–4, and inspects the prepared stream facts.
It then repeats with a source containing no audio. No account, worker, transcription,
user media, or upload is involved. The script asserts no API requests or page errors.

Environment: Windows, Playwright headless Chromium **156.0.8078.4**, installed
mediabunny **1.65.0**, 48 kHz mono synthetic source. This is not qualification of
installed desktop Chrome/Edge, Safari, phones or tablets.

| Candidate | Output | Audio | Audio/video first-timestamp difference | Result |
| --- | --- | --- | --- | --- |
| MP4 AVC/AAC | 3.01 s; approximately 74 KiB | AAC, 48 kHz, mono | 0 ms | Stream-fact checks passed |
| WebM VP8/Opus | 3.01 s; approximately 53 KiB | Opus, 48 kHz, mono | 7 ms | Stream-fact checks passed |
| MP4 AVC/AAC from silent source | 3.00 s | No audio track | Unavailable | Correctly failed harness validation |

The silent-source result means the **harness rejects the candidate**, not that a
production music upload validator exists. It does not identify acoustic silence in
an existing audio track. No production preparation path is selected by this run.

Run with the Vite development server and Python Playwright available:

```powershell
$env:PRACTICE_TEST_URL='http://127.0.0.1:5196'
.venv-saas/Scripts/python.exe scripts/verify_music_preparation.py
```

The detailed report is generated at `test-results/music-prepare-chromium.json`.
Generated media and reports stay in the ignored test-results directory.

## Next implementation order

1. P3.1: add the server-driven subject choice before preparation, preserving the default
   movement flow. For adjustments, retain the lesson's subject. Keep music choices
   disabled until their complete route is qualified; a route flag alone must not make
   an unfinished music uploader available.
2. P3.2/P3.3: implement an isolated music preparation module and a recoverable export
   path. Verify absolute timestamp origins, decoded audio, audibility, cancellation,
   size/duration bounds and representative long clips. Complete target-browser/device
   coverage before selecting and enabling a production path. Keep `prepareClip.ts`
   unchanged for movement.
3. P3.4/P3.5: bind resume metadata to the exact prepared artifact and validate decodable
   video plus usable audio on the server. Reject absent audio before queuing a music job.
4. P3.6 onward: isolated music worker, commercial artifact inventory, attempt-bound
   completion, cancellation and cleanup. Retain existing account limits and separate
   movement capacity. No transcription dependency is installed in this preparation slice.

PostgreSQL migrations 0015/0016 still need a disposable database with legacy rows before
deployment. The audio browser/device matrix remains open before enabling music uploads.

## Implementation slice: creation, isolated preparation, upload identity, audio validation

5 November 2026. Music routes remain **disabled**; this slice builds the movement-free
parts of the music path and cannot be reached by a learner by default.

- **P3.1 subject choice.** `CreateLesson` reads `/conversions/limits` for the subject
  catalogue and per-capability availability. The selector sits before the file picker.
  Movement stays the default, a replacement keeps the movement subject, and piano/guitar
  options are disabled with "(not available yet)" unless that capability is enabled.
  A blocked music subject disables submission, and the movement text and button labels
  are unchanged in the movement path.
- **P3.2/P3.3 isolated preparation.** New `prepareAudioClip.ts` keeps audio and is used
  only for a music subject; `prepareClip.ts` is untouched for movement. It prefers MP4
  AVC/AAC and falls back to WebM VP8/Opus when the encoder pair exists, then re-reads the
  prepared file and refuses it unless both a video and an audio track are present and the
  duration matches the selection. It never uploads the original file. If no encoder pair
  exists, it raises a recoverable message that asks for an exported clip with sound.
- **P3.4 resumable-upload identity.** Creation records subject, instrument and
  preparation provenance (version plus selection offsets). The local clip cache stores
  the same subject/instrument/preparation version; resuming refuses a cached artifact
  prepared for a different lesson type, in addition to the existing filename, size and
  part-hash checks.
- **P3.5 server audio validation.** `apps/api/media_probe.py` inspects the uploaded file
  with ffprobe and decodes a bounded window with ffmpeg. Completion of a music job now
  requires a video track and an audio track; a missing/unreadable audio track fails the
  job as `invalid_audio` (non-retryable) and deletes the uploaded source before queueing.
  Findings record codecs, sample rate, channels, duration and maximum volume, including
  `silent_audio` and `clipping_audio`. Movement completion is unchanged and keeps empty
  findings. Migration `0017_media_findings.py` adds the additive column.

Verification for this slice:

| Check | Result |
| --- | --- |
| Web tests | **244 passed** (+5 preparation-policy) |
| TypeScript / production build | Clean |
| API media validation | **4 passed**: audio queued with measured facts, no-audio rejected as `invalid_audio` with the source removed, silence recorded as a finding, movement unchanged |
| Migration rendering | `alembic upgrade head --sql` renders 0017 |
| Full API suite | **267 passed, 13 skipped** |
| Subject selection browser check | **Passed**: choice before preparation, movement default, music options disabled with an explanation |
| Music uploads end to end | **Not possible by design**: music routes are disabled and no worker exists |

Still open: selecting and qualifying the production preparation path, the target
browser/device matrix, an isolated music worker, transcription, attempt-bound completion,
cancellation/cleanup, and PostgreSQL verification with legacy rows.


## Review of e197194 and worker continuation (5 November 2026)

Proceeding with implementation is appropriate while music routes remain disabled. The
review found concrete gaps and corrected them rather than requiring every deployment
check before further development.

### Corrections

- **Usable media:** music upload completion now requires both audio and video, positive
  decoded audio sample evidence and a duration within 150 ms of the declared prepared
  clip. Video/audio decoding uses a bounded window; absent video no longer slips through
  because an audio stream exists. An audio-only source and a duration mismatch are covered
  by new real-media rejection tests. Probe download failures remove their temporary file.
- **Independent creation:** file/submit availability now follows the chosen instrument,
  rather than the body processor. Music requests do not carry a movement provider value;
  the API already ignores that value for music and chooses its own route. Body provider
  stale-tab checks remain intact. Replacement navigation supplies the existing body
  subject to the creation screen instead of resetting it to `movement_other`.
- **Resume:** server job summaries expose preparation provenance. Cache checks compare
  subject, instrument and preparation version against the current server job. Old body
  cache entries without subject metadata remain usable; missing/old music identity is
  refused. Filename/size/part-hash checks remain in place.
- **Preparation:** cancellation is rechecked around asynchronous encoder initialization,
  and failed conversion initialization/execution can try the next eligible format.
  Re-read output checks positive audio layout, duration within 150 ms, origins within
  50 ms of zero and audio/video first-timestamp difference within 50 ms.
- **Actual recovery path:** an error message alone could not recover a browser with no
  encoder: choosing an exported file simply attempted encoding again. The explicit
  **This file is already my exported clip (use the whole file)** option now verifies and
  imports an entire standalone H.264/AAC MP4 or VP8/Opus WebM without encoding. It checks
  sound/video, timing, size and full-file selection, and records `music-import-v1`.
  There is no automatic original-file fallback; the option is off unless selected.
- **Attempt assets:** music attempts may upload only their route's roles; body/avatars
  cannot be staged on a music lease. Reference completion also checks duration in both
  directions against the requested clip. Existing body completion behavior remains.

### Delivered next slice: P3.6/P3.7 transport boundary

Added `scripts/music_worker.py`, an independent CPU worker entry point with a separate
transport dependency lock. It streams and checks the prepared source, extracts a lossless
PCM analysis derivative, invokes an explicit adapter subprocess, advances heartbeat
stages, binds outputs to the current attempt and completes through the existing typed
endpoint. Owner cancellation/expired leases stop work; local private files are removed.
The existing retention cleanup handles staged objects left by cancelled attempts.

`manage_saas_worker.py --pipeline` now provisions pipeline-specific credentials, keeping
movement as its default. No credentials were provisioned by this work and no music route
was enabled. See `docs/music-worker.md` for the adapter protocol and operational limits.

This is **not transcription implementation**. No model was installed or called. Tests
use an explicitly reviewed synthetic reference; the worker refuses an unreviewed draft
and never changes its review flag. The current music completion contract accepts reviewed
references, so Phase 4/5 must add the unreviewed draft/reference handoff before a real
model's output becomes a canonical lesson. Do not have a model assert teacher approval.

### Verification

- API regression run: **212 passed**. The newly added retention cleanup case was then
  verified in the **6 passing worker integration tests** (four overlap the API run;
  the other two are the retention case and the added guitar completion case).
- Avatar regressions: **61 passed, 13 skipped**. Across these split runs, **275 distinct
  Python tests passed**, with the existing 13 skips. Earlier log entries called the
  combined API/avatar count the “API suite”; the breakdown here is explicit.
- Web suite: **246 passed**; TypeScript and production build passed.
- `verify_music_creation.py`: **passed**, using the actual `prepareAudioClip` module
  and creation UI against mocked API routes. The body processor was unavailable while
  piano was enabled in the mock, proving independent availability. Uploaded bytes were
  inspected with real ffprobe:
  - MP4 preferred: 75,874 bytes, 3.008 s, audio and video;
  - WebM fallback: 54,074 bytes, 3.020 s, audio and video;
  - all encoders disabled: initial preparation made no creation request, then explicit
    verified import uploaded the exact 75,874-byte exported MP4, 3.008 s.
- Subject-choice default/disabled-music and movement feed browser checks passed.
- Worker CLI help/syntax checks passed. A fresh isolated environment install was not run.

### Next work

Continue with the Phase 4 model adapter and draft-reference contract, while completing
Phase 3 diagnostics/resource sizing and browser qualification. Keep teacher review and
release acceptance separate from worker completion. Pin and review the actual model
artifact's commercial terms before installing it. Production music creation/processing
remain disabled; PostgreSQL 0015–0017 against legacy rows and the target browser/device
matrix remain deployment/upload-enablement checks. Movement preparation remains unchanged.

Final measured initial JS/CSS gzip: **127,824 bytes** (+1,066 bytes against the
`43a01ab` measurement); the music screen remains a separate lazy chunk and the bundle
check passes. New work in this continuation is local and uncommitted; nothing was pushed.


## Implementation slice: transcription adapter and unreviewed draft handoff

5 November 2026. Music routes remain **disabled**, no transcription model is installed,
and this slice adds no runtime model dependency.

- **Adapter.** `scripts/music_transcription.py` implements the worker adapter contract and
  emits a **draft**, never a reviewed manifest. `--engine fixture` is deterministic and
  labelled as a fixture; `--engine basic-pitch` lazily imports the optional package and
  fails with an explicit message when it is absent (the default in this checkout). No
  package, weights or model are downloaded automatically.
- **Worker handoff.** The worker now accepts either an unreviewed `draft` result or a
  reviewed `manifest`. A draft is uploaded within the attempt and posted to
  `/api/worker/jobs/{id}/draft`; a manifest that claims to be unreviewed is still refused.
  Transport retries, lease handling and cleanup are unchanged.
- **Server contract and storage.** `MusicDraftDocument` bounds a proposal (20,000 events,
  500 spans, events inside the clip) and requires provenance. Migration
  `0018_music_drafts.py` adds `music_drafts`, stored apart from lesson revisions. The draft
  endpoint validates the lease, pipeline, subject/instrument, duration and reference
  attempt identity/checksum, copies the reference into the lesson's private assets,
  creates the lesson **without a revision**, and moves the job to `ready_for_review`.
- **Guards.** A draft lesson returns 409 to its owner and 404 to everyone else, is never
  public, refuses publishing, and has no revision to accept. The owner reads the proposal
  through `GET /api/lessons/{id}/music-draft`; other accounts get 404.

Verification for this slice:

| Check | Result |
| --- | --- |
| Adapter CLI | **3 passed**: bounded fixture draft with audio-hash provenance, basic-pitch absence fails explicitly, incomplete job refused |
| Draft handoff | **2 passed**: server validation/guards/owner-only read, and a real worker run posting an unreviewed draft with no revision created |
| Migration | `alembic upgrade head --sql` renders 0018 |
| Full API suite | **280 passed, 13 skipped** |
| Model installed | **None**; `basic-pitch` is absent by default |

Still open: review finalisation from draft to a reviewed reference and manifest, the review
editor, adapter selection/benchmarking, worker deployment, PostgreSQL verification with
legacy rows, and the browser/device preparation matrix before enabling music processing.


## Owner review finalisation continuation (5 November 2026)

Reviewed `84b0130` and proceeded with explicit owner review and private finalisation.
The existing feed now routes **Review music** to a lazy review screen with the retained
instructor video, editable notes and teaching sections, and explicit confirmation. Saving
creates an immutable reviewed reference/v2 revision, reviewer provenance and exact-revision
acceptance; it does not publish or enable scored practice.

Corrected attempt-idempotence checks, non-unique draft reference keys, deletion of the
source video, event-end/identity bounds, cross-instrument replacements and the filter that
hid no-revision drafts. Migration **0019** adds the review audit table.

The full configured Python run passed **282 tests, 13 skipped**. Updated review/handoff
checks passed, and two additional adapter edge regressions were verified separately
(**284 distinct Python tests** across runs). Web: **248 passed**; TypeScript/build,
schema drift, offline SQL, owner review browser flow, movement feed and mixed discovery
all passed. Full evidence and remaining work: `docs/music-review-finalisation.md`.

The next development work is model artifact qualification/benchmarking and the music
guide/player. Production model selection, reviewed-reference re-editing, sharing, scored
feedback, worker deployment, PostgreSQL and target-device preparation qualification remain
open. Music creation/processing stay disabled. Changes in this continuation are local,
uncommitted and unpushed.


## Implementation slice: reviewed guide/player and model qualification harness

5 November 2026. Music remains disabled and no model is installed. This slice builds the
reviewed-reference consumer and the measurement gate the next engine must pass.

- **Guide and player.** The private music preview now validates the reviewed reference at
  runtime and renders instructor playback with an animated piano keyboard or guitar
  fretboard, a position slider, teaching-section seeking and the currently sounding notes.
  Timing follows `video.currentTime`, with a timer fallback when no video exists. No
  scoring, microphone, MIDI or camera input is offered. See
  [`music-guide-player.md`](music-guide-player.md).
- **Reference reader.** `music-reference.ts` is DOM-free and rejects unsupported versions,
  duplicate ids, out-of-clip onsets/ends, bad pitches, unordered passages and incomplete
  review evidence before drawing. Piano geometry and standard-tuning guitar positions are
  pure functions covered by unit tests.
- **Qualification harness.** `scripts/qualify_music_model.py` requires artifact identity
  and an approved licence, then scores a proposal against a reviewed reference with
  one-to-one pitch/onset matching and reports precision, recall, F1 and onset error. It
  installs and downloads nothing and does not select an engine. See
  [`music-model-qualification.md`](music-model-qualification.md).

Verification for this slice:

| Check | Result |
| --- | --- |
| Full API suite | **289 passed, 13 skipped** |
| Web suite | **253 passed** |
| TypeScript / production build / bundle | Clean; bundle within budget |
| Reference reader tests | **5 passed** |
| Qualification harness tests | **5 passed**: perfect/tolerant/extra/wrong-pitch scoring, artifact metadata and licence refusal, CLI report |
| `verify_music_guide.py` | **Passed**: reviewed reference, key highlighting, section seeking, video playback, no device requests, phone + desktop screenshots |
| `verify_music_screen.py` | **Passed** for piano and guitar, no device requests |
| `verify_summary_discovery.py` | Still **passes** with the guide |

Still open: no scoring/MIDI practice, no selected or qualified model artifact, no fixture
corpus, no worker deployment, PostgreSQL verification with legacy rows, and the
browser/device preparation matrix. Music processing, sharing and scoring stay disabled.


## Guide review and next slice: corpus and MIDI setup (5 November 2026)

Reviewed `cd4f766` and corrected failed-video fallback/replay, stale references during
lesson changes, coarse guide updates, mandatory review evidence/reference identity,
passage/teaching-section confusion, compact piano black-key geometry, and misleading
unsupported/conflicting guitar markers.

The qualification CLI now verifies actual artifact bytes and retains licence evidence,
requires separate code/weights declarations and valid reviewed inputs, and uses
maximum-cardinality ordered onset matching. Reports remain evidence-only, not model or
licence approval. Six deterministic symbolic fixture cases now exist; no third-party
recording or model output was added. See `docs/music-model-qualification.md`.

Implemented the Phase 6A piano MIDI setup foundation behind **MUSIC_MIDI_SETUP_ENABLED**,
default **false**. Only an explicit connection action requests MIDI; the learner selects
one input, sees pressed/pedal-held notes and can disconnect. No grading, attempt storage,
media capture or automatic practice start occurs. Movement is unchanged. Next scoring
slices and their evidence requirements are in `docs/piano-midi-practice.md`.

Verification: full configured Python run **292 passed, 13 skipped**; web **257 passed**;
TypeScript/build/bundle passed; normal piano/guitar screens, owner review and mixed
navigation passed. Guide regressions cover broken video, replay, hidden-page pause,
lesson-switch cleanup and tamper rejection. Virtual MIDI tests cover selected-device
isolation, note/pedal normalization, switching/disconnect, denial, stale permission,
unsupported browsers and exit cleanup. Movement feed browser check passed.

Initial JS/CSS gzip is **129,001 bytes**, +2,243 against `43a01ab`; the lazy music-screen
closure is **7,816 gzip bytes**. Both existing 16 KiB allowances pass. No new runtime or
model dependency was installed. Music processing, sharing, scoring and the MIDI setup
pilot remain disabled in deployment. PostgreSQL 0015–0019, physical MIDI/device/browser
qualification, worker rollout and actual model artifact qualification remain open.
New changes are local and uncommitted; nothing was pushed.


## Implementation slice: timed music practice controls

5 November 2026. Reviewed piano lessons gain an unscored practice controller. Music
processing, sharing and scoring remain disabled.

- **Controller.** `apps/web/src/music/music-practice.ts` is a pure phase machine
  (count-in → playing → rest → repeat → done) with whole-lesson or section ranges, count-in
  of 0/2/4 beats, 1/2/3/5 repeats, 1.5 s rests and 0.5×/0.75×/1×/1.25× speed presets.
- **Guide integration.** The practice panel shows count-in, run progress, rest and an
  unscored completion summary. Seeks, section changes, Play, leaving the lesson and input
  replacement reset practice cleanly. Watching requests no device.
- **Optional MIDI capture.** `MidiKeyboardCheck` now exposes normalized snapshots; note
  attacks are counted only while a run is playing. No notes are judged, stored or sent.
- **Deliberate limits.** Attacks are counted but not timestamped or matched; the practice
  clock is monotonic with the video paused. Latency mapping, rubric feedback, attempt
  persistence and device qualification remain 6C–6E.

Verification for this slice:

| Check | Result |
| --- | --- |
| Full API suite | **292 passed, 13 skipped** |
| Web suite | **262 passed** (+5 practice-controller) |
| TypeScript / build / bundle | Clean; bundle within budget |
| `verify_music_practice.py` | **Passed**: count-in, section practice, repeats, completion, clean reset on seek, attack counting, no media/attempt requests |
| `verify_music_midi.py` | **Passed** (setup pilot unchanged) |
| `verify_music_guide.py`, `verify_music_screen.py` | **Passed** |

Next: rubric-based feedback (6C) with latency compensation and one-to-one attack matching,
then trustworthy scoring and persistence. Model benchmarking, physical-device checks and
PostgreSQL verification continue alongside; no model is qualified or installed.


## bbf45bb follow-up: timed-practice fixes and initial 6C helpers

Accepted continued development, with phase timing, hidden-page cancellation, native
video transport isolation and honest unmeasured-input messaging corrected. Added
independent timestamp/latency mapping and one-to-one onset matching helpers, not wired
to learner feedback. Required/optional note priority and incomplete edge-window evidence
have explicit tests. See `piano-midi-practice.md` for delivered scope and the next
feedback-contract/capture gate. No live rubric feedback, scoring or persistence claim.

267 web tests pass. TypeScript/production build and bundle check pass. Music practice,
MIDI lifecycle and guide browser checks pass. No server/schema changes; the previously
reported Python result was not rerun for this client-only continuation. Music processing,
sharing and scoring remain disabled. PostgreSQL, physical-device checks and commercial
model qualification remain parallel rollout work. Changes are local and uncommitted.


## Implementation slice: gated local feedback (6C)

5 November 2026. Client-only. Music processing, sharing and scoring remain disabled; no
server contract changed.

- **Gate.** Feedback requires a piano lesson whose reviewed assessment is `notes` with
  `midi` input, the exact reviewed reference, an explicit practice action and a selected
  connected input. Watch-only lessons never produce corrections. The gate explains why it
  refused instead of silently grading nothing.
- **Per-repeat evidence.** Each repeat has its own run clock and attack list. Attacks use
  `MIDIMessageEvent.timeStamp` (so simultaneous notes are separate events) and are mapped
  to reviewed source time with the measured delay. Seek, stop, hidden page and input
  replacement discard the affected run.
- **Calibration.** Eight visual pulses; at least four taps; clamped median delay in
  milliseconds for the session. Without a measurement, feedback is shown but labelled
  approximate.
- **Contract.** Corrections per repeat: matched/missing/extra/unassessed plus note names
  and early/late/on-time direction. No score, percentage, persistence or upload. Optional
  notes never become missing corrections; invalid evidence yields an invalid run.

Verification for this slice:

| Check | Result |
| --- | --- |
| Web suite | **272 passed** (+5 feedback-contract) |
| TypeScript / build / bundle | Clean; bundle within budget |
| `verify_music_feedback.py` | **Passed**: 2 matched, per-repeat 1 missing, watch-only stays ungraded, approximate-delay notice, no progress/attempt/media calls |
| `verify_music_practice.py`, `verify_music_midi.py`, `verify_music_guide.py` | **Passed** |
| API suite | Not rerun; no server files changed in this slice (previous 292 passed, 13 skipped) |

Next: 6D trustworthy scoring (assessable spans, exercise limits, coverage and
false-correction thresholds on physical keyboards), then 6E bounded persistence. Model
qualification and PostgreSQL verification continue alongside.


## 9 November 2026: de094a9 feedback review and Phase 6D foundation

Completed the interrupted continuation. Supported rubric version/dimensions are now
checked; input eligibility waits for a successfully opened MIDI port. Corrected the
run origin and transition clocks, bounded attack evidence, and discarded long timing
stalls. Visual tapping is accurately labelled a personal timing alignment estimate,
not measured hardware latency. One sample is accepted per pulse. Calibration and its
pending completion timeout cancel on input/reference changes, page hiding and exit;
practice cannot start during calibration.

Added an unused pure scoring-readiness helper: exact policy/reference identity,
explicit assessment spans, unioned observation coverage, speed/polyphony/note limits,
interruption refusal and qualified timing/policy evidence. It returns readiness/reasons,
not scores, and is not integrated with lesson manifests or attempts. No real device,
model, scoring policy or deployment was qualified by these tests.

276 web tests; TypeScript/build and bundle pass. Feedback, practice, MIDI lifecycle
and guide browser checks pass, including eight calibration pulses, duplicate-tap
suppression and cancellation. No API/schema changes or Python-suite rerun. See
`piano-midi-practice.md` for the remaining policy/coverage/qualification work. Changes
are local and uncommitted; no commit or push performed.


## Implementation slice: instructor assessment policy and coverage

9 November 2026. Review-screen policy editor and per-repeat coverage reporting. Scoring,
sharing and persistence remain disabled.

- **Policy editor.** The owner review screen offers **Watch only** (default) or **MIDI
  note feedback (unscored)**. The server validates the policy (piano-only, `midi` input,
  `pitch`/`timing`, `piano-midi-v1`; watch-only rejects inputs/dimensions), stores it in
  the reviewed manifest and review audit record, and includes it in the idempotency
  fingerprint. Saving still cannot publish or score.
- **Coverage.** Each repeat reports assessed/total notes and coverage; edge notes without
  a complete tolerance window are unassessed and never corrections. Optional notes never
  become missing corrections. The 6D readiness helper stays a non-grading foundation.

Verification for this slice:

| Check | Result |
| --- | --- |
| Full API suite | **293 passed, 13 skipped** |
| Web suite | **277 passed** |
| TypeScript / build / bundle | Clean; bundle within budget |
| `verify_music_review.py` | **Passed**, now selecting the MIDI policy and asserting it in the saved request |
| `verify_music_feedback.py` | **Passed** with coverage text |
| Practice / MIDI / guide / screen checks | **Passed** |
| Policy validation | Server tests: notes policy saved without publishing; invalid dimensions and watch-with-midi refused |

Still open: editing a policy after review, enforced readiness thresholds and physical-
keyboard qualification (latency, coverage, false corrections), then 6E bounded
persistence. Model and PostgreSQL qualification continue alongside.


## 9 November 2026: 97c73a3 review and Phase 6E backend foundation

Corrected MIDI assessment validation to require both pitch/timing, guitar review policy
availability and Watch-only reset on new drafts. Reworded reference-note eligibility so
it cannot be mistaken for measured observation coverage. Added music-family refusal to
the pose history routes without changing the pose-v1 contract or movement quota.

New `music_attempts.py` and migration 0020 provide separate, bounded, default-off,
account-private unscored music summaries. Exact reference/revision/rubric binding,
explicit save, complete-only status, strict count bounds, UUID idempotency, separate
5,000-account quota, and personal read/delete are enforced. Results are labelled
client-reported. Raw MIDI, device identifiers, scored payloads and arbitrary fields are
refused. No client UI/automatic save or live deployment was enabled.

See `music-history.md` for the contract and next steps. PostgreSQL legacy-data migration
verification now includes 0020. Physical-device evidence, observed-input coverage and
qualified thresholds still gate scoring. Model qualification continues separately.
Changes in this continuation remain local, uncommitted and not pushed.


Verification of the 97c73a3 continuation: full configured Python suite **296 passed,
13 skipped**; latest complete-only history checks **3 passed**; web suite **277 passed**.
TypeScript/production build and bundle check pass. Browser checks for instructor review
(including guitar policy availability), local feedback/reference-window wording and the
movement feed pass. All three lesson-schema artifacts are current. Migration SQL renders
through 0020; no PostgreSQL migration or physical-device qualification was performed.
No commit, push, deployed flag change or automatic learner upload was performed.


## Implementation slice: explicit music summary save and history UI

9 November 2026. Client controls for the existing default-off history API.

- **Save summary.** A completed analysed repeat offers an explicit Save summary only when
  the `music_history` capability is on and the local feedback gate is met. No automatic
  upload occurs. Retries reuse the same UUID and payload; success/error/retry states are
  inline.
- **History.** View music history loads the caller's own latest summaries on demand with
  date, run, section, speed and client-reported counts; Delete removes the caller's row.
  Capability-off hides both controls and makes no history request.
- The guide continues to describe feedback as local, unscored and client-reported.

Verification:

| Check | Result |
| --- | --- |
| Full API suite | **296 passed, 13 skipped** |
| Web suite | **277 passed** |
| TypeScript / build / bundle | Clean; within budget |
| `verify_music_history.py` | **Passed**: explicit save, stable retry id after 503, history list, delete, no auto-upload, capability-off hidden |
| Feedback / review / practice / MIDI / guide checks | **Passed** |

Still open: history in the account destination, pagination beyond the latest 100,
PostgreSQL verification of migrations 0015–0020, physical-keyboard thresholds and any
scored rollout. Music processing, sharing and scoring remain disabled.


## 10 November 2026: 7d91d58 review and account history continuation

Corrected practice-session save-state reuse, froze save retry payloads, guarded duplicate
submissions and discarded late callbacks from prior sessions/references. Updated the
privacy copy to describe explicit aggregate uploads truthfully. Added lazy, explicit
account-level history at the existing Account destination and paginated lesson history.
The additive cursor API preserves legacy latest-100 lesson reads. Pages are account-
scoped and stable across tied dates, deleted boundary rows and newer inserts; unavailable
lessons show no protected title while personal summaries remain removable. Runtime
response validation and page retry/stale-read guards protect the private UI.

See `music-history.md` for the new paginated read contracts, save lifecycle evidence
and remaining qualification work. No new migration, model, scored mode or deployed
capability was enabled. No automatic upload, new login or movement workflow change.
Changes in this continuation remain local, uncommitted and not pushed.


Verification for this continuation: full configured Python suite **297 passed,
13 skipped**; web suite **279 passed**. TypeScript/production build, bundle check and
all three lesson-schema artifacts pass. Browser checks pass for enhanced music history,
local feedback, instructor review and the movement feed. Phone and desktop history
screenshots are recorded and the phone layout was visually checked. Initial JS/CSS is
129,114 gzip bytes; the music screen static closure is 14,046 gzip bytes, within budget.
No database migration, physical-keyboard test, model installation/qualification, deployed
flag change, commit or push was performed. Changes remain local and uncommitted.


## Verification slice: PostgreSQL 0015–0020 and physical-keyboard gate

10 November 2026. Two deployment gates checked; only one could be executed here.

- **PostgreSQL, executed.** A disposable PostgreSQL 16 container was upgraded from a
  seeded 0014 body-era schema (account, lesson, revision, failed conversion) to head, and
  a second empty database was upgraded from zero. Result: version 0020; legacy revision
  backfilled to `movement_other`/`body`; new draft/review/attempt tables present; the
  attempt table has the expected UUID primary key and account/lesson/revision FKs; a
  repeated upgrade was a no-op. Details and limits:
  [`music-postgresql-verification.md`](music-postgresql-verification.md).
- **Physical keyboard, not executed.** No MIDI hardware is attached to this environment.
  A protocol with prerequisites, per-device procedure, proposed pass criteria and evidence
  shape is recorded in
  [`music-keyboard-qualification.md`](music-keyboard-qualification.md). No latency,
  coverage, false-correction or device claim is made.

Not covered by the database run: production-shaped volume, downgrade/recovery rehearsal,
concurrent quota locking and idempotent retry races. Those remain deployment work, not
development blockers. Unscored history and local feedback can continue; scoring stays
disabled until physical qualification and threshold decisions.


## 1e05253 review: PostgreSQL concurrency and recovery follow-up

Accepted the recorded 0015–0020 execution as a development gate. Added a reproducible,
self-contained PostgreSQL harness and ran it successfully: actual quota-5,000 concurrent
saves, identical/changed/cross-account UUID races, cursor continuation after deletion,
0020 downgrade/upgrade, and full pg_dump restore into an empty database. Final evidence
is `docs/qualification/music-postgresql-concurrency-2026-11-10.json`; details and limits
are in `music-postgresql-verification.md`. Test container removed; no live application
or deployed flags changed. This is bounded scenario evidence, not production stress.

Corrected the physical-keyboard protocol's alignment button name and separated personal
alignment, reference-note eligibility, actual observation continuity, ground truth and
independent latency measurements. Hardware protocol remains **not run**, with no pass
record or score approval. The full application suites were not rerun because only the
new harness/docs changed. Changes remain local, uncommitted and not pushed.


## Verification attempt: physical MIDI hardware

10 November 2026. **Blocked, not executed.** This host has no physical MIDI instrument:
Windows lists only software MIDI endpoints, and a Chromium probe (headed and headless)
could not obtain Web MIDI permission or any input device. The protocol remains unchanged;
no latency, observation-coverage, false-correction or device result is claimed.

Evidence: [`qualification/music-keyboard-2026-11-10-blocked.json`](qualification/music-keyboard-2026-11-10-blocked.json).
The PostgreSQL race/recovery harness was independently re-run and passed (quota stops at
5,000, identical retries create one row, 0020 downgrade loses history as documented,
backup restore recovers the exact summaries and revision manifests). Unscored history can
continue; scoring stays disabled until physical evidence and threshold decisions exist.


## Parallel work: model licensing gate and real-audio corpus

10 November 2026. No model is installed and transcription remains disabled.

- **Commercial licensing.** `qualify_music_model.py --use commercial` now requires
  separately declared and approved code/weights licences, allowed commercial use and
  redistribution, attribution, an approval record and a retained approval file whose
  digest matches. The harness reports evidence completeness only; it never grants a
  licence. The human/legal checklist and record schema are in
  [`music-model-licensing.md`](music-model-licensing.md).
- **Real-audio accuracy.** `--corpus` scores reviewed real-audio cases, refuses synthetic
  or unreviewed cases and digest mismatches, and requires at least three cases. It reports
  per-case and macro precision/recall/F1/onset error, but no real recordings or model
  outputs exist yet, so no accuracy claim is made.
- **Hardware evidence correction.** The blocked keyboard record now separates permission
  denial from an empty enumerated device list; the blocked result is unchanged. A first
  one-keyboard/browser smoke test is the next hardware step; scoring stays disabled.

Verification: full API suite **299 passed, 13 skipped** (nine qualification tests); web
suite unchanged at **279 passed**; the PostgreSQL evidence and harness remain as recorded.


## bb780c9 model-qualification review follow-up

Closed retained-evidence binding, unsafe corpus paths, invalid audio acceptance,
missing reference/proposal hashes, duplicate-case/minimum bypass, null-MAE aggregation
and incomplete CLI argument handling. Commercial runs now bind actual code/model/terms
bytes and the contents of a retained approval record. Corpus input is bounded PCM WAV;
case/run declarations bind hashes but are not authenticated inference evidence.
Reports explicitly remain proposal comparisons with unverified inference/acoustic origin,
not model accuracy or rights approvals. Detailed contracts are in the model-licensing
and qualification documents. Existing application/worker schemas and flags are unchanged.
No artifact was installed, selected, qualified or legally approved; no real corpus was
created. Unscored pilot and real-corpus preparation may continue in parallel with the
blocked physical-keyboard smoke test. Changes remain local and uncommitted.


Verification: **20 focused tests passed** (15 qualification tests and 5 transcription
adapter tests); Python compilation and diff checks pass. Includes a complete commercial
CLI evidence chain and refusal when a different artifact is substituted in approval
contents, even after updating the approval-file digest. Full API/web suites were not
rerun: no application, UI, worker runtime or feature-flag code changed. Synthetic test
files are not actual recordings, checkpoints or human approvals. Nothing was committed,
pushed, downloaded or enabled in deployment by this follow-up.


## UI-L0: instrument rendering library spike

10 November 2026. Planning-only migration started with an isolated compatibility and cost
spike; no production route or flag changed.

- Installed exact candidates `react-piano@3.1.3` (MIT), `@moonwave99/fretboard.js@0.2.13`
  (ISC) and `svguitar@2.10.1` (MIT) with no peer forcing.
- Fixture passes React 19.2 Strict Mode, TypeScript 5.9 and the Vite spike build: piano
  highlighting, horizontal neck, hand-authored chord, resize and destroy/re-mount.
- Costs: piano ~6.98 kB gzip including CSS; fretboard chunk ~15.78 kB; svguitar ~69.93 kB.
  The application's initial and music-screen closures are unchanged (129,114 B and
  14,046 B gzip) because nothing in the app imports them.
- Findings: react-piano has no bundled types and needs `playNote`/`stopNote` plus a sized
  wrapper; fretboard has no destroy and needs container reset plus `render()` after
  `setDots`. svguitar is deferred until reviewed chords and a lazy budget exist.

Details: [`music-ui-library-spike.md`](music-ui-library-spike.md);
[`third-party/README.md`](third-party/README.md). No scoring, hardware or model claim.


## ffe1827 follow-up: UI-L1 boundary and initial UI-L2/UI-L3 renderers

Reviewed the spike; fixed its incorrect C shape and loose declarations. Added the real
InstrumentGuideStage with independent default-off piano/guitar capabilities, controlled
read-only piano, mapped standard neck, cleanup, lazy/error fallback and complete bundle
measurement. Resolved a production chunk cycle discovered during integration. No change
to controller timing, reference hashes, MIDI evidence, history semantics or body contracts.

306 Python tests passed / 13 skipped; 282 web tests passed. Production/spike builds, all
four movement scripts, library guides, legacy guide/history and flag-on movement feed
pass. Per-instrument added gzip is 7,662/16,816 bytes, within the planned caps. See
`music-ui-library-verification.md` and `music-delivery-status.md` for delivered scope and
remaining release steps. No deployed flag, model, scoring or schema change. Work remains
uncommitted and not pushed.


## Implementation slice: private reviewed-music sharing

10 November 2026. Reviewed music can be released to named people through the existing
invitation workflow. No public, link, group, scored or model path was enabled.

- Server: v2 release requires the latest revision accepted via `music-review`,
  `reference_reviewed`, and `mode='invite'`; link mode is refused and v2 never falls back
  to a body acceptance. Unpublish and revocation remove access.
- Recipients use the existing inspect/accept endpoints, receive the v2 manifest, see the
  lesson in shared summaries when format 2 is advertised, and can open the guide. Public
  endpoints remain unavailable and recipients cannot publish.
- Client: owned music cards expose **Share lesson**; the share screen is invitation-only
  (no Public/Group/Link tabs), publishes on the first invitation, lists pending invitations
  and people with access, and offers Make private. Join routes v2 to the music guide.
- Legacy tests that expected all music publishing to be refused now assert link refusal
  plus successful invitation release.

Verification: **307 API passed, 13 skipped** (one new sharing test); web **282 passed**;
TypeScript, build, bundle, sharing/feed/summary browser checks pass. Details:
[`music-private-sharing.md`](music-private-sharing.md).


## Implementation slice: exact run profile and synthetic private loop

10 November 2026. Worker binding and end-to-end private wiring; no real model or recording.

- `scripts/music_run_profile.py` binds weights, code bundle, configuration, sample rate,
  thresholds and commercial evidence by SHA-256 and derives a profile digest. The worker
  refuses startup without a verified profile or explicit `--fixture`, never downloads or
  falls back, passes the profile to the adapter, and records `profile_sha256` plus model
  identity in draft provenance. `MUSIC_REQUIRE_RUN_PROFILE` can require a profile server-side.
- A synthetic end-to-end test covers prepared clip → profiled fixture draft → watch-only
  review → invitation-only release → separate learner v2 access. Browser preparation and
  upload remain covered by the existing creation check.
- Real inference, commercial approval, a rights-cleared recording and a deployed staging
  worker are still absent; no accuracy or deployment claim is made.

Verification: **314 API passed, 13 skipped** (run-profile bytes/digest/refusal tests, the
synthetic private loop, and the existing worker/review/sharing suite); web **282 passed**,
TypeScript, build and bundle checks pass.


## Review correction after be1fcfe

The initial profile slice above verified declared file hashes, but did not prove the
adapter used those artifacts/settings. The review now binds the actual adapter entry
point and pinned checkpoint, applies/validates the audio rate and supported onset setting,
requires a matching adapter receipt, rejects fixture relabeling, and uses an API profile
allowlist when enforcement is on. Direct reviewed-manifest completion cannot bypass that
mode's draft/review handoff. Non-finite settings and mismatched configuration are refused.

The private-loop test now runs in explicit fixture mode and is described only as wiring
evidence. Runtime dependencies and commercial approval are still separate requirements.
See [the corrected run-profile and next-slice handoff](music-real-piano-loop.md).

Targeted follow-up: **34 passed**, including worker lifecycle/conversion regressions,
profile artifact/settings binding, pinned prediction arguments and server enforcement.
Schema artifacts remain current. No frontend files or deployed flags changed.

Full review follow-up suite: **322 passed, 13 skipped**. The final targeted run above
also covers the subsequently tightened direct-completion guard.


## Implementation slice: reviewed edits and assessable passages

10 November 2026. Owners can edit a reviewed music lesson into a new immutable revision
without changing the shared release; passages distinguish playing from explanation.

- Migration 0021 adds `music_revision_edits`. `POST /music-revision` validates the base
  revision, sections, notes, passages and policy, writes a new reviewed reference/manifest
  and acceptance, and leaves `published_revision_id` untouched. Retries are idempotent;
  changed retries conflict.
- The lazy **Edit lesson** client opens the latest reviewed lesson, edits notes, title,
  sections, policy and passages, and previews the saved revision. The share screen's
  **Update shared version** is the only action that changes learner access.
- Passages carry `playing`/`explanation`; feedback excludes explanation notes and input
  from corrections and eligibility. No passages preserves prior behaviour.
- Worker packaging: isolated Dockerfile, compose example and operating guide added; no
  image was built or deployed here.

Verification: edit API/browser tests, explanation-feedback unit test, **283 web** passed,
TypeScript/build/bundle pass within budget; **323 API passed, 13 skipped**. Share/edit browser checks pass.


## Verification slice: corrections, worker image, PostgreSQL 0021, UI acceptance

10 November 2026.

- Passage overlap is rejected; boundary-crossing notes/attacks are unassessed rather than
  missing/extra. Editing preserves untouched velocity/confidence.
- Worker compose fixed to point `--code` at the mounted executed adapter, a single `/work`
  volume and a token-file mount. The image built and passed help/token/profile/tamper
  smoke; live job cancellation/cleanup was not exercised.
- PostgreSQL 0021 applied over existing 0020 data; concurrent edits produced one winner
  and one 409, identical retry reused the revision, shared release stayed NULL.
- UI-L2/L3 library acceptance passed: independent flags, mappings, lazy isolation,
  read-only input, resize cleanup, fallback, phone/desktop.
- Verification: **324 API passed, 13 skipped**; **284 web passed**; TypeScript/build/bundle within budget.


## Verification slice: paired boundaries, worker lifecycle, candidate dossier

10 November 2026.

- Boundary exclusions are paired by pitch/proximity; the two reproduced false
  missing/extra cases are unassessed, with regression tests.
- The built worker image completed a fixture job against a mock API on a local Docker
  network (claim, source, extraction, adapter, reference upload, draft) and cleaned its
  attempt directory. A heartbeat 409 during a slow adapter terminated processing, sent no
  draft and removed the attempt directory.
- The transcription candidate dossier is empty: no approved code/weights, commercial
  evidence, rights-cleared recordings or real adapter. No accuracy claim.
- Reviewed guitar positions/chord authoring is not started; it remains the next
  capability after the private piano loop inputs exist.

Verification: **324 API passed, 13 skipped**; **285 web passed**; TypeScript, build and
bundle pass (music screen within budget).
