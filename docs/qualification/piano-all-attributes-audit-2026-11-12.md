# Piano correction usefulness: audit of every attribute

## Decision

These two recordings do not demonstrate enough benefit to justify making the current
full correction process the default quality-improvement step. The public recording has
a small pitch/onset cleanup; the owner's video has no supported edits. The expression
stage produces no duration or velocity corrections for either recording. The actual app
preview has no meaningful overall source-audio improvement.

This is a result about this implementation on these inputs, not evidence that every
possible audio-guided refinement method is unnecessary. Keep the measurement tools and
the frozen baseline. Do not enable the existing policies, loosen ambiguity checks to
manufacture changes, or present the current output as improved across all attributes.

## What was tested

Three stages were compared, with no new transcription thresholds or model training:

- **A:** existing piano-specific Basic Pitch decoder output.
- **B:** A after the existing diagnostic pitch/onset correction suggestions are applied
  offline with production edit preconditions.
- **C:** B after the existing duration/dynamics diagnostic stage. Proposed expression
  changes would be tested offline, but the stage proposed none. Therefore C equals B.

The inputs are the exact frozen current 36-note lesson video and the complete public
Vienna Chopin Op.38 p01 recording, 128.199274 seconds. Public truth is the corrected
captured MIDI, with 727 reference notes. Its timing alignment remains independently
unverified, so event results are descriptive diagnostics. The shorter 20-second excerpt
is not counted as another performance.

The 60-second expression input limit was respected: the public recording was processed
in four 40-second core intervals, with up to four seconds of context on either side.
Every candidate note belongs to exactly one scored core; context events are not counted
twice. All 680 B notes receive both duration and dynamics evaluations. The complete
36-note owner clip fits one window. Stored audio/proposal hashes were checked when
reusing reports. A separate timed rerun repeats the calculations.

## Attribute results

| Attribute | Public recording: A to C | Owner's current video: A to C | Interpretation |
|---|---|---|---|
| Notes present | 686 to 680 proposed notes | 36 to 36, identical events | Six duplicate merges on public input; no clip edits |
| Missing / extra notes | 165 / 124 to 164 / 117 | Correctness unknown: no independent note annotations | Eight count errors removed out of 289 (2.77%) on public input |
| Pitch/onset F1 | 0.795471 to 0.800284 | Not scorable against independent truth | Small diagnostic improvement, not a sound-match percentage |
| Matched onset MAE | 14.690 to 14.664 ms | Independent timing truth unavailable | 0.026 ms difference in aggregate, effectively unchanged |
| Matched onset p95 | 32.972 to 32.970 ms | Independent timing truth unavailable | Effectively unchanged |
| Audible durations | Zero expression corrections | Zero expression corrections | Independent audible-ending labels absent for both inputs |
| Physical key release | No explicit predictions, despite captured public reference | No explicit predictions or independent reference | System does not currently estimate this target |
| Calibrated MIDI velocity | Zero predictions/corrections | Zero predictions/corrections | No valid calibration for these recording domains |
| Relative loud/soft ordering | Amplitude/MIDI rank correlation 0.311565 to 0.308304 | No captured velocity reference | Weak proxy agreement, slightly worse, not calibrated velocity accuracy |
| Pedal | No predicted trajectory; reference includes sustain and soft pedal | No predicted trajectory or reference | No pedal improvement can be claimed |
| Written rhythm / note values | No independently scored notation target | No independently scored notation target | Performance timing is not written rhythm |
| Stereo / room | Original stereo, preview dual mono | Original stereo, preview dual mono | Stereo image is not reconstructed |
| Listening similarity | No real listener ratings | No real listener ratings | No perceptual improvement or indistinguishability claim |

The six duplicate merges also alter six matched notes' duration values and four matched
notes' amplitude values indirectly. That is separate from dedicated expression
corrections. A successful note-count edit does not certify its duration or velocity.
No previously matched public reference note is lost, and no new unmatched candidate note
is introduced, but this is only the pitch/onset damage check.

## Why expression does nothing here

| Input / category | Evaluated notes | Reason for no correction |
|---|---:|---|
| Public duration | 680 | 678 attribution uncertain; 2 have no search range |
| Public dynamics | 680 | 651 attribution uncertain; 29 lack calibration |
| Owner duration | 36 | All 36 attribution uncertain |
| Owner dynamics | 36 | All 36 attribution uncertain |

This was diagnostic mode, not simply suppression by disabled policies. The public
dynamics stage obtains 29 potentially usable attack measurements (4.3% of notes), but
has no valid conversion from these measurements to instrument velocity. Most overlapping
notes fail attribution first. No time-budget abstentions occurred in the timed rerun.

The existing local SMD-derived calibration is unqualified and targets a different
instrument/recording domain. It was not relabelled and used as a Vienna or owner-clip
calibration. Captured public velocities were used for evaluation, not fed into the
estimator to make its predictions agree with the answers.

