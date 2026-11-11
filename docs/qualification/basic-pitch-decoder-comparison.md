# Basic Pitch decoder comparison

Synthetic aligned MIDI+audio fixtures, not human performances. Matching is one-to-one by exact pitch within 80 ms; offset/duration are reported separately.

| Configuration | Ref | Detected | Matched | Missing | Extra | Onset MAE | Offset MAE | Duration MAE | Velocity MAE | Soft MAE | Loud MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms | 0.24 | 0.45 | 0.08 |
| onset_0.35 | 19 | 38 | 18 | 1 | 20 | 6.27 ms | 221.05 ms | 220.69 ms | 0.26 | 0.47 | 0.1 |
| frame_0.40 | 19 | 29 | 19 | 0 | 10 | 6.32 ms | 101.23 ms | 101.57 ms | 0.25 | 0.46 | 0.08 |
| melodia_on | 19 | 35 | 19 | 0 | 16 | 6.32 ms | 102.19 ms | 102.65 ms | 0.24 | 0.45 | 0.08 |
| infer_onsets_off | 19 | 28 | 19 | 0 | 9 | 4.99 ms | 79.03 ms | 80.21 ms | 0.24 | 0.45 | 0.08 |
| pitch_bends_on | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms | 0.24 | 0.45 | 0.08 |

Velocity MAE is separate from pitch/timing; soft <0.34 and loud >=0.60 groups.
Pitch-bend configuration leaves the extracted pitch/onset events identical: **True**.


## Duration and dynamics conventions

- Predicted end is Basic Pitch's decoded frame release; reference end is MIDI key release.
  They are compared as offset error, separately from missing/extra notes. Sustain-pedal
  resonance can legitimately outlast key release.
- Velocity is Basic Pitch's approximate note amplitude, not key pressure or calibrated
  MIDI velocity. Velocity MAE is reported separately; soft reference notes (<0.34) and
  loud notes (>=0.60) are grouped separately.

## Existing 14.677 s clip (diagnostic only)

Re-inference with the stored settings reproduces 46 notes. Re-decoding gives: onset 0.35
77, frame 0.40 40, Melodia 73, inferred-onsets-off 42, pitch-bends-on 46. D3 onset peaks
near 10.02 s and 11.34 s are 0.4507 and 0.4388, below 0.5; onset 0.35 recovers D3 attacks
at 9.956 s and 11.268 s but adds 31 detections. No manually checked reference exists for
this clip, so these are diagnostics, not accuracy.

## Selection

No threshold or Melodia default changed. Inferred-onsets-off looks better on the synthetic
set, but the fixtures are not human performances and the existing clip has no verified
reference. Pitch-bend extraction is disabled: the extracted pitch/onset/velocity events are
identical in this comparison and pitch-bend work is unnecessary for the note guide.

## Caveat

The five fixtures are synthetic aligned MIDI+audio cases, not human piano recordings. Human
reference notes are still required before claiming accuracy or changing defaults. Soft-note
velocity is substantially less reliable than loud-note velocity (soft MAE 0.45 vs loud MAE
0.08 at current settings).
