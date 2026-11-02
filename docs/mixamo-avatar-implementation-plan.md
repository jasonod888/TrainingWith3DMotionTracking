# Male and female Mixamo avatar implementation plan

Date: 2 November 2026  
Status: inspection complete; implementation proposed, not started.

## 1. Inspection result

Both revised files are suitable inputs for an avatar conversion proof of concept. Removing the embedded animation did not damage their skeletons or skinning.

| Check | Xbot: female | Ybot: male |
|---|---|---|
| Source | `C:/Users/enqui/Downloads/3dModel/Xbot.glb` | `C:/Users/enqui/Downloads/3dModel/Ybot.glb` |
| Size | 2,372,732 bytes | 2,919,552 bytes |
| Embedded animation clips | **0**, in both raw GLB and Three.js loader | **0**, in both raw GLB and Three.js loader |
| Skinned meshes | `Beta_Surface`, `Beta_Joints` | `Alpha_Surface`, `Alpha_Joints` |
| Joints per skin | 66 | 66 |
| Total triangles | 49,112 | 55,320 |
| Standing mesh height before display normalization | Approximately 1.809 m | Approximately 1.805 m |
| Invalid skin influences found | 0 | 0 |
| Maximum weight-sum error | Less than 0.000001 | Less than 0.000001 |
| Three.js parsing | Successful | Successful |

The named joint hierarchies match between the two files. Their joint-array ordering differs, so conversion must match by validated names and hierarchy, never by array position. Matching hierarchy does not establish identical bind orientations or bone lengths; measure those per model.

Both exports still use `S8S_v3d_materials` rather than standard glTF PBR material settings. The current loader interprets their materials as white. There are no embedded images or external buffer dependencies. Preparing standard materials is still required.

These checks establish file and rig suitability. They do **not** establish that a transferred kick, stance, hand pose, or foot contact is correct. That is the first implementation milestone.

Inspection fingerprints:

- Xbot SHA-256: `231b9f8a26ed024aad32487bd1784c1dd0243b7ca6c0176103e6626c7778a037`
- Ybot SHA-256: `6c076c4b4a320256306f1e50ab259c850671deb2d5e3d044982db756fbb369a3`

## 2. Recommended architecture

Retain SAM 3D Body / MHR as the motion-extraction system. Add a versioned **MHR-to-Mixamo retargeting stage** after motion export. The browser loads a selected avatar and the corresponding converted animation independently.

```text
Uploaded video
    -> existing SAM 3D Body processing
    -> canonical MHR animation + comparison landmarks
         -> retarget using Ybot profile -> male animation
         -> retarget using Xbot profile -> female animation

Browser: selected static avatar + matching converted animation
Scoring: original comparison landmarks + tracked user pose
```

Bake converted motion on the processing worker rather than solving retargeting on every rendered phone frame. Prepare separate target clips for the two avatars initially. Their shared hierarchy allows a common converter, but not an assumption that their resulting clips are interchangeable.

Keep the canonical `reference.glb`, comparison `reference.json`, source video, lesson timestamps, and section definitions. The new avatars replace presentation, not inference or the scoring reference. Changing avatar must not create a different challenge or score.

The existing viewer loads one GLB containing both body and animation and requires `gltf.animations[0]`. That path cannot accept these static models directly. Separating those responsibilities is a necessary part of this work.

## 3. Phase A: prepare and describe the two avatar rigs

1. Copy the approved files into managed, versioned project assets during implementation. Preserve originals and record the inspection hashes. Do not make production depend on the Downloads directory.
2. Convert material definitions to standard glTF metallic/roughness materials. Preserve the intended surface/joint distinction and inspect front, side, and back views in our actual viewer.
3. Keep the original skinned mesh structure. The surface and joint meshes are parts of the supplied characters, not added clothing. Confirm whether both are needed visually before removing or combining anything.
4. Normalize units, axes, facing direction, object transforms, and the reference pose. Re-export with correct inverse bind matrices; do not freeze transforms in a way that changes skin deformation.
5. Produce an explicit profile for each model containing:
   - Stable avatar ID: `male` or `female`; asset and profile versions; SHA-256.
   - Rig family and normalized bone names, with unique loader-safe names.
   - Parent hierarchy, local/global rest transforms, and inverse bind matrices.
   - Root, hips, head, wrists, feet, toes, and floor/height measurement landmarks.
   - Standing height, limb lengths, facing correction, and root-motion scale policy.
6. Keep animation clips absent from the static assets. The viewer must accept this as normal.

Use a real rest/bind pose for calibration, not the first frame of a captured lesson. A lesson can begin halfway through a technique.

Deliverable: two static browser-ready GLBs plus two checked rig profiles. No avatar-selection UI is required for this milestone.

