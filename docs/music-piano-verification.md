# Piano transcription verification: diagnostic stage and correction gate

For the latest complete-pipeline fixes and measured tests, see the
[11 November system audit](qualification/piano-system-audit-2026-11-11.md).
It includes the original uploaded excerpt and an additional synchronized human
recording benchmark; the latter shows a small improvement from duplicate removal,
but does not qualify automatic corrections for general uploads.

The separate [duration and dynamics accuracy test](qualification/piano-expression-audit-2026-11-11.md)
found harmful expression edits on controlled natural AI proposals. Expression
categories must remain disabled pending estimator improvements and fresh validation.
The developer-ready [expression improvement implementation plan](piano-expression-improvement-plan.md)
defines the replacement estimators, reference data, integration work and activation gates.

Status: the diagnostic verifier, owner review and the fail-closed phase 3 correction
gate are implemented (11 November 2026). In qualified mode, validated corrections are
applied automatically to a separate working draft before the owner opens it; the
original draft and correction history are retained for rollback. Phase 4 adds the same
independently gated path for audible duration and relative dynamics; pedal/key-release
and written-rhythm inference remain unimplemented and disabled. This is still
**not acceptance-complete**: the evaluation remains sample-rendered prototype evidence
and **no correction or expression category is qualified**. Real performances with
checked synchronized reference notes, browser-level workflow tests and a held-out
qualification study are still required. Automatic application never publishes or shares
a lesson, and does not quantize timing.

The measured report is retained in [piano-verification-2026-11-11.json](qualification/piano-verification-2026-11-11.json);
the current, intentionally disabled correction policy is
[piano-correction-policy.json](qualification/piano-correction-policy.json), with the
independent phase-4 policy in
[piano-expression-policy.json](qualification/piano-expression-policy.json). Research
scope, cautions and the later delivery phases remain in
[piano-audio-verification-plan.md](piano-audio-verification-plan.md).

## Placement and guarantees

```
media validation -> audio extraction -> Basic Pitch inference -> piano peak decoder
    -> diagnostic verification (this stage) -> owner review
```

- Runs inside the profiled Basic Pitch adapter after the selected decoder and before
  the draft is handed to the worker. The draft document is never edited.
- Enabled by a `verification` block in the run profile. Profiles without the block,
  or with it disabled, behave exactly as before. The verifier code is pinned by its
  own SHA-256 and the settings by a separate digest.
- The report is written to `verification.json` inside the existing owner-only
  `analysis.zip`. When a supported edit exists, a separate `verification-proposal.json`
  contains the alternative draft and its edit list, derived from the recorded proposal
  hash. It never replaces `proposed-reference.json`, the manifest or any review state.
  `metadata.json` records the verifier status, version, code/settings hashes, finding
  counts and runtime. A failure, timeout or code mismatch records
  `status: unavailable` with a reason and leaves the baseline proposal usable.
- Same owner-only access and 30-day analysis retention as the rest of the artifact.
  Nothing is added to the lesson manifest, reference, review state or release.

## What the verifier does

### Inputs

- The exact extracted analysis WAV used for inference.
- The decoded proposal events (read-only).
- Retained Basic Pitch `note`, `onset` and `contour` activations, used only as
  supporting evidence, never as calibrated probabilities.
- Duration, sample rate, audio hash, proposal hash and model/profile/decoder identity.

### Evidence extraction (`scripts/piano_verifier.py`)

- Two STFT resolutions. A long 8192-sample window resolves low piano partials; a
  2048-sample window resolves higher partials and attack timing. A short 1024-sample
  window produces a pitch-specific attack curve above 900 Hz.
- Global tuning estimate from prominent partials, bounded to ±40 cents; the spread is
  recorded and a spread above 30 cents falls back to equal temperament.
- Per-bin noise floor (15th percentile), per-pitch harmonic activity, broadband onset
  novelty and a short-window per-pitch attack curve with its peak time and strength.
- All analysis stays on the recording's own timeline. No score, beat grid or
  synthesised playback is involved.

### Constrained note decomposition

Each local region is modelled in the magnitude domain with separable atoms:

