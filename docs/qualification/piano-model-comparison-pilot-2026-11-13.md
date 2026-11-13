# Raw piano model comparison — pilot run, 13 November 2026

Status: three permitted variants executed on both pilot inputs; two licence rows blocked.
Results are **diagnostic**, not a model-selection decision. No human listening data exists.
No correction stage ran and no lesson document was modified.

## Host and environments

- Windows development host, NVIDIA GeForce RTX 4060 Laptop GPU (8 GB), driver 572.42.
- Basic Pitch 0.4.0: `.venv-music`, ONNX CPU, pinned weights SHA-256 `2c3c1d14…`.
- Kong: `.venv`, PyTorch `2.8.0+cu128`, CUDA, checkpoint SHA-256 `c3fa9730…`.
- Kong inference dependencies (`librosa 0.10.2.post1`, `torchlibrosa 0.1.0`, `audioread`,
  `mido`, `matplotlib`) were installed into `.venv` for this pilot. The vendored
  `load_audio` helper assumes an older librosa private API, so the adapter feeds the
  already-prepared 16 kHz mono samples directly; the samples are identical.
- A host quirk: `.venv-music` is denied writes under dot-directories, so its outputs were
  staged in `model-pilot-output/` and archived with PowerShell. Artifact hashes are
  unaffected.

## Inputs

| input | identity | duration | reference |
|---|---|---|---|
| Owner's current lesson | video SHA-256 `aa0a545e…`, extracted audio SHA-256 `5fb6b892…` | 15.616009 s, 22 050 Hz mono | none; source-only |
| Vienna Chopin Op.38 p01 | audio SHA-256 `808a6a3e…` | 128.199274 s, 44 100 Hz stereo | corrected captured MIDI, 727 notes, velocity and pedal verified, **alignment unverified** |

The historical 14.677 s / 34-note clip was not used.

## Owner clip — observation only

| variant | detected notes | runtime | device |
|---|---:|---:|---|
| Basic Pitch — native | 51 | 10.2 s (cold first run) | CPU ONNX |
| Basic Pitch — current app | 36 | 2.6 s | CPU ONNX |
| Kong | 38 | 23.2 s | CUDA |

There is no independent note reference for this clip, so every correctness, timing,
velocity and pedal cell is `reference_unavailable` or `not_estimated`. "36/51/38 notes
detected; correctness not measured — no reference." The parent job ran all three
permitted variants and recorded Transkun (`model_selection=unresolved`) and Onsets and
Frames (`maestro:model_selection=prohibited`) as `blocked_license`; parent status is
`partial`, never `complete`.

## Vienna — reference-based, diagnostic

All cells are `diagnostic_only` because the audio/MIDI alignment has not been independent
verified. Captured MIDI note-off is not an audible-end label.

| variant | detected | matched | missing | extra | precision | recall | F1 | onset MAE | p95 | bias | within 20 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Basic Pitch — native | 784 | 522 | 205 | 262 | 0.666 | 0.718 | 0.691 | 15.25 ms | 37.27 ms | +10.36 ms | 49.8 % |
| Basic Pitch — current app | 686 | 562 | 165 | 124 | 0.819 | 0.773 | 0.795 | 14.71 ms | 32.97 ms | +9.46 ms | 53.8 % |
| Kong | 739 | 718 | 9 | 21 | 0.972 | 0.988 | 0.980 | 12.30 ms | 26.40 ms | +10.82 ms | 79.4 % |

Additional Kong cells: MIDI velocity MAE **11.71 units** (model-estimated against captured
values); sustain pedal transition F1 **0.402** with time-weighted state agreement
**0.856**. Basic Pitch reports neither velocity nor pedal. Physical key release and
audible ending are `not_estimated` for every variant. Written rhythm is
`unsupported_semantics`.

Runtimes: Basic Pitch native 2.4 s, current app 2.5 s on CPU; Kong 22.2 s on CUDA. The
owner-clip Basic Pitch run was cold (10.2 s), so these are not a controlled speed ranking;
cold model load was not separated from inference.

## What this supports — and what it does not

- On this one recording and this reference, raw Kong is substantially closer than either
  Basic Pitch decoding: 9 missing / 21 extra versus 165–205 missing / 124–262 extra.
- The current app decoder is materially better than native Basic Pitch decoding on this
  reference (F1 0.795 vs 0.691), which is why the plan requires both variants.
- Timing differences are small (12.3–15.3 ms MAE) and all variants run late by about 10 ms.
- The velocity and pedal evidence exists only for Kong, and pedal transition detection is
  weak even though sustained state agrees most of the time.
