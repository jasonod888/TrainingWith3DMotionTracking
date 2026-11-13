# Piano reconstruction acceptance specification v1

Date: 12 November 2026  
Status: proposed engineering/product requirements; not measured capabilities  
Applies to: [the reconstruction implementation plan](piano-performance-reconstruction-plan.md)

## 1. How to use these requirements

These numbers make the first development decision testable. They are initial product
targets, not claims justified by existing data or promises that a candidate will pass.
Implement the measurements and run development pilots. A failed target means the
candidate fails; abstaining on everything does not pass.

Before untouched qualification, commit a versioned acceptance manifest containing
the target definitions, thresholds below, metric formulas/weights, domains, splits,
minimum subgroup sizes, study protocol, code/assets and hardware identities. The
engineering lead owns implementation, the evaluation lead owns independent scoring,
and the product owner owns requirements. Resolve annotation uncertainty during the
pilot. If a requirement must change for a substantive reason, publish a new version
and rationale before opening new holdout data; do not retrospectively relax it to
make a failed run pass. Previously inspected qualification data becomes development
data for that revised decision.

Vienna supports an initial one-piano/recording-domain evaluation. It does not support
a claim across arbitrary pianos. Claims involving multiple domains require suitable
independent recordings and listener stimuli from each declared domain.

## 2. Renderer selection is a separate, mandatory delivery

### Engineering default and alternatives

1. **First fidelity prototype:** pinned **sfizz engine plus Salamander Grand Piano V3**.
   Engine library is BSD-2-Clause; sample collection is CC BY 3.0. This is an SFZ route,
   not a SoundFont loaded into FluidSynth. Use an explicitly versioned mapping with
   tested support for every required opcode/control. Upstream's mapping uses ARIA
   extensions; silently ignoring unsupported features fails the prototype. The sfizz
   repository is archived, so assign an internal maintenance owner or select a vetted
   maintained fork before production.
2. **Control/cost baseline:** FluidSynth plus a project-built SF2 from the already
   selected VCSL CC0 samples. Pin conversion/mapping and test response. FluidSynth is
   LGPL-2.1-licensed; record packaging/linking and dependency obligations for the actual
   build. This provides a reproducible baseline, not presumed source-identical quality.
3. **If the fidelity prototype fails:** test another documented compatible mapping or
   engine/asset pair, or procure a direct license covering server rendering and any
   needed sample/model redistribution or adaptation. An ordinary plugin purchase is
   not assumed to grant dataset extraction or redistribution rights.

DDSP-Piano remains an offline research comparison. It is not a production fallback or
approved product asset by virtue of appearing in the plan. Product use would require
its own code/checkpoint/data rights, reproducibility, maintenance and quality review.

### Required renderer decision artifact

Deliver `renderer-selection.json` and a short report with separate engine, sample,
mapping, effect and dependency licenses/hashes; build/packaging mode; required notices;
tested controllers/features; deterministic render evidence; audio quality results;
latency/memory/cost results; unsupported behavior and maintenance owner. A permissive
engine does not clear its samples. A sample collection's license does not prove its
quality. Conversion from SFZ to SF2 does not automatically preserve sound behavior.

Use 24 development excerpts from at least 12 performances, spanning quiet attacks,
chords, repeated notes, bass/treble and pedal tails. Compare identical checked
performance controls across renderers to isolate rendering error, then test a bounded
source-sound fit. Pin latency compensation and gain treatment. Renderer selection
requires complete core-control tests, runtime targets in section 5, and at least a
10-point mean improvement over the current oscillator audition on the 0–100 pilot
similarity scale. The pilot's clustered 95% confidence interval for that gain must
exclude zero. This selects an engineering renderer; it does not qualify an
indistinguishability claim. If all candidates fail, the renderer milestone fails.

## 3. Initial quantitative quality gates

All comparisons use real, naturally occurring baseline errors and independent
references. Report corrupted controls separately. Compare refinement with the
stronger selected model alone using the same renderer, then report complete-system
gain over the current product. No-change/unsupported cases remain in denominators.

| Gate | v1 requirement |
|---|---|
| Analysis coverage | At least 95% of scorable notes and 95% of supported source time analyzed; report both denominators and all excluded/unscorable material |
| Useful correction coverage | Correct at least 20% of independently identified material natural errors for each enabled category, in its qualified scope; count a repeated/partial representation of one error only once |
| Performance coverage | At least 50% of evaluated performances having material baseline errors receive at least one correct material improvement; retain the existing minimum of 40 distinct performances contributing edits per enabled category |
| Natural-error reduction | At least 20% relative reduction in each enabled category's predeclared primary error measure; clustered 95% CI for reduction must exclude zero |
| Safety/precision | At least 95% observed correction precision and zero measured damage under existing category rules; retain at least 20 edits and 40 distinct contributing performances; report uncertainty rather than imply a population guarantee |
| Tail behavior | Category 95th-percentile error must not increase by more than the larger of 5% of baseline or the independently established reference uncertainty; no hidden subgroup regression |
| Audio comparison | At least 10% relative improvement in the frozen normalized reconstruction objective over model-only output, with 95% clustered CI excluding zero; report every component so gain cannot conceal a pitch/rhythm failure |
| Listening improvement | Mean full-system similarity gain at least 10 points on the 0–100 pilot/qualification scale over model-only playback; clustered 95% lower confidence bound above 5 points |

