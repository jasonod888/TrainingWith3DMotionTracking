# Local foot silhouette experiment

This is an isolated visual experiment, not a lesson migration or a motion correction.
It generates SAM2.1 small whole-person masks and compares bottom mask boundaries
inside two adjustable image regions. It never substitutes SAM3D projected feet
for independent pixel measurements.

The current dataset is the first 8 seconds (121 frames, 15 fps) of project
`b3353ab96eb745328bb7078a56d98712`. The manually reviewed person prompt is
`580 190 720 550`. Initial foot review regions are clip-specific conveniences;
the person box and foot regions must be selected for a different video.

## Open

The local experiment is served at http://127.0.0.1:8002/ and binds only to loopback.
It serves `.local/foot-mask-experiment`, not the repository or other lesson files.
To restart from the repository root:

```powershell
.venv/Scripts/python.exe -m http.server 8002 --bind 127.0.0.1 --directory .local/foot-mask-experiment
```

## Regenerate

Dependencies: existing processing environment plus `iopath`, official SAM2 code
at `.local/sam2`, checkpoint `models/sam2.1_hiera_small.pt`. The SAM2 CUDA extension
is not required for this experiment; model postprocessing is explicitly disabled.

```powershell
.venv/Scripts/python.exe scripts/build_foot_mask_experiment.py --video PATH/preview.mp4 --motion PATH/motion.npz --output .local/foot-mask-experiment --box 580 190 720 550 --duration 8
```

The input must be the exact normalized preview used for inference, with one motion
sample per decoded frame. The builder checks frame indices and records hashes for
video, motion and checkpoint. It copies the preview and writes extracted frames,
full-resolution binary mask PNGs, `data.json` and the standalone HTML page.

The browser shows exact decoded sample frames; playback is frame-stepped rather
than relying on video-seeking approximations. Download measurements exports the
regions, baseline, bottom contour, pixel shift and shape overlap per sample.

## Interpretation

At 2 seconds the default regions show approximately 0–1 pixel median-boundary
shift while SAM's original estimated depth changes by 1.69 metres. This is useful
independent evidence to investigate false depth. It does not certify contact or
establish an accurate world path. Mask errors, clothing, rotation and cropping
can change the measurements. Whole-person silhouettes cannot separate overlapping
feet. Fixed regions cease to describe a foot when it moves out of the region.

Validated in headless Chromium: data/mask loading, exact 2-second scrubbing,
baseline reset, no page errors and no mobile horizontal overflow. Enlarged foot
masks and the full-page screenshot were inspected visually.
