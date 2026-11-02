"""Retarget a canonical MHR clip onto a prepared Mixamo avatar.

The converter is a pure function of its inputs: it reads the canonical motion GLB and a
rig profile, and writes an animation-only GLB plus a validation report. It touches no
database and no object storage, so tests can exercise it directly.

Rotation policy
---------------
Every mapped target bone takes its world orientation from its source bone:

    target_world_rotation = delta_source * target_rest_rotation
    delta_source          = source_world_rotation * source_rest_rotation^-1

The delta is taken in world space, so differing rest orientations between the two rigs
cancel out, and a compound MHR chain transfers whole by pointing the mapping at the
deepest bone of that chain. Local transforms are then rebuilt in target parent order and
each target bone keeps its own rest translation, so bone lengths are preserved by
construction rather than by correction.

Translation policy
------------------
One global translation is transferred, on the root (Hips), scaled by the ratio of the two
hip heights and converted into the target's own node space (centimetres under the 0.01
armature scale). All three axes are preserved; display centring belongs to the viewer.

Hands and feet
--------------
Wrist and finger motion is measured relative to each mapped target parent's source bone,
including intermediate twist/metacarpal joints. Three phalanges are animated; fingertip
endpoints keep their rest transforms. A two-bone leg solve preserves source ankle
displacements within the target's reach, without stretching or inferring a world floor.

    python scripts/retarget_mixamo.py --source outputs/demo/motion.glb \
        --avatar male --output build/male-clip.glb --report build/male-report.json
"""

import argparse
import hashlib
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from pygltflib import (
    ANIM_LINEAR, FLOAT, Accessor, Animation, AnimationChannel,
    AnimationChannelTarget, AnimationSampler, Asset, Buffer, BufferView, GLTF2,
    Node, Scene,
)

import avatar_rig as rig
from avatar_kinematics import pose as target_pose, place_feet

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / 'packages/avatar-rigs/profiles'

RETARGETER_VERSION = '2.0.0'
CLIP_SCHEMA = 1
SOURCE_ROOT = 'root'
TIMESTAMP_TOLERANCE = 1e-6
LENGTH_TOLERANCE = 1e-6
IDENTITY_TOLERANCE = 1e-6
MAX_ROOT_TRAVEL_M = 10.0

# Bones whose rest segment is a limb axis worth aligning. The pelvis and spine are excluded:
# their bone-to-child direction is not a limb axis, and rotating them rotates every child.
ALIGNED_BONES = {
    'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
    'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
    'LeftFoot', 'RightFoot',
}


class RetargetError(Exception):
    """A structural problem with an input; conversion cannot proceed."""


@dataclass
class Motion:
    """Canonical motion sampled at its original timestamps."""

    times: np.ndarray
    bones: list[dict]
    tracks: dict[str, dict[str, np.ndarray]]
    ancestors: np.ndarray
    source_name: str = ''
    _rest_worlds: dict[str, np.ndarray] | None = field(default=None, repr=False)
    _rest_quats: dict[str, np.ndarray] | None = field(default=None, repr=False)

    @property
    def frame_count(self):
        return int(self.times.shape[0])

    @property
    def duration(self):
        return float(self.times[-1] - self.times[0])

    def local_at(self, bone, frame):
        track = self.tracks.get(bone['name'], {})
        t = track['translation'][frame] if 'translation' in track else bone['t']
        q = track['rotation'][frame] if 'rotation' in track else bone['q']
        s = track['scale'][frame] if 'scale' in track else bone['s']
        return np.asarray(t, float), np.asarray(q, float), np.asarray(s, float)

    def pose_at(self, frame):
        """World matrices and world quaternions for one frame.

        Rotations are composed as quaternions throughout: extracting them from 4x4
        matrices that carry the armature's 0.01 scale loses precision near 180 degrees.
        """
        worlds, quats = {}, {}
        ancestors_q = rig.quat_from_matrix(self.ancestors)
        for bone in self.bones:
            t, q, s = self.local_at(bone, frame)
            parent = bone['parent']
            base = worlds[parent] if parent else self.ancestors
            worlds[bone['name']] = base @ rig.matrix_from_trs(t, q, s)
            parent_q = quats[parent] if parent else ancestors_q
            quats[bone['name']] = rig.quat_multiply(parent_q, np.asarray(q, float))
        return worlds, quats

    def rest_quats(self):
        if self._rest_quats is None:
            ancestors_q = rig.quat_from_matrix(self.ancestors)
            quats = {}
            for bone in self.bones:
                parent = bone['parent']
                parent_q = quats[parent] if parent else ancestors_q
                quats[bone['name']] = rig.quat_multiply(parent_q, np.asarray(bone['q'], float))
            self._rest_quats = quats
        return self._rest_quats

    def worlds_at(self, frame):
        return self.pose_at(frame)[0]

    def rest_worlds(self):
        if self._rest_worlds is None:
            worlds = {}
            for bone in self.bones:
                parent = bone['parent']
                base = worlds[parent] if parent else self.ancestors
                worlds[bone['name']] = base @ rig.matrix_from_trs(bone['t'], bone['q'], bone['s'])
            self._rest_worlds = worlds
        return self._rest_worlds

    def subject_rest_worlds(self):
        """Neutral pose with the captured subject's lengths, excluding root travel.

        MHR GLB node defaults describe its generic bind body. The exported translation
        tracks carry the captured subject's shape. Using bind lengths as a positional
        baseline turns a shorter subject's standing pose into a crouch on the target.
        """
        worlds = {}
        for bone in self.bones:
            name, parent = bone['name'], bone['parent']
            track = self.tracks.get(name, {})
            t = (np.median(track['translation'], axis=0)
                 if 'translation' in track and name not in ('body_world', SOURCE_ROOT)
                 else bone['t'])
            scale = np.median(track['scale'], axis=0) if 'scale' in track else bone['s']
            worlds[name] = (worlds[parent] if parent else self.ancestors) @ rig.matrix_from_trs(t, bone['q'], scale)
        return worlds