Define material natural errors before evaluation: exact-pitch missing/extra notes;
onset error above 20 ms; key-release error above 80 ms; velocity error above 8 MIDI
units; or pedal transition error above 50 ms. Use stricter/uncertainty-aware rules if
the reference contract requires them. References too uncertain to adjudicate these
boundaries are unscorable for that target; do not inflate coverage by relabeling them
as easy successes. Audible-ending error uses the independently annotated interval,
not the key-release threshold.

Per-category primary measures are missing-plus-extra note count per reference note
for pitch/event edits, mean absolute onset/release/velocity error for those respective
attributes, distance outside valid audible-ending intervals for audible ends, and
transition timing error plus frame-state error for binary pedal. Report pedal false
transitions explicitly; continuous/half-pedal editing needs its own calibrated
reference and acceptance extension. Match notes one-to-one and report missing-note
rates separately; matched-note timing/velocity gains cannot offset lost notes.

For subgroup claims require at least 10 independent performances and 20 scorable
material errors per reported subgroup; smaller groups remain descriptive and cannot
authorize that scope. Existing 40-performance edit minimums still apply to each
enabled category. Freeze the uncertainty/subgroup handling in the pilot manifest.

These are intentionally demanding first targets. Pilot evidence may show that no
available renderer/model combination meets them. Deliver that result rather than
changing the definition of success after examining holdout.

## 4. Listening study work package and claim control

The study is a staffed evaluation/claims deliverable, not an automated test-suite
item. Name an evaluation lead/statistician, recruitment coordinator and product/claims
review owner. Budget recruitment, participant payment, instrument-rated expert time,
study hosting, calibrated playback checks, analysis and reporting before qualification.

For planning, reserve at least 60 participant-hours for confirmatory ABX sessions,
plus pilot time and separately scheduled quality ratings. Initial staffing allowance:
5–10 evaluation-design/implementation person-days, 3–5 recruitment/coordinator
person-days and 5–10 statistics/analysis/reporting person-days. These are budgeting
allowances, not a quoted study cost or completion-date commitment. The power/design
pilot may increase them; secure the resulting budget before confirmatory recruitment.

### Stage L1: development pilot

- Recruit at least 12 listeners, including six experienced pianists/audio listeners.
- Use the 24 development excerpts from section 2, 8–15 seconds each, balanced across
  musical conditions. Randomize source/candidate ordering; include hidden reference,
  current audition and model-only controls, with a deliberately degraded anchor.
- Collect similarity/impairment scores and structured descriptions of remaining
  differences. Check task comprehension, fatigue, equipment and within-listener noise.
- Use pilot variance and listener/excerpt correlations to simulate confirmatory power.
  Pilot listeners and stimuli are excluded from confirmatory qualification.

### Stage L2: preregistered confirmatory study

- Initial recruitment floor: **60 valid listeners**, with at least 30 experienced
  pianist/audio listeners and 30 intended users. Recruit replacements for exclusions
  under predeclared rules. This is a planning floor, not a calculated power guarantee.
- Initial stimulus floor: **24 previously uninspected excerpts from at least 24
  distinct performances**, 8–15 seconds each. Specify and balance each claimed piano,
  recording and musical-condition domain. With Vienna alone, the claim remains scoped
  to its one recording domain and limited repertoire.
- Each listener completes 24 randomized ABX trials, divided into three blocks with
  breaks, plus separately scheduled quality/preference trials. Use balanced assignment
  if more stimuli are needed. Treat listener and excerpt as crossed clusters; 1,440
  nominal judgments are not 1,440 independent observations.
- Predefine a one-sided 5% error rate and target at least **90% power** to establish
  the declared discrimination bound when true discrimination is at chance. Use pilot
  mixed-effects/simulation estimates. Increase listener/excerpt counts if the floor
  cannot achieve that power; freeze final numbers and analysis before collecting
  confirmatory outcomes. If the powered design cannot be funded or recruited, no
  indistinguishability claim is released.
- The proposed practical discrimination bound is **60% correct in a two-choice ABX
  task** (chance 50%). The one-sided simultaneous 95% upper confidence bound must be
  below 60% overall and in both listener cohorts, with multiplicity handled in the
  preregistration. This 10-percentage-point margin is a project acceptance choice,
  not a universal definition of identical sound. The statistician must assess its
  scientific suitability during the pilot, before final registration.
- Supplement with a small-impairment listening protocol informed by ITU-R BS.1116;
  require mean rating at least 4.5/5 and one-sided 95% lower bound at least 4.0/5.
  For earlier larger differences, use a protocol informed by ITU-R BS.1534. Clearly
  document adaptations; do not claim ITU compliance without meeting the full method.
