# Piano duration and velocity improvements: implementation plan

For the broader goal of reproducing the original performance's complete sound, use
[Piano performance reconstruction: developer implementation plan](piano-performance-reconstruction-plan.md).
That plan extends scope to key release, pedal, realistic rendering, sound fitting and
iterative audio comparison. This document remains the historical expression workstream;
its completed software does not establish complete performance reconstruction.

Status: remaining attribution, calibrated-velocity, reference-evaluation and application
software is implemented. **Accuracy and activation acceptance remain incomplete.**
Public-reference tests produced no safe velocity changes; natural held-out rendered
duration recovery and improvement on the original upload were not demonstrated.
All automatic expression categories remain disabled. See the
[implementation and measured-results report](qualification/piano-expression-implementation-2026-11-12.md)
for delivered components, exact results, test coverage and remaining acceptance work.

## 1. Objective

Improve the audible endings and dynamics of piano notes after Basic Pitch and Phase 3
have established the working pitches and attack times. Improvements must be measured
against appropriate independent references, preserve attributes that are already
correct, and happen automatically for supported cases without exposing analysis
steps to the learner or owner.

The estimator must also be allowed to return **no change**. An uncertain modification
is not an improvement. Successful delivery requires useful corrections to natural AI
errors, rather than only good results on deliberately damaged examples.

Implement duration and dynamics independently. Either may remain disabled while the
other becomes qualified. Physical key release, pedal transcription and written-rhythm
inference are separate future projects.

## 2. Evidence motivating this work

The [expression accuracy audit](qualification/piano-expression-audit-2026-11-11.md)
tested 24 controlled clips, three human excerpts and the original upload.

| Current estimator on controlled AI output | Result |
|---|---|
| Audible-ending mean error | Worsened from 87.8 ms to 160.4 ms |
| Duration proposals | 9 improved, 18 worsened, 1 negligible change |
| Dynamics proposals versus known rendering gain | 11 improved, 5 worsened |
| Previously acceptable AI attributes damaged | 10 endings and 2 dynamics values |
| Correct-reference controls | 21 incorrect ending changes and 24 incorrect dynamics changes |
| Human-recording dynamics | No proposals across 563 matched notes |

Controlled gain is an audio-amplitude reference, not a calibrated MIDI velocity.
The human MIDI endings describe key releases, not necessarily audible endings.
These results identify algorithm failures but do not establish human velocity or
audible-duration accuracy. The original clip has 18 offline duration proposals whose
correctness is unverified; none should be treated as accepted examples.

## 3. Define the targets before changing the estimators

### 3.1 Duration targets

Keep four concepts separate throughout analysis, reports, evaluation and playback:

| Concept | Definition | Planned treatment |
|---|---|---|
| Audible end | When the target note's identifiable sound ceases or becomes inaudible | Target of this project |
| Key release | When the pianist physically releases the key | Not inferred from acoustic decay alone |
| Written duration | Rhythmic value shown on the sheet | Preserve `notation_duration`; no automatic quantization |
| Pedal | Sustain/damper state | No pedal changes in this project |

Document how `duration` is interpreted by the review player, MIDI export and learner
assessment. Preserve written rhythm when changing an audible duration. An audible
tail must not silently become an instruction to keep pressing the key for that long.
If a consumer requires key-hold duration, it must keep its existing behavior or use a
separate explicit field until a key-release estimator is independently validated.

For controlled stems, retain the independent RMS-based ending reference and report
sensitivity to reasonable audibility thresholds. Do not select a reference threshold
because it makes the estimator score well.

For human recordings, annotate an earliest/latest plausible audible-ending interval
where an exact timestamp is uncertain. Mark masked or inseparable endings as
unscorable. A proposed end inside the same valid interval as the baseline is not a
demonstrated correction.

### 3.2 Dynamics targets

Separate three quantities:

- Measured attack level or attributable note energy, in stated audio units.
- Relative dynamics within a performance, such as stronger/weaker strikes.
- MIDI velocity, which requires an instrument/rendering-response calibration.

Do not qualify MIDI-velocity editing using linear rendering gain alone. If reliable
velocity calibration is unavailable, retain a relative-dynamics diagnostic and leave
the saved velocity unchanged. Do not force every performance toward a median velocity
of 0.5 or erase intentional phrase-level dynamics.

Deliverable: a target-specification section in the expression report documentation,
including units, annotation uncertainty, consumer semantics and unsupported cases.

