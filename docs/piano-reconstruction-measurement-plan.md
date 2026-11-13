# Piano reconstruction measurement and acceptance plan

Date: 12 November 2026  
Status: implementation plan; no new accuracy results claimed

## 1. Objective

Build a reproducible evaluation system that answers, separately for notes, timing, note lengths, dynamics, pedal and piano sound:

1. How close is the unchanged AI output to the original performance?
2. How close is the final corrected result?
3. What improved, what became worse, and what stayed unchanged?
4. How much of the recording could we evaluate reliably?
5. Is the evidence sufficient to enable a correction category in the product?

The long-term product objective remains an editable reconstruction that reproduces the uploaded performance and sound as closely as possible. This measurement work makes progress toward that objective demonstrable. Passing software tests is necessary, but does not answer these musical questions.

**Primary deliverable:** a versioned before/after quality scorecard, backed by event-level decisions, audio measurements and independent reference evidence. Deliver this scorecard for the user's existing piano clip before describing its transcription as improved.

Do not invent a single overall percentage. Report exact, scoped percentages where a meaningful denominator exists, physical errors such as milliseconds and MIDI units, and listening results with uncertainty.

## 2. Current gap and work to retain

The repository already has useful components. Extend them instead of replacing them:

| Existing component | Reuse | Remaining measurement work |
|---|---|---|
| `scripts/qualify_music_model.py` | Reviewed-reference validation, one-to-one event scoring and model qualification helpers | One shared correspondence contract across complete before/after scorecards |
| `scripts/benchmark_piano_recordings.py` and `scripts/benchmark_piano_velocity.py` | Paired-recording and velocity experiments | Common candidate runner, consistent references, population coverage and aggregate reports |
| `scripts/piano_performance.py` | Separate key release, audible end, notation, captured velocity, renderer intensity and pedal | Evaluation reference and uncertainty contract; do not collapse these fields |
| `scripts/piano_reconstruction_harness.py` | Bound source identity, comparison intervals, delivered WAV, latency and diagnostic qualification | Orchestrate baseline/final comparisons and expose target-specific quality/evidence results |
| `scripts/piano_reconstruction_metrics.py` | Objective v2: spectral, attack, loudness, pitch-class, octave-band and decay diagnostics | Independent event evaluation, stereo/room evidence and calibrated interpretation |
| `scripts/prepare_vienna_dataset.py` | MIDI inventory, identity and split validation | More actual audio/MIDI pairs and independently verified alignment |
| `scripts/probe_sampler.py` and `scripts/piano_render.py` | Sampler diagnostics and rendering interface | A real, pinned renderer adapter and measured capability evidence |
| Listening-study builder, analyzer and `tools/listening-instrument/` | Blinded public bundle, paired analysis and stimulus verification | Real participant data; performance-level clustering; confirmatory protocol remains separate |

Current evidence is **693 passed / 14 skipped** software tests and a diagnostic run on the 14.6773696-second clip with a cached 34-note proposal. Its audio objective, **0.596754**, is not a match percentage or a demonstrated improvement. The renderer is approximate. No before/after musical-accuracy scorecard exists for that clip.

See `docs/qualification/piano-reconstruction-followup-fixes-2026-11-12.md` for the verified implementation state. Existing acceptance requirements in `docs/piano-reconstruction-acceptance-v1.md` remain authoritative; this plan operationalizes them rather than weakening them.

### Implementation clarification following developer review

Inspection confirms two current scorer behaviors do not meet this plan: `score_events()` maximizes ordered match count per pitch but does **not** minimize total onset distance among equally large matchings; it also reports F1 = 1 for empty/empty inputs. M2 therefore includes a **versioned scorer behavior change**, not a wrapper around the current scorer. The existing listener/excerpt bootstrap also needs a versioned performance-aware analysis change. These are implementation deliverables, not already available capabilities.

## 3. Two evaluation modes—both are required

### Mode A: independent-reference benchmark

Use recordings with independently checked reference events. A reference may provide some attributes and leave others unknown.

