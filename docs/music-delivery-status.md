# Music delivery: current status and next milestones

10 November 2026. Review of `bb780c9` and the subsequent local qualification fixes.
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
| Audio-preserving preparation and music worker | Separate preparation, import recovery, upload identity, server audio validation, leased/attempt-bound worker and draft handoff | Target-device preparation matrix and real deployed worker route are not qualified |
| Instructor review | Private draft editing, note corrections, teaching sections, reviewed reference identity and supported watch/MIDI policy | Policy/reference re-editing after finalisation and explicit assessable-span editing remain incomplete |
| Guide/player | Instructor video and reviewed-time piano keyboard or illustrative guitar fretboard, section seeking and cleanup | Guitar positions are illustrative; no inferred instructor fingering or general capo/tuning support |
| Piano MIDI | Opt-in input, sustain/attack normalization, timed practice and approximate local pitch/onset feedback | Virtual tests pass; physical keyboard still not tested; no score or acoustic-piano feedback |
| Personal music history | Explicit unscored save, stable retries, per-lesson/account pages and deletion | Self-reported aggregate evidence, not grades or observation-coverage proof |
| PostgreSQL | 0015–0020 execution, real quota/retry races, cursor continuation and full backup restore exercised | Bounded synthetic dataset; deployment-scale load and operational recovery remain separate |
| Model evidence tooling | Artifact/code/terms/approval binding, PCM corpus validation and proposal comparison checks | No selected/installed/approved model, real acoustic corpus or independently verified inference |
| Instructor-to-learner music release | Guarded off | Even reviewed music cannot yet be published/shared through normal API use |
| Microphone and full guitar assessment | Not delivered | Separate detector/rights/device/exercise qualification needed |

Phase labels describe workstreams, not a sequential completion certificate. Work from
Phases 3–6 and history has landed while real transcription/release and device gates are
still open. Do not declare all of Phase 5 or Phase 6 finished on the basis of the current
fixture and database tests.

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

Music sharing/publishing is still refused by `ensure_release`, even for a reviewed
reference. The current owner-only lab and simulated future grants in tests are not a
working instructor-to-learner distribution journey.

Before a two-account learner pilot, implement a narrow reviewed-music invite/group
release using the existing sharing flow. Bind access to the accepted revision/reference
and its policy; test unreleased edits, relabels, revocation, assets and v1-client refusal.
Keep public listings/derivatives off until their media-rights and projection work is ready.
This distribution work can proceed alongside model and hardware qualification.

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
   deployed-worker path; and the narrow invite-only reviewed music release. Instructor
   and learner should use their existing account and lesson entry paths.
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
