# Piano attack decoding: measured comparison

11 November 2026. Basic Pitch 0.4.0 / ONNX weights are unchanged. The new
`basic-pitch-0.4.0/piano-peaks-v1` decoder is separately profiled and does not
change legacy or guitar profiles.

## Implemented behavior

- Select attack peaks independently for each piano pitch: onset 0.60,
  prominence 0.20 in a 25-frame neighborhood, minimum spacing 70 ms.
- Disable frame-difference inferred attacks and Melodia for this profile. They
  can create extra strikes during an already ringing note.
- Reduce minimum decoded note length from 127.7 to 80 ms; retain frame threshold
  0.30. These times are quantized to Basic Pitch's frame grid.
- Preserve polyphony and real octaves. No key-signature correction, octave
  deletion, beat snapping, or fixed-duration chopping is applied.
- Copy prediction arrays before decoding. The archived raw arrays remain
  untouched and both legacy and new decoding can be reproduced.
- Retain `baseline-reference.json` alongside the selected proposal, raw arrays,
  MIDI, metadata and complete settings in the owner-only analysis zip.
- Clamp serialized notes to media boundaries without extending the last note
  past the end just to satisfy a minimum length.

## Comparison and selection

`scripts/benchmark_piano_decoding.py` renders 36 eight-second piano mixtures from
locally supplied recorded piano samples, with exact known attack references.
Each contains 39 notes: two hands, chords (including real octaves), dynamics,
timing variation, fast same-pitch repeats and overlapping ringing tails.

Twelve cases were used for parameter selection, twelve for diagnostic checks,
and twelve fresh seeds for final validation. Match policy: one-to-one exact
pitch within 50 ms using `mir_eval`; timings are not quantized for matching.

| Final held-out 468 notes | Matched | Missing | Extra | Precision | Recall | F1 | Attack MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Existing profile | 408 | 60 | 145 | .738 | .872 | .799 | 11.92 ms |
| Piano peaks | 420 | 48 | 60 | .875 | .897 | .886 | 11.25 ms |
| Lower onset to .35 | 404 | 64 | 292 | .580 | .863 | .694 | 11.96 ms |
| Only disable inferred attacks | 408 | 60 | 139 | .746 | .872 | .804 | 12.22 ms |

Additional experiments considered pitch-specific spectral energy rises,
conditional weak re-attacks, harmonic/octave suppression, onset/frame
agreement and threshold grids. They did not beat the selected decoder on the
selection cases without additional losses, so they were not shipped. In
particular, weak re-attacks inside long notes introduced many extra notes.

This is sample-rendered validation, not a manually transcribed human performance.
All splits share one sample bank and related generated patterns. Tail overlap
approximates sustain; it does not simulate an acoustic pedal mechanism. Do not
infer key-release or pedal accuracy, or generalization to every piano, from
these scores. No audio samples or third-party weights are redistributed.
The JSON report retains sample SHA-256 identities, seeds, settings and summaries.

## User clip

The 14.677-second uploaded excerpt produces 34 notes with the selected profile,
versus 46 with the original. For an independent diagnostic only, the published
Kong/ByteDance piano model produced 37 events. Original Basic Pitch agreed on
33 attacks with 13 unmatched events; the new decoder agreed on 32 attacks with
2 unmatched events. This trades one agreement for eleven fewer disagreements.
It is supporting evidence, not a human-verified accuracy score.

The independent model did not support automatically adding the suspected D3
re-attacks. Subthreshold peaks can be caused by other notes and should not be
assumed to be missing strikes. Some weak pitches remain missing; neither model
is considered ground truth. This companion model is not a production dependency.

## Reproduce and operate

Run in the environment with Basic Pitch installed:

```powershell
.venv-music/Scripts/python.exe scripts/benchmark_piano_decoding.py --samples music-candidate-run/editors/riffscore/demo/public/audio/piano --weights music-candidate-run/basic-pitch-0.4.0/model.onnx --output .local/piano-benchmark
```

Create a new worker profile from the existing model and operator evidence:

```powershell
.venv-saas/Scripts/python.exe scripts/prepare_piano_decoder_profile.py --weights music-candidate-run/basic-pitch-0.4.0/model.onnx --evidence music-candidate-run/basic-pitch-0.4.0/commercial-evidence.txt --output music-candidate-run/piano-peaks-v1
```

The generator refuses to overwrite an existing profile. It does not approve
commercial licensing or alter a server allowlist. If the server enforces a
profile allowlist, the operator must register the verified profile through the
existing deployment process. Keep the old profile for rollback.

Start the piano worker with the new profile/config/adapter paths and existing
weights/evidence paths. The worker and adapter must use a Python executable
permitted to write its attempt directory. On this local host, the working
launcher is `.venv-saas/Scripts/python.exe` with `PYTHONPATH` pointing to the
absolute `.venv-music/Lib/site-packages` directory. This preserves the music
dependencies in an isolated adapter subprocess without installing them in the API.

`redecode_basic_pitch_analysis.py` uses the same decoder as the adapter. Its
`--decoder legacy` and `--decoder piano` options allow comparisons from one
artifact, without inference or changing the saved lesson.

The original user lesson remains unchanged. A separate comparison draft is
processed through the real upload/worker/review path, with its own provenance.

## Verified local deployment

- Profile: `476275668da0669b250dff26942b70a2f9bab1d463817fc42fe8803845836931`.
- Registered this exact hash alongside the previous hash. Profile verification
  remains enabled; the public allowlist is persisted in the local environment.
- Comparison lesson: `18593155967047db980543a4ad49cf04`, title
  `Video Project 8 — improved piano`, ready for review with 34 notes.
- Original lesson: `fbbac9f3097040b8afcd7a599995b80b`, unchanged at 46 notes.
- Downloaded the live analysis artifact and verified its profile identity,
  34-note proposal and 46-note baseline; replay also produces 34 notes.
- Verified the review page renders all 34 notes. No instructor confirmation,
  release or sharing action was performed.
- 51 focused tests passed: 9 decoder regressions, 24 profile/transcription
  tests, and 18 worker/handoff/media/review tests. Python compilation and
  whitespace checks passed. The API tests require local service access.