- Pitch/onset: checked transcription or independently validated captured MIDI.
- Physical key release and captured MIDI velocity: synchronized instrument capture or another independently established reference. Listening alone may not reveal them, especially under sustain.
- Audible ending: independently annotated time intervals; captured MIDI note-off is not an audible-ending annotation.
- Pedal: captured controller trajectory or independently adjudicated annotations with uncertainty.
- Sound: the original recording, at its declared interval and processing identity.

This mode can establish note accuracy, correction precision, damage and qualification. Another model's output is a candidate or supporting diagnostic—not ground truth.

### Mode B: source-only upload diagnostics

An ordinary user provides only a video. Compare baseline and final renders with its extracted original audio, and report the supported acoustic diagnostics and processing coverage.

Do not claim exact pitch recall, physical key-release accuracy or captured MIDI-velocity accuracy without a suitable independent reference. Model agreement is not a substitute. Source-only checks can reject obvious inconsistencies and support independently qualified correction policies; a reduced reconstruction objective alone cannot authorize arbitrary edits.

No user should need to upload MIDI or inspect the comparison script. Public paired data is for development and qualification. Routine analysis and qualified corrections run automatically in the background.

## 4. Freeze reference, alignment and candidate identity first

Create `piano-quality-reference-1` with:

- Source audio/video hashes, duration, channels and sample rate; explicit scored interval.
- Mapping from original-video time to extracted/trimmed analysis time, including trim start and declared resampling. Verify this mapping; do not assume the previously observed trim applies to every job.
- Stable performance, performer, recording, work and reference-event IDs.
- Per-attribute reference value or interval, units, provenance, reviewer/capture identity, uncertainty and status: `verified`, `uncertain` or `unavailable`.
- Rights-clearance receipt and dataset revision for external references.
- Independent alignment method, fixed offset and any measured drift, with uncertainty. Duration agreement alone does not verify alignment.
- Reference version/hash, annotation revision and development/calibration/holdout assignment.

Reject invalid pitches, impossible orderings, nonfinite values, duplicate identities, broken note pairing and source/interval mismatches. Do not require monophonic behavior: legitimate same-pitch retriggers and polyphony must remain representable.

For the user's clip, prepare pitch/onset annotations independently of the final candidate. Use two reviewers and adjudicate disagreements, or explicitly record uncertain regions. Checked model-assisted suggestions may accelerate annotation, but remain unverified until reviewed. Do not fill unknowable key release or velocity with the AI estimate.

User clip annotations are development material: the clip has already been inspected and cannot become untouched qualification data.

Freeze and retain these candidates:

| ID | Purpose |
|---|---|
| A | Current production model/decoder output, unchanged |
| B | Each alternative model/decoder, unchanged; use exact approved package/checkpoint identities |
| C | Selected model output plus corrections; preserve every proposed/applied/withheld change |

For the correction comparison, render the selected model alone and its corrected counterpart with **the same renderer and settings**. This isolates correction benefit. Separately compare the complete new system with the existing product, disclosing renderer changes. Retain no-change and unsupported cases.

No dynamic time warping or per-note realignment is permitted in the primary timing score. Correct independently established source alignment and declared renderer latency only. Keep unadjusted measurements too. Do not fit timing from the candidate being evaluated.

## 5. Per-category measurements

### 5.1 Pitch and note-event detection

Use deterministic maximum-cardinality, one-to-one matching at exact MIDI pitch within a frozen **50 ms onset window**, minimizing total absolute onset distance among equally large matchings. Reuse the existing event validation and qualification/report infrastructure, but replace the matching primitive on the new measurement path. The current two-pointer matcher has no minimum-distance tie-break and must not be described as already satisfying this requirement.