## 4. Phase B: prove MHR-to-Mixamo compatibility

This is the critical phase and must pass before enabling the switch in lessons or challenges.

### Candidate anatomical mapping

| Target Mixamo chain | Canonical MHR source | Required treatment |
|---|---|---|
| Hips | `root`, with `body_world` movement handled separately | Separate pelvis articulation from global movement |
| Spine / Spine1 / Spine2 | `c_spine0` through `c_spine3` | Distribute the compound torso rotation across the shorter target chain |
| Neck / Head | Neck chain and `c_head` | Include source intermediate neck rotations in the compound transform |
| Left/RightShoulder | `l_clavicle` / `r_clavicle` | Calibrate shoulder axes and reference-pose offsets |
| Left/RightArm | `l_uparm` / `r_uparm` | Transfer upper-arm orientation and handle twist deliberately |
| Left/RightForeArm | `l_lowarm` / `r_lowarm` | Preserve elbow bend direction and forearm twist |
| Left/RightHand | `l_wrist` / `r_wrist` and their parent chains | Include wrist-twist contribution; preserve palm orientation |
| Left/RightUpLeg | `l_upleg` / `r_upleg` | Transfer hip articulation without copying source limb length |
| Left/RightLeg | `l_lowleg` / `r_lowleg` | Preserve knee direction and extension |
| Left/RightFoot | MHR foot/ankle chain through the appropriate tarsal joint | Derive the compound foot orientation; a name-only ankle match is insufficient |
| Left/RightToeBase | `l_ball` / `r_ball` | Calibrate toe articulation and sole orientation |
| Finger chains | Corresponding MHR finger chains | Map anatomical segments; account for different metacarpal/end-joint layouts |
| End/helper joints | No direct motion where unnecessary | Keep target rest offsets unless a documented constraint drives them |

The table is a starting specification, not a validated correspondence table. Resolve the final ankle, spine, wrist, and finger mappings by inspecting the actual rest transforms and rendered motion.

### Conversion algorithm requirements

1. Evaluate the canonical MHR rig at every original timestamp, including its source scale tracks, to obtain the actual posed anatomical transforms.
2. Derive motion relative to source rest transforms. Convert rotation deltas through calibrated source/target anatomical coordinate frames, then reconstruct target local transforms in parent order.
3. Preserve each target's bind bone lengths and local translation offsets. Do not copy all MHR local translations or scale curves onto the target skeleton.
4. When chains have different lengths, transfer their compound motion with explicit distribution rules. Do not silently discard source twist or intermediate rotations.
5. Extract global translation and heading once. Convert translation with the agreed body/leg-length scale, preserve vertical hip motion, and keep display centering outside the animation. Never apply root movement in both the clip and the viewer anchor.
6. Use quaternion continuity and normalization. Preserve the original start, end, timestamps, and standing time; avoid an extra sampling step that shifts section boundaries.
7. Initially keep captured foot-contact quality visible. Measure whether retargeting introduces additional sliding or penetration. Add a deterministic contact/leg constraint only if that measurement shows it is necessary, and version its behavior separately.
8. Export converted clips bound to stable normalized target bone names. An animation-only GLB may carry the target transform hierarchy and clip, while the reusable avatar GLB supplies meshes and skinning. Validate that all loaded tracks resolve against the prepared avatar.

Three.js provides `SkeletonUtils.retarget` / `retargetClip`, including name mappings and offsets. Evaluate them against this specification during the proof of concept. They are tools, not evidence that a 127-joint MHR rig automatically matches a 66-joint target. The installed implementation and output must be tested before choosing the final converter.

### Proof-of-concept gate

Use the existing Taegeuk reference and a small diagnostic motion set: neutral pose, arms forward/up, torso turn, deep stance, knee lift, front/side kick, wrist rotation, and fist/open hand where source motion supports them. Inspect both avatars from front, side, and back, with skeleton overlays available to developers.

Pass conditions:

- No detached geometry, stretched triangles, flipped elbows/knees, inverted palms, or unexpected whole-body rotation.
- Neutral source pose produces the calibrated neutral target pose.
- Matching target anatomy follows the intended source segment directions; numeric angular tolerances are set from this pilot and documented before rollout.
- Finger and ankle mappings are explicitly accepted rather than assumed from a successful torso animation.
- Feet do not acquire substantial additional sliding or ground penetration relative to source motion. Record drift and penetration in metres and compare both avatars.
- Playback duration, key timestamps, standing time, and section endpoints match the canonical clip within the existing timestamp tolerance of `1e-5` seconds.
- Camera placement, mirrored display, and height calibration do not change the generated target clip.

If these fail, correct rig preparation/mapping before proceeding to UI work. The current files passing a loader check alone is insufficient.