## Expression proxies: useful warnings, not target substitution

Using the same 562 reference notes matched by every stage avoids a changing denominator:

- Decoder-amplitude versus captured-velocity Spearman rank correlation:
  **0.311565 to 0.308304**. This checks whether stronger predicted notes tend to correspond
  to stronger captured strikes; it does not turn amplitude into calibrated MIDI velocity.
- Legacy note endpoint versus captured physical key release MAE:
  **328.736 to 329.480 ms**; signed bias **+274.741 to +280.451 ms**. This proxy is slightly
  worse. Acoustic duration and physical note-off are different targets, especially with
  pedal, so this is not reported as physical-release accuracy.
- The captured sustain pedal is down for **89.754 seconds (70.0%)** of the public audio;
  soft pedal is active for **20.880 seconds (16.3%)**. The candidate has neither trajectory.
  Missing pedal output remains unmeasured, not an invented all-off prediction.

## Actual app-preview audio test

This audit additionally renders A, B and C with native Chromium Web Audio using the
app's current `schedulePianoVoice`, the same velocity response, compressor settings and
70% master-volume setting. All notes are scheduled: 686/680 are below the 1,000-note
preview cap, and the owner's clip contains 36. No output sample clips.

The known 50 ms scheduling lead is removed for comparison; no timing fit or time stretch
is used. Delivered 24-bit audio is scored over the full available source interval.
The full video source audio is 15.616009 s versus a 15.633333 s video container.

Errors below are bounded diagnostic components: **lower is better**, and they are not
percentages of identical sound. The preview is still an approximate voice, not a
qualified acoustic piano renderer.

| Public audio component | A | C | Direction |
|---|---:|---:|---|
| Overall, independently normalized gain | 0.516807 | 0.516802 | Negligible 0.000005 decrease |
| Overall, frozen A gain | 0.516807 | 0.516811 | Negligibly worse |
| Spectral / timbre | 0.760883 | 0.761032 | Worse |
| Attack alignment | 0.601108 | 0.601444 | Worse |
| Loudness envelope | 0.687480 | 0.687375 | Very slightly better |
| Pitch energy | 0.050796 | 0.050842 | Worse |
| Octave balance | 0.086605 | 0.086025 | Very slightly better |
| Decay envelope | 0.343055 | 0.342737 | Very slightly better |

All component changes are smaller than 0.001; the overall change is far below the existing
0.001 materiality threshold. There is no established overall improvement. B and C have
identical events, so the expression stage contributes none of these differences.

For the owner's clip, A/B/C are identical note data. Actual-preview objectives are
**0.600143 / 0.600144 / 0.600142**. Waveform differences have RMS about **9e-9**, consistent
with insignificant browser DSP/quantization variation between identical renders. The
sixth-decimal objective variation is not a correction gain. Loudness, attack, pitch
energy, octave balance and decay components remain unchanged at reported precision.

These actual-preview numbers use a different renderer from the previous additive
harness score. Compare A/C within this audit; do not compare 0.5168 to the older 0.4742
and call the difference a transcription change.

## Stereo check

Both original recordings have two channels. The preview produces the same signal on
left and right, so it cannot match their stereo width. Channel correlations are:

| Input | Original | Preview |
|---|---:|---:|
| Public recording | 0.7031 | 1.0000 |
| Owner video | 0.3826 | 1.0000 |

This independently rules out identical stereo reproduction with the current preview.
It does not measure every aspect of room acoustics or replace a listening study.

## Product consequence

The independently timed expression rerun takes **60.29 seconds** for the complete
128.20-second public recording and **1.66 seconds** for the owner's clip, with zero
candidate changes and no time-budget abstentions. The earlier complete public note
verification took 28.3 seconds, using the explicitly recorded larger region budget.
Those are analysis-stage costs, excluding model inference, browser rendering and report
generation. They show that the full expression stage has measurable cost without a
demonstrated benefit on these inputs. The normal 80-region note limit would truncate
the public recording; its incomplete results were not treated as a complete correction.

The current data supports keeping the full heuristic/expression path out of default
automatic activation. Duplicate merging has a small positive diagnostic signal; the
larger duration/dynamics stage is not delivering changes on either real input. The
missing physical-release, calibrated-velocity and pedal estimators are implementation
gaps, not just a missing final scorecard column.

Preserve the measurement tools and candidate comparison as the acceptance test for
future work. Any replacement or improvement should beat this frozen baseline on a
broader, independently aligned paired set and demonstrate benefit before default app
activation. One performance cannot establish global effectiveness or uselessness.

No application code, lesson data, model thresholds or automatic policies were changed
for this audit. No old evidence was deleted. Analysis artifacts live under
`.local/piano-all-attributes-20261112/`, including per-window expression reports, exact
preview WAVs, source comparisons, rank diagnostics, stereo diagnostics and timing receipts.