def load_motion(path, source_name=None):
    """Read the canonical clip, keeping its exact timestamps and node hierarchy."""
    gltf = GLTF2().load(str(path))
    if not gltf.animations:
        raise RetargetError(f'{Path(path).name} has no animation to retarget')
    if not gltf.skins:
        raise RetargetError(f'{Path(path).name} has no skin; cannot identify the rig')

    skin = gltf.skins[0]
    joint_names = [rig.normalise_name(gltf.nodes[node].name) for node in skin.joints]
    if len(set(joint_names)) != len(joint_names):
        raise RetargetError('source joint names are not unique')

    start = skin.skeleton
    if start is None:
        start = next((index for index, node in enumerate(gltf.nodes)
                      if rig.normalise_name(node.name) == 'body_world'), None)
    if start is None:
        raise RetargetError('could not find the source rig root')

    parent_of = {}
    for index, node in enumerate(gltf.nodes):
        for child in node.children or []:
            parent_of[child] = index

    # Compose only the wrapper nodes above the rig root. The rig root's own transform is
    # applied by the bone traversal, so including it here would apply it twice.
    chain, cursor = [], parent_of.get(start)
    while cursor is not None:
        chain.append(cursor)
        cursor = parent_of.get(cursor)
    ancestors = np.eye(4)
    for node in reversed(chain):
        t, q, s = rig.node_trs(gltf.nodes[node])
        ancestors = ancestors @ rig.matrix_from_trs(t, q, s)

    joints = set(skin.joints)
    bones = []

    def visit(node_index, parent_name):
        node = gltf.nodes[node_index]
        t, q, s = rig.node_trs(node)
        bones.append({'name': rig.normalise_name(node.name), 'parent': parent_name,
                      't': t, 'q': q, 's': s})
        for child in node.children or []:
            if child in joints:
                visit(child, rig.normalise_name(node.name))

    visit(start, None)

    animation = gltf.animations[0]
    times = None
    tracks = {}
    for channel in animation.channels:
        if channel.target.node not in joints:
            continue
        sampler = animation.samplers[channel.sampler]
        sample_times = rig.read_accessor(gltf, sampler.input).reshape(-1).astype(np.float64)
        if times is None:
            times = sample_times
        elif sample_times.shape != times.shape or float(np.abs(sample_times - times).max()) > 0:
            # Interpolating onto a different clock would move section boundaries.
            raise RetargetError('animation channels do not share one timestamp array')
        if channel.target.path not in ('translation', 'rotation', 'scale'):
            continue
        name = rig.normalise_name(gltf.nodes[channel.target.node].name)
        tracks.setdefault(name, {})[channel.target.path] = \
            rig.read_accessor(gltf, sampler.output).astype(np.float64)
    if times is None:
        raise RetargetError('the animation has no sampled channels')

    return Motion(times=times, bones=bones, tracks=tracks, ancestors=ancestors,
                  source_name=source_name or Path(path).name)


def neutralise(motion, root_motion=False):
    """Replace every rotation and translation with its rest value.

    This is the neutral-pose fixture: the converted output must reproduce each avatar's
    own rest pose. Pass ``root_motion=True`` to keep the source's global translation.
    """
    rest = {bone['name']: bone for bone in motion.bones}
    tracks = {}
    for name, paths in motion.tracks.items():
        tracks[name] = {path: values.copy() for path, values in paths.items()}
        if 'rotation' in tracks[name]:
            tracks[name]['rotation'] = np.repeat(rest[name]['q'][None, :],
                                                 motion.frame_count, axis=0)
        if 'scale' in tracks[name]:
            tracks[name]['scale'] = np.repeat(rest[name]['s'][None, :],
                                              motion.frame_count, axis=0)
        if 'translation' in tracks[name] and not root_motion:
            tracks[name]['translation'] = np.repeat(rest[name]['t'][None, :],
                                                    motion.frame_count, axis=0)
    return Motion(times=motion.times.copy(), bones=motion.bones, tracks=tracks,
                  ancestors=motion.ancestors, source_name=motion.source_name)