- one attack atom and one sustain atom per note (pitch-specific harmonic template,
  bounded brightness/decay; attack and sustain use different spectral tilts);
- one noise atom from the measured floor;
- candidate atoms for pitches and onsets that the proposal does not contain.

Non-negative gains are fitted with a HALS/coordinate-descent NNLS solver over a
precomputed Gram matrix. Hypotheses are subsets of the same atom union, so keeping,
shifting, adding, deleting, splitting and merging are compared under identical
conditions. The proposal narrows the search but never dictates the answer.

### Checks and phase-1 outcomes

| Check | Implemented evidence | Phase-1 outcome |
|---|---|---|
| Timeline / clip boundary | event bounds versus analysed duration | flagged finding; no note edit |
| Duplicate / fragmented strike | second same-pitch onset ≤ 160 ms away, no separate short-window attack, no separate decoder onset, merge cost bounded | suggested merge |
| Early / late onset | displaced pitch-specific attack peak, no attack at the current onset, NNLS gain, ±160 ms bounded search | suggested local shift |
| Missed repeated strike | short-window attack inside a ringing note plus broadband novelty, no competing note onset | suggested split |
| Missing pitch | unexplained harmonic energy, fundamental-specific evidence, decoder support, harmonic-relation guard | usually an `unresolved` finding; a suggestion only for a strongly supported, non-harmonic candidate |
| Extra pitch | removal cost, decoder note activation, harmonic overlap, quiet-note guard | `unresolved` finding; deletion suggestion only when the event has essentially no evidence |
| Octave / wrong pitch | octave, twelfth and other harmonic comparisons; per-note spectral-profile fit; joint lower/upper/both evaluation | `unresolved` finding; substitution requires separate qualification and is never suggested by default |
| Unmatched attack | broadband novelty with no nearby proposed onset; candidate pitches from residual harmonics | flagged timestamp, or a suggestion when one pitch is strongly supported |
| Audible duration | not implemented in this stage | phase 3 |
| Relative dynamics | not implemented in this stage | phase 3 |

Every finding records its evidence in physical units (residual gain relative to the
local noise floor, unexplained fraction, attack strength, activation values, profile
fit). No confidence percentages are invented from those scores.

### Ambiguity policy

The verifier abstains rather than guessing when:

- a candidate shares a harmonic series with a sounding note (octaves, twelfths,
  octave-of-a-fifth and other integer ratios), so the residual cannot separate them;
- an attack is too weak to locate, or another note attacks at the relocated time;
- competing pitches explain the passage almost equally well;
- the note is quiet enough that masking cannot be excluded;
- the change only slightly improves the audio explanation.

Missing notes are explicitly reported as *unresolved harmonic evidence*, not as proof
that a note was absent. A masked quiet note may be impossible to detect. Missing-pitch
and unmatched-attack insertions share the same gain, harmonic-profile, attack,
decoder-support, relation and competing-candidate gate; failure produces an unresolved
or flagged finding, never an insertion suggestion.

## Report schema (`schema_version` 1)

```json
{
  "schema_version": 1,
  "verifier_version": "piano-verifier-1",
  "mode": "diagnostic",
  "correction_policy": { "mode": "diagnostic", "policy_version": null,
                         "policy_sha256": null, "enabled_categories": [],
                         "withheld_count": 0 },
  "status": "complete",
  "source": {
    "audio_sha256": "...", "proposal_sha256": "...", "reference_sha256": "...",
    "profile_sha256": "...", "model": "basic-pitch", "model_version": "0.4.0",
    "decoder": "basic-pitch-0.4.0/piano-peaks-v1",
    "duration": 8.0, "sample_rate": 22050, "note_count": 42,
    "tuning_cents": -2.1, "tuning_spread_cents": 7.96
  },
  "settings": { "...": "merged verifier settings" },
  "settings_sha256": "...",
  "analysis": { "frames": 688, "bins": 743, "noise_floor_db": -54.2, "usable": true },
  "findings": [
    {
      "id": "vf-1", "kind": "missing_pitch", "status": "unresolved",
      "correction_status": "none",
      "time_range": [1.985, 2.274], "event_ids": [], "pitch": 85,
      "explanation": "Unexplained harmonic energy near C#6 ...",
      "evidence": { "gain": 1.402, "unexplained": 0.425, "fundamental": 0.42,
                    "snr_db": 12.94, "strong_partials": 2, "attack": 3.722,
                    "attack_sharp": 4.127, "decoder_onset": 0.842 },
      "alternatives": [], "proposed_edits": [],
      "ambiguous": true, "ambiguity_reasons": ["The candidate shares a harmonic series ..."]
    }
  ],
  "edits": [
    { "op": "set_onset", "event_ids": ["bp-7"], "before": {"onset": 1.75},
      "after": {"onset": 1.66}, "reason": "Pitch-specific attack evidence ..." }
  ],
  "summary": { "finding_count": 2, "suggested_count": 0, "flagged_count": 0,
               "unresolved_count": 2, "qualified_count": 0, "withheld_count": 0,
               "edit_count": 0, "runtime_seconds": 3.0 },
  "warnings": []
}
```

