# Independent review of the measurement implementation — 12 November 2026

## Verdict and verified scope

The implementation is useful progress, but the measurement plan is **not complete as software**. Remaining gaps can misclassify unknown evidence, inflate success rates or declare improvement despite a newly wrong note. Fix these before trusting the scorecards or asking the user to judge an improved transcription.

Independently reran the six new measurement test files: **74 passed**. The listening-study file contributes another **30 passed**, reproducing the claimed **104 measurement-path tests**. The reported 767-pass full-suite result was not independently rerun in this review. Passing the existing tests does not resolve the counterexamples below.

The DP matcher, explicit legacy path, null empty/empty scorer behavior and performance-nested paired-listening machinery are present. Human annotations/listener data, real renderer evidence and a corrected real candidate remain absent as the developer disclosed. Those missing inputs are distinct from the software defects below.

No application source was modified during this review. Independent probes and results are saved in `.local/repo-research/review_round3_quality.py` and `round3-independent-probes.json`; test logs are `round3-independent-focused.log` and `round3-independent-listening.log`.

## Required fixes

### 1. P1 — Unknown reference is being scored as verified silence

Locations: `scripts/benchmark_piano_quality.py:evaluate`, `scripts/piano_quality_events.py:score_events`, `scripts/report_piano_quality.py:_event_metrics`, `scripts/piano_quality_expression.py:pedal_scores` and `scripts/piano_quality_reference.py:from_captured_midi`.

The user's stored scorecard has reference pitch/onset status `unavailable`, but its coverage says `extra: 34`, `false_activity_notes: 34`, `missing: 0`. That is not a valid finding about this music. An absent transcription is not evidence that the recording contains no notes. The Markdown also gives the reason “reference has no notes,” which incorrectly implies verified silence.

A separate direct probe with unavailable pedal reference and one predicted pedal-on event returns `status: measured`, one false transition and 1.4 seconds of false-on time. The captured-MIDI importer unconditionally marks pedal `verified`, including when its filtered controller list is empty.

Required: gate event/expression scoring on attribute evidence before calling empty-list scorers. Distinguish verified silence/off state from unavailable data. With unavailable references, error counts, false-activity counts and accuracy values must be null/unmeasured; candidate count can still be reported as an observation. Preserve uncertainty masks so candidates near unresolved reference notes are not automatically declared extra. Missing MIDI controller capture cannot become verified pedal-off without explicit capture/default-state evidence.

Regressions: unavailable reference plus 34 predictions reports “34 detected; correctness unknown”; verified empty reference plus predictions still reports real false activity; unavailable pedal plus predicted transitions stays unscorable.

### 2. P1 — “All-reference” duration/velocity rates exclude missing notes

Location: `scripts/piano_quality_expression.py:release_scores`, `audible_end_scores` and `velocity_scores`.

These scorers construct their denominator from the matched `pairs`, not the full scorable reference population. In an independent four-note reference with just one correctly matched candidate, velocity and release both report `reference_notes: 1` and `all_reference_within_tolerance: 1.0`. The correct all-reference result is one of four, or 25%, with three unmatched notes disclosed.

Required: derive the scorable reference population independently of matching. Separate unmatched notes, matched notes missing an attribute, uncertain reference attributes and conditional measured pairs. Keep conditional MAE, but calculate all-reference success over every eligible reference note. Removing a difficult note must not improve coverage or hide a failure. Apply the same rule to audible endings.

### 3. P1 — A wrong added note can coexist with `improvement_established: true`

Locations: `scripts/report_piano_quality.py:outcome` and its caller in `build`; `scripts/benchmark_piano_quality.py:evaluate`.

The report uses `primary['tolerance']` as the minimum change required to identify a regression. For pitch F1 that field is **0.050 seconds**, the onset-matching window. It becomes a **0.05 F1-point threshold**, mixing units and concealing small event regressions.