Implement a canonical per-pitch dynamic program over onset-sorted events: maximize matched-pair count first, then minimize summed absolute onset distance, then apply a documented deterministic tie-break for exact ties. Backtrack and return reference/candidate IDs and signed onset errors; the same returned correspondence feeds every downstream attribute scorer. Preserve original IDs through validation—the existing normalized event loader alone does not retain them. An equivalent proven algorithm is acceptable, but no independent greedy implementation may compete with the canonical scorer. Bound/profile the per-pitch state space and never silently truncate notes or fall back to different matching semantics for long files.

Introduce `piano-event-metrics-2` (or an equivalently explicit version) for the matcher, empty-case rules, tolerance and aggregation contract. Preserve the legacy scorer/results as an explicitly identified legacy path when reproduction is needed. Update new consumers, corpus aggregates, command-line formatting, scorecards, implementation hashes and qualification receipts together. Historical numbers and approvals do not migrate automatically: re-score baseline and candidate under the same new version, retain the old receipts, and re-establish affected qualification evidence. Never compare a legacy baseline MAE with a v2 candidate MAE.

Required tie-break regression: same-pitch reference onsets at 1.000 and 1.040 seconds, with one candidate at 1.035 seconds. Both policies match one note; the new policy must select 1.040 and report 5 ms absolute error, whereas the current ordered greedy pairing reports 35 ms. Also test repeated events, exact ties, global cardinality versus nearest-first choices, and input ordering invariance under stable IDs.

Report:

- Matched notes, missing notes, extra notes, reference count and candidate count.
- Precision = matched / candidate count; recall = matched / scorable reference count; F1.
- Missing and extra counts per 100 scorable reference notes.
- Wrong-pitch, octave and repeated-strike diagnostics where independently adjudicable. Do not present an inferred missing/extra pairing as a proven pitch substitution.
- Separate bass/treble, isolated/polyphonic, repeated-note, quiet/loud and pedal scopes.

The new scorer must implement these empty-case semantics explicitly; this changes current behavior:

| Reference / candidate note counts | Precision | Recall | F1 | Additional result |
|---|---|---|---|---|
| Both zero | `null` | `null` | `null` | Note accuracy not applicable; evaluate silence separately |
| Reference positive, candidate zero | `null` | 0 | 0 | Every reference note is missing |
| Reference zero, candidate positive | 0 | `null` | 0 | Every candidate note is extra; report false activity |

For nonempty combined counts, calculate F1 directly as `2 × matched / (reference_count + candidate_count)`. Each metric carries its own applicability and denominator. A denominator-free precision/recall is not silently replaced with 1. Corpus aggregation must pool event counts for micro metrics and separately report macro means over applicable cases, their case counts and silence/false-activity results. Nulls cannot enter arithmetic/formatting as zeros or 100%; tests must cover JSON, CLI and aggregate reports as well as the core scorer.

Pitch/onset F1 is a tolerance-based event-detection percentage. It does not measure correct duration, dynamics or identical sound.

### 5.2 Rhythm and onset timing

For matched notes report signed bias, mean/median absolute error, 95th-percentile error, and percentages within **20 ms** and **50 ms**. Report local inter-onset-interval error using stable reference-event correspondence; preserve expressive timing instead of quantizing the reference to a beat grid.

The 50 ms detection window truncates the matched timing distribution. Disclose that conditioning and retain missing/extra notes in the scorecard. The headline within-20-ms rate must also use all scorable reference notes, counting missed/wrong-pitch notes as failures. Wider-window alignment may be shown only as a separately labeled diagnostic.

Freeze correspondence for all attributes within a candidate. For before/after expression comparisons also show the common-reference-note set, changed correspondences, lost matches and new matches. Do not improve timing MAE by deleting difficult notes or rematching repeated strikes invisibly.

### 5.3 Key release and audible duration

Keep three distinct targets:

1. Physical key release: compare with synchronized captured release, when available.
2. Audible ending: compare with the independently annotated acceptable interval.
3. Written rhythm: a separate notation interpretation; do not score it as acoustic key release.

For key release, report mean/median/p95 absolute error and percentage within **80 ms**, plus reference uncertainty. For audible ends, error is zero inside the accepted interval and distance to the nearest boundary outside it. Report the percentage inside the interval and the outside-interval errors.

