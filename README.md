# Local SAM 3D Body video experiment

Scope: run Meta's official SAM 3D Body on the RTX 4060, process one short
single-person video, and export structured motion plus a skinned skeletal GLB.
The reconstruction pipeline is kept separate from the browser practice interface.

The new SaaS foundation lives in `apps/`, with a responsive library, 3D practice
preview, and section editor. See [SaaS setup](docs/saas-development.md) and the
[phase verification record](docs/phase-0-verification.md). The existing local
prototype below remains available while the new application is built.

## Repository contents

This repository tracks the application source, setup scripts, dependency locks,
tests, and product requirements. Downloaded dependencies, model weights, input
videos, generated motion files, browser runtime assets, and local credentials
are excluded from Git. They remain on the original development machine; a fresh
clone must follow the setup and asset preparation instructions below and in
`web/README.md`. The recorded local results below describe that machine's runs;
their output files are not bundled with the repository. Browser tests that read
the accepted reference animation also require those prepared local assets.

The editable browser application source currently lives in `web/dist/`; only
its downloaded `vendor/` and generated `assets/` subdirectories are ignored.

The next-phase browser practice prototype now lives in `web/`. See
[web/README.md](web/README.md) for camera tracking, fixed height calibration,
side-by-side practice and local phone access. Start it with
`powershell -ExecutionPolicy Bypass -File scripts/start_practice.ps1`.

## Verified local run — 17 October 2026

SAM 3D Body ran successfully on the NVIDIA RTX 4060 Laptop GPU (8 GB), using
the hash-verified BlendCap redistribution of Meta's DINOv3 checkpoint.
The supplied 15-second Taegeuk clip produced 225 poses at approximately 15 fps.
Inference took 70.52 seconds excluding model loading, with a PyTorch peak
reserved allocation of 3.58 GiB. Model loading and the first frame were also
tested separately before the complete run.

Results are in `outputs/demo/`: `motion.npz`, `motion.json`, `motion.glb`,
`motion_smoothed.glb`, `pose_contact_sheet.jpg`, and `verification.json`.
Both GLBs contain a skinned mesh and 127-joint skeleton. Preserved source
timestamps and finite animation values were checked. On 12 sampled frames,
exported joint positions matched the intended native MHR poses to within
0.000002 metres. This checks export fidelity, not accuracy against real 3D
ground truth. Eight source-image landmark overlays were visually inspected.
World trajectory, occluded limbs, fast motion, and foot contact still need
motion-quality assessment; no contact solver is included in this baseline.

## Setup

Use Python 3.12 and FFmpeg/ffprobe on Windows. The setup uses an isolated `.venv`
and CUDA 12.8 PyTorch; it does not replace system Python packages.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

The official SAM source is pinned to
`b5c765a0d89d789985e186d396315e7590887b94`. Optional Detectron2, SAM segmentation,
and MoGe are deliberately excluded. The input is assumed to show one person,
clearly visible; pass a fixed `--bbox X1 Y1 X2 Y2` if needed.

Request/accept access at https://huggingface.co/facebook/sam-3d-body-dinov3.
Authenticate locally if needed; do not put a token in source files or chat.

```powershell
.venv/Scripts/hf.exe auth login
.venv/Scripts/python.exe scripts/download_models.py
.venv/Scripts/python.exe scripts/check_environment.py
```

An alternative public redistribution is available while official access is
pending:

```powershell
.venv/Scripts/python.exe scripts/download_models.py --verified-mirror
```

This uses `Blendcap/sam-3d-body`, compares all four files (license, configuration,
checkpoint, TorchScript body model) against Meta's public repository metadata,
and verifies the downloaded bytes. A mismatch stops the download workflow.
Source revisions and verified digests are retained in `models/sam-3d-body-dinov3/provenance.json`.
The original SAM License continues to govern use; the mirror is not endorsed by Meta.

