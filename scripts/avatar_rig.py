"""glTF rig maths shared by avatar preparation and retargeting.

Conventions, kept explicit because mixing them silently re-proportions a skeleton:

* Matrices computed here are row-major 4x4 with translation in the last column.
* glTF stores matrices column-major, so an inverse bind matrix read from a buffer is
  transposed once on the way in. `load_skin` does that and reports row-major matrices.
* Quaternions are glTF order (x, y, z, w) and are normalised before use.
"""

import math

import numpy as np
from pygltflib import GLTF2

COMPONENTS = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
SIZES = {'i1': 1, 'u1': 1, 'i2': 2, 'u2': 2, 'u4': 4, 'f4': 4}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
BONE_PREFIX = 'Armature_mixamorig:'


def read_accessor(gltf, index):
    """Read an accessor as a (count, width) array, honouring interleaved strides."""
    accessor = gltf.accessors[index]
    if accessor.sparse is not None:
        raise ValueError('Sparse accessors are not supported.')
    dtype = COMPONENTS[accessor.componentType]
    width = WIDTHS[accessor.type]
    view = gltf.bufferViews[accessor.bufferView]
    blob = gltf.binary_blob()
    base = (view.byteOffset or 0) + (accessor.byteOffset or 0)
    count = accessor.count
    stride = view.byteStride
    row = width * SIZES[dtype]
    if stride and stride != row:
        raw = np.frombuffer(blob, dtype=np.uint8, count=stride * count, offset=base)
        return np.frombuffer(raw.reshape(count, stride)[:, :row].tobytes(),
                             dtype=f'<{dtype}').reshape(count, width)
    return np.frombuffer(blob, dtype=f'<{dtype}', count=count * width, offset=base).reshape(count, width)


def node_trs(node):
    t = np.array(node.translation if node.translation is not None else [0.0] * 3, dtype=np.float64)
    q = np.array(node.rotation if node.rotation is not None else [0.0, 0.0, 0.0, 1.0], dtype=np.float64)
    s = np.array(node.scale if node.scale is not None else [1.0] * 3, dtype=np.float64)
    return t, q, s


def matrix_from_trs(t, q, s):
    x, y, z, w = q
    n = math.sqrt(float(x * x + y * y + z * z + w * w)) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    m = np.eye(4)
    m[0, 0] = (1 - 2 * (y * y + z * z)) * s[0]
    m[0, 1] = 2 * (x * y - z * w) * s[0]
    m[0, 2] = 2 * (x * z + y * w) * s[0]
    m[1, 0] = 2 * (x * y + z * w) * s[1]
    m[1, 1] = (1 - 2 * (x * x + z * z)) * s[1]
    m[1, 2] = 2 * (y * z - x * w) * s[1]
    m[2, 0] = 2 * (x * z - y * w) * s[2]
    m[2, 1] = 2 * (y * z + x * w) * s[2]
    m[2, 2] = (1 - 2 * (x * x + y * y)) * s[2]
    m[0, 3], m[1, 3], m[2, 3] = t
    return m


def quat_from_matrix(m):
    """Rotation part of a row-major matrix as an (x, y, z, w) quaternion."""
    r = np.asarray(m, dtype=np.float64)[:3, :3]
    scale = np.cbrt(np.linalg.det(r)) or 1.0
    r = r / scale
    trace = r[0, 0] + r[1, 1] + r[2, 2]
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = math.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        q = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
    elif r[1, 1] > r[2, 2]:
        s = math.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        q = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    q = np.array(q, dtype=np.float64)
    return q / np.linalg.norm(q)


def quat_multiply(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], dtype=np.float64)


def quat_conjugate(q):
    return np.array([-q[0], -q[1], -q[2], q[3]], dtype=np.float64)


def quat_dot(a, b):
    """Absolute dot product of two orientations, tolerant of unnormalised inputs.

    Profile values are rounded to six decimals, so normalising here keeps a rounded
    quaternion from reading as a rotation error of ~0.1 degrees.
    """
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    scale = float(np.linalg.norm(a) * np.linalg.norm(b))
    if scale < 1e-12:
        return 1.0
    return float(abs(np.dot(a, b))) / scale


def quat_angle_degrees(a, b):
    """Smallest rotation between two orientations, in degrees."""
    d = min(1.0, quat_dot(np.asarray(a, float), np.asarray(b, float)))
    return math.degrees(2 * math.acos(d))


def quat_from_axis_angle(axis, degrees):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / (np.linalg.norm(axis) or 1.0)
    half = math.radians(degrees) / 2.0
    s = math.sin(half)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, math.cos(half)], dtype=np.float64)


def matrix_from_quat(q, position=None, scale=None):
    """Row-major matrix from a quaternion, with optional translation and scale."""
    t = np.zeros(3) if position is None else np.asarray(position, dtype=np.float64)
    s = np.ones(3) if scale is None else np.asarray(scale, dtype=np.float64)
    m = matrix_from_trs(t, q, s)
    return m


