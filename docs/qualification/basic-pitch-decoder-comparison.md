# Basic Pitch decoder comparison

Synthetic aligned MIDI+audio fixtures, not human performances. Matching is one-to-one by exact pitch within 80 ms; offset/duration are reported separately.

| Configuration | Ref | Detected | Matched | Missing | Extra | Onset MAE | Offset MAE | Duration MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms |
| onset_0.35 | 19 | 38 | 18 | 1 | 20 | 6.27 ms | 221.05 ms | 220.69 ms |
| frame_0.40 | 19 | 29 | 19 | 0 | 10 | 6.32 ms | 101.23 ms | 101.57 ms |
| melodia_on | 19 | 35 | 19 | 0 | 16 | 6.32 ms | 102.19 ms | 102.65 ms |
| infer_onsets_off | 19 | 28 | 19 | 0 | 9 | 4.99 ms | 79.03 ms | 80.21 ms |
| pitch_bends_on | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms |

Pitch-bend configuration leaves the extracted pitch/onset events identical: **True**.


## Duration convention

The predicted end is Basic Pitch's decoded frame release. The reference end is the MIDI
key-release time. They are compared as an **offset error**, separately from missing/extra
notes; sustain-pedal resonance can legitimately outlast key release and is not classified
as a missing or extra note.

## Existing 14.677 s clip (diagnostic only)

The existing clip was re-inferred from its stored source. Re-decoding reproduces the
reported counts exactly:

| Configuration | Notes |
|---|---:|
| current | 46 |
| onset 0.35 | 77 |
| frame 0.40 | 40 |
| Melodia enabled | 73 |
| inferred onsets off | 42 |
| pitch bends enabled | 46 |

The D3 onset activation peaks near 10.02 s and 11.34 s are 0.4507 and 0.4388, below the
0.5 onset threshold. Lowering the threshold to 0.35 recovers D3 attacks at 9.956 s and
11.268 s, but also produces 31 additional detections and one missed reference note on the
aligned fixture set. This clip has no manually checked reference transcription, so these
counts are diagnostic evidence, not accuracy ground truth.

## Selection

No threshold or Melodia default was changed. The aligned synthetic fixtures show
`infer_onsets_off` with fewer extras and lower offset error, but they are not human
performances and the existing clip has no verified reference; changing defaults on that
basis would be unjustified. The explicit current defaults remain the baseline.

Disabling pitch-bend estimation leaves the extracted note events byte-for-byte equal in
this comparison and avoids contour pitch-bend work; the profile records
`include_pitch_bends=False`.

## Caveat

These five fixtures are synthetic, aligned MIDI+audio cases covering single/short notes,
chords/overlap, repeated strikes, soft-under-loud and pedal sustain. They are not human
piano recordings. Human-verified reference notes are still required before claiming
accuracy or changing defaults.
