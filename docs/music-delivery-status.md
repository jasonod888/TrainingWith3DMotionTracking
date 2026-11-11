# Music delivery: current status and next milestones

10 November 2026. Updated through review of `be1fcfe` and the profile-execution corrections.
This is the current status summary; older phase records are historical evidence, not
an assertion that every phase or production acceptance gate is complete.

## Overall assessment

Continue development and a narrow private, unscored pilot. The architecture and tested
user-flow foundations are substantial. Music is not yet a commercially qualified,
end-to-end instructor-to-learner release. The next milestone should be one real piano
lesson through the complete path, not completion of every future scoring requirement.

The existing login, account destination and movement workflow remain the product shell.
History is explicitly saved and account-private. No broad rollout, public music release,
scored MIDI result or microphone assessment is approved by the current evidence.

## What is in place

| Area | Current state | Practical limit |
| --- | --- | --- |
| Shared account, subject metadata and discovery | Implemented and regression-tested; v1 body/v2 music boundary and shared navigation | Music rollout gates stay off by default |
| Audio-preserving preparation and music worker | Separate preparation, import recovery, upload identity, server audio validation, leased/attempt-bound worker/draft handoff, verified exact run profiles and a synthetic private loop | No approved model/recording, real deployed worker route or target-device preparation qualification yet |
| Instructor review | Private draft editing, reviewed reference identity and watch/MIDI policy; **post-review revision editing and playing/explanation passages delivered 10 November 2026** | Diff/rollback UI and co-editor roles remain; assessable-span enforcement still matters for scoring |
| Guide/player | Instructor video and reviewed-time piano keyboard or illustrative guitar fretboard, section seeking and cleanup | Guitar positions are illustrative; no inferred instructor fingering or general capo/tuning support |
| Piano MIDI | Opt-in input, sustain/attack normalization, timed practice and approximate local pitch/onset feedback | Virtual tests pass; physical keyboard still not tested; no score or acoustic-piano feedback |
| Personal music history | Explicit unscored save, stable retries, per-lesson/account pages and deletion | Self-reported aggregate evidence, not grades or observation-coverage proof |
| PostgreSQL | 0015–0020 execution, real quota/retry races, cursor continuation and full backup restore exercised | Bounded synthetic dataset; deployment-scale load and operational recovery remain separate |
| Model evidence tooling | Artifact/code/terms/approval binding, PCM corpus validation and proposal comparison checks | No selected/installed/approved model, real acoustic corpus or independently verified inference |
| Instructor-to-learner music release | **Private invitation release delivered 10 November 2026** | Group/link/public music release and a real two-account pilot remain; link and public stay intentionally unavailable |
| Microphone and full guitar assessment | Not delivered | Separate detector/rights/device/exercise qualification needed |

Phase labels describe workstreams, not a sequential completion certificate. Work from
Phases 3–6 and history has landed while real transcription/release and device gates are
still open. Do not declare all of Phase 5 or Phase 6 finished on the basis of the current
fixture and database tests.

## Editable notation prototype (11 November 2026)

Piano lessons now have an owner-only editable grand staff linked to the existing piano
roll, keyboard and source video. The prototype adds a shared notation/timing document
(measures, written durations, rests, ties, two voices per staff, editable staff assignment,
pitch spelling and a performance-event mapping), one undo/redo history, save/reopen through
the existing immutable revision flow, and MusicXML export. Basic Pitch seconds remain the
source of truth for video alignment; written-duration edits follow an explicit timing
policy, and tempo changes affect notation playback only.

The first-step evaluation pinned and tested Smoosic 2.0.3 and RiffScore 1.0.0-alpha.18.
RiffScore is the recommended library foundation but is not embedded: alpha.18 is
one-voice-per-staff and does not yet move notes, while Smoosic is 7.1 MB gzip, global
jQuery-based and mouse-only. The delivered editor is an in-house implementation behind an
adapter boundary, not a claim that either candidate met the requirement set.

Verification: **306 web tests**, **267 API tests**, production build and bundle budgets
pass, and three Chromium checks cover touch selection, chord pitch edit, duration/ties,
undo/redo, save/reopen and MusicXML export. The existing 12 s / 59-note Basic Pitch draft
renders as six measures with both staves, both voices and 18 ties. RiffScore imports the
export; a second voice on one staff is dropped with its documented warning. Physical
iOS/Android devices, screen readers, long-lesson stress and MusicXML import remain
unverified.

- [`music-notation-model.md`](music-notation-model.md)
- [`music-notation-editor-evaluation.md`](music-notation-editor-evaluation.md)
- [`music-notation-verification.md`](music-notation-verification.md)

## Material gaps, in priority order

### 1. Real lesson path and exact inference provenance

No current evidence demonstrates an actual instructor clip being prepared in a supported
browser, uploaded to the deployed isolated worker, transcribed by the exact approved
artifact, corrected by its instructor and opened with synchronized video/guide.