- Use fixed, screened headphones/monitor setups and controlled conditions for the
  primary claim; evaluate mobile/ordinary equipment as a separately reported domain.
  Control level and latency without normalizing away note dynamics. Use the product's
  actual served render and output codec. Preserve randomized orders, consent,
  preregistration, exclusions, calibration, raw anonymized results and analysis code.
- Predefine attention/anchor checks and exclusions, maximum session duration (initial
  cap 60 minutes per session), missing-data handling and retest policy. Never exclude
  a listener merely for distinguishing the reconstruction successfully.

### Claims artifact

Deliver `listening-protocol-v1`, power simulation, immutable preregistration with
timestamp, recruitment/consent record, blinded stimulus manifest, analysis/report and
a claims sheet stating the tested domain and permitted wording. Product/claims review
uses this evidence before publication; an engineering pass alone cannot authorize an
advertising claim.

Non-significant difference from chance is not an equivalence result. Even passing the
60% bound supports only the predeclared practical criterion under the study conditions;
it does not prove literal identity. No unqualified “exactly identical for any piano”
claim is authorized. If the study fails, keep measured-improvement wording only when
its separate gates pass and continue sound development without changing the results.

## 5. Runtime, memory and cost work package

### Measurement milestone before integration

During Phase C, benchmark renderer alone and repeated comparison/render workloads.
Update measurements after Phase D model selection and Phase F refinement. **Phase G
integration depends on a signed-off measured budget**, not the old expression caps.

Reference qualification worker profile: eight CPU cores, 32 GiB system RAM and one
16 GiB GPU; record exact hardware, OS, drivers, thread count and versions. Measure a
separate CPU-only profile if it is offered. Results do not transfer automatically
between profiles. Use 15 s, 60 s and 300 s inputs, including dense pedal-heavy cases,
multiple note counts and repeated/overlapping candidates. Run at least 30 jobs per
length/complexity cell with warm/cold caches reported separately. Confirm p95 under
realistic concurrency before setting production admission limits.

### Provisional engineering ceilings, to be tested rather than claimed

| Resource | v1 target |
|---|---|
| Initial qualified upload domain | Up to 300 seconds; do not silently analyze only the first 60 seconds |
| Renderer-only single full pass | p95 real-time factor at most 0.25, with cold-start overhead separately measured |
| Complete job, excluding queue/upload | p95 at most `max(60, 3 × source_seconds)` seconds on the reference profile: 60 s for a 15 s clip, 180 s for 60 s, 900 s for 300 s |
| Hard processing deadline | `max(120, 6 × source_seconds)` seconds, capped at 1,800 s for the initial domain; preserve baseline on expiry |
| Edit audition regeneration | p95 at most 3 s warm / 8 s cold for a dirty region up to 10 s plus measured acoustic context; broader pedal/sound edits may require a full background render |
| Per-job memory | Peak resident RAM at most 8 GiB; GPU allocation at most 12 GiB, leaving host/device headroom |
| Processing cost | Target at most `max(USD 0.02, USD 0.05 × source_minutes)` per job, including allocated compute and temporary storage at actual contracted rates; report actual cost and assumed utilization |

These are product budgets, not measured speed or market-price statements. If the
prototype cannot meet them, optimize/prune/cache or propose a documented versioned
budget/domain change before holdout and launch. Do not skip necessary analysis and
still report complete coverage to meet time limits. Queue latency has its own
measured service objective and is not hidden inside processing results.

Report extraction, model, fitting, local renders, final renders, comparison and asset
encoding separately; retain candidate counts/iterations, audio length, note density,
peak memory, storage and failure reasons. Derive candidate/iteration/admission limits
from measured worst cases and leave headroom. Runtime checks must run inside the
candidate search, not only between stages. Test cancellation, cache misses, long
tails, renderer crashes and two concurrent jobs.

Deliver `reconstruction-runtime-profile.json`, benchmark inputs/results and operating
cost calculation. Runtime limits belong to the versioned worker profile and scheduling
configuration. Until this milestone passes, shadow/offline research may continue but
production integration must not advertise a turnaround promise. Longer inputs use an
explicitly qualified asynchronous/chunked path or preserved legacy processing with
clear coverage; never truncate silently.

## 6. Primary references

- [sfizz license](https://github.com/sfztools/sfizz/blob/develop/LICENSE),
  [project status/dependencies](https://github.com/sfztools/sfizz).
- [Salamander license and mapping requirements](https://github.com/sfzinstruments/SalamanderGrandPiano).
- [FluidSynth license](https://github.com/FluidSynth/fluidsynth/blob/master/LICENSE).
- [Selected data/sample grants](piano-reconstruction-rights-register.md).
- [ITU-R BS.1116](https://www.itu.int/rec/R-REC-BS.1116/en),
  [ITU-R BS.1534](https://www.itu.int/rec/R-REC-BS.1534/en).

All numerical gates, resource ceilings, sample floors and power/claim procedures here
are proposed project requirements. The linked sources establish tool terms and
listening-method context; they do not establish our system's quality or speed.
