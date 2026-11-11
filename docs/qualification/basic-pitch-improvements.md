# Basic Pitch integration audit and improvements

11 November 2026. Scope: Basic Pitch 0.4.0 ONNX only. No custom note splitting, harmonic
suppression, quantization, key correction or second model was added.

## 1. Retained raw predictions

The adapter now calls `run_inference()` once and explicitly decodes with
`model_output_to_notes()`. It retains `raw.npz` (note/onset/contour float32 arrays),
`proposal.mid`, the original proposed reference and `metadata.json` in an internal
`analysis.zip`.

Metadata records model/version, weights/profile/audio/source SHA-256, sample rate,
thresholds, every decoding choice, array shapes and note count. The server stores the zip
as an owner-only lesson asset:
`GET /api/lessons/{id}/music-analysis` and `/music-analysis/artifact`.
Learners/invitees and the generic asset route return 404. Retention defaults to 30 days and
`scripts/prune_music_analysis.py` removes only expired analysis zips. Raw activations can
be re-decoded without inference with `scripts/redecode_basic_pitch_analysis.py`; the
original proposal is preserved.

## 2. Explicit, versioned decoding

The verified profile now carries a `decoding` block (version
`basic-pitch-0.4.0/decoding-v1`):

- onset threshold 0.5, frame threshold 0.3, minimum note 127.7 ms;
- inferred onsets **enabled**;
- Melodia **disabled**;
- pitch-bend inclusion **disabled** and multiple pitch bends disabled;
- MIDI tempo 120, no frequency bounds.

These are validated by `music_run_profile.py` and must match `config.json` exactly.
Thresholds remain configurable. Disabling pitch-bend extraction leaves the extracted
pitch/onset events identical in the comparison below while avoiding contour pitch-bend
work.

## 3. Measured comparison

Aligned synthetic MIDI+audio fixtures cover single/short notes, chords/overlap, repeated
same-pitch strikes, soft-under-loud and pedal sustain. Matching is one-to-one by exact pitch
within 80 ms. Offset/duration is reported separately; sustain extending past key release is
not a missing/extra note.

| Configuration | Ref | Detected | Matched | Missing | Extra | Onset MAE | Offset MAE | Duration MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms |
| onset 0.35 | 19 | 38 | 18 | 1 | 20 | 6.27 ms | 221.05 ms | 220.69 ms |
| frame 0.40 | 19 | 29 | 19 | 0 | 10 | 6.32 ms | 101.23 ms | 101.57 ms |
| Melodia on | 19 | 35 | 19 | 0 | 16 | 6.32 ms | 102.19 ms | 102.65 ms |
| inferred onsets off | 19 | 28 | 19 | 0 | 9 | 4.99 ms | 79.03 ms | 80.21 ms |
| pitch bends on | 19 | 32 | 19 | 0 | 13 | 6.32 ms | 102.19 ms | 102.65 ms |

Repeated-note pairs recovered: 3/3 for every configuration. No threshold default was
changed: the fixtures are synthetic, not human performances, and the sample is too weak to
justify a default solely from this table.

The existing 14.677 s clip reproduces the reported counts: current 46, onset 0.35 77,
frame 0.40 40, Melodia 73, inferred-onsets-off 42, pitch-bends-on 46. The D3 onset peaks
near 10.02 s and 11.34 s are 0.4507 and 0.4388, below 0.5. Onset 0.35 recovers D3 attacks
at 9.956 s and 11.268 s but produces 31 additional detections; that is diagnostic, not an
accuracy win. This clip has no manually checked reference transcription.

## 4. Audio and timing

The worker extracts exactly the uploaded source with `-map 0:a:0 -vn -t <duration> -ar
22050 -ac 1 -c:a pcm_s16le`; it adds no gain, silence, time stretch or `job.start` offset.
The 14.677 s source and its analysis WAV are both 14.677 s. Its ~0.94 s difference from the
original recording is the user's pre-upload trim, not a second timeline offset.

## 5. Audition

The review preview now uses a harmonic `PeriodicWave` with a decay envelope rather than
plain sine/triangle oscillators. The visual playhead starts when the scheduled audio clock
starts (50 ms schedule delay), not immediately. All displayed notes up to the 1,000-note
audition cap are scheduled; above the cap the UI explicitly says that only the first 1,000
are shown/auditioned. The source video remains sticky.

## Remaining errors and limits

- The comparison set is synthetic; human-verified piano references are still required.
- 13 extra detections remain on the synthetic set at current settings.
- D3 soft attacks are rejected at 0.5; lowering to 0.35 admits them but adds many extras.
- Pitch/onset metrics are strong on the synthetic set, but offset/duration error is about
  100 ms; held-note behavior is not claimed improved.
- No default threshold/Melodia change was made.
- Raw analysis is owner-only and retained 30 days; it is not exposed to learners.