Rig assets come from Meta's public MHR v1.0.1 release. Inference uses the
official checkpoint's TorchScript body model. DINOv3 source is loaded locally
from `vendor/dinov3`, pinned to `6876159a11b4df116f30f667f8c9888617df0751`.
The runner redirects the upstream torch.hub request to this local checkout.

## Run

The supplied YouTube demonstration has been downloaded to `inputs/taegeuk_1_jang.mp4`.
`inputs/demo_15s.mp4` contains source seconds 10–25, without audio. Source attribution
is retained in `inputs/taegeuk_1_jang.info.json`. Its downloaded resolution is
640×360. Once model files are downloaded, `scripts/run_demo.ps1` runs this clip
with a fixed person crop and exports raw and lightly smoothed GLBs.

First run one frame and inspect `first_frame_keypoints.jpg`:

```powershell
.venv/Scripts/python.exe scripts/process_video.py inputs/demo.mp4 --max-frames 1 --output outputs/one_frame
```

Then process 15 seconds, sampling up to 15 frames/second, sequentially:

```powershell
.venv/Scripts/python.exe scripts/process_video.py inputs/demo.mp4 --duration 15 --fps 15 --output outputs/demo
.venv/Scripts/python.exe scripts/export_glb.py outputs/demo/motion.npz
```

The default `body` mode estimates the entire body without the extra hand-crop
refinement passes. Use `--inference-type full` for refined hands after the
baseline succeeds. `--fps 0` keeps every source frame. Different runs require
different output folders so that partial results cannot be mixed accidentally.

Optional lightly smoothed export, keeping the raw data:

```powershell
.venv/Scripts/python.exe scripts/export_glb.py outputs/demo/motion.npz --smooth 0.75 --output outputs/demo/motion_smoothed.glb
```

The full visible demonstration (source 5.5–48.3 seconds, excluding the title-only
intro) can be processed with the same settings:

```powershell
.venv/Scripts/python.exe scripts/process_video.py inputs/taegeuk_1_jang.mp4 --start 5.5 --duration 42.8 --fps 15 --bbox 190 70 470 330 --output outputs/full_video
.venv/Scripts/python.exe scripts/export_glb.py outputs/full_video/motion.npz
.venv/Scripts/python.exe scripts/render_pose_preview.py outputs/full_video
```

The preview is a fixed oblique view of the raw 3D skeleton beside the original
source frames. The GLB contains the skinned animated body and can be viewed from
any angle. Preview timestamps refer to the original source video.

## Outputs and limitations

- `frames/*.npz`: per-frame parameters saved immediately, including original timestamp.
- `motion.npz`: numeric arrays, readable with `numpy.load(..., allow_pickle=False)`.
- `motion.json`: source, timestamps, coordinate conventions, array shapes, GPU memory and timing.
- `motion.glb`: neutral MHR skinned character with skeletal animation; source timestamps retained.
- `motion.export.json`: export settings and limitations.
- `first_frame.jpg`, `first_frame_keypoints.jpg`: initial visual check.

GPU measurements are PyTorch peak allocated/reserved memory, not total device
memory including the driver and other applications. Use `nvidia-smi` for the latter.

The GLB fixes skeletal scale over the clip. It retains **estimated relative
camera translation**, converted to native rig axes; this is not a calibrated
world-space trajectory. An in-place export is available with `--in-place`.
There is no foot-contact solver. Optional smoothing can soften fast motions and
must be checked against the source video. The skin is a neutral MHR body, not
a textured reconstruction of the instructor.

## Exporter verification

```powershell
.venv/Scripts/python.exe scripts/verify_export.py
```

This creates an explicitly **synthetic** three-frame animation, checks a 180°
turn, nonuniform timestamps, skin and animation presence, and all exported joint
positions against native MHR forward kinematics. It does not validate SAM
inference or reconstruction quality on a real video.

## Licenses

SAM code and weights retain Meta's SAM License (`vendor/sam-3d-body/LICENSE`).
MHR rig assets retain their Apache 2.0 license (`models/mhr/assets/LICENSE.txt`).
PyMomentum and all other dependencies retain their own terms.