def convert(motion, profile, finger_preset='tracked', retargeter_version=RETARGETER_VERSION,
            foot_placement=True):
    """Convert a Motion onto a profile. Returns (clip, report)."""
    started = time.perf_counter()
    failures, warnings = [], []

    bones = profile['rig']['bones']
    bone_by_name = {bone['name']: bone for bone in bones}
    try:
        rig.validate_profile(profile)
    except ValueError as error:
        return None, _failure_report([f'invalid rig profile: {error}'], warnings, motion,
                                     profile, finger_preset, retargeter_version, started)
    rest_worlds = rig.profile_rest_world(profile)
    armature = profile['rig'].get('armature', {'t': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1]})
    armature_world = rig.matrix_from_trs(np.array(armature['t'], float),
                                         np.array(armature['r'], float),
                                         np.array(armature['s'], float))
    armature_rotation_raw = armature_world[:3, :3]
    armature_scale = float(np.cbrt(np.linalg.det(armature_rotation_raw)))
    if abs(armature_scale) < 1e-9:
        raise RetargetError('profile armature has a degenerate scale')
    # Strip the armature scale before using the rotation: inverting the scaled matrix and
    # dividing by the scale again would multiply root translation by 100.
    armature_rotation = armature_rotation_raw / armature_scale

    source_names = {bone['name'] for bone in motion.bones}
    missing_sources = sorted({src for src in rig.MIXAMO_FROM_MHR.values()
                              if src not in source_names})
    if SOURCE_ROOT not in source_names:
        missing_sources.append(SOURCE_ROOT)
    missing_targets = sorted(name for name in rig.MIXAMO_FROM_MHR if name not in bone_by_name)
    if missing_sources:
        failures.append(f'source rig is missing mapped bones: {missing_sources}')
    if missing_targets:
        failures.append(f'profile is missing mapped bones: {missing_targets}')
    if failures:
        # Report the mapping failure rather than raising past it: the report is the
        # artefact an operator reads when a conversion refuses to run.
        return None, _failure_report(failures, warnings, motion, profile,
                                     finger_preset, retargeter_version, started)

    unknown_compound = sorted({joint for chain in rig.COMPOUND_CHAINS.values()
                               for joint in chain} - source_names)
    if unknown_compound:
        warnings.append(f'compound-chain joints absent from the source: {unknown_compound}')

    source_rest = motion.rest_worlds()
    source_rest_quats = motion.rest_quats()
    target_rest_quats = _rest_world_quats(profile)
    ancestors_q = rig.quat_from_matrix(armature_world)
    source_root_rest = source_rest[SOURCE_ROOT][:3, 3]
    if source_root_rest[1] < 1e-3:
        raise RetargetError('source root rests at ground level; cannot scale root motion')
    hip_height = float(profile['measurements']['hip_height'])
    translation_scale = hip_height / float(source_root_rest[1])

    preset = rig.finger_preset_rotations(profile, finger_preset)
    preset_missing = sorted(set(preset) - set(bone_by_name))
    if preset_missing:
        failures.append(f'finger preset bones absent from the profile: {preset_missing}')
    if failures:
        raise RetargetError('; '.join(failures))

    mapped = {name: src for name, src in rig.MIXAMO_FROM_MHR.items()}
    finger_mapping = {}
    if finger_preset == 'tracked':
        for bone in bones:
            name = bone['name']
            src = rig.FINGER_FROM_MHR.get(name)
            if src in source_names and bone['parent'] in mapped:
                finger_mapping[name] = src
                mapped[name] = src
        missing_fingers = sorted(set(rig.FINGER_FROM_MHR) - set(finger_mapping))
        if missing_fingers:
            warnings.append(f'captured finger joints missing; relaxed fallback: {missing_fingers}')
            fallback = rig.finger_preset_rotations(profile, 'relaxed')
            preset.update({name: value for name, value in fallback.items()
                           if name in missing_fingers})
    source_rest_local = {bone['name']: np.asarray(bone['q'], float) for bone in motion.bones}
    source_parent_of = {bone['name']: bone['parent'] for bone in motion.bones}
    aligned_rest, alignment = aligned_rest_quats(
        profile, source_rest, mapped, motion.bones)
    max_alignment = max((rig.quat_angle_degrees(q, np.array([0.0, 0.0, 0.0, 1.0]))
                         for q in alignment.values()), default=0.0)
    tracked = sorted(set(mapped) | set(preset))
    frames = motion.frame_count
    rotations = {name: np.zeros((frames, 4)) for name in tracked}
    translations = {'Hips': np.zeros((frames, 3))}

    rest_lengths = {}
    for bone in bones:
        parent = bone['parent']
        if parent is None:
            continue
        rest_lengths[bone['name']] = float(np.linalg.norm(
            rest_worlds[bone['name']][:3, 3] - rest_worlds[parent][:3, 3]))
    length_error = 0.0
    previous_source, previous_target = {}, {}
    source_steps, target_steps = {}, {}
    source_jumps = []
    worst_direction = (0.0, None)
    source_travel = 0.0
    direction_total, direction_count = 0.0, 0
    target_children, source_children = {}, {}
    for bone in bones:
        if bone['parent'] is not None:
            target_children.setdefault(bone['parent'], []).append(bone['name'])
    for bone in motion.bones:
        if bone['parent'] is not None:
            source_children.setdefault(bone['parent'], []).append(bone['name'])

    for frame in range(frames):
        worlds, source_quats = motion.pose_at(frame)
        source_travel = max(source_travel,
                            float(np.linalg.norm(worlds[SOURCE_ROOT][:3, 3] - source_root_rest)))
        target_worlds, target_quats = {}, {}
        for bone in bones:
            name, parent = bone['name'], bone['parent']
            parent_world = target_worlds[parent] if parent else armature_world
            parent_q = target_quats[parent] if parent else ancestors_q

            source_name = mapped.get(name)
            if source_name is not None:
                if (parent in ALIGNED_BONES and name not in ALIGNED_BONES) or name in finger_mapping:
                    # The parent is aligned but this bone is not (the hands). Copying an
                    # absolute world delta here would keep the rig's own T-pose wrist angle
                    # against an aligned forearm, which reads as a twisted wrist. Apply the
                    # source's *relative* wrist motion to the hand's own rest angle instead.
                    # The target parent may absorb several source joints. Using the
                    # source's immediate parent loses wrist_twist and metacarpal motion.
                    source_parent = mapped[parent]
                    rest_relative = rig.quat_multiply(
                        rig.quat_conjugate(source_rest_quats[source_parent]),
                        source_rest_quats[source_name])
                    posed_relative = rig.quat_multiply(
                        rig.quat_conjugate(source_quats[source_parent]),
                        source_quats[source_name])
                    relative = rig.quat_multiply(rig.quat_conjugate(rest_relative),
                                                 posed_relative)
                    frame_map = rig.quat_multiply(
                        rig.quat_conjugate(target_rest_quats[name]),
                        source_rest_quats[source_name])
                    relative = rig.quat_multiply(rig.quat_multiply(frame_map, relative),
                                                 rig.quat_conjugate(frame_map))
                    quaternion = rig.quat_multiply(np.asarray(bone['r'], float), relative)
                else:
                    # Copy the bone's world rotation change onto its rest pose *aligned to the
                    # source rest*. Without the alignment the A-pose/T-pose difference (48 deg
                    # in the upper arm) survives every frame; with it, the target segment
                    # points where the source segment points.
                    delta_world = rig.quat_multiply(
                        source_quats[source_name],
                        rig.quat_conjugate(source_rest_quats[source_name]))
                    world_q = rig.quat_multiply(delta_world, aligned_rest[name])
                    quaternion = rig.quat_multiply(rig.quat_conjugate(parent_q), world_q)
            else:
                quaternion = np.asarray(bone['r'], float)
                world_q = rig.quat_multiply(parent_q, quaternion)

            if name in preset:
                quaternion = rig.quat_multiply(quaternion, preset[name])
                world_q = rig.quat_multiply(parent_q, quaternion)
            quaternion = quaternion / np.linalg.norm(quaternion)
            world_q = rig.quat_multiply(parent_q, quaternion)
            target_quats[name] = world_q

            translation = np.asarray(bone['t'], float)
            if name == 'Hips':
                delta_world = worlds[SOURCE_ROOT][:3, 3] - source_root_rest
                translation = translation + (
                    (armature_rotation.T @ (delta_world * translation_scale))
                    / armature_scale)
                translations[name][frame] = translation

            if name in rotations:
                rotations[name][frame] = quaternion
            elif np.max(np.abs(quaternion - np.asarray(bone['r'], float))) > IDENTITY_TOLERANCE:
                failures.append(f'{name} is neither mapped nor preset but changed')

            # Track the bone's own local step. This is a fidelity check: a large step is
            # nearly always upstream tracking noise, which the clip reproduces rather than
            # invents.
            if frame:
                if source_name is not None:
                    track = motion.tracks.get(source_name, {})
                    posed_local = (track['rotation'][frame] if 'rotation' in track
                                   else source_rest_local[source_name])
                    previous_local = previous_source.get(source_name)
                    if previous_local is not None:
                        step_angle = rig.quat_angle_degrees(previous_local, posed_local)
                        source_steps[source_name] = max(
                            source_steps.get(source_name, 0.0),
                            step_angle)
                        if step_angle > 60 and name not in finger_mapping:
                            source_jumps.append({'bone': source_name, 'frame': frame,
                                                 'time': float(motion.times[frame]),
                                                 'degrees': round(step_angle, 3)})
                    previous_source[source_name] = np.asarray(posed_local, float)
                previous_target_local = previous_target.get(name)
                if previous_target_local is not None:
                    target_steps[name] = max(
                        target_steps.get(name, 0.0),
                        rig.quat_angle_degrees(previous_target_local, quaternion))
                previous_target[name] = quaternion
            else:
                if source_name is not None:
                    previous_source[source_name] = np.asarray(
                        motion.local_at(next(b for b in motion.bones if b['name'] == source_name), 0)[1])
                previous_target[name] = quaternion

            target_worlds[name] = parent_world @ rig.matrix_from_trs(
                translation, quaternion, np.asarray(bone['s'], float))

            if parent is not None:
                length = float(np.linalg.norm(target_worlds[name][:3, 3]
                                              - target_worlds[parent][:3, 3]))
                length_error = max(length_error, abs(length - rest_lengths[name]))

        # Fidelity of the mapping: does each target segment point where the source's does?
        # This is the property the rest alignment exists to guarantee.
        for target_name, source_name in mapped.items():
            if target_name not in ALIGNED_BONES:
                continue
            target_child = next(iter(target_children.get(target_name, [])), None)
            source_child = next(iter(source_children.get(source_name, [])), None)
            if target_child is None or source_child is None:
                continue
            target_vector = (target_worlds[target_child][:3, 3]
                             - target_worlds[target_name][:3, 3])
            source_vector = worlds[source_child][:3, 3] - worlds[source_name][:3, 3]
            target_length = float(np.linalg.norm(target_vector))
            source_length = float(np.linalg.norm(source_vector))
            if target_length < 1e-9 or source_length < 1e-9:
                continue
            cosine = float(np.clip(np.dot(target_vector / target_length,
                                         source_vector / source_length), -1.0, 1.0))
            error = math.degrees(math.acos(cosine))
            direction_total += error
            direction_count += 1
            if error > worst_direction[0]:
                worst_direction = (error, target_name)

    mean_direction = direction_total / direction_count if direction_count else 0.0

    for name in rotations:
        rotations[name] = _quat_continuity(rotations[name])
        if not np.isfinite(rotations[name]).all():
            failures.append(f'{name} produced non-finite rotations')
    if not np.isfinite(translations['Hips']).all():
        failures.append('Hips produced a non-finite translation')

    if length_error > LENGTH_TOLERANCE:
        failures.append(f'bone lengths changed by up to {length_error * 1000:.3f} mm')

    hips_rest = np.asarray(next(bone for bone in bones if bone['name'] == 'Hips')['t'], float)
    travel = float(np.linalg.norm(translations['Hips'] - hips_rest, axis=1).max()) * abs(armature_scale)
    # Check that the conversion preserved the source's travel rather than that travel is
    # small: handheld footage legitimately reconstructs several metres of root motion.
    expected_travel = source_travel * translation_scale
    if abs(travel - expected_travel) > max(0.02, 0.01 * expected_travel):
        failures.append(
            f'root travel is {travel:.2f} m but the source implies {expected_travel:.2f} m; '
            'the node-space conversion is probably wrong')
    if travel > 200.0:
        failures.append(f'root travel is {travel:.0f} m, which cannot be a real movement')

    norms = {name: float(np.abs(np.linalg.norm(values, axis=1) - 1).max())
             for name, values in rotations.items()}
    worst_norm = max(norms.values()) if norms else 0.0
    if worst_norm > 1e-6:
        failures.append(f'quaternions are not unit length (max error {worst_norm})')

    continuity = _continuity_floor(rotations)
    if continuity < 0.0:
        failures.append('quaternion signs are discontinuous')

    worst_step = (0.0, None)
    worst_local_error = (0.0, None)
    for target_name, source_name in mapped.items():
        step = target_steps.get(target_name, 0.0)
        if step > worst_step[0]:
            worst_step = (step, target_name)
        # Conjugation preserves the rotation angle, so these must agree.
        error = abs(step - source_steps.get(source_name, 0.0))
        if error > worst_local_error[0]:
            worst_local_error = (error, target_name)
    worst_source_step = max(
        ((value, name) for name, value in source_steps.items()), default=(0.0, None))

    unmapped_targets = [name for name in bone_by_name if name not in rotations]
    hands = sorted(set(finger_mapping) | {name for name in preset if name in bone_by_name})
    clip = {'times': motion.times.copy(), 'rotations': rotations,
            'translations': translations, 'preset': finger_preset}
    report = {
        'schema': CLIP_SCHEMA,
        'status': 'failed' if failures else 'ok',
        'failures': failures,
        'warnings': warnings,
        'retargeter': {'version': retargeter_version, 'finger_preset': finger_preset},
        'source': {
            'name': motion.source_name,
            'joints': len(motion.bones),
            'frames': frames,
            'duration_seconds': round(motion.duration, 6),
            'first_timestamp': round(float(motion.times[0]), 6),
            'last_timestamp': round(float(motion.times[-1]), 6),
            'timestamps_sha256': _hash_array(motion.times),
        },
        'target': {
            'avatar_id': profile['avatar_id'],
            'asset_file': profile['asset']['file'],
            'asset_sha256': profile['asset']['sha256'],
            'profile_schema': profile.get('schema'),
            'prep_version': profile['asset'].get('prep_version'),
            'bones': len(bones),
        },
        'root_motion': {
            'source_root_rest_height_m': round(float(source_root_rest[1]), 6),
            'target_hip_height_m': round(hip_height, 6),
            'translation_scale': round(translation_scale, 6),
            'axes_preserved': ['x', 'y', 'z'],
            'travel_m': round(travel, 4),
            'source_travel_m': round(source_travel, 4),
            'note': 'display centring is the viewer\'s responsibility, not the clip\'s',
        },
        'mapping': {
            'direct': mapped,
            'compound': {name: chain for name, chain in rig.COMPOUND_CHAINS.items()
                         if name in bone_by_name},
            'unmapped_target_bones': unmapped_targets,
            'rest_alignment_bones': len(alignment),
            'rest_alignment_missing': sorted(set(mapped) - set(alignment)),
            'max_rest_alignment_degrees': round(max_alignment, 3),
            'fingers': {'bones': hands, 'preset': finger_preset,
                        'direct': finger_mapping, 'endpoints': 'keep target rest transforms'},
        },
        'checks': {
            'frame_count': frames,
            'timing_max_timestamp_drift': 0.0,
            'duration_seconds': round(motion.duration, 6),
            'max_quaternion_norm_error': worst_norm,
            'min_consecutive_quaternion_dot': round(continuity, 6),
            'max_bone_length_error_m': round(length_error, 9),
            'max_step_rotation_source_degrees': round(worst_source_step[0], 3),
            'max_step_rotation_source_bone': worst_source_step[1],
            'max_step_rotation_target_degrees': round(worst_step[0], 3),
            'max_step_rotation_target_bone': worst_step[1],
            'max_step_local_error_degrees': round(worst_local_error[0], 6),
            'mean_segment_direction_error_degrees': round(mean_direction, 4),
            'max_segment_direction_error_degrees': round(worst_direction[0], 4),
            'max_segment_direction_error_bone': worst_direction[1],
        },
        'elapsed_seconds': round(time.perf_counter() - started, 3),
        'source_rotation_jumps': source_jumps,
    }
    if finger_preset == 'none':
        warnings.append('fingers are at the bind pose; review before showing this clip')
    if worst_local_error[0] > 0.01:
        # Informational only: with world deltas the local step need not equal the source's.
        pass
    if worst_direction[0] > 10.0:
        failures.append(
            f'{worst_direction[1]} points {worst_direction[0]:.1f} deg away from the source '
            'segment; the rest alignment is wrong')
    elif worst_direction[0] > 2.0:
        warnings.append(
            f'{worst_direction[1]} points {worst_direction[0]:.1f} deg away from the source '
            'segment')
    if worst_source_step[0] > 60.0:
        warnings.append(
            f'source joint {worst_source_step[1]} turns {worst_source_step[0]:.0f} deg in one '
            'frame; the clip reproduces that jump rather than inventing it')
    if foot_placement:
        # The reference for displacement is the aligned neutral pose, not the raw
        # T-pose. A neutral source must remain neutral on the target.
        neutral_rotations = {}
        neutral_quats = {}
        for bone in bones:
            name, parent = bone['name'], bone['parent']
            parent_q = neutral_quats[parent] if parent else ancestors_q
            if name in mapped and not ((parent in ALIGNED_BONES and name not in ALIGNED_BONES)
                                       or name in finger_mapping):
                local = rig.quat_multiply(rig.quat_conjugate(parent_q), aligned_rest[name])
            else:
                local = np.asarray(bone['r'], float)
            neutral_quats[name] = rig.quat_multiply(parent_q, local)
            neutral_rotations[name] = local[None, :]
        baseline, _ = target_pose(profile, neutral_rotations, {}, 0)
        report['foot_placement'] = place_feet(
            motion, profile, clip, baseline, translation_scale, _shortest_arc)
        if report['foot_placement']['max_ankle_error_after_m'] > 0.02:
            warnings.append('some source ankle positions exceed the target leg reach; see foot_placement')
        for name in rotations:
            rotations[name] = _quat_continuity(rotations[name])
        # IK changes leg directions deliberately to preserve ankle placement. Report
        # its residual independently of the orientation mapping checks above.
        final_step, final_bone = max(
            ((rig.quat_angle_degrees(a, b), name) for name, values in rotations.items()
             for a, b in zip(values, values[1:])), default=(0., None))
        report['checks']['max_step_rotation_target_degrees'] = round(final_step, 3)
        report['checks']['max_step_rotation_target_bone'] = final_bone
        report['checks']['min_consecutive_quaternion_dot'] = round(_continuity_floor(rotations), 6)
        report['checks']['segment_direction_measurement'] = 'orientation transfer before ankle placement'
        # Validate the final transforms, not only the orientation-only intermediate.
        final_length_error = 0.
        for frame in range(frames):
            final_worlds, _ = target_pose(profile, rotations, translations, frame)
            for bone in bones:
                if bone['parent'] is not None:
                    length = np.linalg.norm(final_worlds[bone['name']][:3, 3] - final_worlds[bone['parent']][:3, 3])
                    final_length_error = max(final_length_error, abs(length-rest_lengths[bone['name']]))
        report['checks']['max_bone_length_error_m'] = round(final_length_error, 9)
        if final_length_error > LENGTH_TOLERANCE:
            failures.append('ankle placement changed target bone lengths')
    report['elapsed_seconds'] = round(time.perf_counter() - started, 3)
    report['status'] = 'failed' if failures else 'ok'
    return clip, report