## 4. Plug into the existing automatic pipeline

```text
Exact analysis WAV + Basic Pitch activations
    -> existing piano decoder
    -> Phase 3 working pitches/onsets and correction history
    -> expression evidence extraction
       -> independent audible-end candidates
       -> independent attack/dynamics candidates
    -> attribute-specific decision rules and qualification policy
    -> automatic application to a separate working document
    -> existing owner review and audition
```

Reuse the exact analysis WAV and recording timeline. Do not re-trim, normalize note
levels independently, stretch time, or use synthesized audition as the source signal.

The immutable AI proposal, the Phase 3 result and the expression result must remain
distinguishable. Both expression estimators read the same Phase 3 input; one must not
silently change the other's evidence or isolation classification during the pass.

The interface should show the resulting working notes and retain existing optional
history/rollback. It must not require the user to inspect spectra, run a comparison
script, or approve each qualified edit. No automatic publishing or sharing is added.

## 5. Work package A: diagnostic execution and reproducible evidence

### Required changes

1. Separate candidate generation from permission to apply a candidate. Currently
   `piano_expression.analyze()` returns early when no policy category is enabled,
   preventing normal diagnostic reporting of those estimators.
2. Introduce independent analysis switches for duration and dynamics. In diagnostic
   mode they may compute candidates even with no qualified automatic categories.
3. Keep unqualified candidates explicitly marked `diagnostic` or `withheld`; the API
   must reject them for automatic application regardless of whether analysis ran.
4. Record per-note abstention reasons and coverage. Distinguish no audible improvement,
   unsupported recording, uncertain overlap, missing calibration, clipped ending,
   resource limit and estimator failure.
5. Bind every report to the exact Phase 3 working-event hash and recording identity.
   Record code, settings, model, decoder, template/calibration and reference versions.
6. Keep CPU, memory, audio-length and event-count limits. A timeout or failure must
   preserve completed Phase 3 corrections. Report partial coverage explicitly.

### Deliverables and completion checks

- A diagnostic run produces evidence with both automatic categories disabled.
- The same report cannot change a working draft through the automatic API.
- Duration failure does not erase a valid dynamics result, and vice versa.
- Repeated execution produces the same candidates apart from timestamps/runtime.
- No changes are made to the source audio or immutable proposal.

## 6. Work package B: shared note-specific audio evidence

The existing scalar harmonic-SNR measurement is insufficient for either estimator.
Build a bounded local analysis that considers the other sounding notes.

### Proposed analysis

1. Analyze a local window around each attack or proposed ending, including earlier
   notes whose tails may still be ringing. Determine overlap from audio evidence and
   a conservative ring window, not just the AI's proposed duration.
2. Reuse the verifier's tuning estimate, multiple spectral resolutions and separable
   nonnegative decomposition where appropriate. Its current generic attack/sustain
   atoms are a starting hypothesis, not a validated source separator.
3. Fit competing pitches together with noise and an explicit unexplained component.
   Avoid assigning all residual energy to the target note.
4. Estimate a time-varying target-note contribution. A single fixed decay shape must
   not force every real piano note to follow a predetermined envelope.
5. Measure identifiability: shared partials, near-collinear templates, masked
   fundamentals, residual structure and sensitivity to reasonable analysis settings.
6. Compare estimates from independent partial groups or analysis resolutions. A
   conclusion supported only by shared harmonics should not authorize an edit.
7. Permit bounded template adaptation from reliable isolated attacks in the same
   recording. Never use an uncertain correction as a new calibration anchor during
   that pass. Fall back to no change if too few anchors exist.

Suggested outputs: attributed attack energy, attributed decay envelope, local noise
estimate, overlap class, supported partials, template fit, fit sensitivity and usable
time range. Store physical measurements and reason codes; do not label arbitrary fit
scores as confidence probabilities.

This is an experimental component. If generic decomposition cannot separate a class
of notes reliably, keep that class unsupported rather than adjusting thresholds to
force coverage. A piano-specific companion model can later be evaluated as another
evidence source; agreement alone is not ground truth.

## 7. Work package C: replace the audible-ending decision

### Candidate generation

1. Always include the current ending as the no-change hypothesis.
2. Search earlier and later within a bounded window using the attributed decay
   envelope, not the summed energy of all matching harmonics.
3. Require evidence that an ending was actually observed. Clip boundaries, missing
   context or an envelope still above the usable floor must produce abstention.
