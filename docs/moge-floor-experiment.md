# First-frame MoGe floor experiment

Open http://127.0.0.1:8003/floor.html. The previous mask and silhouette experiments
remain on port 8002. Both servers bind only to loopback and expose isolated local
experiment directories. No published lesson, raw prediction or scoring data changes.

The default comparison covers all 729 samples (48.53 seconds). The selector also
offers the previous eight-second silhouette correction. Both versions compare
against original MHR using the same fixed camera, time, grid and source video.
The actual video shows heuristic support observations for review. All articulated
tracks are checked byte-for-byte against the source; only body_world placement
is changed. No Mixamo changes are involved.

## Method

1. Generate full-clip SAM2 masks with `build_foot_mask_experiment.py --duration 49`.
2. Run official MoGe-2 ViT-B normal on the first decoded frame only; cache metric
   point/depth maps and intrinsics, with input-frame and checkpoint hashes.
3. Fit a RANSAC/SVD plane outside the dilated person mask, in an explicitly reviewed
   floor region: x=36–96%, y=78–97%. This excludes the wall and lower-left title.
4. Convert normalized MoGe intrinsics to source-pixel coordinates and hold fixed.
5. Use SAM projected ankles only as region guides, with reviewed first-frame sole
   centers. Subsequent binary-mask bottom contours provide independent pixels.
6. Select probable support using visibility, relative image height and relative
   reconstructed ankle height. Intersect selected viewing rays with the fixed plane.
7. Express floor displacement in an orthonormal plane basis, relative to initial
   feet; solve a whole-body placement offset. Conflicting feet (>18 cm disagreement)
   lose support. Bridge at most five missing samples; smooth offsets and fade
   towards the original placement during longer uncertainty.

This keeps the first-frame scene reference fixed without fixing the person's
travel. Support detection, ankle-to-sole association and camera stationarity are
assumptions/heuristics, not certified results. A tight plane fit establishes
consistency in MoGe's output, not measured floor accuracy. Occlusion, toe roll,
pose errors and ambiguous masks remain limitations. At the end of this clip,
observations disappear and the viewer explicitly reports original-motion fallback.

The experiment predicts its own camera calibration (approximately fx=884 pixels)
instead of changing the original SAM pose inference. Pose is held fixed so the
effect of placement can be judged separately. A future camera-consistent pose
refit may be necessary; this experiment does not claim that source pose or global
orientation errors have been repaired.

## Reproduce

Use the existing `.venv` processing environment, official source at `.local/MoGe`,
and `models/moge-2-vitb-normal/model.pt` from `Ruicheng/moge-2-vitb-normal`.
Only `utils3d_moge` was added for MoGe-2, pinned to upstream helper commit
`62f09d58509485564e24d5d9f6aac9ee9ebc0c37`; PyTorch was not upgraded.

```powershell
.venv/Scripts/python.exe scripts/build_moge_floor_experiment.py --experiment .local/foot-mask-full --source PATH/reference.glb --motion PATH/motion.npz
.venv/Scripts/python.exe -m http.server 8003 --bind 127.0.0.1 --directory .local/foot-mask-full
```

The full experiment directory also needs `silhouette.glb` and
`silhouette-data.json`, copied from `revised.glb` and `revision-data.json` in the
earlier experiment, for the selector's older baseline. Viewer modules are copied
from that experiment's local vendor directory. These are local assets, not CDN
dependencies.

## Validation

Six geometry/image-correction regressions passed, covering robust plane fitting,
ray intersections, invalid rays, synthetic drift suppression and unobserved travel.
Both original and revised source clips retain identical pose tracks. Headless
Chromium checked full-clip seeking, end recovery, playback, the two correction
versions and mobile overflow. Frames at 2.47, 20 and 33.33 seconds were captured;
the 20-second comparison was inspected visually against source foot observations.

For this run the first-frame fitted prediction had 1.48 mm median residual and
4.85 mm p95 residual. Probable support was available for 97.7% of frames; this
coverage does not measure correctness. Maximum placement adjustment was 2.33 m.
The result remains an experimental candidate for human review.

## Tracking revision 2

The initial run above is preserved locally as `floor-guided-v1.glb` and
`floor-data-v1.json`. Revision 2 changes observation and gap handling:

- Foreground corner features near the last observed foot are tracked using
  pyramidal optical flow and a forward/backward consistency check. The current
  silhouette refines the tracked boundary. Reacquisition uses an adaptive offset
  and a wider mask search, instead of retaining the first-frame pixel offset.
- When two tracks collapse onto one visible foot despite separated pose guides,
  only the better-associated observation remains; the other track reacquires.
- Image height, relative pose height and observation quality contribute soft
  support confidence. Temporal filtering and entry/exit hysteresis replace the
  former 10 cm hard height cutoff. Candidate placement uses confidence weights.
- Unsupported intervals of up to 0.8 seconds interpolate between reliable
  corrections. Longer gaps retain the last correction and are labelled uncertain;
  they do not fade to the known-unreliable original depth.

The page exposes confidence plus observed/bridged/held states. Holding a correction
through a long gap avoids a reset but cannot establish true motion during that
gap. No joint pose is edited. Ten focused regressions pass, including image
feature displacement, the 10.1 cm threshold case, collapsed tracks and gap handling.
