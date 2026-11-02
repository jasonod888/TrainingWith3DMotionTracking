# Image-guided animation revision experiment

Open http://127.0.0.1:8002/animation.html while the local experiment server is running.
It compares original and revised MHR source animations for the first eight seconds
of the reviewed Taegeuk clip. Both clips have the same timestamps, skeleton,
rotation, scale, and non-wrapper translation tracks. The builder asserts those
tracks match exactly. Only `body_world` placement is changed.

The algorithm uses the existing SAM2 mask pixels inside reviewed initial foot
regions. Shape overlap, median bottom-boundary displacement and visible boundary
width gate evidence. A stable region provides an approximately constant-depth
prior. Image x/y displacement is converted using the first-frame focal/depth
estimate. The corresponding source foot landmark offsets determine whole-body
placement, without changing articulated pose or declaring floor contact.

This is an explicit prior, not depth recovered from pixels. Fixed regions can be
misleading when a different body part enters the region, feet overlap or move along
the camera ray. Current source-to-region identity and fixed-camera validity are
reviewed assumptions. Thresholds (70% overlap, <=4 px shift, width ratio 0.7–1.3)
are experimental and need validation across uploads. Missing evidence fades the
correction; gaps of at most three frames may be bridged. Boundary filtering is
anchored to prevent an initial offset.

The page has shared time, fixed synchronized cameras, front/side/angled views,
optional skeletons, a blue initial-origin ring, actual video frames and correction
amounts. Playback does not remove root travel. Both original and revised GLBs are
trimmed to the same measured interval; their source buffer contents outside that
interval are unused. The existing published lesson is never replaced.

Build after generating masks:

```powershell
.venv/Scripts/python.exe scripts/build_image_motion_revision.py --experiment .local/foot-mask-experiment --source PATH/reference.glb --motion PATH/motion.npz
```

Checks: three synthetic regressions cover false-depth suppression, preservation
of unobserved travel and image-motion/vertical correction. Actual output tracks
are checked exactly against the original. Headless Chromium verified loading,
scrubbing, end recovery, playback, views and mobile overflow; screenshots were
visually inspected. At 2.47 s, root depth changed from approximately -2.415 m to
-0.118 m relative to the stage origin. This is a reduced artifact, not a certified
world-trajectory measurement.
