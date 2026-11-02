"""Guards for the MHR -> Mixamo retargeter.

The two assertions that matter are the neutral-pose gate (a neutral source must reproduce
each avatar's own rest pose, per bone, numerically) and the delta test (a rotation on one
source joint must arrive on exactly the mapped target segment, without leaking into its
children). Everything else protects the contract the worker depends on: exact timing,
fixed bone lengths, deterministic bytes, and a report on failure.
"""

import copy
import json

import numpy as np
import pytest
from pygltflib import GLTF2

import avatar_rig as rig
import retarget_mixamo as rt

DEMO = rt.ROOT / 'outputs/demo/motion.glb'
AVATARS = ['male', 'female']

pytestmark = pytest.mark.skipif(not DEMO.exists(), reason='canonical demo motion is absent')


@pytest.fixture(scope='module')
def motion():
    return rt.load_motion(DEMO)


@pytest.fixture(scope='module')
def profiles():
    return {avatar: rig.load_profile(rt.PROFILES / f'{avatar}.json') for avatar in AVATARS}


def clip_worlds(clip, profile, frame):
    """Compose target world matrices the way a viewer would: rest hierarchy + clip."""
    armature = profile['rig'].get('armature', {'t': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1]})
    worlds = {}
    for bone in profile['rig']['bones']:
        name, parent = bone['name'], bone['parent']
        base = worlds[parent] if parent else rig.matrix_from_trs(
            np.array(armature['t'], float), np.array(armature['r'], float),
            np.array(armature['s'], float))
        t = clip['translations']['Hips'][frame] if name == 'Hips' else np.asarray(bone['t'], float)
        q = clip['rotations'][name][frame] if name in clip['rotations'] else np.asarray(bone['r'], float)
        worlds[name] = base @ rig.matrix_from_trs(t, q, np.asarray(bone['s'], float))
    return worlds


def rest_rotation(profile, name):
    for bone in profile['rig']['bones']:
        if bone['name'] == name:
            return np.asarray(bone['r'], float)
    raise KeyError(name)


FINGER_KEYS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')


def is_finger(name):
    return 'Hand' in name and any(key in name for key in FINGER_KEYS)


def test_neutral_pose_reproduces_each_rest_pose(motion, profiles):
    """The Phase B gate, as a number instead of an eyeball.

    Run with the bind-pose finger preset so it isolates the mapping: the preset is
    checked separately.
    """
    neutral = rt.neutralise(motion)
    for avatar in AVATARS:
        clip, report = rt.convert(neutral, profiles[avatar], finger_preset='none')
        assert report['status'] == 'ok', report['failures']
        assert clip['rotations'], 'the neutral conversion produced no tracks'
        worst, worst_bone = 0.0, None
        for name, values in clip['rotations'].items():
            angle = max(rig.quat_angle_degrees(value, rest_rotation(profiles[avatar], name))
                        for value in values)
            if angle > worst:
                worst, worst_bone = angle, name
        assert worst < 0.1, f'{avatar}: {worst_bone} is {worst:.3f} deg from rest'

        # The default preset may curl fingers but must not disturb a mapped bone.
        curled, curled_report = rt.convert(neutral, profiles[avatar])
        preset_bones = set(curled_report['mapping']['fingers']['bones'])
        assert preset_bones, 'the relaxed preset produced no finger tracks'
        for name, values in curled['rotations'].items():
            if name in preset_bones:
                continue
            angle = max(rig.quat_angle_degrees(value, rest_rotation(profiles[avatar], name))
                        for value in values)
            assert angle < 0.1, f'{avatar}: preset moved {name} by {angle:.3f} deg'

        hips_rest = next(b for b in profiles[avatar]['rig']['bones'] if b['name'] == 'Hips')
        assert np.allclose(clip['translations']['Hips'], np.array(hips_rest['t'], float),
                           atol=1e-9), f'{avatar}: neutral pose shifted the hips'


def test_timing_is_preserved_exactly(motion, profiles):
    clip, report = rt.convert(motion, profiles['male'])
    assert np.array_equal(clip['times'], motion.times)
    assert report['checks']['timing_max_timestamp_drift'] == 0.0
    assert report['checks']['duration_seconds'] == round(motion.duration, 6)
    assert report['source']['frames'] == motion.frame_count


