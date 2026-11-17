# Pinned midi2hands source and model

- Upstream: https://github.com/pianoviz/midi2hands
- Pinned commit: `78e546b520144b301de5e793ceb83be61356a65d`
- License: MIT, Copyright (c) 2025 pianoviz (see `LICENSE-midi2hands.txt`)
- Model artifact: `src/midi2hands/models/onnex/model.onnx`
- Model URL: https://raw.githubusercontent.com/pianoviz/midi2hands/78e546b520144b301de5e793ceb83be61356a65d/src/midi2hands/models/onnex/model.onnx
- Size: 252047 bytes
- SHA-256: `6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd`
- ONNX input: `[1, 64, 4]` float32; output: `[1, 1]` float32
- Runtime path: CPUExecutionProvider only

## Observed label convention

The upstream interface documents `0 = left, 1 = right` in
`HandFormer.convert_hand_to_number`, but the pinned training preprocessing labels
MIDI track 1 as "right" and every other track as "left", while the upstream test MIDI
`000-Faure_ClaireDeLune_Op46No2.mid` names track 0 `Rechts` (right) and track 1
`Links` (left). The pinned model consequently learned the inverse musical mapping:
raw prediction `0` behaves as musical **right**, raw prediction `1` as musical **left**.

The adapter preserves both labels per note:

- `prediction`: raw thresholded model label 0/1
- `upstream_label`: the upstream code's label (`0=left`, `1=right`)
- `hand`: the musically corrected label (`0=right`, `1=left`)

This correction is required for musical hand semantics and is not a claim of accuracy.
Raw scores are uncalibrated and no percentage is fabricated.

## Reproducible setup (optional, isolated)

```powershell
py -3.12 -m venv .venv-midi2hands
.\.venv-midi2hands\Scripts\python.exe -m pip install --upgrade pip
.\.venv-midi2hands\Scripts\python.exe -m pip install -r tools\midi2hands\requirements-cpu.txt
.\tools\midi2hands\setup.ps1
```

`setup.ps1` downloads the pinned model into `tools/midi2hands/model.onnx` and verifies
the exact size and SHA-256. It does not install globally or download datasets. The pinned
CPU wheels are approximately 12.6 MB (NumPy 2.5.4) + 14.9 MB (onnxruntime 1.31.1), plus
the 252 KB model; none are part of the mandatory application runtime. These are the
validated runtime versions; the API discovers `.venv-music` by default and never imports
NumPy/onnxruntime in its own process.

## Backend operation

The API exposes `GET /api/piano/hands/status` and owner-only
`POST /api/lessons/{lesson_id}/hand-estimates` (max 20,000 events, 45 s subprocess timeout,
one bounded CPU slot, 5 s queue wait, 300 s / 64-entry fingerprint cache, same-input
coalescing). It discovers `.venv-music/Scripts/python.exe` by default; `.venv-midi2hands`
is incomplete and is never auto-used. No model runtime is imported into the API process.

Optional operator overrides (restart the API after changing them):

```powershell
$env:HANDS_MODEL_PYTHON = 'D:\3d_trainer\developement\.venv-music\Scripts\python.exe'
$env:HANDS_MODEL_ARTIFACT = 'D:\3d_trainer\developement\tools\midi2hands\model.onnx'
$env:HANDS_MODEL_ENABLED = 'true'
```

Disable with `HANDS_MODEL_ENABLED=false`; the canonical baseline then remains fully
available. Restart via the existing local server process (for example
`.\scripts\start_saas.ps1`). No secrets are required.

## Commands

```powershell
# after the optional setup above
$env:PYTHONDONTWRITEBYTECODE='1'
.\.venv-midi2hands\Scripts\python.exe tools\midi2hands\adapter.py `
  --input docs\qualification\piano-workspace-phase-06\long-draft.json `
  --model tools\midi2hands\model.onnx --summary

.\.venv-midi2hands\Scripts\python.exe tools\midi2hands\adapter.py `
  --input docs\qualification\piano-workspace-phase-06\long-draft.json `
  --model tools\midi2hands\model.onnx |
  node --import .\apps\web\tests\runner\register.mjs tools\midi2hands\compare.mjs `
    --performance docs\qualification\piano-workspace-phase-06\long-draft.json `
    --model - --summary
```