Statuses are `suggested` (a specific alternative exists for review), `unresolved`
(disagreement detected, no sufficiently supported change) and `flagged` (a warning
such as a timeline or timestamp-only attack finding). `accepted` and `rejected` are
stored separately as owner decisions (phase 2), not as findings: the retained report
stays the immutable record of what the verifier observed. Each edit keeps the original
value, proposed value, reason and affected event IDs. In qualified mode a finding also
carries `correction_status` (`qualified`, `withheld`, `diagnostic` or `none`); withheld
edits stay visible as evidence but are excluded from `edits` and cannot be accepted.

## Owner review (phase 2)

Revised 11 November 2026 after review. The unreviewed draft document remains the
immutable baseline. Accepted suggestions are stored as decision records **with their
complete edit snapshots**, and the working proposal is reconstructed from those snapshots
rather than from the expiring analysis archive. A working-state token covers the
baseline and every decision; decision changes and final review saving must present the
current token.

### API

- `GET /api/lessons/{lesson_id}/music-analysis/verification?draft_id=...` — owner-only.
  Returns the report (or `null` when evidence is unavailable), decisions, reconstructed
  `events`, `available`, `report_error`, `stale`, `conflicts`, `invalid_working`,
  `state_token` and proposal/report hashes. Missing or expired evidence is a **200 with
  `available: false`**, not a 404, so accepted owner work remains visible.
- `POST /api/lessons/{lesson_id}/music-draft/verification-decision` — body
  `{draft_id, base_proposal_sha256, base_state_token, base_report_sha256, finding_id,
  decision: accepted|rejected|cleared}`. `cleared` is undo and works without the archive.

Both routes resolve the lesson through the existing owner check and require the draft
owner, piano subject, latest draft and `status = draft`.

### Persistence, identity and stale revisions

- `music_verification_decisions` (migration `0022`) stores one row per draft/finding:
  decision, reviewer, time, baseline proposal hash, report digest, and a snapshot of the
  finding type, pitch, time range, explanation, edits, `before` values and audio hash.
  A unique constraint makes retries idempotent.
- The report is bound to the exact audio hash and clip duration. A report whose audio
  identity differs from the draft is treated as unavailable diagnostic evidence, while
  decisions remain recoverable.
- Decision changes require the current `base_state_token`. The token changes when any
  decision changes; an old tab receives **409** and cannot silently overwrite accepted
  corrections. Final review saving requires the same token and verifies that every
  accepted decision's effect is present in the submitted notes.
- Accepted findings are applied with the recorded `before` preconditions. Two findings
  changing the same property incompatibly are refused with 409; compatible changes to
  different properties are allowed. The resulting complete proposal is validated
  against the draft contract (clip bounds, finite values, pitch range, unique IDs, event
  count) before the decision commits. Generated additions are clipped to the clip and
  invalid results are refused with 422.
- On review, the immutable reviewed reference gains
  `review.verification.decisions` with each decision, timestamp and original/proposed
  edit, preserving provenance after the draft leaves the review screen.

### Review experience

The verifier panel lists each finding with its plain-language explanation, status, time
range, linked note numbers, evidence summary, original → proposed values and ambiguity
reasons. Selecting a finding seeks the source recording, jumps to its note page, and
highlights the linked notes (or, when derived IDs no longer match, notes at the finding's
pitch and time) in the roll, keyboard and note fieldsets. Each finding offers:

- **Play context** — loops a short window of the original instructor recording.
- **Audition now** and **Audition proposed** — synthesize the current notes or the
  selected finding's alternative around the same interval. Notes already sounding at
  the context boundary keep an attenuated elapsed envelope instead of a fresh attack.
- **Accept suggestion**, **Dismiss**, and **Undo**.

Acceptance and undo are merged into the current working note list locally, so unrelated
manual edits survive; a conflicting manual edit blocks the change instead of being
silently replaced. Editing and saving are paused while a decision or initial report
request is pending. If the report arrives after the owner has started editing, accepted
work from another session is not silently merged; the screen asks for a reload.

### Remaining phase-2 limits

- The notation editor is not linked to findings yet; the review screen links the piano
  roll, keyboard, source video and note fieldsets.
- Sensitivity/template-perturbation qualification was **not implemented** and the
  corresponding unused settings were removed rather than advertised. Settings are now
  validated by section and field name.
- The real-performance benchmark, browser-level integrated workflow tests and the
  large-scale correction qualification required by the review remain outstanding. The
  current evidence is prototype-scale.

Automated checks: `tests/api/test_music_verification.py` covers owner access,
accept/reopen, rejection, undo, stale-tab decision and save conflicts, archive-expiry
reconstruction, report identity/digest changes, invalid/out-of-clip edits, incompatible
property edits, unavailable evidence, reviewed drafts and reviewed-reference provenance.
`apps/web/tests/verification.test.tsx` covers parsing, selection, decisions, stale UI,
withheld corrections and manual-edit preservation in the working list.
`tests/api/test_piano_correction_policy.py` and the qualified-mode cases in
`test_piano_verifier.py` cover rendered-versus-human evidence, sample minima, precision
and damage gates; profile and adapter tests cover missing/mismatched policy fallback.
`test_music_draft_handoff.py` covers automatic application before the owner opens the
draft, and `test_music_verification.py` covers working/baseline views, history,
qualification-label rejection, exact-draft/token rollback and stale-tab rejection.
`test_piano_expression.py` covers phase-4 policy gating and fingerprint checks, strict
per-attribute qualification, short notes in noise, clipped/ringing/repeated tails,
overlap-aware dynamics, working-event preconditions and notation preservation.
`test_piano_adapter_verification.py` covers independent phase-3/phase-4 process
fallback, and the web tests cover the 2,000-record combined history and score
construction from `notation_duration`. These tests do not replace the missing
real-performance and browser integration evidence.



## Qualified corrections (phase 3)

Phase 3 is a **fail-closed qualification gate followed by automatic application**.
When a prepared profile contains an enabled correction policy, the worker/server applies
only those qualified edits to a separate **working draft** before the owner opens the
review screen. The original draft document is never rewritten, the complete correction
history is retained internally, and the owner can restore the original notes.

This is separate from publishing or sharing: an automatically corrected working draft is
still an unreviewed draft. Saving the reviewed reference and any later release remain the
existing explicit owner actions.

### Policy and evidence

`docs/qualification/piano-correction-policy.json` is a versioned policy with:

- the benchmark digest and whether the evidence is `rendered` or `human`;
- distinct held-out performance and individual-correction minima;
- minimum individual-correction precision and maximum damage rate;
- one entry per correction category with metrics, enabled flag and reason;
- an implementation fingerprint covering verifier code, settings, model weights,
  decoder and the correction-application code.

`scripts/qualify_piano_corrections.py` builds the policy from a benchmark report. A
category is enabled only when all of these hold:

- the report contains per-correction `correction_trials` with explicit eligibility,
  correctness and damage measurements;
- the evidence is held-out **human** performance;
- the category has enough distinct performances and individual suggestions;
- individual correction precision meets the threshold;
- no previously correct note was damaged, including unwanted corrections on clean
  reference material and natural decoder errors.

Missing trial fields block qualification rather than being treated as no damage. The
benchmark records individual correction outcomes, identity-based damage to previously
correct notes, and unwanted corrections on clean/natural material. Several corruptions
of the same performance count as one distinct performance for that category.