def test_bone_lengths_are_preserved(motion, profiles):
    clip, report = rt.convert(motion, profiles['male'])
    assert report['checks']['max_bone_length_error_m'] == 0.0
    for avatar in AVATARS:
        profile = profiles[avatar]
        rest = rig.profile_rest_world(profile)
        clip, _ = rt.convert(motion, profile)
        for frame in (0, motion.frame_count // 2, motion.frame_count - 1):
            worlds = clip_worlds(clip, profile, frame)
            for bone in profile['rig']['bones']:
                parent = bone['parent']
                if parent is None:
                    continue
                rest_length = np.linalg.norm(rest[bone['name']][:3, 3] - rest[parent][:3, 3])
                length = np.linalg.norm(worlds[bone['name']][:3, 3] - worlds[parent][:3, 3])
                assert abs(length - rest_length) < 1e-6, f'{avatar} {bone["name"]} stretched'


def test_one_joint_rotation_lands_on_the_mapped_segment(motion, profiles):
    """Rotating l_uparm must move LeftArm by that delta and leave LeftForeArm alone."""
    profile = profiles['male']
    # Start from the neutral pose so the only rotation in the clip is the synthetic one;
    # the real Taegeuk clip animates the forearm too.
    moved = copy.deepcopy(rt.neutralise(motion))
    local_delta = rig.quat_from_axis_angle((0.0, 1.0, 0.0), 30.0)
    rest_q = next(b['q'] for b in moved.bones if b['name'] == 'l_uparm')
    moved.tracks['l_uparm']['rotation'] = np.repeat(
        (rig.quat_multiply(rest_q, local_delta))[None, :], moved.frame_count, axis=0)
    moved._rest_worlds = None

    clip, report = rt.convert(moved, profile)
    assert report['status'] == 'ok'
    rest = rig.profile_rest_world(profile)
    worlds = clip_worlds(clip, profile, 0)

    source_rest = moved.rest_worlds()
    source_posed = moved.worlds_at(0)
    delta = source_posed['l_uparm'][:3, :3] @ np.linalg.inv(source_rest['l_uparm'][:3, :3])
    expected = rig.quat_from_matrix(delta @ rest['LeftArm'][:3, :3])
    actual = rig.quat_from_matrix(worlds['LeftArm'][:3, :3])
    angle = rig.quat_angle_degrees(expected, actual)
    assert angle < 0.01, f'LeftArm is {angle:.4f} deg from the expected delta'
    assert angle is not None
    assert rig.quat_angle_degrees(rig.quat_from_matrix(source_rest['l_uparm']),
                                  rig.quat_from_matrix(source_posed['l_uparm'])) > 5.0, \
        'the synthetic rotation did not reach the target at all'

    # The elbow does not bend in the source, so the forearm's *local* rotation must stay at
    # rest even though its world orientation follows the rotating upper arm.
    forearm_local = rig.quat_angle_degrees(clip['rotations']['LeftForeArm'][0],
                                           rest_rotation(profile, 'LeftForeArm'))
    assert forearm_local < 0.01, f'the elbow gained {forearm_local:.4f} deg of bend'


def test_root_translation_is_scaled_and_converted(motion, profiles):
    clip, report = rt.convert(motion, profiles['male'])
    scale = report['root_motion']['translation_scale']
    source = motion.worlds_at(0)[rt.SOURCE_ROOT][:3, 3]
    source_rest = motion.rest_worlds()[rt.SOURCE_ROOT][:3, 3]
    armature = profiles['male']['rig']['armature']
    armature_raw = rig.matrix_from_trs(np.array(armature['t'], float),
                                       np.array(armature['r'], float),
                                       np.array(armature['s'], float))[:3, :3]
    armature_scale = float(np.cbrt(np.linalg.det(armature_raw)))
    armature_rotation = armature_raw / armature_scale
    expected = (armature_rotation.T @ ((source - source_rest) * scale)) / armature_scale
    hips = next(b for b in profiles['male']['rig']['bones'] if b['name'] == 'Hips')
    assert np.allclose(clip['translations']['Hips'][0] - np.array(hips['t'], float),
                       expected, atol=1e-9)
    # The end-to-end travel must stay physically sensible: the demo form steps forward.
    assert 0.1 < report['root_motion']['travel_m'] < 5.0


def test_finger_presets_are_explicit(motion, profiles):
    profile = profiles['male']
    relaxed, _ = rt.convert(motion, profile, finger_preset='relaxed')
    none, report_none = rt.convert(motion, profile, finger_preset='none')

    finger_tracks = [name for name in none['rotations'] if is_finger(name)]
    assert not finger_tracks, 'the bind-pose preset must not write finger tracks'
    assert any('bind pose' in warning for warning in report_none['warnings'])

    fingers = [name for name in relaxed['rotations'] if is_finger(name)]
    assert len(fingers) == 40
    for name in fingers:
        angle = rig.quat_angle_degrees(relaxed['rotations'][name][0], rest_rotation(profile, name))
        assert 3.0 < angle < 40.0, f'{name} curls {angle:.1f} deg, outside a relaxed hand'

    # The curl axis is derived per hand, so both hands bend toward their palm rather than
    # relying on a mirror sign. Both hands of this rig share one local axis convention.
    for side in ('Left', 'Right'):
        palm = rig.palm_normal_local(profile, side)
        axis = np.cross(rig.FINGER_ALONG_LOCAL, palm)
        rest_q = rest_rotation(profile, f'{side}HandIndex2')
        posed_along = rig.quat_from_matrix(
            rig.matrix_from_quat(rig.quat_multiply(
                rest_q, relaxed['rotations'][f'{side}HandIndex2'][0])))[:3]
        assert np.dot(axis, np.array([1.0, 0.0, 0.0])) > 0.99, f'{side} curl axis is unexpected'
        assert abs(np.dot(axis, palm)) < 1e-9, 'the curl axis must be perpendicular to the palm'
        assert posed_along is not None


def test_conversion_is_deterministic(motion, profiles):
    first, _ = rt.convert(motion, profiles['male'])
    second, _ = rt.convert(motion, profiles['female'])
    again, _ = rt.convert(motion, profiles['male'])
    for name, values in first['rotations'].items():
        assert np.array_equal(values, again['rotations'][name]), f'{name} is not deterministic'
    assert not np.array_equal(first['rotations']['Hips'],
                              second['rotations']['Hips']), 'avatar should change the clip'


def test_written_clip_round_trips(tmp_path, motion, profiles):
    profile = profiles['male']
    output = tmp_path / 'clip.glb'
    report_path = tmp_path / 'report.json'
    report = rt.retarget(DEMO, rt.PROFILES / 'male.json', output, report_path)

    assert report['status'] == 'ok'
    assert report['checks']['written_tracks_resolve'] is True
    assert report['checks']['written_timestamps_match'] is True
    assert report['source']['sha256'] == rt.hashlib.sha256(DEMO.read_bytes()).hexdigest()
    assert report['target']['asset_sha256'] == profile['asset']['sha256']
    assert report['output']['tracks'] == len(report['mapping']['direct']) + 40 + 1
    assert json.loads(report_path.read_text())['status'] == 'ok'

    gltf = GLTF2().load(str(output))
    assert len(gltf.animations) == 1
    assert not gltf.meshes, 'the clip file must not carry geometry'
    names = {node.name for node in gltf.nodes}
    assert {bone['name'] for bone in profile['rig']['bones']} <= names
    animation = gltf.animations[0]
    for channel in animation.channels:
        assert gltf.nodes[channel.target.node].name in names
    times = rig.read_accessor(gltf, animation.samplers[0].input).reshape(-1)
    assert np.array_equal(times.astype(np.float32), motion.times.astype(np.float32))


def test_mapping_failure_is_reported_not_raised(motion, profiles):
    broken = copy.deepcopy(profiles['male'])
    broken['rig']['bones'] = [bone for bone in broken['rig']['bones']
                              if not bone['name'].startswith('LeftHand')]
    broken['rig']['joint_count'] = len(broken['rig']['bones'])
    clip, report = rt.convert(motion, broken)
    assert clip is None
    assert report['status'] == 'failed'
    assert any('profile is missing mapped bones' in failure for failure in report['failures'])


def test_missing_source_bone_is_reported(motion, profiles):
    broken = copy.deepcopy(motion)
    for bone in broken.bones:
        if bone['name'] == 'l_wrist':
            bone['name'] = 'l_wrist_gone'
    if 'l_wrist' in broken.tracks:
        broken.tracks['l_wrist_gone'] = broken.tracks.pop('l_wrist')
    broken._rest_worlds = None
    clip, report = rt.convert(broken, profiles['male'])
    assert clip is None
    assert any('l_wrist' in failure for failure in report['failures'])


def test_failed_conversion_writes_report_and_no_clip(tmp_path, profiles):
    broken = copy.deepcopy(profiles['male'])
    broken['rig']['bones'] = [bone for bone in broken['rig']['bones']
                              if bone['name'] != 'Hips']
    profile_path = tmp_path / 'broken.json'
    profile_path.write_text(json.dumps(broken))
    output = tmp_path / 'clip.glb'
    report_path = tmp_path / 'report.json'

    with pytest.raises(rt.RetargetError):
        rt.retarget(DEMO, profile_path, output, report_path)
    assert not output.exists(), 'a failed conversion must not leave a clip behind'
    assert not list(tmp_path.glob('.*.tmp')), 'temporary files must be cleaned up'
    saved = json.loads(report_path.read_text())
    assert saved['status'] == 'failed'
    assert saved['failures']
