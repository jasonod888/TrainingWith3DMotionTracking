# Phase B verification · MHR → Mixamo retargeting

Date: 2 November 2026
Status: converter implemented and gated. Worker/storage wiring (Phase C) not started.

Companion to `mixamo-avatar-implementation-plan.md` and `avatar-phase-a-verification.md`.

## What was built

| Piece | Path |
|---|---|
| Converter + CLI | `scripts/retarget_mixamo.py` |
| Rig profiles, mapping table, calibration helpers | `scripts/avatar_rig.py` |
| Tests (12) | `tests/avatar/test_retarget_mixamo.py` |
| Demo clips for inspection | `apps/web/public/dev-clips/` (git-ignored) |
| Clip playback in the harness | `apps/web/src/avatar-lab.ts` |

Conversion functions are importable and independent of the database and storage:
`load_motion`, `neutralise`, `convert`, `write_clip`, `verify_written`, `retarget`.
`retarget()` is the only function that touches the filesystem, and it writes both outputs
atomically through a temporary file plus `os.replace`. The CLI exits non-zero on any
invalid conversion, including a mapping that cannot be resolved.

Report contents: source file name, SHA-256, joint count, frames, duration, first and last
timestamp, timestamp-array hash; target avatar id, asset file, asset SHA-256, profile
schema and preparation version; retargeter version and finger preset; the direct and
compound mapping actually used; unmapped target bones; root-motion scale and travel;
timing, quaternion norm and continuity, bone-length and written-track checks; failures and
warnings. A failed conversion still writes the report, so the reason survives.

## Measured result on the Taegeuk reference

| | male | female |
|---|---|---|
| Tracks written | 63 (62 rotation + 1 translation) | 63 |
| Frames / duration | 225 / 14.948282 s | 225 / 14.948282 s |
| Timestamp drift | 0.0 | 0.0 |
| Max bone-length change | 0.0 m | 0.0 m |
| Quaternion norm error | 2.2e-16 | 2.2e-16 |
| Root translation scale | 1.080 | 1.128 |
| Root travel over the form | 1.82 m | 1.90 m |
| Clip size | 252,204 B | 252,108 B |
| Unmapped target bones | HeadTop_End, Toe_End ×2 | same |

The timestamp array is the source's own accessor, so section boundaries cannot shift; the
frame count and duration are asserted equal, not resampled.

## Two defects the gate caught

Both would have shipped as visible faults, and neither was caught by the earlier
inspection:

1. **Root translation was 100× too large.** The converter inverted the armature matrix
   *including* its 0.01 scale and then divided by that scale again. The first-run report
   read `ok` because nothing checked translation magnitude; the neutral-pose test exposed
   hips positions in the hundreds of metres. The rotation is now normalised before use and
   an implausible-travel check fails the conversion.
2. **One hand curled backwards.** The finger preset flipped the curl sign for the right
   hand by assumption. Both hands of this rig share one local axis convention, so the flip
   was wrong. The curl axis is now derived per hand from its rest orientation
   (`palm_normal_local`), which is self-correcting rather than assumed.

## What the gate proves, and what it does not

Proven numerically: a neutral source pose reproduces each avatar's own rest pose within
0.1° per bone (actual: below measurement resolution); a 30° rotation on `l_uparm` lands on
`LeftArm` within 0.01° of the expected world delta without adding elbow bend; bone lengths
are fixed to the profile; conversion is deterministic; the written clip re-reads with all
tracks resolving against the profile and the source clock; mapping and source-bone failures
produce a report and no clip.

Checked visually in the harness at t = 0, 1, 4 and 8 s on both avatars, front, side and
back (`.local/shots/pose2-male-8.png`, `hand2-male-4.png`, `clip-female-4.png` and peers):
no detached geometry, no stretched triangles, no inverted elbow or knee, torso twist and
weight shift read correctly, and the fingers curl toward the palm on both hands.

**Not yet done, and still required by the Phase B gate:**

- the full diagnostic set (neutral, arms forward/up, torso turn, deep stance, knee lift,
  front/side kick, wrist rotation, fist/open) as a fixture, rather than three sampled times
  of one form;
- the wrist/palm/forearm fixture, which must be a visual review: the comparison metric
  (`web/dist/pose.js`) reads 15 joint *positions*, so wrist orientation is not scored;
- foot contact measurement (sliding and penetration in metres) per avatar, measured through
  the viewer's root pinning rather than on the raw clip;
- joint-versus-landmark divergence between each avatar's retargeted joints and the
  canonical comparison landmarks;
- acceptance in the real lesson viewer: the harness shares lighting and tone mapping but is
  not `MotionStage`.

## Dependency check for the worker image

No new dependencies are needed: `numpy`, `scipy` and `pygltflib` are declared in
`requirements.txt`, which `infra/docker/Dockerfile.gpu` installs.

Two caveats worth acting on before Phase C:

- the GPU image installs `requirements.txt`, which pins with **ranges**
  (`numpy>=1.26,<3`, `pygltflib>=1.16,<2`, `scipy>=1.13,<2`). `requirements-lock.txt` has
  exact versions (numpy 2.5.2, pygltflib 1.16.5, scipy 1.18.1) but the image does not
  install it. The converter's output is deterministic for a given numpy build, so an exact
  pin matters more here than usual.
- `apps/api/requirements-lock.txt`, which the API image installs, contains **none** of the
  three packages. Derivative generation must therefore stay in the worker; any API-side
  on-demand conversion would fail at import.

## Pilot viewer wiring · re-enabled 2 November 2026

`MotionStage` loads the prepared avatar and its converted clip when `pilotClipFor()` finds a
recorded conversion whose duration matches the lesson's own animation. It falls back to the
canonical MHR reference on any failure, including a missing clip, a failed fetch, or clip
tracks that do not resolve against the avatar.

Two defects found in the first attempt are fixed and remain fixed:

- the horizontal root pin resolves the root in the model's own space, because a Mixamo bone is
  expressed in centimetres under a 0.01 armature (the old form displaced the stage by ~100 m);
- the clip is chosen by recorded provenance and duration, not by a hardcoded path, so a lesson
  cannot receive another lesson's motion.

Still temporary: the clip is served from `/dev-clips/<id>.glb` as a static file rather than
from the lesson's derivative record, the avatar is male by default (the router drops an
`?instructor=` override before the lazy chunk loads), and no selector exists yet.

The notes below describe what was built and why it is parked, not current behaviour.


Added so the prepared avatars can be seen in the real app, not only in the harness.

- `apps/web/src/avatar-stage.ts` loads a prepared avatar and its converted clip as two
  assets, validates that every clip track resolves against the avatar, and returns the
  profile-derived root, hands, height and floor. It knows nothing about lessons or scoring.
- `MotionStage.tsx` tries that path first and falls back to the canonical MHR reference if
  anything fails, because the reference is what scoring is built on. `styleInstructor` is
  not applied to the prepared avatars.
- Horizontal root pinning now resolves the root in the model's own space instead of reading
  `root.position`. The old form was correct for MHR (`body_world` sits at the scene root in
  metres) but wrong for Mixamo, whose `Hips` is expressed in centimetres under the 0.01
  armature; it displaced the model by roughly 100 metres, which read as an empty stage.

Temporary scaffolding, to be replaced:

- the clip URL is hardcoded as `/dev-clips/<id>.glb` (`pilotClipUrl`) instead of coming
  from the lesson's derivative record through the authorized presentation route;
- the avatar choice is a module-scope read of `?instructor=` captured before the router
  rewrites the URL, defaulting to male. Phase E's control replaces it. The router drops
  unknown parameters in `LibraryApp`'s canonical-URL effect, and `MotionStage` is a lazy
  chunk, so a query parameter cannot be relied on for selection;
- clips are served as static files from the web deployment rather than from object storage
  with lesson access checks.

Verified in the API-served app at port 8001 for both avatars (`.local/shots/app2-male.png`,
`app4-female.png`): the avatar loads, the clip plays from the lesson clock, and the pose at
t=0 matches the same frame in the harness.

## Review follow-up · 2 November 2026

Five findings were raised against this work. All are fixed; the two that mattered changed
the algorithm and the viewer, not just a line.

| Finding | Cause | Fix |
|---|---|---|
| P1 root centring used the wrong units | The pin read `root.position`, which is metres for MHR (its parent is the scene root) but centimetres for Mixamo (its parent is the 0.01 armature), displacing the stage by ~100 m | Resolve the root in the model's own space from a consistent matrix snapshot, so the result is unit-agnostic |
| P1 every lesson could receive the same clip | `pilotClipUrl` returned one file for any lesson, and the clip had in fact been converted from a 14.95 s diagnostic rather than the lesson's 42.74 s animation | Convert the lesson's real animation; gate on a recorded provenance entry plus a duration match, so an unrecorded or mismatched lesson keeps the canonical reference |
| P1 rest-pose differences produced incorrect limb directions | The MHR reference rests in an A-pose and the avatars in a T-pose (upper arm 47.9°, shin 7.5°). Copying deltas preserves that offset on every frame | Align each target rest segment to the source rest direction first, then apply world deltas: `target_world = delta_source * (align * target_rest)` |
| P2 timestamp verification accepted an invalid clock | Only the first sample, last sample and count were compared | Compare the whole timestamp array per sampler and require strictly increasing times; a tampered middle sample now fails |
| P2 input failures produced no report | `load_motion` raised before any report existed | Reject with a written report carrying the source hash, reason and retargeter version |

Measured effect of the rest alignment, on the lesson animation (male avatar):

| Metric | Before | After |
|---|---|---|
| Upper-arm segment direction vs source | 45–69° | **0.0°** |
| Shin segment direction vs source | 11° | **0.0°** |
| Mean segment direction error, all mapped bones | — | 0.74° |
| Worst segment direction error | — | 9.0° (`LeftShoulder`) |

The converter now reports `mean/max_segment_direction_error_degrees` and fails the
conversion above 10°, so this class of error cannot return silently.

