# Actual correction-stage experiment — 12 November 2026

The existing correction stage can make a small pitch/onset improvement on the available
public paired recording. It did not propose a supported edit for the owner's current
clip. No category has passed the product's qualification gates, so no automatic policy
was enabled and no lesson was rewritten.

## Frozen inputs and method

- Exact current lesson: `3ee8ce618f69406fa9313d17d4ebfee2`, draft
  `9f168b16870e4699a40623cabc911b47`, 36 proposed notes, 15.633333 s video.
- Frozen baseline SHA-256:
  `703cfaae2c70142702fc34d1ed6bedcd2298f9c36d36b8c41b160d298d2b13c1`.
- Source video SHA-256:
  `aa0a545ebc137595a558ff7148fde40f84ac595f92ff45063912f3393fca1a10`.
- Extracted 22,050 Hz mono PCM audio SHA-256:
  `5fb6b8929f1548d067637b0063bc02c19c6e34025905aa2526aa49e02f3874fd`.
  This exactly matches the retained inference metadata's audio hash. The audio stream is
  15.616009 s; comparisons use that full available audio interval, without time warping.
- Raw activations were recovered from the lesson's retained analysis archive, whose
  storage checksum was checked. The baseline and video were copied without DB changes.
- Public reference: CPJKU Vienna 4x22, Chopin Op.38, performer p01, corrected captured
  MIDI and its recording, under the existing CC BY 4.0 receipt. Both the first 20 seconds
  and the complete 128.199274-second recording were tested. They are **one performance**,
  not two independent qualification cases. Existing alignment remains unverified.
- Public baseline uses the existing piano-peaks decoder configuration, not new threshold
  tuning. Diagnostic suggestions are applied with the production `apply_finding`
  preconditions, and A/C are scored with the versioned one-to-one event scorer.
- The new `scripts/benchmark_piano_correction_candidates.py` builds an offline candidate,
  combined and per-category scorecards, individual correction trials, a disabled
  qualification policy, and a receipt in a new output directory. It never writes to the
  app or calls a production eligibility bypass. Ambiguous and incomplete analyses cannot
  supply edits. The original input bytes are retained, and existing outputs are refused.

## Results

| Recording | Metric | Original A | Candidate C |
|---|---|---:|---:|
| Owner's current clip | Proposed notes | 36 | 36 |
| Owner's current clip | Supported note corrections | — | 0 |
| Vienna, first 20 s | Matched / missing / extra | 93 / 21 / 15 | 93 / 21 / 14 |
| Vienna, first 20 s | Pitch/onset F1 | 0.837838 | 0.841629 |
| Vienna, complete recording | Proposed notes | 686 | 680 |
| Vienna, complete recording | Matched / missing / extra | 562 / 165 / 124 | 563 / 164 / 117 |
| Vienna, complete recording | Pitch/onset F1 | 0.795471 | 0.800284 |
| Vienna, complete recording | Matched onset MAE | 14.690 ms | 14.664 ms |
| Vienna, complete recording | Matched onset p95 | 32.972 ms | 32.970 ms |

On the complete public recording, six duplicate merges each remove one extra detection;
one onset shift recovers a reference match and removes the corresponding missing/extra
pair. All seven edits also improve the event score when tested individually. No previously
matched reference IDs are lost and no new unmatched candidate IDs are introduced.
This is **pitch/onset evidence only**; it does not establish that merged durations or
physical key releases are correct. Eight of 289 missing/extra errors are removed (2.77%);
this is a modest result, below the existing 20% natural-error-reduction gate.

The first-20-second result is a subset of the complete result and must not be counted
again as an additional successful performance. These are descriptive development results
against the captured MIDI, with unverified alignment, not product qualification.

For the owner's clip, the verifier completes 13 regions and reports 13 unresolved concerns
(12 neighboring-pitch concerns and one octave ambiguity), with **no proposed edits**.
These findings are suspicions, not independently established wrong notes. This remains
true in diagnostic mode, before the production qualification policy suppresses edits.
The separate expression run considers all 36 notes for duration and dynamics and abstains
on all 72 attribute evaluations with `attribution_uncertain`. No velocity or duration
improvement has been demonstrated.

## Source-audio comparison