def rotation_from_matrix(m):
    """Rotation part of a row-major matrix, as a 3x3 array."""
    return np.asarray(m, dtype=np.float64)[:3, :3]


def quat_between_matrices(a, b):
    """Rotation taking matrix a to matrix b: b * a^-1."""
    return quat_from_matrix(rotation_from_matrix(b) @ np.linalg.inv(rotation_from_matrix(a)))


def normalise_name(name):
    return name[len(BONE_PREFIX):] if name.startswith(BONE_PREFIX) else name


# --- retargeting specification -------------------------------------------------

# Target Mixamo bone -> the MHR bone whose world orientation it follows. Where MHR
# inserts extra joints, the mapping points at the deepest bone, so the target receives
# the whole compound rotation. `COMPOUND_CHAINS` documents what each of those absorbs
# and is checked against the source rig at conversion time.
MIXAMO_FROM_MHR = {
    'Hips': 'root',
    'Spine': 'c_spine0',
    'Spine1': 'c_spine1',
    'Spine2': 'c_spine3',
    'Neck': 'c_neck',
    'Head': 'c_head',
    'LeftShoulder': 'l_clavicle', 'RightShoulder': 'r_clavicle',
    'LeftArm': 'l_uparm', 'RightArm': 'r_uparm',
    'LeftForeArm': 'l_lowarm', 'RightForeArm': 'r_lowarm',
    'LeftHand': 'l_wrist', 'RightHand': 'r_wrist',
    'LeftUpLeg': 'l_upleg', 'RightUpLeg': 'r_upleg',
    'LeftLeg': 'l_lowleg', 'RightLeg': 'r_lowleg',
    'LeftFoot': 'l_transversetarsal', 'RightFoot': 'r_transversetarsal',
    'LeftToeBase': 'l_ball', 'RightToeBase': 'r_ball',
}

# MHR joints that carry the same segment as a mapped target bone. They are collapsed
# into the target because Mixamo has no equivalent articulation between them.
COMPOUND_CHAINS = {
    'Spine2': ['c_spine2', 'c_spine3'],
    'LeftHand': ['l_wrist_twist', 'l_wrist'],
    'RightHand': ['r_wrist_twist', 'r_wrist'],
    'LeftFoot': ['l_foot', 'l_talocrural', 'l_subtalar', 'l_transversetarsal'],
    'RightFoot': ['r_foot', 'r_talocrural', 'r_subtalar', 'r_transversetarsal'],
}

# Source joints that exist only to build the MHR deformation rig.
HELPER_SUFFIXES = ('_twist', '_proc', '_null', '_twist1', '_twist2', '_twist3',
                   '_twist4', '_twist0')

# Fingers are deliberately not retargeted yet: Mixamo chains are 4 joints against MHR's
# 3-plus-metacarpal layout, and the hand shapes are not validated. They hold a reviewed
# preset instead, so the hands never fall back to the flat, splayed bind pose.
# Every Mixamo bone points along local -Z, so curl is rotation about local X.
FINGER_CHAINS = {
    'Thumb': (('LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3', 'LeftHandThumb4'),
              (8, 12, 10, 6)),
    'Index': (('LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandIndex4'),
              (12, 18, 14, 8)),
    'Middle': (('LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3', 'LeftHandMiddle4'),
               (12, 20, 16, 8)),
    'Ring': (('LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3', 'LeftHandRing4'),
             (13, 20, 16, 8)),
    'Pinky': (('LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3', 'LeftHandPinky4'),
              (14, 22, 16, 8)),
}

FINGER_PRESETS = {
    # Relaxed instructor hand: a gentle curl, not a fist.
    'relaxed': {'axis': (1.0, 0.0, 0.0), 'sign': 1.0, 'scale': 1.0},
    # Explicit bind pose, for diagnostics only.
    'none': None,
}


def finger_preset_rotations(preset_name):
    """Local rotations for every finger bone in a named preset.

    Returns {bone_name: quaternion} for both hands. The right hand mirrors the left by
    negating the curl, because its local axes are mirrored.
    """
    preset = FINGER_PRESETS[preset_name]
    if preset is None:
        return {}
    axis, sign, scale = preset['axis'], preset['sign'], preset['scale']
    rotations = {}
    for chain, angles in FINGER_CHAINS.values():
        for side, mirror in (('Left', 1.0), ('Right', -1.0)):
            for bone, angle in zip(chain, angles):
                name = bone.replace('Left', side)
                rotations[name] = quat_from_axis_angle(axis, angle * scale * sign * mirror)
    return rotations


def load_profile(path):
    import json
    from pathlib import Path
    return json.loads(Path(path).read_text())