Residual, reported rather than hidden:

- Rest alignment is applied only to limb segments (`ALIGNED_BONES`). Aligning the pelvis by
  its spine segment rotated `Hips` by 103° and folded the entire torso; the spine, neck and
  hands keep their own rest orientation and take their motion from the world delta. With the
  restriction, limb segment directions match the source to 0.14° mean / 0.65° max.
- `LeftShoulder` retains ~9° because the clavicle segment is short and its child direction
  is a poor estimator; it is under the failure threshold and surfaced as a warning.
- Hands fall back to the unaligned rest because their mapped children are fingers, which are
  not retargeted yet.
- The clip reproduces an 88°/frame forearm jump present in the source tracking
  (`max_step_rotation_source_degrees`), warning that the jump is inherited, not invented.

## Wrist fix · 2 November 2026

Hands were excluded from rest alignment (their mapped children are fingers) but still received
an absolute world delta. Against an aligned forearm that holds the rig's own T-pose wrist
angle, which is why the wrists looked twisted in some poses — the error is the forearm's
alignment offset, applied rigidly to the hand.

The hands now take only the source's wrist motion **relative to the forearm**, on the rig's own
rest angle:

```
hand_local = rest_local · (source wrist motion, frame-mapped)
```

Measured: the source's wrist motion and the clip's agree to **0.0°** at every sampled frame
(`test_wrist_motion_is_relative_to_the_forearm`). The remaining palm-direction difference
against the reference is a constant 2–8° across the clip, which is the rest difference between
the two rigs rather than a growing error.

A related rule is now explicit: rest alignment applies to limb segments only, and a bone whose
parent is aligned while it is not (the hands) uses relative motion. The pelvis is excluded —
aligning it by its spine segment rotated `Hips` 103° and folded the torso.

## Per-lesson conversion · 2 November 2026

The viewer used to hold one hardcoded lesson. It now reads a registry:

- `scripts/prepare_lesson_clip.py --lesson <id> --animation <canonical GLB>` retargets that
  lesson's own animation for both avatars, writes the clips beside the pilot assets, and
  records the lesson in `apps/web/src/avatar-clips.json`;
- the viewer keys the registry by lesson id and only uses an entry when its recorded duration
  is within 0.05 s of the lesson's own animation, so an entry cannot mis-pair a lesson;
- a missing entry, a duration mismatch, or a failed load logs the reason and keeps the
  canonical MHR reference.

Converted so far: `taegeuk-demo` (42.7427 s) and `40e650ea…` (54.8667 s, "Taegeuk 3 Jang"),
the latter matching its recorded lesson duration of 54.866667 s.

The root-travel check was corrected in the same pass. It compared travel against an absolute
10 m bound, which a handheld clip legitimately exceeds (this lesson travels 11.6 m because
camera movement is reconstructed as root motion). It now verifies that the converted travel
equals the source travel times the body scale, with an absolute sanity net far above any real
movement.

## Automatic pipeline · 2 November 2026

No per-video work is needed any more. The conversion is part of the normal worker flow:

1. After canonical export, the worker retargets the clip for both avatars and uploads
   `avatar-male.glb`, `avatar-female.glb` and `avatar-report.json` through the existing
   attempt file endpoint (while the lease is still valid).
2. `/finish` publishes the lesson exactly as before. Its cleanup now removes only the four
   manifest assets, so the uploaded clips survive.
3. `POST /api/worker/jobs/{id}/derivatives` then copies the clips to
   `lessons/{lesson_id}/avatar-*.glb` and records them as lesson assets.
4. The lesson asset route serves those names to anyone with lesson access; the built-in
   demonstration serves its clips from the demo fixture directory instead.
5. The viewer requests `avatar-<id>.glb` for the lesson, rejects a clip whose duration does
   not match the lesson, and otherwise keeps the canonical MHR reference.

The lesson manifest is untouched — derivatives are presentation data, so no schema version
bump, no migration, and existing revisions stay valid.

A derivative failure cannot fail a conversion: the retarget and the attach step are both
wrapped, and the lesson is already durable when they run.

Existing lessons converted before this step need a one-off backfill, because their attempt
objects are gone:

```
python scripts/publish_lesson_clips.py --lesson <id> --male <clip> --female <clip> --report <json>
```

The two lessons in this repository were backfilled that way.

## Open risks carried forward

- **Foot contact is unmeasured.** The clip preserves the source's global translation and the
  viewer now cancels horizontal root motion on the profile's root bone, so the remaining
  question is purely how much sliding and penetration this introduces per avatar. That
  number is still owed.
- **Fingers are static.** They hold the relaxed preset for the whole clip; a lesson needing
  an open hand will need a per-lesson preset override, and preset changes mid-clip would pop.
- **Torso distribution is by construction, not by test.** Spine2 takes the world delta of
  `c_spine3`, which collapses `c_spine2` and `c_spine3` into one target bone. It is correct
  by the delta definition, but the visible result on a deep twist has not been compared
  against the MHR reference side by side.
