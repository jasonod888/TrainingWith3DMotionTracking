# Remaining multi-discipline delivery sequence

10 November 2026. Implementation handoff following review of `91b55be`.
This supplements the [canonical plan](multi-discipline-implementation-plan.md), which
remains the source of requirements. Existing login, instructor creation, library,
invitation and learner navigation stay the shared workflow. No new phase numbering.

## 1. Exact-model private piano loop (Phases 3, 5, 10)

**Status 10 November 2026: infrastructure delivered; real inference blocked.** The worker
now requires a verified run profile (weights/code/config/commercial-evidence digests) or an
explicit fixture flag, refuses mismatches, and records the profile digest and model identity
in draft provenance. A synthetic test exercises prepared clip → profiled draft → watch-only
review → invitation → learner access. The real model, rights-cleared recording, commercial
approval and deployed staging worker are still required before steps 1–7 below can run. See
[`music-real-piano-loop.md`](music-real-piano-loop.md).

Profile execution plumbing is now implemented with fail-closed adapter checks; real
model/dependency/commercial qualification and an actual end-to-end run remain open.
See [the current handoff](music-real-piano-loop.md). Normal reviewed-reference/span
editing in section 2 is the next independent software slice; staging worker packaging
can proceed alongside it.

Start with one instructor, one learner and a short, rights-cleared piano clip. Use a
watch-only reviewed policy first. A physical keyboard is unnecessary for this milestone.

Implement an approved worker run profile containing the exact code revision/package
lock, checkpoint file digest, runtime dependencies, preprocessing, sample rate and
inference thresholds. Bind it to the retained commercial evidence. Verify installed
bytes at startup; refuse a missing/mismatched profile. Do not automatically download
another checkpoint or fall back to the fixture engine. Keep fixture operation explicit.

Record the actual profile digest, input/analysis audio digests and worker run/attempt
identity in each draft's provenance and retained benchmark report. Preserve the current
lease and attempt-bound upload protections. A package version alone is insufficient.

Then exercise an isolated staging worker with piano enabled only for the test cohort:

1. Select Piano in the existing creation screen and prepare/upload an actual video.
2. Confirm exported audio, duration and alignment survive browser preparation; exercise
   the existing supported recovery/import path if no encoder is available.
3. Run actual inference and open the draft in the existing review destination.
4. Correct notes/sections and explicitly save the reviewed reference.
5. Invite a separate learner account and open synchronized video/keyboard playback.
6. Review a replacement; confirm invitation does not update the old release, then
   explicitly update it. Test revoke/unpublish and inaccessible private replacement assets.
7. Exercise cancellation/retry once, recording private temporary-asset cleanup.

Retain a sanitized run record with browser/OS, clip rights, model/profile identities,
timing observations and outcomes. Add at least three distinct real reviewed acoustic
cases to the existing benchmark, with per-case results. Three is a harness minimum,
not a universal accuracy claim. Select acceptance thresholds from the intended scope.

External inputs: an accountable review of exact code/weights/terms and permission to
use the recordings. Implementation of profiles and the runner can continue while these
are gathered. Do not label the model commercially approved until that evidence exists.

## 2. Finish diagrams and normal reference editing (Phases 4, 5; UI-L2/L3/L5)

**Status 11 November 2026: editable notation prototype delivered.** Piano owners now edit a
linked grand-staff score, piano roll and keyboard with shared selection and undo/redo;
notation is saved with the reviewed reference and exports to MusicXML. The Phase 1
candidate comparison and the model/timing policy are recorded in
[`music-notation-editor-evaluation.md`](music-notation-editor-evaluation.md),
[`music-notation-model.md`](music-notation-model.md) and
[`music-notation-verification.md`](music-notation-verification.md). Physical iOS/Android,
real transcription round-trips and MusicXML import remain open, so this is not a claim that
the diagram/editing workstream is finished.

**Status 10 November 2026: editing/passages delivered; diagrams partly delivered.**
Owners can reopen a reviewed lesson, edit notes/sections/policy, mark playing versus
explanation passages and save a new immutable revision; learners keep the current release
until **Update shared version**. Explanation passages produce no learner corrections.
Library piano/guitar adapters remain behind default-off flags. See
[`music-reviewed-editing.md`](music-reviewed-editing.md).

- Accept piano and guitar-neck adapters at supported screen sizes, with dense notes,
  ranges/scrolling, seeks/repeats, repeated mount/unmount and text alternatives. Retain
  measured active-instrument bundle budgets and the fallback during comparison.
- Provide normal editing of a reviewed reference/policy and explicit assessable spans.
  Create a new immutable revision and audit trail; leave the released revision and
  historical summaries bound to their original reference/policy until explicit publication.
- Make explanation/non-assessable passages explicit to learners. Do not describe
  eligible-note counts as measured input-observation coverage.

Pass when a teacher can correct an existing lesson through the normal workflow and a
learner sees the previous release until publication. Accept read-only diagrams without
waiting for physical MIDI qualification. Reviewed SVGuitar chord cards remain Phase 8.

## 3. Qualify the piano MIDI subset (Phase 6)

Run one real keyboard/browser smoke test first: correct/wrong/repeated/chord notes,
timing, sustain, disconnect and hidden-page interruption. Then expand only to intended
supported devices. Distinguish personal visual alignment from measured hardware latency.
Record observation limits and false corrections against known performances.

Continue with private unscored feedback/history while collecting evidence. Enable any
score only after versioned readiness/coverage/exercise rules and measured thresholds
are enforced. No hardware result is implied by virtual MIDI tests.

## 4. Complete acoustic and guitar scope (Phases 7, 8)

Qualify a commercially usable detector for a bounded microphone exercise before
promising general acoustic feedback. Add explicit permission/setup/recovery and resource
cleanup to the existing practice destination. Unsupported browsers retain watching.

For guitar, implement reviewed string/fret positions and chord shapes, supported tuning,
capo/handedness and ambiguity messaging before stronger animation/fingering claims.
Assess plucking/chords/strums only where the detector and rubric support them. Deliver
each capability separately; these do not block the private piano milestone.

## 5. Finish shared results and operating release (Phases 9, 10)

Reconcile the implemented account-private history with the canonical results/session
requirements. Keep unscored client summaries distinct from trusted grades. Complete
retention, deletion and any optional recording/paired-display scope per capability.

Before wider rollout, verify representative load, worker isolation from movement jobs,
storage/cleanup budgets, monitoring, backup/restore and rollback. Existing PostgreSQL
migration/race/restore evidence need not be repeated for unrelated UI changes. Complete
the supported browser audio/device matrix for the capabilities actually being enabled.

Private invitations can precede group/link/public music. Those audiences require a
separate authorization/revision/media-rights design and regression checks; removing the
current refusal alone is insufficient. Phase 11 advanced features remain deferred.

## Practical release decision

Proceed with software work now. The immediate deliverable is one real private piano
lesson through the existing instructor/learner workflow. Keep independent capabilities
default-off until their own evidence exists; do not hold all development for future
microphone, guitar or scored-mode qualification.
