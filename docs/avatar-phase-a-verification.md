# Phase A verification · prepared instructor avatars

Date: 2 November 2026
Status: complete. Phase B (MHR → Mixamo retargeting) not started.

Companion to `mixamo-avatar-implementation-plan.md`. Everything below was measured on
the files that ship, not on the Downloads originals.

## What was built

| Artefact | Path |
|---|---|
| Preserved originals | `assets/avatars/source/{ybot,xbot}.glb` |
| Browser assets | `apps/web/public/avatars/{male,female}-<hash>.glb` |
| Rig profiles | `packages/avatar-rigs/profiles/{male,female}.json` |
| Profile access + validation | `packages/avatar-rigs/index.ts` |
| Preparation | `scripts/prepare_avatars.py` |
| Shared rig maths | `scripts/avatar_rig.py` |
| Developer harness | `apps/web/avatar-lab.html` + `src/avatar-lab.ts` |
| Tests | `tests/avatar/test_prepare_avatars.py` (14 tests) |

Preparation is deterministic and re-runnable: `python scripts/prepare_avatars.py`.
The output filename carries the content hash, so a changed asset gets a new URL and
never a stale cache. Unreferenced files are removed on each run.

## Measurements on the shipped assets

| | male (Ybot) | female (Xbot) |
|---|---|---|
| Source bytes | 2,919,552 | 2,372,732 |
| Prepared bytes | 2,388,852 | 1,974,652 |
| Source SHA-256 | `6c076c4b…69a3` | `231b9f8a…a037` |
| Prepared SHA-256 | `b5c58711…f7e4` | `bb4c98eb…5141` |
| Bones | 65 | 65 |
| Meshes | 2 (`Body`, `Joints`) | 2 |
| Materials | 2 (surface, joints) | 2 |
| Animation clips | 0 | 0 |
| Standing height | 1.8047 m | 1.8092 m |
| Floor | −0.0001 m | −0.0003 m |
| Hip height | 0.998 m | 1.043 m |
| Facing (bind pose) | ≈(0, 0, 1), yaw −0.00° | ≈(0, 0, 1), yaw 0.00° |

## Corrections to the inspection report

1. **"66 joints per skin" is 65 bones plus the armature.** The exported skin lists the
   `Armature` node as its 66th joint, and no vertex references it. The prepared skin
   carries the 65 real bones; inverse bind matrices are re-indexed and otherwise copied
   byte-for-byte (`test_inverse_bind_matrices_are_preserved_verbatim`).
2. **"49,112 / 55,320 triangles" counts a mesh that is required.** 20,840 of those
   triangles are the joints mesh. The plan's Phase A step 3 asked to confirm whether it
   is needed: it is. The surface is modelled as separate limb segments and the joints
   mesh is what fills the gaps those segments open at elbows, knees, waist and neck.
   Rendering it also keeps a natural look in a deep stance or a kick, where the gaps
   widen. Both meshes therefore ship; the joints mesh material is the darker one.
3. **Rest poses differ between the avatars.** 14 of 65 bones differ by more than 2°
   (feet 11.2°, toes 13.5°, shoulders 6.9°, Spine2 5.1°) and 28 bones differ in length
   by more than 1 cm (Spine2 by 4.1 cm; hip height by 4.5 cm). This confirms the plan's
   decision to produce one clip per avatar rather than sharing one; a rotation-only clip
   driven on both would be wrong by ~13° at the feet.
4. **The source materials were recoverable.** The S8S extension carried the original
   Blender Principled graph, so the exported base colours were known before choosing a
   look: Ybot's body parsed to a muted teal `(0.097, 0.422, 0.522)`, which reads as a
   Verge3D export artefact rather than intent. The neutral palette from the review
   (light grey surface `0.803, 0.807, 0.816`, dark joints `0.188, 0.204, 0.212`) was
   applied instead, with the surface/joint distinction preserved.

## Decisions recorded

- **Units and axes:** world units are metres. The armature node keeps its `0.01` scale
  and 90° X rotation, so bone data stays in centimetres while the rendered model is in
  metres. Re-baking that into the bone transforms would risk the bind pose for no gain;
  the retargeter must convert hips translation into each avatar's own node space, which
  is now written down in the profile (`units.note`).
- **Bone names:** the `Armature_mixamorig:` prefix is stripped, giving `Hips`, `Spine`,
  `LeftForeArm`, etc. Names are unique and match `^[A-Za-z0-9_]+$`, so neither the GLTF
  loader nor `PropertyBinding.sanitizeNodeName` rewrites them, and clip tracks will bind
  without a mapping layer.
- **Dead data removed:** UVs (there are no textures), the Verge3D node graphs, the
  unused `Verge3D_Environment_World` material and the orphan camera. Together with the
  joints-mesh decision this is 4.36 MB shipped, down from 5.29 MB of source.
- **Profile convention:** inverse bind matrices are stored row-major with translation in
  the last column, converted from glTF's column-major buffers on read. The field
  `rig.matrix_convention` says so, because mixing the two silently re-proportions a rig.

## Verification performed

`python scripts/prepare_avatars.py` then `python -m pytest tests/avatar -q` → 14 passed.

The tests cover: no clips in either file, structure (one skin, two meshes sharing it),
standard PBR materials with a distinct surface/joint colour, **bind-pose skinning
equivalence with the source for both meshes** (max drift < 0.1 mm), verbatim inverse bind
matrices, usable skin weights, finite and indexed geometry, loader-safe unique bone
names, parents-before-children ordering, profile-equals-bytes agreement (hash, size,
transform, landmarks, height, floor, facing), and determinism of a rebuild.

Visual check in the real renderer (`three@0.180.0`, same lighting and tone mapping as
`MotionStage`), front/side/back for both avatars, with the skeleton overlay:
`.local/shots/{male,female}-{front,left,back}.png`, `.local/shots/male-skel.png`.
No inverted normals, detached geometry, or misplaced joints. The rig sits inside the
mesh; hands, feet and head are where the profile's landmarks say they are.

This is a material and geometry check, not acceptance of motion quality. Phase B's gate
is unchanged and unstarted.

## Open items carried into Phase B

- Hips translation must be authored in each avatar's node space (centimetres), and the
  viewer's existing horizontal root pinning (`anchor.position.x = offset − root.x·scale`)
  must be reapplied to the target root, or feet will slide differently per avatar.
- Wrist orientation is not part of the comparison metric (`web/dist/pose.js` reads 15
  joint positions), so the wrist/palm requirement is a visual review, not a numeric gate.
- Finger tracks are deferred, so a derivative clip must pose fingers from an explicit
  preset and must not leave them at the Mixamo bind pose.