def _failure_report(failures, warnings, motion, profile, finger_preset,
                    retargeter_version, started):
    return {
        'schema': CLIP_SCHEMA,
        'status': 'failed',
        'failures': failures,
        'warnings': warnings,
        'retargeter': {'version': retargeter_version, 'finger_preset': finger_preset},
        'source': {
            'name': motion.source_name,
            'joints': len(motion.bones),
            'frames': motion.frame_count,
            'duration_seconds': round(motion.duration, 6),
        },
        'target': {
            'avatar_id': profile.get('avatar_id'),
            'asset_file': profile.get('asset', {}).get('file'),
            'asset_sha256': profile.get('asset', {}).get('sha256'),
            'bones': len(profile.get('rig', {}).get('bones') or []),
        },
        'mapping': {'unresolved': failures},
        'checks': {},
        'elapsed_seconds': round(time.perf_counter() - started, 3),
    }


def _rest_world_quats(profile):
    """World rest orientation of every target bone, composed as quaternions."""
    armature = profile['rig'].get('armature', {'t': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1]})
    ancestors_q = np.asarray(armature['r'], float)
    quats = {}
    for bone in profile['rig']['bones']:
        parent = bone['parent']
        parent_q = quats[parent] if parent else ancestors_q
        quats[bone['name']] = rig.quat_multiply(parent_q, np.asarray(bone['r'], float))
    return quats