Reproduced with a correctly source-bound 40-note example: baseline F1 1.0, final F1 0.987654 after adding one wrong note; velocity MAE improves from 10 to 0. The report calls pitch `unchanged`, velocity `improved`, and sets `improvement_established: true`.

Required: separate matching tolerance, reference uncertainty, material baseline-error definitions and metric-change thresholds, each with correct units/version. Explicitly adjudicate new missing/extra/wrong notes and edit-level damage; do not allow an F1 deadband or another category's gain to hide them. Separate a descriptive improvement on one clip from corpus-level qualification. Add the reproduced tradeoff regression and ensure it cannot authorize an improvement/activation claim.

### 4. P1 — An uncertain, arbitrarily wide ending interval earns full success

Location: `scripts/piano_quality_expression.py:audible_end_scores`.

The scorer accepts candidate status `uncertain` and counts any overlap with the reference interval as an accurate ending. A candidate interval 0.2–1.5 seconds marked uncertain scores 100% inside a reference interval 0.9–1.0 seconds, with zero uncertain-candidate count.

Required: do not treat uncertain predictions or overlap as a precise ending estimate. Score a defined point estimate against the independent valid interval, or implement a separately versioned uncertainty-aware interval metric that cannot improve by widening the predicted interval. Track abstention/interval width and all-reference coverage; uncertain candidates cannot establish a precise correction. Include disjoint, touching, partly overlapping, enclosing and very wide intervals in tests.

### 5. P1 — Source identity, scored interval and metric configuration are not enforced end to end

Location: `scripts/benchmark_piano_quality.py`, plus reference/scorecard identity validation.

A candidate declaring source hash `bbbb…` is accepted against reference hash `aaaa…`; the note score is labeled `measured`. Event scoring includes every candidate event instead of applying the declared scored interval. Audio rendering/scoring calls the harness without forwarding that reference interval. The `tolerances` argument is passed to reporting but not to event matching or expression scoring: a probe reports a 10 ms matching tolerance while accepting all four notes displaced by 30 ms.

Required: verify the complete source and candidate provenance chain before measured comparisons. Validate selected baseline/final IDs. Define and apply one source-time interval/carry-in policy to every candidate and every modality. Bind the supplied audio to the quality reference, not only to each candidate's performance document. Load one frozen, versioned metric configuration and pass its actual thresholds to scorers and reports; reject incompatible overrides instead of relabeling default-scored numbers. Bind source/reference/model/decoder/renderer/config/implementation identities in receipts and reject stale or mismatched evidence.

### 6. P1 — Before/after audio comparison is calculated then discarded

Locations: `scripts/benchmark_piano_quality.py:_audio_comparison` and `evaluate`; `scripts/report_piano_quality.py:build`.

The runner computes both baseline and final audio comparisons but passes only `audio['final']` into reporting. The scorecard then hardcodes audio baseline to null. A supplied A/C pair therefore cannot produce an audio delta. It also loses the absolute-level comparison and detailed renderer/qualification identity when reducing the harness report to one normalized objective.

Required: retain baseline and final delivered-audio reports, all components, absolute and normalized views, scored intervals, gains, renderer/asset identities, capability limitations and artifact hashes. Report diagnostic before/after changes even while the renderer remains approximate, clearly distinct from qualification. With one candidate, call it the measured candidate; do not manufacture a corrected final. Preserve actual audio/listening evidence requirements for fidelity claims.

### 7. P1 — Reference onset uncertainty is recorded but ignored by scoring

Locations: `scripts/piano_quality_reference.py:merge_annotations`, `_pitch_event`; event extraction and `scripts/piano_quality_events.py`.

Two reviewers can disagree by up to 50 ms, producing a verified midpoint with uncertainty up to 25 ms. The event scorer then ignores `onset_uncertainty_seconds` and reports strict 20 ms success/failure using that midpoint. The validator also checks that onset uncertainty is finite but does not reject negative values.