Break out pedal-held notes, retriggers, overlapping partials and clip boundaries. End-censored notes cannot be treated as fully observed endings. Uncertain references remain unscorable for that attribute. If reference uncertainty cannot resolve the material-error threshold, do not use it for correction qualification.

### 5.4 Velocity and relative dynamics

Captured MIDI velocity is a 1–127 instrument value; renderer intensity and audible level are different quantities. Never turn Basic Pitch activation amplitude into captured-velocity ground truth.

With appropriate paired MIDI, report velocity MAE/median/p95 in MIDI units, signed bias and percentages within **8** and **16** units. Break out pitch register, attack level and polyphony. Evaluate source-piano calibration separately from cross-piano generalization.

For source-only audio, report relative attack-level and short-term loudness diagnostics only in supported, qualified scopes. Mask or abstain for interfering attacks, shared harmonics and compression effects that prevent attribution. Label these acoustic dynamics diagnostics; do not call them MIDI-velocity accuracy.

Report conditional errors on scorable matched notes **and** all-reference success/coverage. A missing note or missing candidate velocity cannot disappear from the population by being omitted from MAE. Never use per-note loudness matching to hide dynamics errors.

### 5.5 Pedal

For verified binary pedal, report transition precision/recall/F1, transition timing MAE/p95, percentages within **50 ms**, false transitions and time-weighted state agreement. Separate sustain, soft and sostenuto.

Report false-on and false-off time separately: a mostly pedal-off excerpt can make always-off agreement look deceptively strong. No controller data is `unavailable`, not an explicit pedal-off reference.

Continuous/half-pedal needs validated continuous capture and a separately calibrated acoustic/control interpretation. Keep it unsupported until qualified; do not silently binarize it.

### 5.6 Rendered piano sound

Score the **delivered WAV**, not only the synthesizer's floating-point buffer. Require complete interval coverage and disclose clipping, latency, gain, tail handling and channel processing.

Retain objective v2's six components separately. Report baseline, final and signed/relative change. Keep absolute-level and normalized views. For correction-only comparisons use the same independently established global gain/instrument profile; any candidate-fitted gain/profile is a separate analysis with its value disclosed. Do not let fitted gain conceal dynamics errors.

Add stereo diagnostics before claiming stereo/room coverage: channel-level balance, stereo correlation/width and mid/side spectral differences. Room/reverb estimates remain diagnostics unless independently validated; a mono objective cannot certify room equivalence. Version these additions rather than overwriting objective v2 evidence.

Waveform error or SI-SDR may be supplementary under defined alignment conditions, but phase differences between piano renders make them unsuitable as a universal musical-quality score. No waveform/objective metric becomes a perceptual percentage by multiplication or subtraction from 100.

### 5.7 Perceived similarity

Use the existing blinded instrument with hidden reference, degraded anchor, model-only, corrected and current-product controls. Preserve source attribution and private decoding keys.

The development pilot remains **12 listeners / 24 excerpts from at least 12 performances**, as required by the existing acceptance plan. A slider mean is a **similarity rating out of 100**, not a percentage of identical sound or a probability of indistinguishability.

Predeclare paired comparisons and report clustered 95% confidence intervals. Cluster by listener and independent performance, with excerpts nested in performance; several windows from one recording are not independent performances. Extend the current listener/excerpt analysis accordingly.

This is a substantive M5 analysis change. Add canonical `performance_id` and `recording_id` to analyst study items, backed by the reference registry and parent-source identity; map excerpts to those parents. Do not invent a different performance ID for each excerpt. Include the mapping, sampling/weighting policy and new analysis/protocol version in immutable study/analysis identity. Old studies lacking a verified parent mapping remain legacy diagnostic studies until explicitly migrated; never assume their excerpts are independent performances.