def _shortest_arc(source, target):
    """Rotation taking direction `source` onto direction `target`."""
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    source = source / (np.linalg.norm(source) or 1.0)
    target = target / (np.linalg.norm(target) or 1.0)
    dot = float(np.clip(np.dot(source, target), -1.0, 1.0))
    if dot > 1.0 - 1e-12:
        return np.array([0.0, 0.0, 0.0, 1.0])
    if dot < -1.0 + 1e-9:
        axis = np.cross(source, np.array([1.0, 0.0, 0.0]))
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(source, np.array([0.0, 1.0, 0.0]))
        axis = axis / np.linalg.norm(axis)
        return np.array([axis[0], axis[1], axis[2], 0.0])
    axis = np.cross(source, target)
    return rig.quat_from_axis_angle(axis, math.degrees(math.acos(dot)))


def rest_alignment(profile, source_rest, mapped, source_bones):
    """Per-bone rotation that points the target's rest segment where the source's points.

    The MHR reference rests in an A-pose (upper arm about 48 degrees below horizontal) while
    Mixamo rests in a T-pose. Copying rotation deltas alone preserves that 48-degree offset
    for the whole clip, so every arm pose is wrong by it. Aligning the rest segments first
    makes the target's segment direction equal the source's at every frame:

        target_world = delta_source * (align * target_rest)

    Returns {target bone: quaternion}, plus the angle applied for the report.
    """
    target_rest = rig.profile_rest_world(profile)
    target_positions = {name: matrix[:3, 3] for name, matrix in target_rest.items()}
    source_positions = {name: rest[:3, 3] for name, rest in source_rest.items()}
    parent_of = {bone['name']: bone['parent'] for bone in profile['rig']['bones']}
    target_children = {}
    for bone in profile['rig']['bones']:
        if bone['parent'] is not None:
            target_children.setdefault(bone['parent'], []).append(bone['name'])
    source_children = {}
    for bone in source_bones:
        if bone['parent'] is not None:
            source_children.setdefault(bone['parent'], []).append(bone['name'])

    def direction(positions, name, parent, child):
        base = positions.get(name)
        if base is None:
            return None
        if child is not None and child in positions:
            vector = positions[child] - base
        elif parent is not None and parent in positions:
            vector = base - positions[parent]
        else:
            return None
        length = float(np.linalg.norm(vector))
        return vector / length if length > 1e-9 else None

    alignment = {}
    for target_name, source_name in mapped.items():
        if target_name not in ALIGNED_BONES:
            # Only limb segments are aligned. The pelvis and spine are excluded because a
            # bone-to-child direction is not a limb axis there: aligning the pelvis rotated
            # it 103 degrees and folded the whole torso.
            continue
        # Use each rig's own first child: the segment being aligned is bone -> child, and a
        # compound mapping (LeftFoot <- the tarsal chain) would otherwise measure the whole
        # foot instead of the shin.
        target_child = next(iter(target_children.get(target_name, [])), None)
        source_child = next(iter(source_children.get(source_name, [])), None)
        source_parent = next((bone['parent'] for bone in source_bones
                              if bone['name'] == source_name), None)
        target_dir = direction(target_positions, target_name,
                               parent_of.get(target_name), target_child)
        source_dir = direction(source_positions, source_name, source_parent, source_child)
        if target_dir is None or source_dir is None:
            continue
        alignment[target_name] = _shortest_arc(target_dir, source_dir)
    return alignment