The implementation fingerprint is checked during profile preparation and again at
automatic application. Changing verifier code, settings, model/decoder identity or the
correction-application code invalidates the old policy; it cannot be silently reused.

The checked-in policy is deliberately `insufficient-evidence`: all categories are
disabled because the only available benchmark is sample-rendered and has four held-out
seeds. A rendered benchmark can never enable a category, and a policy that tries to do
so is rejected by the verifier.

### Qualified verification mode and automatic application

Diagnostic mode is the default and keeps the phase-2 owner-suggestion behaviour.
Qualified mode is an explicit profile feature flag:

```powershell
.venv-saas/Scripts/python.exe scripts/prepare_piano_decoder_profile.py `
  --weights <weights> --evidence <evidence> `
  --correction-policy docs/qualification/piano-correction-policy.json `
  --output <new-profile-directory>
```

The profile stores the policy and its digest. Missing, altered or unsupported policy
makes verification unavailable and leaves the baseline draft usable. The verifier then:

- exposes edits only for categories enabled by the policy;
- downgrades other suggestions to `unresolved`, keeps their evidence, and records
  `correction_status: withheld` with a reason;
- reports `correction_policy` metadata and `summary.qualified_count` /
  `summary.withheld_count`;
- excludes withheld edits from `report.edits`, so no alternative proposal is built from
  them.

At draft handoff, if the retained report is qualified and contains validated edits, the
server applies those edits to a copy of the baseline and stores it as
`music_drafts.working_document` (migration **0023**). The baseline `document` remains
unchanged. The applied edits, finding IDs, policy/report digests and timestamps are
written to `correction_history`. Application is all-or-nothing: a precondition failure or invalid
result leaves the original proposal untouched. The server independently validates the
policy digest, enabled categories, implementation fingerprint, per-finding eligibility
and supported operations; it never trusts a report's self-declared `qualified` label.

The owner opens the ordinary editor on the working notes, with a short processing
summary and a banner showing that validated corrections were applied. The technical
diagnostics panel is hidden behind an optional **Show advanced diagnostics** control, so
the ordinary flow shows the improved notes without requiring technical review.
Technical comparison (original versus working note counts and applied findings) is
optional. **Restore original notes** requires the exact
displayed draft ID and current working-state token, locks the draft row, and marks the
history reverted. It is refused while manual verification decisions exist or when a
newer draft/stale token is present, so an older tab cannot restore or modify a newer
draft. The history itself is retained.

The API refuses to accept a withheld, non-suggested, or already-automatically-applied
finding. Remaining qualified suggestions can still be accepted through the normal review
workflow. Review saving records `review.verification.automatic_corrections`, the
baseline/working hashes, and the active working-state token; a stale tab cannot overwrite
a rollback or an automatic correction change.

### Current qualification outcome

The current policy has **zero enabled categories**. The smoke benchmark is useful for
regression testing but does not meet the human-performance, sample-size or precision
evidence requirements. Therefore no correction is automatically applied in the checked-in
configuration; the automatic path is exercised only with a qualified policy.

Qualification is reproducible with:

```powershell
.venv-saas/Scripts/python.exe scripts/qualify_piano_corrections.py `
  --report <benchmark-report.json> `
  --evidence-kind rendered `
  --output docs/qualification/piano-correction-policy.json
```

The report must use benchmark version 2 with `correction_trials`; an older
case-only report is rejected.

Use `--evidence-kind human` only with a real, held-out human-performance benchmark whose
alignment and labels were manually checked. `--require-qualified` exits non-zero when the
policy remains insufficient, which is the intended behaviour for a release gate.

## Phase 4 expression improvements

Phase 4 extends the same automatic pipeline with **independent expression categories**:
`audible_duration`, `relative_dynamics`, `pedal`, `key_release` and `written_rhythm`.
Each has its own policy entry, human held-out thresholds and enable flag in
[piano-expression-policy.json](qualification/piano-expression-policy.json). There is no
mandatory technical review screen; qualified attributes appear in the normal editor and
the owner can optionally open the original/correction history.

Implemented in this phase:

- `audible_duration` and `relative_dynamics` have bounded estimators based on the
  existing pitch evidence. Duration requires an observed decay/release inside the search
  window; activity still high at the search or clip boundary is treated as uncertain and
  the original duration is preserved. Dynamics is proposed only for isolated notes; an
  overlapping chord or accompaniment leaves values unchanged, and relative dB is mapped
  around the median rather than stretched across the full velocity range.
- `pedal`, `key_release` and `written_rhythm` are **not inferred** in this phase. They
  remain disabled, and the implementation leaves them unspecified. This avoids presenting
  audible decay as physical key release or inventing notation.
- **Written notation is separate from audible duration.** A duration change records
  `notation_duration` with the previous written value; score construction and the editor
  use `notation_duration` when present. Pedal-extended sound cannot silently lengthen the
  written note.
- The expression policy is separate from note-correction qualification. An enabled
  category must be implemented by the current runtime, human-qualified, have enough
  distinct held-out performances and individual attribute corrections, meet precision
  and have zero measured damage. Missing target/outcome/damage evidence blocks
  qualification. The policy carries an implementation fingerprint for the estimator,
  verifier/settings, weights/model/decoder and application code.
- Phase 4 runs in a **separate process after the phase-3 working notes exist**, using
  their exact event IDs and proposal hash. It has its own 90-second limit. A phase-4
  timeout, crash or application exception leaves the phase-3 working result and report
  intact with expression status unavailable.
- Automatic expression changes are recorded in the same correction history with
  source `automatic-expression`, original value and policy digest, so rollback restores
  the baseline notes. Server and browser histories both allow 2,000 records. Duration
  analysis receives all notes as context even though the first 500 are refined, so a
  later same-pitch repetition can bound an earlier tail.
- The normal editor shows the improved duration/velocity directly. The optional banner
  exposes the original comparison and correction history; no approval of individual
  technical findings is required.

The checked-in expression policy has **zero enabled categories**, so the default
configuration applies no phase-4 changes. Pedal/key-release and written-rhythm
implementations and human qualification remain outstanding; no claim is made for them.
The diagnostic-first contract is documented in
[music-expression-report-contract.md](music-expression-report-contract.md): candidates,
abstentions, coverage, target units and independent analysis switches are reported even
when every automatic category is disabled. `benchmark_piano_expression_v2.py` emits
reference-based trials, while the old audit remains frozen as a regression baseline.
Relative attack level is diagnostic only; it is not converted to MIDI velocity without
an applicable calibration.

Expression qualification is category-specific. The required reference targets are:

- `audible_duration`: measured acoustic release/end time in a synchronized reference
  recording, not MIDI key-release time; tolerance is ±80 ms or one analysis hop,
  whichever is larger.
- `relative_dynamics`: isolated-strike level relative to the performance median in dB,
  with a tolerance of 3 dB and the applied velocity change limited to that relative
  factor. Notes overlapping another attack/sounding note are not eligible.

A real held-out study must cover multiple pianos, rooms, noise floors, repeated notes,
overlapping chords and clipped recordings. No such completed human benchmark exists in
this repository, so the checked-in policy remains disabled and the phase-4 delivery is
partial.

```powershell
.venv-saas/Scripts/python.exe scripts/qualify_piano_expression.py `
  --report <human-expression-benchmark.json> --evidence-kind human `
  --require-qualified --output docs/qualification/piano-expression-policy.json
```

The reference benchmark is built by
`scripts/benchmark_piano_expression_v2.py`; correctness and damage are derived from
`reference_value`, `before`, `proposed` and `tolerance`. The older
`scripts/benchmark_piano_expression_baseline.py` is retained to reproduce the frozen
audit.

The input contains held-out `cases` with a `category`, `suggested`, `improved` and
`damaged` flag. A category without enough human evidence or with any damage remains
disabled. `pedal`, `key_release` and `written_rhythm` cannot be enabled until they have
an implementation and their own evaluation.

The report is deterministic for identical inputs apart from runtime. The proposal is
identified by a canonical SHA-256 of its events, so a report cannot be applied to a
changed proposal.

## Measured evaluation