4. Consider change points, decay slope and sustained disappearance of identifiable
   partials. Distinguish the target fading from another note starting or releasing.
5. For a repeated same pitch, report ambiguity when the earlier tail cannot be
   separated from the later strike. Do not universally equate the next onset with
   the previous note's release.

### Acceptance decision

Evaluate the baseline and candidate endings under comparable local models and
complexity penalties. A lower fitted residual alone must not authorize an edit.

Accept a candidate only when all applicable conditions hold:

- The target's contribution is sufficiently identifiable for the qualified scope.
- Evidence supports a material change beyond reference/measurement uncertainty.
- The baseline is contradicted by attributable audio evidence.
- Independent analysis views support the same direction and a compatible ending.
- The proposal is stable under modest parameter perturbations selected in development.
- Ending interpretation is not confused with pedal, notation or physical key release.
- The policy approves this attribute and this recording/overlap scope.

Return a candidate interval as well as a selected timestamp. If baseline and candidate
remain similarly plausible, keep the baseline. Large extensions or shortenings need
stronger evidence; the allowable sizes must be selected on development data and
recorded in the policy settings.

### Specific regressions to fix

- The known 2.194-second reference ending must not be extended from an already correct
  2.184 seconds to 3.546 seconds because another note keeps shared energy high.
- Overlapping-tail cases that previously damaged eight acceptable AI endings must
  be preserved or improved.
- Silence/noise must not extend a short note.
- An uncertain clipped tail must not be shortened simply because analysis stops.

Deliverable: a new versioned duration estimator with evidence, abstentions and the
baseline/candidate comparison retained in the report.

## 8. Work package D: replace velocity multiplication

Remove the rule that multiplies an existing velocity by the note's loudness ratio
to a recording median. It can count the same dynamics twice and introduces pitch bias.

### Stage D1: measure attack strength independently

1. Use a bounded attack interval whose timing follows the actual detected attack.
   A single spectral frame exactly at the onset is insufficient.
2. Separate the new attack from already ringing notes and noise. Use temporal change
   and pitch-specific evidence rather than raw broadband volume alone.
3. Start with well-isolated, identifiable attacks. For chords, estimate the notes
   jointly and abstain when their individual contributions cannot be separated.
4. Include pitch and timbre response in the calibration. Equal gain at different
   pitches must not automatically become different playing strengths.
5. Detect clipping, compression, automatic gain changes, severe masking and excessive
   noise. These conditions may invalidate velocity inference without invalidating
   all transcription work.

### Stage D2: map evidence to the intended output

- Validate relative strength ordering on repeated pitches and across pitches
  separately. Preserve ordering, phrase dynamics and global recording gain invariance
  where the target definition requires them.
- Build monotonic attack-feature-to-velocity mappings from multiple known velocity
  layers, using separate training/calibration and held-out performances. Evaluate
  pitch-specific or smoothly pitch-conditioned mappings rather than one global curve.
- Record calibration identity and applicability. Calibration from one sample bank
  must not be assumed valid for every acoustic piano, microphone or synthesizer.
- If only relative loudness is identifiable, report that measurement and leave MIDI
  velocity unchanged until an applicable conversion has been validated.
- When calibration is available, generate an independent candidate and uncertainty
  range. Compare it with the existing AI velocity; do not multiply the baseline by
  another estimate of the same contrast.
- Retain the existing value if it lies in the plausible range. Any blending or maximum
  adjustment is a development-selected, versioned parameter, not a universal constant.

### Specific regressions to fix

- A correct known rendering gain of 0.22 must not be reduced to 0.083 merely because
  the note is quieter than the recording median.
- Equal-gain controls at different pitches must not receive large opposing changes
  without a legitimate target-specific calibration explanation.
- Changing an incorrect duration in the proposal must not turn an acoustically
  overlapping note into a falsely isolated dynamics anchor.
- Quiet melody under loud bass must not receive a velocity change derived from the
  bass's energy. Unsupported polyphony must have an explicit abstention reason.

Deliverables: attributable attack measurements, versioned calibration artifacts,
relative-dynamics diagnostics, and MIDI-velocity candidates only for calibrated scopes.

## 9. Work package E: benchmark and reference-data improvements

Retain the current failing benchmark unchanged as a regression baseline. Add a new
version when targets or scoring rules change; do not silently rewrite old results.

### Data to add

- Multiple recorded pianos and multiple known velocity layers, rather than only one
  timbre per pitch with artificial gain changes.