def aligned_rest_quats(profile, source_rest, mapped, source_bones):
    """Target rest orientations after aligning each segment to the source's rest direction."""
    target_rest = _rest_world_quats(profile)
    alignment = rest_alignment(profile, source_rest, mapped, source_bones)
    aligned = {name: (rig.quat_multiply(alignment[name], target_rest[name])
                      if name in alignment else target_rest[name])
               for name in target_rest}
    return aligned, alignment


def _quat_continuity(values):
    """Flip signs so consecutive quaternions take the short path."""
    out = values.copy()
    for index in range(1, out.shape[0]):
        if float(np.dot(out[index], out[index - 1])) < 0:
            out[index] = -out[index]
    return out


def _continuity_floor(rotations):
    floor = 1.0
    for values in rotations.values():
        if values.shape[0] < 2:
            continue
        floor = min(floor, float(np.sum(values[1:] * values[:-1], axis=1).min()))
    return floor


def _hash_array(values):
    return hashlib.sha256(np.ascontiguousarray(values, dtype='<f8').tobytes()).hexdigest()


class _Builder:
    """Packs animation data into one aligned binary blob."""

    def __init__(self):
        self.blob = bytearray()
        self.views = []
        self.accessors = []

    def accessor(self, array, component_type, gltf_type):
        array = np.ascontiguousarray(array, dtype=np.float32)
        while len(self.blob) % 4:
            self.blob.append(0)
        payload = array.tobytes()
        self.views.append(BufferView(buffer=0, byteOffset=len(self.blob),
                                     byteLength=len(payload)))
        self.blob.extend(payload)
        self.accessors.append(Accessor(bufferView=len(self.views) - 1,
                                       componentType=component_type,
                                       count=int(array.shape[0]), type=gltf_type))
        return len(self.accessors) - 1


