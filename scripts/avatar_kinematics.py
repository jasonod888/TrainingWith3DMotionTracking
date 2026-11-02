"""Target-proportion FK and two-bone leg placement; no inferred world floor."""
import numpy as np

import avatar_rig as rig


def pose(profile, rotations, translations, frame):
    arm = profile['rig']['armature']
    armature = rig.matrix_from_trs(arm['t'], arm['r'], arm['s'])
    worlds, quats = {}, {}
    for bone in profile['rig']['bones']:
        name, parent = bone['name'], bone['parent']
        local = rig.matrix_from_trs(
            translations[name][frame] if name in translations else bone['t'],
            rotations[name][frame] if name in rotations else bone['r'], bone['s'])
        worlds[name] = (worlds[parent] if parent else armature) @ local
        quats[name] = rig.quat_from_matrix(worlds[name])
    return worlds, quats


def knee_position(hip, knee, ankle, goal):
    """Solve a leg without stretching, preserving its current bend plane."""
    upper, lower = np.linalg.norm(knee-hip), np.linalg.norm(ankle-knee)
    direction = goal-hip
    distance = float(np.linalg.norm(direction))
    if distance < 1e-9 or min(upper, lower) < 1e-9:
        return knee, ankle, True
    direction /= distance
    reachable = float(np.clip(distance, abs(upper-lower)+1e-8, upper+lower-1e-8))
    along = (upper*upper-lower*lower+reachable*reachable)/(2*reachable)
    height = np.sqrt(max(upper*upper-along*along, 0.0))
    pole = knee-hip-direction*np.dot(knee-hip, direction)
    if np.linalg.norm(pole) < 1e-8:
        pole = np.cross(direction, [1., 0., 0.])
        if np.linalg.norm(pole) < 1e-8:
            pole = np.cross(direction, [0., 0., 1.])
    pole /= np.linalg.norm(pole)
    return hip+along*direction+height*pole, hip+reachable*direction, distance > upper+lower+1e-7 or distance < abs(upper-lower)-1e-7


def place_feet(motion, profile, clip, baseline, translation_scale, shortest_arc):
    """Preserve source ankle displacements with target leg lengths and foot rotations.

    Each foot starts at the target's neutral ankle, then follows the source ankle's
    displacement in metres. This preserves a stationary source foot without inventing
    contact labels or treating camera-relative motion as a calibrated floor.
    """
    source_rest = motion.subject_rest_worlds()
    parents = {b['name']: b['parent'] for b in profile['rig']['bones']}
    before, after, unreachable = [], [], 0
    for frame in range(motion.frame_count):
        source = motion.worlds_at(frame)
        for side, prefix in (('Left', 'l'), ('Right', 'r')):
            upper, lower, foot = side+'UpLeg', side+'Leg', side+'Foot'
            worlds, quats = pose(profile, clip['rotations'], clip['translations'], frame)
            hip, knee, ankle = (worlds[name][:3, 3] for name in (upper, lower, foot))
            # l_foot is the ankle pivot. l_transversetarsal supplies the orientation,
            # but its position is inside the foot rather than at the ankle joint.
            source_ankle = prefix+'_foot'
            goal = baseline[foot][:3, 3] + translation_scale*(
                source[source_ankle][:3, 3]-source_rest[source_ankle][:3, 3])
            before.append(float(np.linalg.norm(ankle-goal)))
            new_knee, reached, limited = knee_position(hip, knee, ankle, goal)
            unreachable += int(limited)
            upper_q = rig.quat_multiply(shortest_arc(knee-hip, new_knee-hip), quats[upper])
            lower_q = rig.quat_multiply(shortest_arc(ankle-knee, reached-new_knee), quats[lower])
            for name, parent_q, world_q in (
                (upper, quats[parents[upper]], upper_q),
                (lower, upper_q, lower_q),
                (foot, lower_q, quats[foot]),
            ):
                local = rig.quat_multiply(rig.quat_conjugate(parent_q), world_q)
                clip['rotations'][name][frame] = local/np.linalg.norm(local)
            result, _ = pose(profile, clip['rotations'], clip['translations'], frame)
            after.append(float(np.linalg.norm(result[foot][:3, 3]-goal)))
    return {
        'mode': 'source ankle displacement with fixed target leg lengths',
        'max_ankle_error_before_m': round(max(before, default=0.), 6),
        'max_ankle_error_after_m': round(max(after, default=0.), 6),
        'mean_ankle_error_after_m': round(float(np.mean(after)) if after else 0., 6),
        'unreachable_leg_frames': unreachable,
        'floor': 'source camera-relative motion; no world-floor or contact inference',
    }
