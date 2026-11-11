# Transcription candidate: Basic Pitch 0.4.0

10 November 2026. **Candidate assembled; commercial approval is pending.** Actual ONNX
inference has run through the isolated worker on a rights-cleared recording.

## Candidate identity

| Item | Value |
| --- | --- |
| Model | Basic Pitch 0.4.0 (Spotify AB) |
| Code | `basic-pitch==0.4.0` wheel, SHA-256 `738adb503aae7fdfc7d1e1511aa0ce35052315f260a19531ef4c356708425db0` |
| Weights | `nmp.onnx` ICASSP 2022 checkpoint shipped in the wheel, SHA-256 `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec` |
| Adapter | [`scripts/music_basic_pitch_adapter.py`](../scripts/music_basic_pitch_adapter.py), SHA-256 `a5a3412fcbc0de07eb0ebf0ddf2548d963c1e3642b0876187c32bf71034668ee` |
| Profile | `b55aceaa68d76b60b14b21266a9c4b678607776606465893b4f2eefd9f2a16d4` (decoding v1) |
| Runtime | Python 3.12.2; ONNX Runtime 1.31.1; librosa 0.10.2.post1; NumPy 2.5.4; SciPy 1.18.1; pretty_midi 0.2.11.post0; mir_eval 0.8.2; resampy 0.4.3; scikit-learn 1.9.1; numba 0.68.1 |
| Preprocessing | mono PCM s16le at 22,050 Hz |
| Decoding | onset 0.5, frame 0.3, minimum note 127.7 ms; inferred onsets on; Melodia off; pitch bends off; MIDI tempo 120 |

The candidate uses Basic Pitch's bundled ONNX graph rather than TensorFlow; the package's
declared TensorFlow dependency is not installed. This is the same released checkpoint, but
the approval must cover the ONNX path and the exact runtime above. Every decoding choice is
recorded in the profile and in the retained analysis metadata.

## Licence and attribution

- Code and bundled weights: Apache License 2.0, Spotify AB. Retained at
  [`basic-pitch-0.4.0-LICENSE`](basic-pitch-0.4.0-LICENSE) and
  [`basic-pitch-0.4.0-NOTICE`](basic-pitch-0.4.0-NOTICE).
- Attribution: “Basic Pitch by Spotify AB, Apache License 2.0.”
- Commercial evidence file SHA-256: `2cefb2850e07b5d72f7bc08afef26272aa28586bcdb265042eb9165f4ac03377`.
- **Status: evidence assembled, legal/commercial approval pending.** The retained file is
  not an approval.

## Recording used for inference

- J.S. Bach, Well-Tempered Clavier Book 2, Prelude and Fugue in E major (BWV 878), excerpt
  0–12 s.
- Performed by Randolph Hokanson; recorded by Al Swanson on 18 June 2006 at the University
  of Washington.
- Source: [Wikimedia Commons File:JSBach WTC2 Prelude and Fugue Emaj.oga](https://commons.wikimedia.org/wiki/File:JSBach_WTC2_Prelude_and_Fugue_Emaj.oga),
  CC-BY-SA-2.0. The audio is not committed; the derivative excerpt remains CC-BY-SA-2.0.

## Actual inference result

- Transport: `music_worker.py` with the verified profile against a local mock API; source
  download, ffmpeg extraction, Basic Pitch ONNX inference, reference upload and draft
  handoff completed; the attempt directory was removed.
- Output: **59 note events** over 12 s, pitches 36–84; provenance records
  `model=basic-pitch`, `model_version=0.4.0`, `engine=onnx`, the profile digest and the
  analysis-audio digest.
- Retained draft: [`basic-pitch-draft-2026-11-10.json`](basic-pitch-draft-2026-11-10.json).
- Retained raw artifacts: the worker now writes an owner-only `analysis.zip` containing
  `raw.npz` (note/onset/contour activations), `proposal.mid`, `proposed-reference.json` and
  `metadata.json` (audio/weights/profile hashes, config, decoding, array shapes). Retention
  is 30 days by default and pruned with `scripts/prune_music_analysis.py`.
- Retained run report: [`basic-pitch-run-2026-11-10.json`](basic-pitch-run-2026-11-10.json).

This is a real transcription, not a fixture. It is unreviewed and no accuracy claim is
made. The real draft now passes the API journey through review, private release,
invitation and a learner fetch (`tests/api/test_real_transcription_journey.py`). A real
browser upload and playback session has not been recorded; that is the remaining UI
acceptance step, not a model gap.

## Reproduce

1. Install the exact runtime versions and `basic-pitch==0.4.0` (no TensorFlow needed for
   the ONNX graph).
2. Assemble weights, adapter, config and evidence; generate the run profile with
   `music_run_profile.load_profile`.
3. Run `music_worker.py` with `--profile/--weights/--code/--config/--approval` and
   `--adapter-command <python> adapter.py`; provide the source through the normal job.
4. Retain the draft and verify provenance/profile/audio digests.