Choose one candidate and freeze its actual code/checkpoint/runtime. Review the exact
commercial terms and attribution with the accountable reviewer. Use a small,
rights-cleared acoustic corpus to develop the benchmark and capture actual inference
run identities. At least three distinct cases is a harness floor, not sufficient
statistical proof or product acceptance. Include clean single notes, repeated attacks,
chords, silence and explanation/background complications as the pilot scope grows.

The current benchmark compares supplied proposals. Its inference declarations are
not authenticated execution logs. The worker adapter currently records model/package
version, code version and audio hash; it still needs an approved run profile with the
exact deployed model/code identities and preprocessing/configuration that actually
produced its output. Do not equate a package version or a retained JSON declaration with
a verified inference run.

### 2. Teacher-to-learner release

Reviewed music can now be released privately through the existing email invitation
workflow. Publishing requires the latest owner-reviewed and accepted revision and is
restricted to `mode='invite'`; links, groups and public listings remain refused. Recipients
accept through the existing share endpoints and open the v2 guide; unpublish and revocation
close access again. See [`music-private-sharing.md`](music-private-sharing.md).

Remaining: a real two-account pilot, reviewed-music group sharing, and link/public release
only after media-rights and projection work. This does not enable scoring, public music or
model processing.

### 3. Observation and assessment scope

The displayed eligible-note fraction counts reference notes with complete comparison
windows. It does not show how much input was observed. The readiness helper remains a
foundation; it is not connected to an enforced scored policy.

The current editor preserves proposed spans without a dedicated assessable-span editor;
feedback compares the selected section/window. Do not assume explanations, pauses and
playing passages share the same assessment policy. A first unscored smoke test can use
a clean, fully playing passage. Broader lessons need explicit teacher-confirmed
assessable spans and observation/interruption evidence before reliable corrections or
scores are claimed. Release/duration, pedal sound and technique remain distinct from
attack/pitch correctness.

### 4. Actual devices and preparation

Run one physical USB-MIDI keyboard on one intended browser first; record success/failure
for that combination. Then expand the target matrix. The recorded permission denial is
not a successful empty enumeration. Visual alignment estimates personal timing, not
hardware latency. This hardware step does not need to block upstream corpus/worker or
sharing development.

Separately exercise actual audio-bearing upload preparation on that first supported
browser/device: audio presence, trim origin, duration, source-to-guide sync, recovery
export, upload resume and cancellation. Watching must keep working without devices or
supported encoders. Do not infer this from MIDI support or PostgreSQL results.

### 5. Worker operation and commercial packaging

Prove the actual isolated worker environment starts from pinned dependencies, loads the
approved local artifact, survives cancellation/retry/restart, cleans attempt files and
does not consume movement-job capacity unexpectedly. Retain required notices and model
identities. No broad production stress test is needed before a small local experiment,
but real worker operation is needed before enabling instructor processing for a cohort.

### 6. Remaining instrument scope

Current interactive feedback is piano MIDI only. Acoustic pianos without MIDI are
watch-only until microphone assessment exists. Guitar currently has a guide, not a
qualified chord/strum/voicing/fingering or microphone-feedback pipeline. Keep that scope
explicit to users. Do not advertise the MIDI pilot as completed piano-and-guitar feedback.

## Recommended delivery sequence

1. **Checkpoint the existing qualification corrections.** Current HEAD is `bb780c9`;
   code/docs/tests from the subsequent harness review remain uncommitted. The report's
   clean-tree and older test counts describe that commit, not the current working tree.
2. **Build the real private piano lesson milestone.** In parallel: one candidate/code+
   checkpoint commercial review and acoustic benchmark; one supported-browser upload+
   deployed-worker path. Instructor and learner should use their existing account and
   lesson entry paths; the private invitation release is implemented.
3. **Run the first learner smoke test.** One teacher, one learner, one short clean playing
   passage, one keyboard/browser. Check reference/video sync, note corrections,
   interruptions, explicit history save/delete and clean return to movement practice.
   A first smoke test is not a scored or device-matrix qualification.
4. **Expand only from observed results.** Improve instructor corrections/spans, actual
   monitored-input coverage and the supported device/exercise matrix. Decide feedback
   and scoring thresholds from retained ground truth, not from synthetic test counts.
5. **Treat microphone/guitar and public distribution as distinct releases.** They may
   be developed in parallel, but need their own artifact/rights/device evidence. Add
   scores only with an enforced versioned policy and trusted qualification evidence.

## What does not need to block this work

Full device coverage, advanced guitar techniques, public listing, all historical
migration downgrades and large production load are not prerequisites for continuing
private unscored development. Conversely, a real keyboard test cannot substitute for
commercial model approval, and a commercial approval cannot qualify scoring accuracy.

## Evidence and boundaries

- Latest committed report: 299 Python tests passed / 13 skipped; 279 web tests passed.
- Latest local harness correction check: 20 focused tests passed (15 qualification +
  5 transcription adapter tests); no subsequent full-suite rerun was claimed.
