# Piano quality measurement implementation — 12 November 2026

## Follow-up review corrections (round 4)

| Finding | Fix | Regression |
|---|---|---|
| Net counts hid newly damaged notes | damage compares matched reference ids, missing ids and extra candidate ids; recovering one note while losing another, and swapping one extra for another, are both damage | `test_recovering_one_note_while_losing_another_is_damage`, `test_swapping_an_extra_note_for_another_extra_is_damage` |
| Dropping an expression prediction counted as improvement | per-note errors and missing ids are retained; a value lost between baseline and final is damage; the primary comparison is the common measured set | `test_dropping_a_velocity_prediction_cannot_count_as_improvement` |
| Mixed verified/uncertain references produced false extras | the full reference is supplied; uncertain events define pitch-and-time masks applied to counts, precision/F1 and coverage, with the excluded candidates reported | `test_mixed_reference_masks_uncertain_candidates_but_not_wrong_pitches`, `test_uncertain_notes_never_become_false_extras_in_a_verified_attribute` |
| Timing denominators depended on the candidate | fine-timing eligibility is computed from the reference alone | `test_timing_eligibility_is_candidate_independent` |
| Performer pooling lost performance weighting | hierarchy is excerpt -> performance -> performer, equal at each level, with performers resampled and performances nested | `test_performer_hierarchy_preserves_performance_weighting` (+10.0, not +13.3) |
| Expression rows stayed "measured" with unverified source | every expression row is downgraded to `diagnostic_only` when source identity is unverified | `test_unverified_source_identity_makes_results_diagnostic` |
| Ending width could buy success | candidate intervals wider than max(50 ms, 3× the reference interval) abstain; the zero-inclusive interval error is reported separately from the outside-only diagnostic | `test_asymmetric_widening_cannot_buy_success`, `test_audible_end_scores_the_point_estimate_against_the_interval` |
| Evidence fields dropped | MIDI candidates carry a velocity view (key release stays not-captured), release/velocity p95 and bias rows are reported, audio retains baseline/final absolute objective, gains, hashes, interval and a frozen common-gain view, and listening accepts a paired receipt with CI | `test_audio_baseline_and_final_are_retained`, `test_unmatched_notes_count_against_the_all_reference_rate` |

Scorecards are now regenerated under `.local/repo-research/round5-quality/`; the original
pre-correction reports remain under `round5-quality/historical-v1/`. Note: the intermediate
round-3 corrected scorecards were overwritten during the round-4 regeneration before versioned
output directories were introduced; that is a process slip, not a measurement change.

## Review corrections (round 3, applied)

The independent review of 12 November found ten defects in the connected evaluation. Each is
fixed and pinned by a regression; the original scorecards are archived under
`.local/repo-research/round3-quality/historical-v1/`.