## 5. Phase C: store converted motion without changing lesson meaning

Use a separate, versioned avatar-presentation record associated with the canonical animation hash. This allows existing immutable lesson revisions to gain avatar derivatives without changing their sections, resume state, challenge identity, or scoring history.

Proposed presentation metadata:

| Field | Purpose |
|---|---|
| Presentation schema version | Validate the derivative format independently of lesson schema |
| Canonical animation SHA-256 | Prove which source motion was converted |
| Retargeter version / source rig version | Identify mapping and algorithm behavior |
| Avatar ID / asset hash / target profile version | Prevent applying a clip to the wrong model or bind pose |
| Converted animation asset metadata | Key, byte size, MIME type, checksum |
| Duration and timing fingerprint | Verify synchronization with canonical sections |
| Validation status and quality-report reference | Distinguish unavailable, processing, failed, and verified derivatives |

Implementation tasks:

- Add avatar-derivative storage and an idempotent job keyed by source hash, target asset/profile hash, and retargeter version. Keep lesson access relationships separate from cache identity.
- Run retargeting after canonical export for new conversions; use the existing canonical GLB for old lessons, so no repeat video inference is needed.
- Add bounded worker output names for male/female clips and presentation metadata. Update local and external provider contracts together, including checksums, cancellation, leases, retries, and orphan cleanup.
- Version the processing route when its outputs change. Continue accepting in-flight legacy jobs; never reinterpret a v1 job as a v2 result.
- Publish a presentation record only when referenced assets and validation reports are complete. A derivative failure must not invalidate a valid canonical lesson.
- Expose presentation metadata through revision-authorized lesson/public/demo routes. Recheck the requested lesson revision and public release before returning clip assets; a content hash is not an authorization credential.
- Extend the existing asset enumerators, import/copy/delete flows, public publishing/remapping, and storage cleanup to cover derivative assets. Do not assume the current four-file allowlist already permits them.
- Keep the existing lesson manifest and comparison data usable unchanged. The avatar resolver is an additional presentation capability, with a clear unavailable state.

## 6. Phase D: separate avatar rendering from playback

Refactor `MotionStage.tsx` around a small avatar controller that receives the lesson's existing `Playback` clock and an avatar ID.

Responsibilities:

- Load the reusable static avatar and matching converted clip separately. Require a lesson clip, not an animation embedded in the avatar asset.
- Cache static model data, but use skeleton-aware cloning for each live instance. Clone materials before changing opacity; shared cached materials must not affect another viewer.
- Resolve root/hips, hand labels, feet, and height from the target rig profile. Remove assumptions that every displayed model has `body_world`, `l_wrist`, and `r_wrist`.
- Stop applying `styleInstructor` to these prepared assets. Preserve their own geometry and materials.
- Keep scene/camera lifecycle independent of avatar replacement. Swapping the avatar must not recreate the camera stream, pose worker, scoring engine, recorder, or challenge session.
- Load the replacement while retaining the current valid avatar. Once ready, sample the **current** playback time and atomically replace the displayed model at that pose. Do not restart at time zero or jump briefly to a T-pose.
- Keep playback time, speed, section, countdown, pause state, loop, camera angle, and model mirror unchanged.
- Recompute only model-specific height/floor placement using the existing user calibration. Do not ask the user to recalibrate because the instructor avatar changed.
- Cancel or ignore stale loads when users switch quickly or leave a lesson. Dispose instance-owned resources without disposing shared cached geometry/materials prematurely.
- During a scored run, allow an already-ready avatar to swap without altering the run. If it is not ready, defer the swap until it can be displayed seamlessly or until the run ends; never interrupt or silently restart the challenge.

For unavailable derivatives, retain the current working reference and explain the unavailable avatar briefly. If no reference can be displayed before a scored run, block starting the run rather than present an unanimated character.

## 7. Phase E: add the male/female control

Use a compact **Instructor: Male / Female** two-choice control in each lesson's viewer controls, available in both practice and challenge preparation. On small screens, place it in the existing View/Instructor panel with the current choice visible on its button. Do not add another full-width row over the body.

Behavior:

- `Male` selects Ybot; `Female` selects Xbot. This chooses the instructor, not the user's gender.
- Default to Male for a new installation; remember the user's explicit choice locally across lessons and challenges. Keep that preference separate from lesson content and challenge rules.
- The control is available while paused and during ordinary playback. Show pending/loading state and disable choices whose verified clips are unavailable.
- Retain the preference when switching to original-video view; apply it on return to 3D without restarting the lesson.
- Provide keyboard access, readable labels, selected-state semantics, and suitable touch targets.
- Synchronize avatar ID and profile/version through the paired-display snapshot. A receiver should show the same instructor, or retain a valid fallback with a clear loading state.
- The avatar choice must not affect scores, leaderboard rules, attempt timing, or eligibility. Optional appearance metadata may aid debugging, but must not become a score multiplier or comparison category.

