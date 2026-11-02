# Source grounding: implementation status and review workflow

This is the first, diagnostic release of the floor-motion plan. It includes
independent image-flow observations, a sparse contact solver, validated exporter
integration, isolated source/avatar regeneration, and a local Avatar Lab comparison.
It does **not** automatically certify contact or claim calibrated world motion.

Raw `motion.npz`, scoring landmarks, and published lesson assets are preserved.
The worker runs diagnostics only when `FORM_GROUNDING_DIAGNOSTICS=1`; these are
local job artifacts, not automatically published. Remote providers are unchanged.

## Commands

Run with the GPU-processing environment (NumPy, SciPy, OpenCV already required):

```powershell
.venv/Scripts/python.exe scripts/ground_motion.py PATH/motion.npz --video PATH/preview.mp4 --output .local/grounding/example
```

Inspect `grounding-report.json`. Observations use MHR70 IDs 15,17,18,20:
left toe/heel, right toe/heel. Tracks are seeded once from SAM and forward/backward
checked. Missing tracks remain missing. Image stationarity is not ground contact.
No floor geometry is inferred from static background features.

For a **reviewed**, visible fixed-contact interval, create a contact JSON:

```json
{
  "reviewed": true,
  "motion_sha256": "COPY_FROM_REPORT",
  "contacts": [{"start": 0, "end": 30, "point": 17, "confidence": 1.0}]
}
```

Indices are inclusive motion sample indices, not video seconds. Each interval
must describe one fixed physical point; split heel roll, pivots or sliding instead
of treating the ankle or a moving mask centroid as fixed. Review assumes a static
camera. Do not use these intervals for moving-camera footage.

```powershell
.venv/Scripts/python.exe scripts/regenerate_grounded.py PATH/motion.npz --contacts PATH/contacts.json --output .local/grounding/new-revision
```

Output must be a new directory. The command exports corrected `reference.glb`,
both Mixamo avatars, validation reports and a revision marker. It never publishes
or replaces an existing project. Corrections replace camera translation exactly
once, using metres and x-right/y-up/z-back coordinates; hashes and timestamps
must match. Incompatible contacts with residual above 3 cm are rejected.

In Avatar Lab, upload the new `reference.glb` with **Upload corrected MHR**;
toggle **Corrected source** to compare at the same playback time. Upload its
corresponding avatar with **Upload clip**. Enable Floor movement and disable
Follow camera to inspect travel. Switching source does not switch the uploaded
avatar automatically: choose matching assets when inspecting retarget quality.

## Evidence so far

Synthetic regressions cover injected false depth, crouching height changes,
unaltered unconstrained walking/jumping, conflicting contacts, source identity
and timestamps. These do not establish automatic real-video accuracy.

On saved project b3353ab96eb745328bb7078a56d98712, the baseline optical-flow
observer retained only about 5.9% of foot samples and background stability was
uncertain. This is a failed observation-quality gate, not an accepted correction.
No published assets for that project were changed.

A separate diagnostic fit assuming both heel landmarks fixed over the opening
four seconds produced a maximum contact residual of 4.1 cm and was rejected by
the initial 3 cm guard. This is evidence of incompatible pose/contact assumptions;
it is not proof that these landmark definitions exactly match the physical soles.
Better observations and bounded pose refinement need evaluation before acceptance.

## Remaining release gates

1. Annotated independent heel/forefoot observations across held-out activities.
2. Refined image landmarks and segmentation-assisted reinitialisation/occlusion
   recovery; evaluate existing SAM2 tooling against point-tracking alternatives.
3. Confidence-calibrated automatic contact states including sliding, rolling,
   flight and uncertainty. The current solver requires reviewed contacts.
4. Camera/floor calibration with stated scale assumptions; calibrated contact
   mapping, moving-camera estimation, and heading support.
5. Robust observation weighting, bounded long-gap fallback, and windowed solving
   for long recordings. Current offline solve is intended for reviewed short clips.
6. Real-video benchmark against a world-grounded method and manually annotated
   contacts; numerical release thresholds derived from annotation uncertainty.
7. Signed report/overlay routes, automatic synchronized original/corrected asset
   revisions, remote-provider capability negotiation and atomic publication.

Keep automatic production correction disabled until these gates pass. The 3 cm
review threshold is an initial rejection guard, not a measured accuracy guarantee.
