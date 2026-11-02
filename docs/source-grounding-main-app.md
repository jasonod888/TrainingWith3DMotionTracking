# Main-app source movement correction

The local GPU conversion worker now performs best-effort source placement
correction after exporting native MHR and before generating either Mixamo clip.
The retargeter transfers the corrected root path using its existing body-height
scale; tests verify both avatars receive the correction exactly once on all axes.
Scoring landmarks, articulated source pose and video timestamps are preserved.

## Processing

`source_grounding.py` runs by default (`FORM_SOURCE_GROUNDING=off` disables it).
It uses automatic person prompting, memory-bounded SAM2 segmentation chunks,
background camera checks, first-frame MoGe-2 geometry, automatic floor candidates
outside the person mask, and initial foot association from the image/mask. No
Taegeuk-specific rectangles or foot centers are used in this path.

The source solver uses foreground feature tracking, adaptive searches, duplicate
foot rejection, confidence/hysteresis and bridged/held correction gaps, as tested
in tracking revision 2. The raw MHR export is retained in the job's grounding
directory. Replacement happens only after identity, timestamps, pose tracks,
geometry and evidence coverage have been checked. Missing models, ambiguous camera
motion, weak geometry or failed processing leave the valid raw export unchanged.

Initial supported scope is fixed-camera clips from 1 to 180 seconds. Longer clips
remain processable with original placement and a review warning. Remote-provider
processing is unchanged; this is integrated into the local GPU worker. Predicted
metric geometry and heuristic support cannot certify physical accuracy, and
source pose errors still propagate to the avatars.

`grounding-summary.json` records applied/skipped status, reasons and quality
coverage. It is also included in `avatar-report.json`. The lesson records
`root_motion: floor-guided` only when correction was actually applied. Confidence
remains `unmeasured`. Avatar Lab displays correction status and evidence coverage.

## Worker setup

`Dockerfile.gpu` pins SAM2, MoGe and its geometry helper. It does not install the
MoGe-3-specific GPU stack. The source roots can be configured through
`FORM_SAM2_SOURCE` and `FORM_MOGE_SOURCE`; checkpoint paths through
`FORM_SAM2_CHECKPOINT` and `FORM_MOGE_CHECKPOINT`. Defaults use the local `.local`
source checkouts and `models` directory; the GPU image sets its vendor roots.

Download checkpoints outside the read-only worker, then mount `models` as usual:

```powershell
.venv/Scripts/python.exe scripts/download_grounding_models.py
docker build -f infra/docker/Dockerfile.gpu -t form-saas-gpu .
```

SAM2 inference is chunked to 120 new frames with a one-frame overlap seeded from
the previous mask. MoGe runs once. Worker cancellation kills the subprocess group
in the Linux GPU container; stage timeout and original-export fallback remain.

## Existing lessons and revisions

`publish_grounded_lesson.py` validates source hashes and both avatar reports,
uploads all new assets under unique names, and activates them in one database
transaction. A manifest's optional `presentation` map binds male, female and
report assets to the same source revision. Old manifests without the map keep
their legacy avatar URLs. Main-app playback and Avatar Lab honor the new map.
New revision assets retain normal lesson access checks. Public delivery exposes
only its selected release's avatar meshes, not the private report or source video.

The script defaults to read-only validation; `--apply` activates a complete
revision. It refuses archived/disabled lessons and refuses a changed source.
Previous assets/revisions remain available for rollback, and public releases
are not switched automatically. Changed private lessons require normal review.

The archived experiment project `b3353ab96eb745328bb7078a56d98712` was left alone.
Active lesson `5223066d0aef4d39aa81b6b3011e085f` was regenerated from its own
735-frame predictions (48.93 seconds), using automatic selection, and activated
as revision `e7d844845b3c49d18616db0c3fc7a8a4`. Its MHR, male and female source
hashes match. Source video, scoring data, title and sections were preserved.

## Validation

- 132 API tests, including revision-asset authorization and public filtering.
- 53 avatar tests, including male/female transfer of corrected source placement.
- 168 web tests and production build.
- Rebuilt GPU image; CUDA segmentation initialization and MoGe depth smoke test.
- Full automatic correction run on the active lesson, then both avatar exports.
- Headless main-app and Avatar Lab checks using a disposable QA session, deleted
  afterwards: both revision-bound clips load, corrected status is shown, and the
  main app finishes loading the actual Mixamo body. Screenshots were inspected.

The local API and rebuilt conversion worker were started with existing data and
worker identity. No git push was performed as part of this integration.
