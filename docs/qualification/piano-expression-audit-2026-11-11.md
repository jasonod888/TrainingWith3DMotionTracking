# Duration and dynamics accuracy test — 11 November 2026

**Outcome: the current expression estimators are not ready for automatic application.**
Duration suggestions worsened the natural AI output in this controlled benchmark.
Dynamics helped some AI estimates, but also introduced errors and changed values that
were already correct. Both production categories remain disabled. No estimator,
threshold, policy, worker profile or saved lesson was changed by this test.

The [machine-readable results](piano-expression-audit-2026-11-11.json) include estimator
identity, sample identities, scenario summaries, failure examples and the original
clip's offline proposals. The full local report is
`.local/piano-expression-audit/report.json`.

## What was tested

`scripts/benchmark_piano_expression.py` tests the actual existing duration and dynamics
functions directly, outside the disabled production gate. It does not fabricate an
approved policy or apply changes to a user lesson.

- 24 controlled clips: eight scenarios with three deterministic variations, containing
  138 recorded-sample note events.
- Scenarios: isolated repeated pitches at different gains; equal gains across pitches;
  chords; quiet melody over loud bass; overlapping tails approximating pedal sustain;
  repeated same-pitch strikes; quiet recordings; and noisy recordings.
- Four proposal conditions per clip: correct reference attributes, artificially short
  notes with flattened dynamics, artificially long notes with correct dynamics, and
  actual Basic Pitch piano-decoder output. Correct-reference controls check whether
  the estimator damages an already correct result.
- The estimator and Basic Pitch analyze the same quantized 22,050 Hz mono PCM WAV.
- Three existing synchronized human recording excerpts, containing 563 pitch/onset
  matches, were checked separately. Their MIDI key releases are not audible endings.
- The original uploaded excerpt was tested offline for potential proposals.

## Reference definitions and limits

Controlled audible end is measured independently from each isolated rendering stem:
the last 10 ms RMS window above -40 dB relative to that stem's peak RMS. It is not
derived from the estimator's harmonic SNR threshold. Overlapping repeated strikes of
the same pitch are excluded from end-error scoring when their individual endings
cannot be assigned reliably. This leaves 126 reference ends, of which 125 have
pitch/onset matches in the AI output.

Controlled dynamics targets are known **linear rendering gains**, not calibrated MIDI
strike velocities. They test whether the loudness adjustment behaves sensibly under
known amplitude differences. This sample bank has one recorded timbre per pitch;
it cannot validate velocity-dependent acoustic timbre or a real piano's velocity curve.

Notes are matched one to one using exact pitch and onset within 50 ms. Attribute
errors are evaluated on those same matches before and after the proposed changes.
An improvement/worsening must exceed 5 ms or 0.005 normalized gain. A previously
correct value is counted as damaged if it crosses 80 ms of ending error or 8/127 of
gain error. These are diagnostic tolerances, not production qualification criteria.

## Results on actual AI proposals

| Attribute | Matched notes scored | Suggestions | Improved | Worsened | Previously correct values damaged |
|---|---:|---:|---:|---:|---:|
| Audible ending | 125 | 28 | 9 | 18 | 10 |
| Dynamics against known rendering gain | 137 | 16 | 11 | 5 | 2 |

One duration suggestion changed the error by less than the 5 ms reporting threshold.

- Mean audible-ending error increased from **87.8 ms to 160.4 ms**.
- Mean dynamics error against rendering gain decreased from **0.2085 to 0.1858**,
  but five suggestions worsened their targets and two damaged already acceptable
  values. This does not establish better MIDI velocity on real recordings.
- All 11 duration suggestions in the overlapping-tail scenario worsened the ending;
  eight damaged endings that were already within 80 ms.
- Chord duration estimates improved on four suggestions in this limited sample,
  but dynamics abstained on chords and overlapping notes.

An example: a sustained note's independently measured end was 2.194 seconds. The AI
end was 2.184 seconds, already within 10 ms. The estimator proposed 3.546 seconds,
increasing the error to 1.353 seconds.

## Correct-reference and deliberately corrupted controls

Starting from correct attributes, the estimator proposed **21 incorrect duration
changes and 24 incorrect dynamics changes**. These failures disqualify automatic use
even though some deliberately corrupted proposals improve.

Starting from artificially short notes, duration MAE improved from 644 ms to 204 ms;
starting from artificially long notes, it improved from 1,403 ms to 183 ms. Those
easy corruptions therefore overstate its usefulness on natural AI drafts.

Starting from flattened dynamics, mean gain error actually increased from 0.1713 to
0.1773. The correction is sensitive to the values already present in the proposal.

## Human recordings and original clip

On the three human excerpts, the estimator proposed **zero dynamics changes** across
563 matched notes. No velocity improvement was demonstrated. A separate key-release
comparison changed mean endpoint discrepancy from 172 ms to 289 ms, but this is
explicitly **not an audible-duration accuracy score**: pedal and acoustic decay can
extend sound beyond MIDI key release. Checked audible endings are still needed for
a valid human duration benchmark.

On the original 34-note excerpt, the offline estimator proposed **18 duration changes
and zero dynamics changes**. Their correctness cannot be scored without checked
audible endings. The proposals remain diagnostic and were not applied.

## Implementation problems exposed

1. **Duration confuses shared harmonic energy with the target note's own decay.**
   Harmonic SNR can remain high because another pitch is sounding, or fall early
   during a genuine sustained note. The current threshold does not distinguish
   these explanations sufficiently. A source-specific decay estimate needs explicit
   competing-note and overlap uncertainty before it can authorize an edit.
2. **Dynamics can count existing intensity twice.** It multiplies the existing
   velocity by a factor derived from recorded loudness relative to other notes.
   When the existing value already reflects that loudness, the contrast is exaggerated.
   One correct gain of 0.22 was reduced to 0.083.
3. **Harmonic SNR is not a pitch-independent velocity calibration.** In an equal-gain
   control, notes with the same target 0.5 were proposed as 0.811 and 0.257 at different
   pitches. Pitch, timbre and noise affect the measurement.
4. **Dynamics coverage is insufficient for piano music.** The implementation skips
   overlapping notes rather than estimating the separate intensities in a chord or
   accompaniment. Shortening a proposed duration can also cause a note to be treated
   as isolated even while its acoustic tail overlaps another strike.

Duration and dynamics need estimator improvements plus a fresh accuracy benchmark;
changing qualification thresholds would not address these failures. MIDI key release,
audible ending, written note length and pedal state must retain separate targets.

## Reproduce

```powershell
$env:PYTHONPATH = (Resolve-Path .venv-music/Lib/site-packages).Path
$env:OMP_NUM_THREADS = '1'
.venv-saas/Scripts/python.exe scripts/benchmark_piano_expression.py `
  --samples music-candidate-run/editors/riffscore/demo/public/audio/piano `
  --weights music-candidate-run/basic-pitch-0.4.0/model.onnx `
  --output .local/piano-expression-audit --seeds 3 `
  --human-results .local/piano-system-audit/human-recordings
```

The nine existing expression software tests also passed. Those tests verify selected
behavior and safeguards; the accuracy benchmark above shows why they were insufficient
to establish musical improvement.
