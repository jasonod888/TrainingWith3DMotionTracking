# Measurement follow-up implementation review — 12 November 2026

## Verdict

The new implementation fixes several earlier counterexamples and independently passes **all 128 measurement-path tests**. It still has gaps that can produce misleading before/after conclusions. Do not accept “all findings fixed” or use `improvement_established` as a reliable acceptance result yet.

This review did not change application code or the developer's scorecards. Evidence is in `.local/repo-research/round4-independent-focused.log`, `review_round4_quality.py` and `round4-independent-probes.json`. The claimed 791-pass full-suite result was not independently rerun; the 128-test subset was.

## Confirmed progress

- Unavailable note references now produce observations rather than known-silence results on the ordinary unavailable-reference path.
- Full expression populations are used in the low-level release/velocity/ending success rates for the original one-of-four example.
- A simple net increase in missing/extra notes now prevents an improvement claim.
- Candidate endings explicitly marked uncertain abstain instead of earning overlap credit.
- Explicit mismatched source hashes are rejected; unbound event-only candidates stay diagnostic.
- Audio baseline and final scalar objectives survive into the scorecard.
- Negative onset uncertainty, missing pedal capture, crop carry-in and unsupported continuous pedal now have explicit handling.
- Distinct reviewer IDs/input hashes and a registered listening parent mapping have been added.

Those corrections are useful. The remaining issues below concern combinations and integration paths that the new regressions do not cover.

## 1. P1 — Net counts still hide newly damaged notes

Location: `scripts/report_piano_quality.py:77` (`event_damage`); `scripts/benchmark_piano_quality.py:329` (improvement decision).

`event_damage()` subtracts aggregate missing, extra and matched counts. It does not compare the identities of correctly matched reference notes or individual errors. Recovering one missing note can therefore conceal losing another previously correct note.

**Reproduced:** four reference notes; A omits note 0 and matches notes 1–3, with velocity error 10. C recovers note 0 but omits note 1 and improves the remaining velocities. Both have three matches and one missing note. Result:

```
damage.damaged = false
new_missing = 0
lost_matches = 0
pitch_onset = unchanged
velocity = improved
improvement_established = true
```

**Required:** retain canonical reference/candidate pair identities and error identities in the comparison evidence. Detect the newly lost reference note even when the total matched count is unchanged. For extra notes, use stable event lineage or an explicit before/after event correspondence rather than count differences alone. Preserve counts as summary statistics, not a damage test. Add the recovered-one/lost-another regression and a removed-one-extra/introduced-another-extra case.

## 2. P1 — Dropping an expression prediction can still be reported as improvement

Locations: `scripts/report_piano_quality.py:199` and category-primary outcome selection; `scripts/benchmark_piano_quality.py` descriptive improvement logic.

The denominator fix reports population rates correctly, but the final decision uses only the first expression row: conditional MAE. It ignores decreased value coverage and does not compare the common measured-note set.

**Reproduced:** four matched notes, reference velocity 70. A predicts 110 for one note and 70 for the other three: MAE 10 and all-reference success 75%. C removes the difficult note's velocity (`None`) and leaves the other three unchanged: conditional MAE 0, all-reference success still 75%. The runner reports velocity `improved` and `improvement_established: true`. No known velocity error was corrected; its prediction disappeared.

**Required:** distinguish conditional-error improvement from demonstrated expression recovery. Compare baseline/final on a stable common-reference-value set, retain missing/abstained predictions, and gate the category outcome on coverage/population results and per-note damage. A newly missing value cannot itself establish musical improvement. Test this for velocity, key release and audible ending, including cases where another metric improves simultaneously.

## 3. P1 — Mixed verified/uncertain reference notes still become false extras

Locations: `scripts/benchmark_piano_quality.py:43` (`_reference_events`); `scripts/piano_quality_events.py:231` (uncertainty mask).

The reference extractor discards events marked uncertain before scoring. The masking logic only runs when the **whole attribute** status equals `uncertain`. A normal adjudicated attribute is marked verified when some events agree, even if unresolved events remain.

**Reproduced:** four reference events, one marked uncertain, overall attribute verified; candidate detects all four. The report uses three references, labels the fourth detection an extra, reports `masked_extra: 0` and marks the result measured. That candidate may be correct; the reference cannot establish otherwise.

Masking also needs a consistent population definition: currently masked extras are subtracted from the extra count but remain in the candidate denominator for precision/F1. Its time mask checks any retained reference onset without respecting per-event uncertain regions or pitch, so it can mask unrelated wrong pitches while failing to protect the discarded uncertain note.

**Required:** carry the complete reference plus explicit uncertainty masks alongside the verified scoring population. Do not infer masks from an attribute-level label or all nearby verified notes. Define which pitches/time regions are unadjudicable and apply the same exclusions to counts, precision/F1 and coverage. Report excluded candidates explicitly. Add mixed-attribute, uncertain-only, wrong-pitch-near-clear-onset and isolated-uncertain-region integration tests.

## 4. P1 — Fine-timing reference eligibility changes with the candidate

Location: `scripts/piano_quality_events.py:224–269`.

`ambiguous_reference` counts uncertainty only among matched pairs; `scorable_reference` subtracts that candidate-dependent count from the full reference count. The same uncertain reference therefore enters the denominator when missed and disappears when detected.

**Reproduced:** one precise reference note and one reference note with 20 ms onset uncertainty:

| Candidate | Ambiguous reference | Scorable reference | All-reference within 20 ms |
|---|---:|---:|---:|
| Detects only the precise note | 0 | 2 | 50% |
| Also detects the uncertain note | 1 | 1 | 100% |