Required: validate nonnegative uncertainty and carry it through the canonical correspondence/evidence contract. Define how uncertainty affects detection versus fine-timing scoring. References that cannot adjudicate a 20 ms boundary cannot qualify that timing correction; report ambiguity and reduced scorable coverage rather than false precision. Keep negative/too-large/boundary uncertainty regressions separate from ordinary matching tests.

### 8. P2 — Pedal crops lose carry-in state and binary scope is not enforced

Locations: `scripts/piano_quality_reference.py:from_captured_midi` and `scripts/piano_quality_expression.py:pedal_scores`.

The importer retains controller events only inside the scored interval. A pedal pressed before the interval and lifted inside it loses its initial down state; state evaluation starts from an assumed zero. The binary scorer also needs explicit rejection/diagnostic handling of continuous or unsupported pedal semantics, and the runner currently scores only the default sustain trajectory.

Required: carry the independently known state at interval start into the reference and candidate, preserve parent trajectory identity, and score only the declared binary scope. Report sustain/soft/sostenuto separately where supported. Continuous values require the separate calibration/reference contract; do not silently threshold them. Test a crop entirely inside pedal sustain, a lift inside the crop and unavailable controller capture.

### 9. P2 — The scorecard omits or misrepresents required results

Locations: `scripts/report_piano_quality.py` and candidate adapters in `scripts/benchmark_piano_quality.py`.

The low-level scorers calculate more than the scorecard retains. The report needs baseline/final precision/recall and missing/extra counts, p95 and bias, genuine all-reference rates, pedal state/false-on/off evidence and per-category uncertainty. The velocity-within-rate row explicitly passes no baseline even when one exists. Audible-end reporting keeps an inside rate but drops the primary outside-interval error measure. Candidate MIDI loading drops its available expression fields by returning `document: None`.

Required: complete the promised per-category scorecard rather than presenting only a primary mean/F1. Preserve all applicable candidate fields with explicit semantics and provenance; do not promote an AI MIDI note-off into captured physical release. For genuinely absent fields, report unavailable. Include clear candidate A/B/C roles and distinguish conditional from population metrics. Define primary outcomes by the acceptance contract, not whatever scalar happens to be the first row.

### 10. P2 — Reference preparation and listening provenance still need evidence guards

Locations: annotation import/adjudication and parent mapping in study construction/analysis.

The human-work disclosure is correct. However, `merge_annotations()` can label agreement verified without distinct reviewer identities or retained review receipts; reviewer fields in templates are not checked. Parent performance IDs likewise need the canonical recording/reference registry and receipt chain, not just an “explicit” string to establish verification. Performer-level hierarchy and stale-receipt rejection are already acknowledged as partial and remain required before qualification.

Required: preserve reviewer/capture/adjudicator identities, input annotation hashes and decisions. Independently assigned human reviews cannot be inferred from two supplied lists. Bind verified parent recording/performance mappings to registered source evidence, retain legacy diagnostic mode where unknown, and implement the promised performer hierarchy for the claimed domain. Do not fabricate human annotations or listeners to close these gates.

## Suggested order and delivery expectations

1. Correct unknown-state handling, full-population denominators, uncertainty treatment and the damage/improvement guard first.
2. Enforce source/interval/config identities and complete before/after audio and scorecard plumbing.
3. Reproduce the above cases as integration regressions—not only isolated scorer tests—and rerun the focused and full suites.
4. Regenerate both real scorecards. The user's 34 notes should become **detected notes of unknown correctness**, never 34 proven false notes. Keep Vienna diagnostic until its alignment/reference scope supports stronger conclusions.
5. Retain the original reports as historical artifacts; issue corrected scorecards with metric/report version or implementation identity changes. Do not silently overwrite historical qualification evidence.
6. Complete the human/evidence exits and compare an actual corrected candidate with its unchanged baseline before claiming improvement.

The useful conclusion today is: **measurement components exist and the tested cases pass, but the connected evaluation can still produce misleading conclusions. No better transcription of the user's clip has been demonstrated.**