- Synchronized MIDI/audio for strike velocity and physical release diagnostics.
- Human-checked audible-ending intervals, with ambiguous examples explicitly marked.
- Repeated notes, chords, octave doubling, low bass, quiet melody, sympathetic ringing,
  pedal changes, room reverberation, noise and different recording gain conditions.
- Natural Basic Pitch errors alongside correct-reference and corrupted controls.

Split development, calibration and final evaluation by performance, with instrument
and recording identities retained. For generalization claims, reserve instrument or
recording domains as well. The 24 already-inspected clips and original upload are
development/regression material, not untouched final qualification data.

### Measurements required

| Attribute | Primary measures | Additional checks |
|---|---|---|
| Audible endings | Error/distance to reference interval, median/mean/90th percentile | Early versus late errors; changed-note and all-note scores |
| Relative dynamics | Pairwise ordering and attributable attack-level error | Same-pitch versus cross-pitch; phrase and gain invariance |
| Calibrated MIDI velocity | Velocity error and rank agreement against known velocities | Calibration domain; soft/loud and chord subsets |
| Automatic edits | Individual correction precision and damage | Coverage, abstention and useful natural-error recovery |
| Operational behavior | Runtime, peak memory and timeout rate | Partial results and deterministic fallback |

Use fixed one-to-one pitch/onset matches before and after attribute edits. Report
unmatched notes separately. An unscorable ending or missing calibration must never
be counted as a correct edit.

Save the source reference value or interval, before/after values, units, tolerance,
event identity, annotation/calibration identity and exclusion reason for each trial.
Derive correctness and damage from this evidence; do not trust manually supplied
`correct: true` flags without reproducible scoring. Reject duplicate trials and
development/holdout leakage.

Run the real report builder and shared API applier as an integration comparison,
using an explicitly evaluation-only policy. Do not count candidates that production
application would reject as successful fixes.

## 10. Work package F: report contract, application and compatibility

Introduce a versioned expression-report contract when adding candidate intervals,
calibration scope or target semantics. Either migrate the schema explicitly or keep
new fields inside an allowed versioned evidence block; do not bypass strict validators.

Each candidate should retain:

- Event ID and attribute; explicit target kind and units.
- Exact baseline value and independent proposed value.
- Candidate interval or uncertainty representation and its derivation.
- Supported recording/overlap scope and calibration identity, if applicable.
- Evidence measurements, competing explanations and abstention/withholding reasons.
- Working-event/audio hashes and all implementation/settings identities.
- Diagnostic/qualified/application status and category policy identity.

The report, qualification builder, profile loader, adapter and server must agree on
supported versions and policy scope. Qualifying isolated attacks must not silently
authorize chord edits. Runtime scope checks must be part of the pinned implementation.

Preserve existing guarantees: owner-only reports, unchanged original proposal,
atomic validated working edits, persisted before/after history, rollback, exact
preconditions and preservation of `notation_duration`. Re-analysis after manual
pitch/onset edits must use the new working hash; stale expression results cannot apply.

## 11. Files and integration responsibilities

| Location | Planned work |
|---|---|
| `scripts/piano_expression.py` | Diagnostic/application separation; replace estimators; structured per-note evidence |
| New pure analysis helper(s), if needed | Bounded joint attribution, decay/attack evidence, calibration loading |
| `scripts/piano_verifier.py` | Reusable analysis primitives and versioned expression-policy validation; preserve Phase 3 behavior |
| `scripts/piano_settings.py` | Versioned expression parameters without divergent duplicate defaults |
| `scripts/benchmark_piano_expression.py` | Independent references, expanded datasets, scoped scoring and regression results |
| `scripts/qualify_piano_expression.py` | Reproducible attribute outcomes, qualification scope, trial validation |
| `scripts/music_basic_pitch_adapter.py` | Exact Phase 3 input, report versions, independent failure handling and artifact retention |
| `scripts/music_run_profile.py`, `scripts/prepare_piano_decoder_profile.py` | Pin estimator/helper/calibration/settings bytes and reject incompatible profiles |
| `apps/api/music_verification.py` | Contract, scope and stale-state checks; preserve atomic application/history |
| `apps/api/contracts.py`, `packages/lesson-schema/*` | Change only if explicit new persisted target semantics are required |
| `packages/music-notation/*`, review/audition consumers | Verify written duration preservation and playback meaning |
| `tests/api/test_piano_expression.py` and related tests | Correct-reference, interference, calibration, scope and failure regressions |
| Music documentation and qualification artifacts | Target definitions, measured results, limitations and rollout status |

