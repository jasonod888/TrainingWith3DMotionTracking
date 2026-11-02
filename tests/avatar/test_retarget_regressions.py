"""Small, self-contained regressions: no private motion files or model weights."""
import numpy as np
import pytest

import avatar_rig as rig
import retarget_mixamo as rt
from avatar_kinematics import pose, knee_position


@pytest.fixture
def fixture():
    profile = rig.load_profile(rt.PROFILES/'male.json')
    mapping = {**rig.MIXAMO_FROM_MHR, **rig.FINGER_FROM_MHR}
    bones = []
    for target in profile['rig']['bones']:
        name = target['name']
        if name not in mapping:
            continue
        parent = mapping.get(target['parent'])
        t = np.asarray(target['t'])*.01
        q = np.asarray(target['r'])
        if parent is None:
            arm = profile['rig']['armature']
            t = rig.profile_rest_world(profile)[name][:3, 3]
            q = rig.quat_multiply(arm['r'], q)
        if name in ('LeftHand', 'RightHand'):
            helper = name[0].lower()+'_wrist_twist'
            bones.append(dict(name=helper, parent=parent, t=t, q=np.array([0.,0.,0.,1.]), s=np.ones(3)))
            parent, t = helper, np.zeros(3)
        if name in ('LeftFoot', 'RightFoot'):
            for suffix in ('foot', 'talocrural', 'subtalar'):
                helper = name[0].lower()+'_'+suffix
                bones.append(dict(name=helper, parent=parent, t=t, q=np.array([0.,0.,0.,1.]), s=np.ones(3)))
                parent, t = helper, np.zeros(3)
        if name == 'Spine2':
            bones.append(dict(name='c_spine2', parent=parent, t=np.zeros(3), q=np.array([0.,0.,0.,1.]), s=np.ones(3)))
            parent = 'c_spine2'
        bones.append(dict(name=mapping[name], parent=parent, t=t, q=q, s=np.ones(3)))
    tracks = {b['name']: {'rotation': np.repeat(b['q'][None,:], 3, axis=0)} for b in bones}
    return rt.Motion(np.array([0., .1, .2]), bones, tracks, np.eye(4)), profile


def test_wrist_twist_reaches_hand_and_children(fixture):
    motion, profile = fixture
    original, _ = rt.convert(motion, profile)
    motion.tracks['l_wrist_twist']['rotation'][1] = rig.quat_from_axis_angle([0,0,1],60)
    changed, report = rt.convert(motion, profile)
    assert report['status'] == 'ok', report['failures']
    assert rig.quat_angle_degrees(original['rotations']['LeftHand'][1], changed['rotations']['LeftHand'][1]) == pytest.approx(60)
    _, old_world = pose(profile, original['rotations'], original['translations'], 1)
    _, new_world = pose(profile, changed['rotations'], changed['translations'], 1)
    assert rig.quat_angle_degrees(old_world['LeftHandIndex1'], new_world['LeftHandIndex1']) == pytest.approx(60)


def test_diagonal_root_travel_is_not_rejected(fixture):
    motion, profile = fixture
    root = next(b for b in motion.bones if b['name']=='root')
    motion.tracks['root']['translation'] = np.repeat(root['t'][None,:],3,axis=0)
    motion.tracks['root']['translation'][1] += [.2, 0., .2]
    _, report = rt.convert(motion,profile)
    assert report['status']=='ok', report['failures']
    assert report['root_motion']['travel_m']==pytest.approx(np.sqrt(.08),abs=1e-4)


def test_finger_motion_changes_only_its_chain(fixture):
    motion, profile = fixture
    original,_ = rt.convert(motion,profile)
    bone = next(b for b in motion.bones if b['name']=='l_index2')
    motion.tracks['l_index2']['rotation'][1] = rig.quat_multiply(bone['q'],rig.quat_from_axis_angle([1,0,0],45))
    changed,report = rt.convert(motion,profile)
    assert report['status']=='ok',report['failures']
    assert rig.quat_angle_degrees(original['rotations']['LeftHandIndex2'][1],changed['rotations']['LeftHandIndex2'][1])==pytest.approx(45)
    assert np.array_equal(original['rotations']['LeftHandMiddle2'],changed['rotations']['LeftHandMiddle2'])


def test_two_bone_solver_preserves_lengths_and_reaches_goal():
    hip,knee,ankle = np.array([0.,1.,0.]),np.array([0.,.6,.3]),np.array([0.,.2,0.])
    goal = np.array([.2,.15,.1])
    solved,reached,limited = knee_position(hip,knee,ankle,goal)
    assert not limited
    np.testing.assert_allclose(reached,goal)
    assert np.linalg.norm(solved-hip)==pytest.approx(np.linalg.norm(knee-hip))
    assert np.linalg.norm(reached-solved)==pytest.approx(np.linalg.norm(ankle-knee))


def test_first_frame_rotation_jump_is_reported(fixture):
    motion,profile=fixture
    bone=next(b for b in motion.bones if b['name']=='l_uparm')
    motion.tracks['l_uparm']['rotation'][1:]=rig.quat_multiply(bone['q'],rig.quat_from_axis_angle([0,1,0],80))
    _,report=rt.convert(motion,profile)
    assert report['checks']['max_step_rotation_source_degrees']==pytest.approx(80)
    assert any('one frame' in w for w in report['warnings'])


def test_subject_lengths_do_not_turn_neutral_pose_into_crouch(fixture):
    motion,profile=fixture
    for bone in motion.bones:
        if bone['name'] in ('l_lowleg','r_lowleg','l_foot','r_foot'):
            motion.tracks[bone['name']]['translation']=np.repeat((.8*bone['t'])[None,:],3,axis=0)
    original,_=rt.convert(motion,profile,foot_placement=False)
    corrected,report=rt.convert(motion,profile)
    assert report['status']=='ok',report['failures']
    for name in ('LeftUpLeg','RightUpLeg','LeftLeg','RightLeg'):
        assert rig.quat_angle_degrees(original['rotations'][name][0],corrected['rotations'][name][0])<.1