The combined A/C comparisons retain delivered-audio and frozen common-gain measurements.
The current additive renderer is approximate and cannot qualify piano timbre or perceptual
equivalence. It is used only as a diagnostic here.

- Owner's clip: objective approximately 0.5783 to 0.5783, because candidate events are
  unchanged. This is the current 36-note clip, not the historical 34-note scorecard.
- Complete Vienna: independently gain-normalized objective 0.474232 to 0.474276;
  candidate under the baseline's frozen gain is 0.474309. Lower is better. **Audio
  improvement is not demonstrated**, despite the small event-score improvement.
- None of these objective values is a percentage of identical sound.

## Coverage and qualification decisions

The default 80-region limit truncates the complete Vienna recording: 100 of 180 regions
are skipped. That incomplete experiment is preserved and its candidate receives no edits.
For a separate complete diagnostic run, only `max_regions=512` and
`budget_seconds=180` were supplied explicitly. That run analyzes all 180 regions, skips
none, and takes 28.3 seconds in the verifier. No acoustic thresholds were changed and
these experimental resource settings were not installed into the live worker profile.

| Category | Available natural-error development evidence | Activation |
|---|---|---|
| Duplicate merge | Six individually successful edits in one public performance | Disabled |
| Onset shift | One individually successful edit in that same performance | Disabled |
| Missing pitch, extra-pitch deletion, octave substitution, missed repetition, unmatched-attack insertion | No supported edits in these runs | Disabled |
| Velocity and audible duration | Owner's clip abstains; no independently scored improvement | Disabled |

There are **zero distinct held-out performances** in this experiment. The existing policy
requires at least 40 per category and at least 20 individual suggestions, alongside
precision and damage limits. Development excerpts cannot be renamed into holdout cases.
Qualification output therefore remains `insufficient-evidence` and
`activation_authorized=false`. Thresholds and evidence requirements were not relaxed.

## Problems fixed while exercising the real path

1. A performance candidate plus a captured-pedal reference caused the scorecard to crash:
   the runner returns a list of pedal-type results, but the reporting helper treated it
   as a single dictionary. The reporter now pairs baseline/final results by pedal type.
   A regression checks that improving sustain does not change the soft-pedal row.
2. An uncaptured candidate pedal trajectory was passed as an empty list and could be
   scored as a measured all-off prediction. It now remains unscorable, with its reason,
   instead of inventing a measured controller state.

The experiment tests also cover ambiguous suggestions, partial coverage, stale proposal
hashes, stale edit preconditions, cross-category operations, category isolation, preserving
the baseline, and refusing to overwrite evidence.

Validation: 224 focused measurement/verifier/expression tests passed; the updated
25-test experiment/runner subset was rerun after extending the pedal-type regression,
and all 24 app verification integration tests passed separately with access to their
local services. This covers 248 distinct tests; the entire repository suite was not
rerun. `git diff --check` passed. A final read-only check confirms the current lesson
still has 36 baseline notes, no working document, and no automatic correction history.

## App decision and remaining work

The existing draft endpoint and preview already consume a qualified working document
when one exists. This experiment does not justify changing the current lesson or enabling
a global correction category. The missing step is evidence and stronger useful corrections,
not a playback wiring switch.

Next qualification work must use additional distinct, rights-cleared paired performances
with a genuinely frozen performer split and checked alignment. Duplicate merging and
onset shifting are the categories with an initial positive signal. The missing-note path
and polyphonic duration/dynamics estimation still need better evidence or estimators;
turning off ambiguity checks would not establish that their outputs are correct.

## Artifacts

All private experiment data is under `.local/piano-correction-trial-20261112/`:

- `freeze-receipt.json`, `baseline.json`, `source.mp4`, `source.wav`, `retained-*`;
- `clip-experiment/`: unchanged candidate, combined scorecard, disabled policy;
- `expression.json`: the complete current-clip duration/dynamics diagnostics;
- `vienna20-experiment-v2/`: short paired comparison and individual merge evidence;
- `vienna-full/`: frozen full-recording inference and captured reference;
- `vienna-full-experiment-v2/`: full-coverage comparison, category ablations and trials;
- `numeric-summary.json`: baseline/final event counts and every individual edit result;
- test logs alongside the experiment directories.

The earlier failed scorecard runs and the incomplete-coverage run are retained rather
than overwritten. No commit, publication, global policy activation or lesson edit was made.