Fingerprint helper modules and calibration files as well as entry-point files. Moving
logic out of a hashed file must not make those dependencies untracked.

## 12. Acceptance and release criteria

### Required before any automatic activation

1. Existing expression, handoff, review, rollback and notation tests pass.
2. Known harmful correct-reference changes are removed; correct values remain inside
   their reference tolerances. Equivalent abstention is acceptable for an ambiguous
   case, but abstaining everywhere cannot establish useful improvement.
3. On untouched qualification data, the candidate system improves aggregate error on
   natural AI output, reports tail errors, and causes no measured damage under the
   category's current gate. Report results by supported scope and recording domain.
4. Retain the existing category-specific minimums: at least 40 distinct held-out
   performances contributing edit trials to that category, at least 20 individual
   suggestions, at least 95% correction precision and zero measured damage. The
   current per-category performance requirement can imply more than 40 suggestions;
   do not count performances with no proposals as precision evidence.
5. Report denominators and uncertainty. A 95% observed precision threshold is not a
   claim of 95% statistical confidence or a guarantee for every future upload.
6. Duration qualification uses audible-ending references; velocity qualification uses
   applicable calibrated velocity references. Synthetic gain or MIDI key-release
   diagnostics cannot substitute for these targets.
7. Demonstrate useful coverage and natural-error improvement. Set the required
   coverage/minimum effect on development data before inspecting final holdout results;
   it must exceed annotation uncertainty and must not hide subgroup regressions.
8. The full prepared adapter/report/API application path reproduces the benchmark
   changes and preserves Phase 3 output on expression failure.

Do not weaken thresholds to obtain an enabled policy. A failing attribute or scope
remains diagnostic while supported, separately qualified work may proceed.

### Rollout order

1. Offline experiments with pinned old/new reports.
2. Shadow diagnostic runs on new uploads, with no changes to working notes.
3. Independent qualification of audible endings and calibrated velocity scopes.
4. Prepare and register a new immutable worker profile, retaining the old profile.
5. Enable only qualified attributes/scopes. Confirm seamless review, audition and
   rollback in desktop and mobile layouts.
6. Monitor edit counts, withholding reasons, runtime, failures and rollback frequency.
   Rollback frequency is a useful warning signal, not accuracy ground truth. Use
   checked samples for ongoing accuracy review.

Existing lessons should not be silently reprocessed. Keep any re-analysis explicit,
versioned and reversible.

## 13. Delivery sequence and review checkpoints

| Milestone | Deliverable | Gate to proceed |
|---|---|---|
| 1. Target and benchmark contract | Reference definitions, annotated schema, frozen old failures | No conflation of audible end, key release, gain or velocity |
| 2. Diagnostic foundation | Policy-independent analysis, evidence/abstention reports | Disabled policies still prevent application; fallback tests pass |
| 3. Audio attribution prototype | Competing-note decay and attack measurements | Controlled interference and identifiability checks pass |
| 4. Duration estimator | Baseline/candidate comparison with uncertainty | Known harmful ending changes eliminated; natural-error gains measured |
| 5. Dynamics estimator | Independent attack estimate and scoped calibration | Correct-value, pitch-bias and gain-invariance controls pass |
| 6. Polyphonic extension | Joint chord/overlap analysis | Separate evidence demonstrates benefit; otherwise remain unsupported |
| 7. End-to-end qualification | Frozen held-out results, scoped policies and pinned profiles | Existing quality gates pass per attribute/scope |
| 8. Controlled activation | Seamless working-draft updates and rollback | Worker/API/browser workflow verified; operational fallback ready |

Duration and dynamics experimentation can proceed independently after the shared
target/diagnostic foundation. Polyphonic activation is optional until it passes its
own evidence requirements. No delivery date or general accuracy guarantee should be
promised before the attribution prototype and reference-data availability are assessed.

## 14. Definition of done

For every enabled attribute and supported scope, the system automatically produces
measurably better working notes than the incoming AI/Phase 3 result on independent
reference data, preserves already acceptable attributes, records why each edit was
made, and leaves uncertain cases unchanged. The user receives the improved notes
without needing to inspect or operate the comparison script.

An implementation that merely runs, changes more notes, passes software tests or
reduces a spectral residual has not met this definition.