def write_clip(clip, profile, path):
    """Write an animation-only GLB carrying the target hierarchy and the clip."""
    builder = _Builder()
    armature = profile['rig'].get('armature', {'t': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1]})
    nodes = [Node(name='Armature', translation=armature['t'], rotation=armature['r'],
                  scale=armature['s'], children=[])]
    node_index = {}
    for bone in profile['rig']['bones']:
        node_index[bone['name']] = len(nodes)
        nodes.append(Node(name=bone['name'], translation=bone['t'], rotation=bone['r'],
                          scale=bone['s'], children=[]))
    for bone in profile['rig']['bones']:
        parent = bone['parent']
        nodes[0 if parent is None else node_index[parent]].children.append(
            node_index[bone['name']])

    input_accessor = builder.accessor(np.asarray(clip['times'], float).reshape(-1, 1),
                                      FLOAT, 'SCALAR')
    channels, samplers = [], []
    for bone in profile['rig']['bones']:
        name = bone['name']
        if name in clip['rotations']:
            output = builder.accessor(clip['rotations'][name], FLOAT, 'VEC4')
            samplers.append(AnimationSampler(input=input_accessor, output=output,
                                             interpolation=ANIM_LINEAR))
            channels.append(AnimationChannel(
                sampler=len(samplers) - 1,
                target=AnimationChannelTarget(node=node_index[name], path='rotation')))
        if name in clip['translations']:
            output = builder.accessor(clip['translations'][name], FLOAT, 'VEC3')
            samplers.append(AnimationSampler(input=input_accessor, output=output,
                                             interpolation=ANIM_LINEAR))
            channels.append(AnimationChannel(
                sampler=len(samplers) - 1,
                target=AnimationChannelTarget(node=node_index[name], path='translation')))

    gltf = GLTF2(
        asset=Asset(version='2.0', generator=f'3d_trainer retarget {RETARGETER_VERSION}'),
        scene=0, scenes=[Scene(nodes=[0])], nodes=nodes,
        animations=[Animation(name='Retargeted reference', channels=channels,
                              samplers=samplers)],
        accessors=builder.accessors, bufferViews=builder.views,
        buffers=[Buffer(byteLength=len(builder.blob))])
    gltf.set_binary_blob(bytes(builder.blob))
    _atomic_write(path, lambda temp: gltf.save_binary(str(temp)))