| Finding | Fix | Regression |
|---|---|---|
| Unknown reference scored as verified silence | `score_events(..., reference_status='unavailable')` returns an observation-only result; the runner gates on attribute status; detected events are reported as "N notes detected; correctness unknown" | `test_an_unavailable_reference_reports_detection_only`, `test_unavailable_reference_yields_observation_not_accuracy` |
| Missing controller capture became verified pedal-off | `from_captured_midi` marks pedal `unavailable` when no controller events exist; `pedal_scores` refuses to score without a reference | `test_absent_controller_reference_is_unavailable_not_off` |
| "All-reference" rates used matched pairs | release, ending and velocity denominators are the full verified reference population; unmatched and missing values are failures | `test_unmatched_notes_count_against_the_all_reference_rate` (1 of 4 = 25 %) |
| A wrong added note coexisted with `improvement_established` | `event_damage()` marks new missing/extra notes and lost matches; damage forces `regressed` and blocks the improvement claim; materiality is per metric and in metric units | `test_one_wrong_added_note_blocks_improvement_despite_a_better_other_category`, `test_damage_from_an_added_note_blocks_improvement` |
| Uncertain wide ending scored full success | endings are scored by a defined point estimate (interval midpoint); uncertain or inconsistent intervals abstain; widening cannot improve the error | `test_a_wide_uncertain_ending_cannot_claim_success`, `test_widening_a_scorable_interval_does_not_improve_the_error` |
| Source/interval/config not enforced | candidate documents must match the reference source hash; the scored interval filters candidate events and is forwarded to audio scoring; tolerances come from the frozen configuration and overrides are rejected unless explicit | `test_a_candidate_from_another_source_is_refused`, `test_candidate_events_outside_the_scored_interval_are_excluded`, `test_an_incompatible_metric_configuration_is_rejected` |
| Audio baseline computed then discarded | both delivered-audio comparisons are retained with components, absolute objective, gain, renderer and qualification identity | `test_audio_baseline_and_final_are_retained` |
| Reference onset uncertainty ignored | negative uncertainty is rejected; uncertainty above half the fine-timing tolerance makes the pair timing-unscorable and is reported as ambiguous; uncertain references mask nearby unmatched candidates | `test_negative_onset_uncertainty_is_rejected`, `test_uncertainty_above_half_tolerance_makes_timing_unscorable`, `test_uncertain_reference_masks_candidates_near_unresolved_notes` |
| Pedal crops lost carry-in state / binary scope unenforced | controller state at interval start is carried in; continuous values are unscorable without the continuous contract; each declared pedal type is scored separately | `test_carry_in_state_is_preserved_when_the_crop_starts_inside_sustain`, `test_continuous_pedal_values_are_unscorable_not_thresholded` |
| Scorecard omitted required rows | precision/recall, p95/bias, all-reference rates, pedal state/false-on/off, audible-end outside error, velocity baseline and candidate field semantics are reported; conditional and population metrics are separate rows | `test_unmatched_notes_count_against_the_all_reference_rate`, `test_audio_before_and_after_are_retained_with_components` |
| Annotation and parent-mapping provenance | two-reviewer adjudication requires distinct reviewer ids and records input hashes; listening studies require a registered performance/recording mapping, and performer-level hierarchy is the top unit when known | `test_annotations_require_independent_reviewer_identities`, `test_performer_hierarchy_is_used_when_registered` |

## Delivery status

Implemented: **M0** reference contract, **M1a** annotation/importer tooling, **M2** versioned
event scorer, **M3** expression scorers, **M4** A/B/C runner, **M5a** performance-nested
listening analysis and stereo diagnostics, **M6** scorecard reporting. Reproducible scorecards
exist for the user's clip and for a real paired Vienna performance.

Not achieved: **M1b** independently reviewed annotations and **M5b** real listener sessions.
No human reviewer, listener, renderer or corrected candidate exists in this work, so no
"improvement demonstrated" or "reconstruction matches" milestone is claimed.

## M0 — reference contract (`piano-quality-reference-1`)

`scripts/piano_quality_reference.py` freezes:

- source hash/duration/channels/rate and an explicit scored interval;
- a video-to-analysis mapping with trim, optional resample, offset, drift, uncertainty and an
  explicit **verified** flag — duration agreement is not treated as alignment;
- stable performance/performer/recording/work ids;
- per-attribute status `verified` / `uncertain` / `unavailable`, provenance and events;
- rights status and dataset revision, split assignment, and the frozen tolerance/config versions.

Validation rejects invalid pitches, non-finite values, duplicate ids, events outside the scored
interval, releases before their note onset, unavailable attributes that carry events, unknown
verification status and unsupported splits. `is_qualified()` requires verified status, approved
rights **and** verified alignment for timing attributes.

An audio-only reference leaves every attribute `unavailable`; captured MIDI import produces
pitch/onset, physical key release, captured velocity and pedal, and deliberately records
**audible end as unavailable** because a captured note-off is not an audible ending.

## M2 — the versioned scorer change (`piano-event-metrics-2`)