- PostgreSQL evidence and sanitized results are recorded under `docs/qualification/`.
- No physical keyboard passed; no actual model or real acoustic corpus was qualified.
- Piano/guitar processing, remote music conversion, MIDI setup and music history default
  to disabled/off in Settings. These defaults are not proof of a particular deployed
  environment's values. No deployment flags were changed during this review.
- No commit or push was made by this review. HEAD is 16 commits ahead of the local
  `origin/main` tracking reference; the remote was not fetched for this status report.


## Instrument library migration planning (10 November)

The user requested replacing custom piano/guitar drawing with reusable libraries.
The [migration handoff](music-ui-library-migration-plan.md) maps this work to parent
P4.6–P4.8 and P8.3–P8.5. The canonical plan now links it through D13/P4.10/P8.11 and has
an updated opening delivery status instead of the obsolete "Phases 3–11 not implemented"
statement. Initial candidates are React Piano for keys and Fretboard.js for the neck;
SVGuitar chord cards follow reviewed shape authoring. No dependency was installed or
compatibility/bundle result claimed. Product timing, account workflows, MIDI and
assessment qualification remain separate. No progress percentage is claimed.


## ffe1827 continuation: implemented instrument-library boundary

Reviewed the UI-L0 spike and continued into UI-L1 with initial UI-L2/UI-L3 adapters.
Default-off, independent piano/neck library flags are now wired into the real player,
with lazy code, checked musical mapping and isolated fallbacks. The C-chord spike fixture
and overly loose piano declaration were corrected. See
[music-ui-library-verification.md](music-ui-library-verification.md). This is application
integration, not merely another fixture; no deployed setting was changed.

### Next software milestones toward the complete platform

1. **Accept the supported diagram slice internally.** Exercise real instructor media,
   keyboard range/neck scrolling and a longer session; retain the legacy path through
   one comparison window. Do not wait for a full physical MIDI matrix just to accept
   a read-only diagram. SVGuitar cards stay deferred until reviewed shape authoring.
2. **Private invitation release is implemented.** Complete the real two-account pilot
   using this path. Group access, links and public music remain unavailable. The sharing
   follow-up closes the group/public API bypasses and format-negotiation gap, and keeps
   invitations separate from explicit release updates.
3. **Complete a real piano processing loop in parallel.** Choose/pin/review one model
   artifact/runtime, retain commercial evidence, prepare rights-cleared acoustic clips,
   record actual inference provenance and qualify the isolated worker/browser upload.
   Verify source-audio/video/reference synchronization, cancellation, resume and retries.
4. **Add explicit assessable-span review and collect real observation evidence.** Separate
   explanation from playing. Run one physical keyboard/browser smoke test, then expand.
   Set and enforce a versioned assessment policy from ground truth before any grades.
   Policy/reference revisions after review also need a normal instructor edit workflow.
5. **Finish instrument-specific releases.** Microphone piano/guitar feedback needs its
   own detector/rights/device qualification. Guitar needs reviewed positions/chords,
   supported tuning/capo/handedness and strum policies. These do not block a narrow
   piano MIDI/watch-only release.
6. **Complete operating rollout and remaining shared results.** Retain notices and media
   rights, confirm real resource isolation from body jobs, exercise representative load
   and operational recovery, and finish parent Phase 9 session/result scope. Enable each
   capability only for the actually supported cohort; advanced Phase 11 remains later.

External evidence still needed: an actual USB-MIDI instrument on a test host,
rights-cleared recordings and accountable approval of the exact model/code/terms. These
cannot be replaced with virtual ports or metadata flags; independent software work above
can continue while they are obtained. This does not restart the existing implementation.


Verification of this slice: **306 Python passed / 13 skipped; 282 web passed**. Both builds,
net bundle checks, library guide and existing guide/history checks pass. All four movement
scripts pass, plus feed with both library flags on and no instrument imports. Details are
in `music-ui-library-verification.md`. No package versions, deployed flags, model assets,
database schema or scoring policy were changed. Code/docs/tests are local and uncommitted.


## Current next action after the private-sharing review

Continue into the real private piano processing milestone. The ordered implementation
and acceptance criteria are in [the completion sequence](music-platform-completion-sequence.md).
No physical-keyboard matrix is required for a watch-only teacher/learner playback pilot.
Hardware evidence remains necessary for claims about MIDI feedback quality or scoring.


## Run-profile execution follow-up

The worker profile foundation now applies and checks actual adapter/checkpoint/audio/
configuration identities and uses an API-approved digest list when enforcement is on.
It does not qualify the imported dependency environment or grant commercial rights.
Fixture output remains fixture evidence; the synthetic private path has been labelled
accordingly. See [the current handoff](music-real-piano-loop.md).

Next independent feature: owner re-editing of reviewed references/policies and explicit
assessable passages, preserving the published revision until an explicit release update.
Build isolated music-worker packaging alongside it. Actual model/recording qualification
and the watch-only private piano run remain open; no keyboard is needed for that run.