def _atomic_write(path, writer):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.tmp')
    try:
        writer(temporary)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def verify_written(path, clip, profile, report):
    """Re-read the written file and confirm it binds and keeps the source clock."""
    gltf = GLTF2().load(str(path))
    failures = list(report['failures'])
    names = {bone['name'] for bone in profile['rig']['bones']}
    if len(gltf.animations) != 1:
        failures.append('written clip does not contain exactly one animation')
    animation = gltf.animations[0]
    node_names = {index: node.name for index, node in enumerate(gltf.nodes)}

    unresolved, tracks = [], 0
    for channel in animation.channels:
        name = node_names.get(channel.target.node)
        if name not in names:
            unresolved.append(name)
        tracks += 1

    expected_times = np.asarray(clip['times'], dtype=np.float64).reshape(-1)
    clocks, nonfinite, drifted, non_monotonic = set(), False, 0, 0
    for sampler in animation.samplers:
        values = rig.read_accessor(gltf, sampler.input).reshape(-1).astype(np.float64)
        clocks.add(len(values))
        if values.shape != expected_times.shape or \
                float(np.abs(values - expected_times).max()) > TIMESTAMP_TOLERANCE:
            # Comparing only the first and last sample would accept a clock that is wrong
            # in the middle, which would move section boundaries.
            drifted += 1
        if np.any(np.diff(values) <= 0):
            non_monotonic += 1
        if not np.isfinite(rig.read_accessor(gltf, sampler.output)).all():
            nonfinite = True
    if len(clocks) != 1:
        failures.append('written clip channels disagree on their timestamps')
    if drifted:
        failures.append(f'{drifted} samplers have timestamps that differ from the source clock')
    if non_monotonic:
        failures.append(f'{non_monotonic} samplers have non-increasing timestamps')
    start, end, count = (float(expected_times[0]), float(expected_times[-1]),
                         int(expected_times.shape[0]))
    if nonfinite:
        failures.append('written clip has non-finite sample data')
    if unresolved:
        failures.append(f'tracks do not resolve against the profile: {sorted(set(unresolved))}')

    report['output'] = {
        'file': Path(path).name,
        'bytes': Path(path).stat().st_size,
        'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        'tracks': tracks,
        'animated_bones': len(clip['rotations']),
        'frames': count,
        'duration_seconds': round(end - start, 6),
    }
    report['checks']['written_tracks_resolve'] = not unresolved
    report['checks']['written_timestamps_match'] = not (drifted or non_monotonic or len(clocks) != 1)
    report['status'] = 'failed' if failures else 'ok'
    report['failures'] = failures
    return report


def _empty_report(source_path, profile_path, error, retargeter_version, finger_preset):
    """A report for input failures, so a refusal is never silent."""
    def digest(path):
        try:
            return hashlib.sha256(Path(path).read_bytes()).hexdigest()
        except OSError:
            return None

    return {
        'schema': CLIP_SCHEMA,
        'status': 'failed',
        'failures': [str(error)],
        'warnings': [],
        'retargeter': {'version': retargeter_version, 'finger_preset': finger_preset},
        'source': {'file': Path(source_path).name, 'sha256': digest(source_path)},
        'target': {'profile_file': Path(profile_path).name,
                   'profile_sha256': digest(profile_path)},
        'mapping': {},
        'checks': {},
        'output': {'file': None},
    }


def retarget(source_path, profile_path, output_path, report_path,
             finger_preset='tracked', retargeter_version=RETARGETER_VERSION):
    """Read, convert, write and verify. Returns the report; raises on a failed conversion."""
    try:
        profile = rig.load_profile(profile_path)
        rig.validate_profile(profile)
        motion = load_motion(source_path)
    except (RetargetError, ValueError, OSError) as error:
        report = _empty_report(source_path, profile_path, error, retargeter_version,
                               finger_preset)
        _write_report(report_path, report)
        raise RetargetError(f'input rejected: {error}') from error

    clip, report = convert(motion, profile, finger_preset=finger_preset,
                           retargeter_version=retargeter_version)
    report['source']['file'] = Path(source_path).name
    report['source']['sha256'] = hashlib.sha256(Path(source_path).read_bytes()).hexdigest()
    report['target']['profile_file'] = Path(profile_path).name

    if report['status'] != 'ok':
        report['output'] = {'file': None}
        _write_report(report_path, report)
        raise RetargetError('conversion failed: ' + '; '.join(report['failures']))

    write_clip(clip, profile, output_path)
    report = verify_written(output_path, clip, profile, report)
    _write_report(report_path, report)
    if report['status'] != 'ok':
        raise RetargetError('written clip failed verification: '
                            + '; '.join(report['failures']))
    return report


def _write_report(path, report):
    _atomic_write(path, lambda temp: temp.write_text(json.dumps(report, indent=1) + '\n'))


def main():
    parser = argparse.ArgumentParser(
        description='Retarget a canonical MHR clip onto a prepared Mixamo avatar.',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', required=True, type=Path, help='canonical motion GLB')
    parser.add_argument('--avatar', choices=('male', 'female'),
                        help='prepared avatar id; uses the bundled profile')
    parser.add_argument('--profile', type=Path, help='explicit rig profile JSON')
    parser.add_argument('--output', required=True, type=Path, help='converted clip GLB')
    parser.add_argument('--report', required=True, type=Path, help='validation report JSON')
    parser.add_argument('--finger-preset', default='tracked', choices=sorted(rig.FINGER_PRESETS))
    parser.add_argument('--retargeter-version', default=RETARGETER_VERSION)
    args = parser.parse_args()

    if bool(args.avatar) == bool(args.profile):
        parser.error('give exactly one of --avatar or --profile')
    profile_path = args.profile or (PROFILES / f'{args.avatar}.json')

    try:
        report = retarget(args.source, profile_path, args.output, args.report,
                          finger_preset=args.finger_preset,
                          retargeter_version=args.retargeter_version)
    except RetargetError as error:
        print(f'retarget failed: {error}', file=sys.stderr)
        return 1

    output = report['output']
    print(f"{report['status']}: {output['tracks']} tracks, {output['frames']} frames, "
          f"{output['duration_seconds']} s, {output['bytes']:,} bytes -> {output['file']}")
    for warning in report['warnings']:
        print(f'warning: {warning}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