Method: `scripts/benchmark_piano_verification.py` renders eight-second piano mixtures
from locally supplied recorded samples (same generator as the decoder benchmark), with
39 known notes per case including chords, genuine octaves, dynamics, fast same-pitch
repeats and overlapping tails. Four development seeds were used while tuning; four
held-out seeds were not. Each case feeds:

1. the clean reference notes as a proposal (damage check: any suggestion is wrong);
2. the natural Basic Pitch piano-peaks decode;
3. one controlled corruption per scenario (delete, insert, octave substitution,
   onset shift by 100 ms, duplicate, merged repetition).

The benchmark now applies proposed edits through the same
`apps/api/music_corrections.py` eligibility, precondition, all-or-nothing and generated-ID
path used by automatic handoff. It records per-correction trials and identity-based damage
rather than only aggregate matched-note counts. It reports
errors fixed, correct notes damaged, remaining missing/extra errors and onset changes,
including merge and split operations. The latest eight-case smoke run:

| Scenario (8 attempts each) | Finding detected | Suggested | Proposal improved | Correct notes damaged | Mean time |
|---|---:|---:|---:|---:|---:|
| Clean reference proposal | — | 0 | — | 0 | — |
| Deleted note | 37.5% | 0% | 0% | 0 | 0.81 s |
| Inserted note | 12.5% | 12.5% | 12.5% | 0 | 0.73 s |
| Octave substitution | 0% | 0% | 0% | 0 | 0.78 s |
| Onset shifted by 100 ms | 12.5% | 12.5% | 12.5% | 0 | 0.84 s |
| Duplicate event | 62.5% | 62.5% | 0% (5 conflicts) | 0 | 0.73 s |
| Merged repetition | 0% | 0% | 0% | 0 | 0.85 s |
| Natural decoder proposal (8 clips) | — | 0 edits | errors 77 → 77 | 0 | 0.8 s |

"Proposal improved" means the matched error count fell without losing an already
matched note. "Correct notes damaged" counts a decrease in one-to-one matched notes
after applying all suggestions; the clean-reference row is the direct false-edit
measure.

These are eight generated clips from one sample bank, not human performances. The table
is descriptive only: qualification uses the per-correction `correction_trials` with
identity-based damage, including clean/natural material, rather than these case
aggregates. The strictness added after review reduced recall further: deleted-note detection is 37.5%,
onset shifts 12.5%, merged repetitions 0% and octave substitutions 0%, while duplicate
detection remains 62.5%. No suggestion was applied to the clean reference notes or the
natural decoder proposal, and no proposal lost a correctly matched note in this run.
Five duplicate-event proposals were withheld from combined application by the
all-or-nothing conflict check rather than falling back to partial application. That is a
safety observation, not evidence of improved transcription.

On the four held-out seeds the verifier detected 2/4 deleted notes and 3/4 duplicate
events, and suggested an edit for 1/4 inserted notes and 0/4 shifted onsets or merged
repetitions. Development and holdout behaviour differ materially at this sample size;
the split remains too small for a generalisation claim.

This is a diagnostic result, not evidence that the stage improves transcription. The
next benchmark must use human performances, synchronised MIDI, and separate tuning and
evaluation recordings.

Runtime is about one second per eight-second clip on this host, single process,
including the report write. The verifier has a 100-second internal budget and the
adapter runs it in a separate process with a hard 120-second timeout; a timeout leaves
the baseline proposal untouched.

### User clip observation

On the existing 14.677-second uploaded excerpt, the verifier produced two
`unresolved` missing-pitch findings around C#6 (1.985 s and 2.4 s), both matching
notes that the decoder did not emit, and proposed no edits. The harmonic guard keeps
them unresolved because the surrounding chord shares the same partials. This is the
intended diagnostic behaviour, not a correction.

## Known limitations

- The evaluation is sample-rendered, from one sample bank and related generated
  patterns. It does not establish accuracy on human performances, other pianos or
  noisy rooms. This is the main outstanding acceptance gap.
- Harmonic ambiguity is fundamental: octaves, twelfths and other integer-ratio
  cousins cannot be separated reliably from steady spectra. The verifier abstains.