- It does **not** establish a universal winner: one performance, unverified alignment,
  a captured MIDI reference that may itself contain errors, no listening study, and no
  second paired recording. A model-selection decision still needs the full four families
  (or explicit permanent exclusion) and additional performances.

## Preview fidelity (corrected 13 November, after the live review)

The first previews were not a faithful duration/dynamics comparison: they ignored the
native sidecar, ignored Basic Pitch amplitude, and clipped. All pilot previews have been
regenerated with one policy:

- **Native endings:** the declared native offset is used as the as-transcribed render
  duration for every note (36 / 51 / 38 on the owner clip; 686 / 784 / 739 on Vienna). It
  is labelled `legacy-not-release`, the convention and sidecar SHA-256 are recorded in the
  preview manifest, and it is never presented as measured physical release.
- **Amplitude:** Basic Pitch amplitude is mapped to an uncalibrated `render_intensity`
  (`clamp(amplitude, 0, 1)`) for the default preview only; `velocity_midi` stays null.
  Notes-only mode remains fixed-intensity.
- **Headroom:** one declared **-24 dB** pre-saturation headroom is applied to every model
  preview and bound into the render identity. No per-model normalization.

Result: every regenerated pilot preview has `clipping: false` (peaks between -17 and
-14.7 dBFS). Audio diagnostics were rescored: Vienna objective (normalized / fixed-gain)
is 0.4923 / 0.5097 for Basic Pitch native, 0.4948 / 0.5119 for current-app and
0.4696 / 0.5085 for Kong; the owner clip is 0.5711 / 0.5727, 0.5776 / 0.5789 and
0.5421 / 0.5422. These remain `diagnostic_only` and approximate; they are not fidelity
evidence and no listener ratings exist.

The two live comparisons (`7b40e5aaea794b01b04492e98f8c5f79` and
`b3e6a6955f6f477fa705bfb1c4c30058`) also had their previews regenerated in
`model-pilot-output/live-comparisons/`, so their next results request recomputes the audio
row from clipping-free previews. The running API process must be restarted to pick up the
adapter/preview code changes; the page needs only a refresh for the new bundle.

## Remaining

Package 6 is implemented and verified through the normal app and API; the earlier statement
that it was not implemented was stale. Remaining limitations are: the two blocked checkpoint
permissions (so the four-family experiment is incomplete), no listener data, a development
executor that finishes an in-flight subprocess before honouring cancellation, and a page
with source audio and note roll but no source-video panel or keyboard. New lesson uploads
can now be registered through the owner-checked "Use this lesson's retained source" action.


## Artifacts

- `.local/repo-research/model-pilot/clip/` — three run directories (document, native
  sidecar, semantics, receipt, prepared audio), previews, source-only `comparison.json`,
  and the parent job under `job-clip-raw/`.
- `.local/repo-research/model-pilot/vienna/` — same layout plus `reference.json` and the
  reference-based `comparison.json`.
- Every run receipt records `correction_enabled: false`, `expression_correction_enabled:
  false` and `correction_operations: 0`; the model output hashes are frozen before scoring.

## API and browser acceptance

The owner clip was also run through the HTTP API and the built comparison page on a
temporary database: source registered, comparison started from the page, three adapters
executed sequentially, previews rendered, and two blocked rows displayed. The browser test
confirmed one audio element switching between Kong and Basic Pitch native while preserving
the 5 s position, preview metadata loading for each model, and the results table showing
`no reference` / `not estimated` / `blocked by licence` rather than zeros. Screenshots are
under `.local/repo-research/model-pilot/browser/`. Runtime in that warm API run was
3.0 s / 3.2 s CPU for the two Basic Pitch variants and 8.7 s CUDA for Kong; it is not
comparable to the earlier cold 10.2 s and is not a speed ranking.

The full Vienna recording was then run through the API with its reference registered. The
same measurements were reproduced exactly (F1 0.691 / 0.795 / 0.980; missing 205 / 165 / 9;
MAE 15.25 / 14.71 / 12.30 ms), all correctness and timing cells stayed `diagnostic_only`,
Kong velocity was `diagnostic_only`, and the audio row was `diagnostic_only` for every
model. The two blocked rows remained explicit and the parent finished `partial`. Artifacts
and the result JSON are under `.local/repo-research/model-pilot/vienna-api/`.

## Remaining

See the corrected limitations above. No lesson was mutated by any pilot run. The broader
four-family experiment remains incomplete until the two blocked checkpoints can run.