Define the paired estimand and weights before collecting data. For the initial balanced pilot, give performances equal weight and average paired candidate-minus-baseline differences over the assigned, scorable excerpts within each listener/performance cell. Bootstrap listeners and performances as crossed top-level units, retaining the same selections for baseline and candidate; if excerpt sampling is part of the inference, resample excerpts **within their sampled parent performance**. Do not bootstrap all excerpt columns as independent performances. Respect any performer-level hierarchy required by the generalization claim. Freeze the precise missing-cell and nested-resampling rules with the study lead before the pilot.

Report independent listener count, performance count and nested excerpt count separately, and apply coverage gates to independent units. Tests must show that duplicating windows of one performance neither increases the performance count nor fabricates independent precision; use synthetic data with strong within-performance dependence and known paired effects. Retain real listener collection and statistical review as separate exit requirements: implementing the bootstrap is not a completed pilot.

A confirmatory indistinguishability claim requires the separate preregistered, powered protocol already specified in the acceptance plan. A small or nonsignificant listening result cannot establish equality.

## 6. Scorecard and evidence contract

Create `piano-quality-scorecard-1`. For every metric include:

- Metric name/version, units, direction and declared tolerance.
- Reference kind/hash, candidate identity, matching/alignment/renderer identity and scored interval.
- Baseline value, final value, absolute change and relative change where defined. A zero baseline error has no finite relative reduction; report absolute change instead.
- Numerator, denominator, supported/scorable coverage, missing predictions and all exclusions with reasons.
- Per-performance values, reference uncertainty and aggregate confidence interval when enough independent performances exist.
- Status: `not_measured`, `unscorable`, `diagnostic_only`, `measured` or `qualified_for_scope`. Include explicit reasons and scope. Missing inputs must never become zeros or a pass.

The human-readable report must answer the user's questions directly:

| Question | Required answer |
|---|---|
| Are the notes better? | Baseline/final F1 and missing/extra counts; corrected errors and introduced damage |
| Is rhythm closer? | Timing errors and all-reference percentages within tolerance; lost notes still visible |
| Are lengths closer? | Separate key-release and audible-ending results with uncertainty/coverage |
| Are dynamics closer? | Captured-velocity accuracy where supported; otherwise labeled acoustic diagnostics |
| Does pedal match? | Transition/state results or an explicit unavailable status |
| Does it sound closer? | Audio component changes and actual blinded listening evidence |
| What percentage matches? | Scoped within-tolerance/event percentages; no invented overall fidelity percentage |

A single-clip report is descriptive. Do not manufacture a population confidence interval by treating its notes or overlapping windows as independent performances.

## 7. Implementation packages and dependencies

Names below are proposed new modules, not claims that they already exist.

| Package | Implement | Completion evidence |
|---|---|---|
| M0 — Contracts | `scripts/piano_quality_reference.py`, scorecard schema and versioned metric/tolerance configuration | Invalid/uncertain inputs handled; units/identities/statuses validated; configuration frozen |
| M1 — Reference preparation | Pair registration, alignment receipts, annotation/adjudication import, clip reference and immutable corpus splits | Independently checked clip pitch/onsets; unavailable expression fields explicit; a small real development subset ready |
| M2 — Shared event scorer | `scripts/piano_quality_events.py`; replace the matching primitive with the versioned cardinality/distance DP, reuse validation/report infrastructure | Pair IDs, cardinality and minimum-distance tie-break, null empty-case semantics, aggregates/CLI migration and legacy reproduction verified |
| M3 — Expression scorer | `scripts/piano_quality_expression.py` | Release/ending/velocity/pedal scores, uncertainty handling and denominator protections verified |
| M4 — Candidate evaluation runner | `scripts/benchmark_piano_quality.py`; wrap existing adapters/benchmarks/harness | Same-input A/B/C outputs, unchanged baselines, identities, resource usage and full-length coverage preserved |
| M5 — Audio and listening evidence | Extend metrics/harness, add parent performance/recording IDs and versioned nested listening analysis | Delivered-audio comparisons; unsupported stereo/room explicit; hierarchy regressions; genuine pilot with paired performance-clustered results |
| M6 — Reporting | `scripts/report_piano_quality.py`; JSON plus Markdown scorecard | Complete clip report and corpus aggregate; no unsupported percentage or fabricated values |
| M7 — Qualification/integration | Scope-aware policy/evidence receipts, worker diagnostics and rollback | Enabled edits trace to independent passing evidence; seamless background workflow and reproducible final export |