- The fixed piano templates do not adapt per instrument in this phase; template
  mismatch creates residual energy that can look like a quiet note. The guards reduce
  this but do not eliminate it.
- Bass timing is less certain because the low-pitch analysis window is long.
- Pitch insertion, deletion and substitution are deliberately diagnostic-only in this
  phase; only timing and duplicate categories emit suggested edits.
- Phase 1/2 diagnostics make no pedal, key-release or written-rhythm inference;
  phase-4 audible duration and relative dynamics are separate and disabled by default.
  There is no beat/chord quantization.
- Owner review highlights the piano roll, keyboard and note fieldsets; the separate
  notation editor is not linked to findings in this phase. Accepted suggestions modify
  the unreviewed working copy only, never a reviewed revision or release.
- Verification runs in a separate process with a 120-second timeout and bounded region,
  note, atom and matrix limits. Work beyond those limits is reported as partial/skipped;
  it is not a claim that unchecked passages passed.
- The phase 3 automatic-application path is implemented but **no category is
  qualified**. The checked-in policy is intentionally disabled until a real held-out
  human-performance study meets the precision, sample-size and zero-damage limits.
- Phase 4 currently implements and can gate audible duration and relative dynamics;
  pedal/key-release and written-rhythm estimation are not implemented. All phase-4
  categories are disabled in the checked-in policy, so uncertain attributes remain
  unspecified rather than invented.
- Template/tuning sensitivity perturbations were removed from the prototype rather
  than advertised. No conclusion is currently qualified by a perturbation study.
- Thresholds were selected on four development cases. They are versioned in the
  report's settings hash and must be re-evaluated on a larger, independent benchmark.
- The three original web tests were extended with working-edit and parser coverage, but
  there is still no browser-level test of the parent review screen against a live API.

## Reproduction

Prepare a verifier-enabled profile (existing weights and commercial evidence, new
output directory):

```powershell
.venv-saas/Scripts/python.exe scripts/prepare_piano_decoder_profile.py `
  --weights music-candidate-run/basic-pitch-0.4.0/model.onnx `
  --evidence music-candidate-run/basic-pitch-0.4.0/commercial-evidence.txt `
  --output <new-profile-directory>
```

The profile copies `adapter.py`, `piano_verifier.py` and `config.json`, and records
the verifier code and settings digests. Start the piano worker with that profile as
described in `docs/qualification/piano-peak-decoder-2026-11-11.md`.

Standalone diagnostic run against an existing artifact:

```powershell
.venv-music/Scripts/python.exe scripts/piano_verifier.py `
  --audio analysis.wav --reference reference.json --activations raw.npz `
  --output verification.json
```

Benchmark (needs Basic Pitch and the local sample bank):

```powershell
.venv-saas/Scripts/python.exe scripts/benchmark_piano_verification.py `
  --samples music-candidate-run/editors/riffscore/demo/public/audio/piano `
  --weights music-candidate-run/basic-pitch-0.4.0/model.onnx `
  --output .local/piano-verification --cases 8
```

On this host the music dependencies are isolated; the worker documents the working
launcher (`.venv-saas` with `PYTHONPATH` pointing at
`.venv-music/Lib/site-packages`).

## Next steps

For the current expression implementation, public-reference evaluation, original-clip
result and remaining accuracy criteria, see the
[12 November implementation report](qualification/piano-expression-implementation-2026-11-12.md).
Bounded template adaptation and conditional calibrated velocity application described
below are now implemented; their automatic policies remain disabled pending qualification.

1. Larger independent benchmark with human performances and synchronized MIDI,
   reporting flag precision/recall, suggestion correctness, damage and abstention per
   category. The phase 3 gate is implemented but requires this evidence before it can
   enable a category.
2. Optional linking of findings into the notation editor and a side-by-side original /
   revised diff.
3. Template adaptation from reliable isolated notes, with bounded changes and visible
   template-mismatch uncertainty.
4. Audible-duration findings (not key release), then separately qualified dynamics.
5. Run `scripts/qualify_piano_corrections.py --evidence-kind human` on the untouched
   human benchmark; enable a category only if the generated policy passes and the
   prepared profile is installed deliberately. Do not enable categories by hand-editing
   the policy.
