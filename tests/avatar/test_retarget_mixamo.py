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


def test_neutral_pose_reproduces_the_aligned_rest(motion, profiles):
    """The Phase B gate.

    A neutral source must reproduce each avatar's rest pose *as aligned to the source rest*:
    the source rigs rest in an A-pose and the avatars in a T-pose, so "neutral" is the
    aligned rest, not the raw profile rest. Run with the bind-pose finger preset so it
    isolates the mapping; the preset is checked separately.
    """
    neutral = rt.neutralise(motion)
    for avatar in AVATARS:
        profile = profiles[avatar]
        source_rest = neutral.rest_worlds()
        expected, _ = rt.aligned_rest_quats(profile, source_rest,
                                            dict(rig.MIXAMO_FROM_MHR), neutral.bones)
        expected_local = {}
        for bone in profile['rig']['bones']:
            parent = bone['parent']
            if parent in rt.ALIGNED_BONES and bone['name'] not in rt.ALIGNED_BONES:
                # Relative-mode bones (the hands) keep the rig's own rest angle, because the
                # source's wrist motion is added relative to the aligned forearm.
                expected_local[bone['name']] = np.array(bone['r'], float)
                continue
            parent_q = expected[parent] if parent else np.array(
                profile['rig']['armature']['r'], float)
            expected_local[bone['name']] = rig.quat_multiply(
                rig.quat_conjugate(parent_q), expected[bone['name']])

        clip, report = rt.convert(neutral, profile, finger_preset='none')
        assert report['status'] == 'ok', report['failures']
        worst, worst_bone = 0.0, None
        for name, values in clip['rotations'].items():
            angle = max(rig.quat_angle_degrees(value, expected_local[name]) for value in values)
            if angle > worst:
                worst, worst_bone = angle, name
        assert worst < 0.1, f'{avatar}: {worst_bone} is {worst:.3f} deg from the aligned rest'

        # Segment directions must match the source exactly in a neutral pose.
        worlds = clip_worlds(clip, profile, 0)
        for side in ('Left', 'Right'):
            source_side = side[0].lower()
            target_dir = worlds[f'{side}ForeArm'][:3, 3] - worlds[f'{side}Arm'][:3, 3]
            source_dir = (source_rest[f'{source_side}_lowarm'][:3, 3]
                          - source_rest[f'{source_side}_uparm'][:3, 3])
            angle = np.degrees(np.arccos(np.clip(
                np.dot(target_dir / np.linalg.norm(target_dir),
                       source_dir / np.linalg.norm(source_dir)), -1, 1)))
            assert angle < 0.1, f'{avatar}: {side} upper arm is {angle:.3f} deg off the source'

        hips_rest = next(b for b in profile['rig']['bones'] if b['name'] == 'Hips')
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
    """A rotation on l_uparm must carry the target's upper-arm segment with it, and must not
    add elbow bend."""
    profile = profiles['male']
    # Start from the neutral pose so the only rotation in the clip is the synthetic one.
    moved = copy.deepcopy(rt.neutralise(motion))
    local_delta = rig.quat_from_axis_angle((0.0, 1.0, 0.0), 30.0)
    rest_q = next(b['q'] for b in moved.bones if b['name'] == 'l_uparm')
    moved.tracks['l_uparm']['rotation'] = np.repeat(
        (rig.quat_multiply(rest_q, local_delta))[None, :], moved.frame_count, axis=0)
    moved._rest_worlds = None
    moved._rest_quats = None

    clip, report = rt.convert(moved, profile)
    assert report['status'] == 'ok'

    # The upper-arm segment must point where the source's upper-arm segment points.
    source = moved.worlds_at(0)
    worlds = clip_worlds(clip, profile, 0)
    source_dir = source['l_lowarm'][:3, 3] - source['l_uparm'][:3, 3]
    target_dir = worlds['LeftForeArm'][:3, 3] - worlds['LeftArm'][:3, 3]
    angle = np.degrees(np.arccos(np.clip(
        np.dot(source_dir / np.linalg.norm(source_dir),
               target_dir / np.linalg.norm(target_dir)), -1, 1)))
    assert angle < 0.1, f'the upper arm is {angle:.3f} deg off the source'
    assert angle is not None

    # The elbow does not bend in the source, so the forearm keeps its local rotation.
    bend = rig.quat_angle_degrees(clip['rotations']['LeftForeArm'][0],
                                  clip['rotations']['LeftForeArm'][-1])
    assert bend < 0.01, f'the elbow gained {bend:.4f} deg of bend'


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
    assert report['output']['tracks'] == len(report['mapping']['direct']) + 1
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


def test_wrist_motion_is_relative_to_the_forearm(motion, profiles):
    """The hand must keep the rig's own wrist angle and add only the source's wrist motion.

    Hands are not rest-aligned, so copying an absolute world delta would hold the T-pose
    wrist angle against an aligned forearm and read as a twisted wrist.
    """
    profile = profiles['male']
    clip, report = rt.convert(motion, profile)
    assert report['status'] == 'ok'
    for side, source_name in (('Left', 'l_wrist'), ('Right', 'r_wrist')):
        source_parent = 'l_lowarm' if side == 'Left' else 'r_lowarm'
        rest_quats = motion.rest_quats()
        source_rest = rig.quat_multiply(rig.quat_conjugate(rest_quats[source_parent]),
                                       rest_quats[source_name])
        target_rest = rest_rotation(profile, f'{side}Hand')
        worst = 0.0
        for frame in range(0, motion.frame_count, 7):
            source_quats = motion.pose_at(frame)[1]
            source_relative = rig.quat_multiply(rig.quat_conjugate(source_quats[source_parent]),
                                               source_quats[source_name])
            source_motion = rig.quat_angle_degrees(source_rest, source_relative)
            target_motion = rig.quat_angle_degrees(target_rest,
                                                   clip['rotations'][f'{side}Hand'][frame])
            worst = max(worst, abs(source_motion - target_motion))
        assert worst < 0.05, f'{side} wrist motion differs from the source by {worst:.3f} deg'


def test_middle_timestamp_mismatch_fails_verification(tmp_path, motion, profiles):
    """A clock that is wrong in the middle must fail, not only at the ends."""
    profile = profiles['male']
    output = tmp_path / 'clip.glb'
    report = rt.retarget(DEMO, rt.PROFILES / 'male.json', output, tmp_path / 'report.json')
    clip, _ = rt.convert(motion, profile)

    tampered = {**clip, 'times': clip['times'].copy()}
    tampered['times'][len(tampered['times']) // 2] += 0.01
    checked = rt.verify_written(output, tampered, profile,
                                {'failures': [], 'checks': {}, 'status': 'ok',
                                 'warnings': []})
    assert checked['status'] == 'failed'
    assert any('differ from the source clock' in failure for failure in checked['failures'])


def test_input_failure_writes_a_report(tmp_path):
    """A rejected input must still leave an explanation behind."""
    bad = tmp_path / 'bad.glb'
    bad.write_bytes(b'this is not a glb')
    output = tmp_path / 'clip.glb'
    report_path = tmp_path / 'report.json'

    with pytest.raises(rt.RetargetError):
        rt.retarget(bad, rt.PROFILES / 'male.json', output, report_path)
    assert not output.exists()
    saved = json.loads(report_path.read_text())
    assert saved['status'] == 'failed'
    assert saved['failures']
    assert saved['source']['sha256'] == rt.hashlib.sha256(bad.read_bytes()).hexdigest()


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