M0 comes first. M1 and renderer acquisition can then proceed in parallel. M2/M3 can be developed against real reference events without a real renderer. M4's event comparisons do not wait for renderer selection; its audio comparisons do. M5's actual fidelity test requires a real renderer and actual listeners. M6 starts early and displays unavailable fields until evidence arrives. M7 activation waits for qualification.

Assign an evaluation owner to freeze references, tolerances and splits; an engineering owner for scorers/runner/receipts; two piano reviewers for clip annotation/adjudication; a renderer owner for actual capability and audio evidence; and a study lead for recruitment and statistical analysis. The developer owns arranging these inputs and reporting missing evidence. Do not make the user responsible for supplying MIDI or discovering quality regressions through manual trial.

### Software completion and human-evidence completion are separate

M1 has two exits: **M1a software**, the importer/validator, annotation templates, uncertainty representation and alignment/identity tooling; and **M1b evidence**, independently reviewed annotations, adjudication and signed reference records. The engineer can complete M1a without claiming M1b. The evaluation owner must assign actual reviewers, schedule their work and retain their review receipts. Unknown values may legitimately remain unknown; they cannot satisfy an annotation or qualification requirement.

Likewise M5 has **M5a software**, the instrument, hierarchy-aware analysis and verified stimulus pipeline; and **M5b evidence**, recruited real listeners, completed sessions, exclusions and the analyzed pilot. The study lead owns staffing/recruitment and statistical sign-off. No LLM, synthetic session or inferred label substitutes for either human exit. Unblocked software work proceeds in parallel; neither a software-only result nor a missing human input is labeled a completed evidence milestone.

Do not use a fake renderer, generated corruptions or invented listener scores to close the real-data exit gates.

## 8. Qualification and correction safety

Retain the existing acceptance policy, including:

- At least **95% analysis coverage** for scorable notes and supported source time.
- At least **20% useful natural-error correction coverage** and **20% relative primary-error reduction**, with the required clustered interval excluding zero.
- At least **95% observed correction precision**, zero measured damage under the category rules, and the existing minimum of **40 distinct contributing performances per enabled category**.
- Required performance/subgroup coverage and p95 regression limits from the acceptance document.
- At least **10% objective improvement** with clustered evidence, with no concealed pitch/rhythm regression.
- Full-system listening gain at least **10 points**, with clustered lower confidence bound above **5 points**.

These are provisional product acceptance requirements, not achieved results or scientific constants. Freeze them before holdout. If feasibility or pilot evidence requires changing them, record a new policy/version and use a fresh untouched evaluation; do not move thresholds after viewing holdout outcomes.

Aggregate paired deltas by independent performance; cluster by performer when several performances share a performer. Report the limited work/instrument/room domain. The Vienna proposal's 52-performance ceiling is not proof that enough performances contain qualifying edits, or that all paired audio is available.

Score correction precision and damage at edit level against independent reference, including insertions, deletions, onset/release/velocity changes and pedal changes. Retain no-change cases and rejected candidates in coverage denominators. An improvement in loudness or spectral error cannot compensate for a wrong inserted note or damaged rhythm.

The reference scorer belongs in offline evaluation/qualification. Ordinary uploads use source diagnostics plus the independently approved, scope-limited policy; they do not acquire ground-truth status by running through the same optimizer and evaluator.

At the production insertion point, preserve raw AI output first, run the candidate correction stage, render/measure supported candidates, and apply only policy-qualified edits. Revert rejected changes and retain the unchanged baseline when evidence is insufficient. Attach the scorecard/evidence identity to the exact saved/exported performance. Keep detailed diagnostics available to authorized reviewers; the normal upload-and-edit flow stays seamless and does not expose a comparison script.

