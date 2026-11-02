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

Fingers
-------
Fingers are not retargeted yet. MHR has three phalanges plus a metacarpal per finger and
Mixamo has four joints per chain; that correspondence is not validated. Fingers hold a
reviewed static preset instead, so the hands never sit at the flat, splayed bind pose.

    python scripts/retarget_mixamo.py --source outputs/demo/motion.glb \
        --avatar male --output build/male-clip.glb --report build/male-report.json
"""

import argparse
import hashlib
import json
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

ROOT = Path(__file__).resolve().parents[1]
PROFILES = ROOT / 'packages/avatar-rigs/profiles'

RETARGETER_VERSION = '1.0.0'
CLIP_SCHEMA = 1
SOURCE_ROOT = 'root'
TIMESTAMP_TOLERANCE = 1e-6
LENGTH_TOLERANCE = 1e-6
IDENTITY_TOLERANCE = 1e-6
MAX_ROOT_TRAVEL_M = 10.0


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


def convert(motion, profile, finger_preset='relaxed', retargeter_version=RETARGETER_VERSION):
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

    for frame in range(frames):
        worlds, source_quats = motion.pose_at(frame)
        target_worlds, target_quats = {}, {}
        for bone in bones:
            name, parent = bone['name'], bone['parent']
            parent_world = target_worlds[parent] if parent else armature_world
            parent_q = target_quats[parent] if parent else ancestors_q

            source_name = mapped.get(name)
            if source_name is not None:
                delta = rig.quat_multiply(source_quats[source_name],
                                          rig.quat_conjugate(source_rest_quats[source_name]))
                world_q = rig.quat_multiply(delta, target_rest_quats[name])
                quaternion = rig.quat_multiply(rig.quat_conjugate(parent_q), world_q)
            else:
                quaternion = np.asarray(bone['r'], float)
                world_q = rig.quat_multiply(parent_q, quaternion)

            if name in preset:
                quaternion = rig.quat_multiply(quaternion, preset[name])
                world_q = rig.quat_multiply(parent_q, quaternion)
            quaternion = quaternion / np.linalg.norm(quaternion)
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

            target_worlds[name] = parent_world @ rig.matrix_from_trs(
                translation, quaternion, np.asarray(bone['s'], float))

            if parent is not None:
                length = float(np.linalg.norm(target_worlds[name][:3, 3]
                                              - target_worlds[parent][:3, 3]))
                length_error = max(length_error, abs(length - rest_lengths[name]))

    for name in rotations:
        rotations[name] = _quat_continuity(rotations[name])
        if not np.isfinite(rotations[name]).all():
            failures.append(f'{name} produced non-finite rotations')
    if not np.isfinite(translations['Hips']).all():
        failures.append('Hips produced a non-finite translation')

    if length_error > LENGTH_TOLERANCE:
        failures.append(f'bone lengths changed by up to {length_error * 1000:.3f} mm')

    hips_rest = np.asarray(next(bone for bone in bones if bone['name'] == 'Hips')['t'], float)
    travel = float(np.abs(translations['Hips'] - hips_rest).max()) * armature_scale
    if travel > MAX_ROOT_TRAVEL_M:
        failures.append(f'root translation travels {travel:.2f} m, which is implausible; '
                        'the node-space conversion is probably wrong')

    norms = {name: float(np.abs(np.linalg.norm(values, axis=1) - 1).max())
             for name, values in rotations.items()}
    worst_norm = max(norms.values()) if norms else 0.0
    if worst_norm > 1e-6:
        failures.append(f'quaternions are not unit length (max error {worst_norm})')

    continuity = _continuity_floor(rotations)
    if continuity < 0.0:
        failures.append('quaternion signs are discontinuous')

    unmapped_targets = [name for name in bone_by_name if name not in rotations]
    hands = sorted(name for name in preset if name in bone_by_name)
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
            'note': 'display centring is the viewer\'s responsibility, not the clip\'s',
        },
        'mapping': {
            'direct': mapped,
            'compound': {name: chain for name, chain in rig.COMPOUND_CHAINS.items()
                         if name in bone_by_name},
            'unmapped_target_bones': unmapped_targets,
            'fingers': {'bones': hands, 'preset': finger_preset},
        },
        'checks': {
            'frame_count': frames,
            'timing_max_timestamp_drift': 0.0,
            'duration_seconds': round(motion.duration, 6),
            'max_quaternion_norm_error': worst_norm,
            'min_consecutive_quaternion_dot': round(continuity, 6),
            'max_bone_length_error_m': round(length_error, 9),
        },
        'elapsed_seconds': round(time.perf_counter() - started, 3),
    }
    if finger_preset == 'none':
        warnings.append('fingers are at the bind pose; review before showing this clip')
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

    clocks, nonfinite = set(), False
    for sampler in animation.samplers:
        values = rig.read_accessor(gltf, sampler.input).reshape(-1)
        clocks.add((round(float(values[0]), 6), round(float(values[-1]), 6), len(values)))
        if not np.isfinite(rig.read_accessor(gltf, sampler.output)).all():
            nonfinite = True
    if len(clocks) != 1:
        failures.append('written clip channels disagree on their timestamps')
    start, end, count = clocks.pop() if clocks else (0.0, 0.0, 0)
    if count != int(clip['times'].shape[0]):
        failures.append('written clip frame count differs from the source')
    if (abs(start - float(clip['times'][0])) > TIMESTAMP_TOLERANCE
            or abs(end - float(clip['times'][-1])) > TIMESTAMP_TOLERANCE):
        failures.append('written clip duration differs from the source')
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
    report['checks']['written_timestamps_match'] = not nonfinite and count == int(
        clip['times'].shape[0])
    report['status'] = 'failed' if failures else 'ok'
    report['failures'] = failures
    return report


def retarget(source_path, profile_path, output_path, report_path,
             finger_preset='relaxed', retargeter_version=RETARGETER_VERSION):
    """Read, convert, write and verify. Returns the report; raises on a failed conversion."""
    profile = rig.load_profile(profile_path)
    motion = load_motion(source_path)
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
    parser.add_argument('--finger-preset', default='relaxed', choices=sorted(rig.FINGER_PRESETS))
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