Integrate through one shared preference/controller rather than duplicating selection logic in every screen.

## 8. Affected code areas

| Area | Planned work |
|---|---|
| New avatar assets and rig-profile package | Versioned models, materials, anatomy map, rest transforms, hashes |
| New retargeting tool and tests | MHR evaluation, calibrated conversion, target clip export, quality reports |
| `scripts/export_glb.py` | Keep canonical export; expose/reuse source timing and rig information as needed |
| `scripts/saas_worker.py`, `scripts/saas_provider_worker.py`, provider output contracts | Generate/register avatar derivatives after canonical motion export |
| `apps/api/conversions.py`, processing contracts and storage | Versioned outputs, derivative jobs, upload validation and atomic availability |
| `apps/api/lessons.py`, public/permission paths, database migration | Authorized derivative lookup, backfill, asset lifecycle and public-release handling |
| `apps/web/src/MotionStage.tsx` | Separate static model and animation loading; controller-based replacement |
| `apps/web/src/instructor.ts` | Remove its shaping role for the new models; keep only explicit legacy fallback if still needed |
| `PracticeWorkspace.tsx`, `LessonWorkspace.tsx`, shared preference/UI module | Avatar choice in practice/challenge, without session resets |
| `MoveDetail.tsx`, `MoveCheck.tsx`, `Public.tsx`, replay viewers | Use the selected avatar through the same controller |
| `MimicReceiver.tsx`, `mimic-connection.ts`, API pairing snapshot | Synchronize selected avatar and version |
| Existing framing, playback and scoring tests | Prove unchanged timing, calibration, comparison inputs and challenge behavior |

## 9. Validation and release gates

### Automated

- Validate both static models: no clips, finite geometry, usable skin weights, expected named hierarchy, correct bind pose, standard materials, no unintended external dependencies.
- Compare converter outputs against analytical single-joint and chain-motion fixtures. Include mismatched rest poses, joint order, body proportions, and missing-bone rejection.
- Verify no unresolved animation tracks, nonfinite values, changing target bone lengths, or discontinuous quaternions.
- Check duration/timestamp equality and deterministic conversion for a fixed source/profile/version.
- Verify scores and competition outcomes are identical for a fixed tracked-pose sequence with either avatar selected.
- Cover switching while paused, playing, scrubbing, counting down, looping, recording, loading, and leaving a lesson; ensure session and camera resources are unchanged.
- Repeat the previous regression scenario: model load completes after camera anchor translation, scale, and mirroring have already been applied.
- Test simultaneous viewers, cached skeleton clones, late responses, failed downloads, pairing/reconnection, and unauthorized derivative requests.
- Verify older lessons and pending legacy conversions still open correctly.

### Visual and device checks

Inspect both avatars in the actual browser viewer, including camera composite and calibrated height matching. Offline beauty renders alone are not acceptance evidence.

Use portrait/landscape phone layouts, camera on/off, front/back/side observation, mirrored views, low/deep stances, fast kicks, and transitions. Confirm the hands, feet, and head stay visible in supported framing modes. Inspect materials under app lighting.

Profile one active avatar on representative phones. A proposed initial goal is sustained 30 fps during camera practice without increasing tracking latency materially. Measure model load time, conversion time, peak memory, repeated-switch leaks, and a maximum-duration lesson. Load the other model on demand or during idle time; do not render both continuously.

### Delivery order

1. **Rig preparation and diagnostic conversion:** prove both models can reproduce important movements.
2. **Worker/storage foundation:** produce verified derivatives for one pilot lesson; keep source lesson usable.
3. **Viewer controller:** render both avatars correctly in every layout, without a selector rollout.
4. **Selector and preference:** enable for pilot practice and challenge screens, including paired display.
5. **Backfill and rollout:** generate derivatives for existing lessons; enable only those with verified outputs; retain a rollback path to the canonical reference.

The main unknown is motion quality across the different skeleton structures, especially ankles, shoulders, wrists, and fingers. Complete the first gate before estimating the remaining conversion effort or enabling the feature broadly.

## 10. Reference material

- [Three.js SkeletonUtils documentation](https://threejs.org/docs/pages/module-SkeletonUtils.html): skeleton-aware cloning and retargeting interfaces. Check behavior against the project's installed version.
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html): skins, joint transforms, animation channels and standard materials.

Only inspection and this plan were completed for this request. No models were copied into application assets, no retargeting was implemented, and no runtime behavior was changed.