## 9. Required tests

1. **Scorer correctness:** exact matches; missing/extra/wrong/octave notes; chords; repeated strikes; ambiguous matchings; empty/silent material; onset errors on both sides of each tolerance.
2. **Expression semantics:** pedal-held versus key-down duration; uncertain ending intervals; clip-censored tails; unavailable velocity; same MIDI velocity rendered on different instruments; missing predictions; candidate deletion that would otherwise artificially improve MAE.
3. **Audio contract:** truncated prefixes, wrong interval/source, sample/channel mismatch, renderer delay, clipped delivered PCM, missing channels, changed gain and unreported time warping. An aligned prefix must not pass as a complete recording.
4. **Corruption sensitivity:** isolated pitch, timing, duration, intensity and pedal changes should affect the intended measures. These tests prove sensitivity only and stay separate from real-world accuracy evidence.
5. **Regression/damage:** improve one attribute while damaging another; confirm the report and policy reject hidden tradeoffs. Verify rollback and preserved raw proposal.
6. **Evidence integrity:** changed source/reference/model/decoder/renderer/profile/implementation invalidates stale receipts; performer leakage and duplicate performances are rejected.
7. **End-to-end:** one command evaluates A/B/C on the checked clip and real development subset and emits complete scorecards. Compare the exact exported artifact. Exercise normal-length and longer recordings; resource truncation must be disclosed and disqualify complete-match claims.
8. **Listening integrity:** public bundle has no decoding key; identities and played stimuli verify; planned comparisons survive construction; duplicate submissions are quarantined; multiple excerpts of one performance do not inflate independent coverage.

Run the relevant regressions and full API suite after integration. Record software results separately from real musical-quality results.

## 10. First practical milestone: the user's piano clip

Deliver the following before requesting a subjective acceptance decision from the user:

1. Verify the exact uploaded/trimmed source and its video-to-analysis timeline.
2. Freeze the current production model/decoder result. Do not treat a cached result as current without checking its identities.
3. Prepare independently reviewed pitch/onset reference with uncertainty. State clearly which expression attributes cannot be recovered as ground truth from this clip.
4. Run the available approved piano-specific candidates on the same audio. Packaging the existing Kong runtime and common-input scoring can proceed now; do not wait for a renderer to measure event accuracy.
5. Evaluate unrefined and corrected notes against the frozen reference, using the same correspondence and coverage rules.
6. Render model-only and final candidates with the same measured real renderer when available. Until then, publish acoustic results as approximate-renderer diagnostics and leave fidelity qualification blocked.
7. Produce the category scorecard, note-level diff, errors introduced, processing coverage, processing cost and synchronized original/baseline/final playback assets. Obtain real listening judgments before claiming perceived improvement.
8. Give an explicit outcome per category: improved, unchanged, regressed or insufficient evidence. A report showing no improvement is a valid evaluation result; it is not a successful correction milestone.

## 11. Definition of done

**Measurement implementation complete:** contracts, scorers, before/after runner, reference workflow, coverage/uncertainty reporting, versioned receipts and integrity/regression tests are implemented. A reproducible real-clip scorecard exists; unavailable attributes are clearly marked. This milestone does not require pretending every attribute is observable.

**Improvement demonstrated:** independently scored real evidence shows gains over the unchanged model without material damage, with coverage and scope meeting the frozen gates. The result is reproducible from the delivered artifacts, and actual listening evidence supports any perceptual claim.

**Reconstruction matches the original:** a separate, substantially stronger claim. It cannot be declared from passing unit tests, high note F1, a reduced audio objective or an unpowered listening study. Apply the established confirmatory protocol and restrict the claim to its measured domain.

The developer's final handoff must state which milestone was achieved, attach the scorecards and receipts, and list every remaining unmeasured category. “Goal complete” alone is not an acceptable evidence report.