The fine-timing eligibility should be determined from the reference alone and stay identical in both comparisons. Detecting the uncertain note can improve detection coverage; it cannot manufacture new fine-timing evidence.

**Required:** establish per-target reference eligibility before matching. Count all timing-unscorable reference events, matched or unmatched. Use the same frozen timing population for A/B/C. Keep detection accuracy, timing ambiguity and fine-timing success separate. Add the two-candidate regression above.

## 5. P1 — Performer-level pooling loses the performance hierarchy

Locations: `scripts/analyze_listening_study.py:282` (`nested_cells`), `nested_paired_difference`, and the role-level `cluster_bootstrap()` call at approximately line 387.

When performer IDs exist, `nested_cells()` maps every excerpt directly to its performer and puts their scores into one flat list. Performance identity is lost. It now averages excerpts within performer, rather than averaging excerpts within performance and then using the predeclared performance/performer weighting.

**Reproduced:** the same performer has one performance at +20 points across four excerpts and another at 0 across two. The function returns **+13.333**, labeled `performance-equal`, instead of **+10**. The evidence identifies one top-level performer as one “performance.” Duplicating windows of the first performance can change the point estimate again.

Additionally, the role means/confidence intervals still use the old listener × excerpt `cluster_bootstrap()`, even for verified parent mappings. Only the paired-difference path uses the new grouping. Absolute similarity means/CIs therefore do not share the hierarchy asserted by the paired comparison.

**Required:** retain excerpt → performance → performer identity throughout. Implement the declared estimand explicitly and preserve the middle performance level during performer-cluster resampling. Apply hierarchy-aware weighting and uncertainty to role summaries as well as paired differences. Return separate performer/performance/excerpt counts. Test unequal excerpts per performance within the same performer, unequal performance counts per performer, duplicated windows, and absolute role confidence intervals—not only top-unit counts.

## 6. P1 — Expression rows can remain “measured” with unverified source identity

Location: `scripts/report_piano_quality.py:199` (`simple`).

Event rows use `source_verified` to downgrade unbound candidates. Expression rows check alignment but ignore source verification.

**Reproduced:** a performance document with `source.sha256: null` produces `source_verified: false` and diagnostic note accuracy, but its velocity and release rows remain `measured`. The global improvement flag is blocked by source verification, which is good, but the category labels and evidence contract still contradict it.

**Required:** enforce identity/status eligibility on every source-dependent category. Unbound expression evidence must be diagnostic/unscorable with explicit reasons. Keep applicability, reference verification, source verification and actual qualification distinct; do not infer one from another. Add one integration regression covering notes, release, velocity, ending and pedal together.

## 7. P2 — Ending-width invariance and zero-error summaries are not yet correct

Location: `scripts/piano_quality_expression.py:181` and outside-interval summary construction.

Rejecting explicitly uncertain endings fixes the original example. However, deriving the point from the midpoint of a caller-declared scorable interval does not enforce the claim “widening cannot improve.”

**Reproduced:** reference interval 0.9–1.0 seconds. Candidate 0.2–0.4 gives midpoint 0.3 and 0% success. Merely extending its upper bound to 1.7 gives midpoint 0.95 and 100% success, with no width-based abstention. This is particularly misleading if interval width represents uncertainty rather than a changed independent point estimate.

The outside-error mean also averages only failed predictions, excluding successful zero errors. When every ending is inside its target interval, the reported error becomes null instead of zero. That prevents the primary interval-distance error measure from showing complete recovery and can create conditional-selection bias.

**Required:** represent the estimate separately from uncertainty bounds, or impose a documented, qualified width/eligibility rule. Assess primary interval-distance error over all scorable point predictions, including zeros; retain mean-over-failures only as a separately labeled diagnostic. Test asymmetric widening and a transition from all-outside to all-inside.

## 8. P2 — Some previously requested report/adapter fields are still dropped

Locations: `scripts/benchmark_piano_quality.py:70` (MIDI candidate loading), `_audio_comparison`; `scripts/report_piano_quality.py` expression/audio assembly.

- MIDI candidates still return `document: None`; expression evaluation skips them. Reporting the label `velocity: model_output` does not preserve the actual MIDI velocity values for evaluation. Preserve available values through an explicit candidate adapter; do not mislabel generated note-offs as captured physical release.
- Release/velocity p95 and bias are computed at the scorer level but are not retained as complete scorecard rows/evidence. Baseline/final uncertainty, missing counts and denominators must remain inspectable for both candidates.
- Audio scalar baseline and final objectives are now retained, but the scorecard still drops baseline absolute objective/gain/completeness, per-candidate delivered hashes and interval metadata available in the runner. Normalized gains are independently fitted in each harness invocation; correction-only comparisons still need the frozen common gain/profile view required by the plan.
- The listening scorecard integration accepts only a single final mean and has no paired baseline/delta/CI receipt path from the analyzer.

**Required:** finish the per-candidate evidence contract through the final exported scorecard. Tests must assert the final artifact contains the actual data and its identity, not merely that an upstream helper calculated it or that a semantics label exists.

## Recommended next handoff

1. Add the reproduced combinations as integration regressions and fix the damage, uncertainty, source-status and population rules first.
2. Complete hierarchy-preserving listening summaries before collecting paid/real listener data.
3. Finish evidence serialization and candidate adapters; reissue scorecards with immutable implementation/config identities and preserve historical artifacts.
4. Keep qualification/activation false until independent evidence supports them. The explicit false qualification/activation flags added in this implementation should remain.
5. Supply an actual independently checked reference and actual baseline/corrected candidates before claiming that the user's transcription improved.

The current clip correctly remains **34 detected notes, correctness unknown**. That is an honest observation, not proof of improvement. The remaining issues are in the measurement software as well as the still-missing real-world evidence.