def validate_profile(profile):
    """Check a profile can be composed: unique names, known parents, parents first."""
    problems = []
    bones = profile.get('rig', {}).get('bones') or []
    if not bones:
        problems.append('profile has no bones')
    names = [bone.get('name') for bone in bones]
    if len(set(names)) != len(names):
        problems.append('bone names are not unique')
    seen = set()
    for bone in bones:
        parent = bone.get('parent')
        if parent is not None and parent not in seen:
            problems.append(f'{bone.get("name")} has an unknown or later parent {parent}')
        seen.add(bone.get('name'))
    if profile.get('avatar_id') not in ('male', 'female'):
        problems.append(f'unsupported avatar id {profile.get("avatar_id")!r}')
    if problems:
        raise ValueError('; '.join(problems))
    return profile


def profile_rest_world(profile):
    """Rest world matrices for every bone in a profile, in hierarchy order."""
    armature = profile['rig'].get('armature', {'t': [0, 0, 0], 'r': [0, 0, 0, 1], 's': [1, 1, 1]})
    armature_world = matrix_from_trs(np.array(armature['t'], float),
                                     np.array(armature['r'], float),
                                     np.array(armature['s'], float))
    worlds = {}
    for bone in profile['rig']['bones']:
        local = matrix_from_trs(np.array(bone['t'], float),
                                np.array(bone['r'], float),
                                np.array(bone['s'], float))
        parent = bone['parent']
        worlds[bone['name']] = (worlds[parent] if parent else armature_world) @ local
    return worlds


def find_armature(gltf):
    for index, node in enumerate(gltf.nodes):
        for child in node.children or []:
            if gltf.nodes[child].name == BONE_PREFIX + 'Hips' or gltf.nodes[child].name == 'Hips':
                return index
    raise ValueError('Could not find the armature node above the hips.')


def load_skin(gltf, armature_index=None):
    """Load the first skin as ordered bones with local and world rest transforms.

    Returns a dict with:
      bones     list of {name, parent, source, t, q, s, world}
      ibm       dict name -> row-major 4x4 inverse bind matrix
      joints    names in skin order
      armature  row-major armature world matrix
    """
    armature_index = find_armature(gltf) if armature_index is None else armature_index
    armature = gltf.nodes[armature_index]
    at, aq, as_ = node_trs(armature)
    armature_world = matrix_from_trs(at, aq, as_)
    hips = next(c for c in armature.children or []
                if normalise_name(gltf.nodes[c].name) == 'Hips')

    bones = []

    def visit(source_index, parent):
        node = gltf.nodes[source_index]
        t, q, s = node_trs(node)
        local = matrix_from_trs(t, q, s)
        world = (bones[parent]['world'] if parent is not None else armature_world) @ local
        bones.append({'source': source_index, 'name': normalise_name(node.name),
                      'parent': bones[parent]['name'] if parent is not None else None,
                      't': t, 'q': q, 's': s, 'world': world})
        position = len(bones) - 1
        for child in node.children or []:
            if gltf.nodes[child].mesh is None:
                visit(child, position)

    visit(hips, None)

    skin = gltf.skins[0]
    joint_rows = {node: row for row, node in enumerate(skin.joints)}
    flat = read_accessor(gltf, skin.inverseBindMatrices).astype(np.float64)
    matrices = flat.reshape(-1, 4, 4).transpose(0, 2, 1)
    ibm = {bone['name']: matrices[joint_rows[bone['source']]] for bone in bones
           if bone['source'] in joint_rows}
    return {
        'bones': bones,
        'ibm': ibm,
        'joints': [normalise_name(gltf.nodes[node].name) for node in skin.joints],
        'armature': armature_world,
        'armature_index': armature_index,
    }


def mesh_world(gltf, rig, mesh_node):
    node = gltf.nodes[mesh_node]
    t, q, s = node_trs(node)
    return rig['armature'] @ matrix_from_trs(t, q, s)


def skinned_positions(gltf, rig, mesh_node, blend=None):
    """Vertex positions in world space for the current node transforms.

    At the bind pose this collapses to the mesh transform, which is what makes it a
    useful independent check of a repacked asset.
    """
    primitive = gltf.meshes[gltf.nodes[mesh_node].mesh].primitives[0]
    position = read_accessor(gltf, primitive.attributes.POSITION).astype(np.float64)
    joints = read_accessor(gltf, primitive.attributes.JOINTS_0).astype(np.int64)
    weights = read_accessor(gltf, primitive.attributes.WEIGHTS_0).astype(np.float64)
    worlds = [bone['world'] for bone in rig['bones']]
    if blend is not None:
        worlds = blend(worlds)
    ibms = [rig['ibm'][bone['name']] for bone in rig['bones']]

    out = np.zeros_like(position)
    for slot in range(joints.shape[1]):
        indices = joints[:, slot]
        slot_weights = weights[:, slot]
        for bone_index in np.unique(indices):
            mask = indices == bone_index
            if not mask.any():
                continue
            matrix = worlds[bone_index] @ ibms[bone_index]
            points = position[mask] @ matrix[:3, :3].T + matrix[:3, 3]
            out[mask] += slot_weights[mask, None] * points
    return out


def load(path):
    return GLTF2().load(str(path))