The earlier `score_events()` maximised ordered pairs but did not minimise onset distance, and
returned F1 = 1 for empty/empty. Both are replaced on the new path:

- canonical per-pitch dynamic program: maximise pairs, then minimise summed absolute onset
  distance, then a documented match-first tie-break; ids and signed errors are returned and that
  correspondence feeds every attribute scorer;
- the required regression is implemented: reference at 1.000 s and 1.040 s against a candidate at
  1.035 s selects the 1.040 s pair and reports 5 ms absolute error, where the legacy two-pointer
  pairing reports 35 ms;
- empty-case semantics follow the plan's table exactly (both null; reference positive/candidate
  zero → precision null, recall 0; reference zero/candidate positive → precision 0, recall null,
  false activity reported); nulls are never formatted as zero or 100 %;
- F1 for non-empty inputs is `2 × matched / (reference + candidate)`;
- corpus aggregation pools counts for micro metrics and reports macro means over **applicable**
  cases with their case counts, plus silence/false-activity results;
- the legacy scorer remains available as an explicitly labelled reproduction path.

Migration is explicit: baseline and candidate must be re-scored under v2 before comparison. On the
one paired set available here the two matchers happened to agree:

| matcher | matched | F1 | onset MAE |
|---|---:|---:|---:|
| legacy (`piano-event-metrics-1-legacy`) | 93 | 0.8378 | 9.600 ms |
| v2 (`piano-event-metrics-2`) | 93 | 0.8378 | 9.559 ms |

That agreement is a property of this pair, not evidence that the matchers are equivalent; the
tie-break regression is what proves the behavioural change.

## M3 — expression semantics

Release, audible ending, velocity and pedal each report their own denominator:

- key release compares only measured releases; legacy/assumed releases are excluded and counted;
  reference uncertainty above half the tolerance is unscorable;
- audible ending scores zero error inside the accepted interval and distance outside it;
- velocity uses captured MIDI values only, with conditional error beside the all-reference rate;
- pedal reports transition precision/recall/F1, timing error, false-on and false-off time
  separately, and time-weighted state agreement; absent controller data is `unavailable`, not
  "pedal off".

A deletion test pins the damage case: removing a badly timed note improves conditional MAE while
leaving the all-reference rate unchanged and increasing the missing count.

## M5 — performance-nested listening and stereo

Listening analysis is now `piano-listening-analysis-2`. Items carry `performance_id` and
`recording_id`; excerpts are nested inside a parent performance. Paired differences are averaged
**within a listener/performance cell** before bootstrapping listeners and performances as crossed
units, so extra windows of one recording cannot fabricate precision. Items without an explicit
parent performance make the study `legacy_diagnostic`, and its comparisons stay exploratory.

A regression shows the weighting: one performance at +20 points with four excerpts and another at
0 points with two excerpts yields **+10.0** (performance-equal), not +13.3 (excerpt-weighted), and
duplicating windows leaves both the performance count and the interval unchanged.

Stereo diagnostics (balance, correlation, width, mid/side spectral difference) are implemented and
always report `diagnostic_only` / `supported_for_qualification: false`.

## M6 — scorecard (`piano-quality-scorecard-1`)

Every metric carries version, units, direction, tolerance, baseline, final, absolute and relative
change, denominator, coverage, reasons and one of `not_measured` / `unscorable` /
`diagnostic_only` / `measured` / `qualified_for_scope`. A zero baseline yields no relative change.
Outcomes are `improved`, `unchanged`, `regressed` or `insufficient_evidence`; an unverified
alignment downgrades timing evidence to diagnostic, and a silent reference reports note accuracy
as not applicable with false activity counted separately.

The Markdown report answers the seven questions and states that no overall fidelity percentage
exists.

## Real scorecards

Artifacts: `.local/repo-research/round3-quality/` (`summary.json`, `vienna/`, `clip/`).

**Vienna, Chopin Op.38 first 20 s** — reference from the CPJKU corrected captured MIDI, candidate
from the cached Basic Pitch probe events, same correspondence for all attributes:

- reference 114 notes, candidate 108, matched **93**, missing **21**, extra **15**;
- precision **0.861**, recall **0.816**, F1 **0.8378**;
- onset MAE **9.559 ms**, p95 **29.5 ms**, bias **-2.9 ms**, all-reference within 20 ms
  **69.3 %**;
- status `diagnostic_only`: the alignment is not independently verified and the candidate
  event list carries no source identity;
- release, ending, velocity, pedal, audio and listening are `not_measured`/`unscorable`
  (no performance document for that candidate, and no corrected candidate);
- `improvement_established: false`.

**User's clip (14.6773696 s)** — audio-only reference, cached 34-note proposal:

- pitch/onset: **34 notes detected; correctness unknown** because the reference is
  unavailable — no missing/extra or false-activity claim is made;
- delivered-audio objective **0.596754** under the approximate renderer, `diagnostic_only`;
- every expression attribute `unscorable`; no listener data;
- `improvement_established: false`.

Neither scorecard shows improvement, and neither is presented as one.

## Required-test coverage

| Plan §9 item | Status |
|---|---|
| 1 scorer correctness (exact, missing, extra, octave, chords, repeats, ambiguity, silent, tolerance edges) | covered: exact/missing/extra/ambiguity/ties/order-invariance/empty table/tolerance validation; octave and chord scopes are represented by exact-pitch matching |
| 2 expression semantics (pedal-held vs key-down, uncertain endings, censored tails, unavailable velocity, instrument differences, missing predictions, deletion) | covered except same-velocity-different-instrument rendering, which needs a renderer |
| 3 audio contract (truncated prefix, wrong interval/source, rate mismatch, delay, clipping, gain, warping) | covered by the existing harness regressions; no time-warping path exists |
| 4 corruption sensitivity | existing synthetic fixture; not re-run here |
| 5 regression/damage (improve one attribute, damage another) | partially covered by the deletion test; edit-level policy rejection remains M7 |
| 6 evidence integrity (stale receipts, performer leakage, duplicates) | reference/candidate hashes bound; duplicate submissions and split leakage covered; performer-level hierarchy and receipt invalidation are partial |
| 7 end-to-end A/B/C and scorecard | covered for events; audio comparison runs when a candidate document and source exist, and stays diagnostic |
| 8 listening integrity | covered: blinding, nested units, duplicate quarantine, planned comparisons |

## Reproduction

```powershell
$env:PYTHONPATH = "$PWD/.venv-music/Lib/site-packages"
.venv-saas/Scripts/python.exe -m pytest -q
.venv-saas/Scripts/python.exe .local/repo-research/round3_quality_build.py
```

## Verification

- Date: 2026-11-12, 17:33 (+08:00), after the follow-up review corrections.
- Command: `python -m pytest -q` from the repository root.
- Interpreter: `.venv-saas/Scripts/python.exe` (Python 3.12.2) with
  `PYTHONPATH=.venv-music/Lib/site-packages`.
- Result: **814 collected, 800 passed, 14 skipped, 0 failed** (8 min 14 s).
- Measurement-path subset: **137 passed** across `test_piano_quality_events` (30),
  `test_piano_quality_reference` (19), `test_piano_quality_expression` (18),
  `test_piano_quality_report` (16), `test_piano_quality_runner` (14),
  `test_piano_quality_hierarchy` (11) and the extended `test_listening_study` (29).
- Worktree: `5f8e1b7` with uncommitted changes; the new modules and tests are untracked
  additions.

## Remaining work

- **M1b**: two independent reviewers annotate the clip's pitch/onsets; without them the clip's
  notes stay unmeasured. The templates, adjudication and uncertainty fields exist.
- **M5b**: real listeners on a performance-nested study; the software is ready, the evidence is not.
- **Renderer**: a real, pinned engine to replace the approximate diagnostic on the audio category.
- **M7**: scope-aware policy receipts and edit-level damage reporting before any activation.
