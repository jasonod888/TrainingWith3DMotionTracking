"""Prepare the Mixamo instructor avatars for the browser.

Takes the reviewed source GLBs, drops the Verge3D-only material graphs and the
hidden joints mesh, converts materials to standard glTF metallic/roughness, and
rewrites bone names to stable loader-safe names. Emits:

  apps/web/public/avatars/<id>-<content>.glb        prepared avatar
  packages/avatar-rigs/profiles/<id>.json           rig profile
  assets/avatars/manifest.json                      hashes and sizes

Both supplied meshes are kept. The surface is authored as separate limb segments, and
the joints mesh is what fills the gaps those segments open when a limb bends, so
removing it exposes dark holes at every elbow, knee and the waist.

The profile is derived from the bytes that ship, so it can never describe a
different model. Only POSITION, NORMAL, JOINTS_0 and WEIGHTS_0 survive: the source
has no images and no textures, so UVs and the Verge3D node graphs are dead weight.
Inverse bind matrices are copied byte-for-byte, in glTF's column-major order.

    python scripts/prepare_avatars.py
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pygltflib import (
    FLOAT, TRIANGLES, UNSIGNED_INT, UNSIGNED_SHORT,
    Accessor, Asset, Buffer, BufferView, GLTF2, Material, Mesh, Node,
    PbrMetallicRoughness, Primitive, Scene, Skin,
)

import avatar_rig as rig

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/avatars/source'
PUBLIC = ROOT / 'apps/web/public/avatars'
PROFILES = ROOT / 'packages/avatar-rigs/profiles'
MANIFEST = ROOT / 'assets/avatars/manifest.json'

ASSET_VERSION = '1.0.0'
PREP_VERSION = '1'
PROFILE_SCHEMA = 1

# Instructor look: neutral surface, darker joints. Surface and joints stay separate
# meshes and materials so the supplied characters keep their intended two-tone read.
SURFACE = {'name': 'Instructor_Surface', 'base': [0.803, 0.807, 0.816, 1.0], 'metallic': 0.0, 'roughness': 0.62}
JOINTS = {'name': 'Instructor_Joints', 'base': [0.188, 0.204, 0.212, 1.0], 'metallic': 0.35, 'roughness': 0.55}

AVATARS = {
    'male': {'source': 'ybot.glb', 'display_name': 'Instructor A',
             'surface': 'Alpha_Surface', 'joints': 'Alpha_Joints'},
    'female': {'source': 'xbot.glb', 'display_name': 'Instructor B',
               'surface': 'Beta_Surface', 'joints': 'Beta_Joints'},
}

LANDMARKS = {
    'root': 'Hips', 'hips': 'Hips', 'spine': 'Spine', 'chest': 'Spine2',
    'neck': 'Neck', 'head': 'Head', 'head_top': 'HeadTop_End',
    'left_shoulder': 'LeftShoulder', 'right_shoulder': 'RightShoulder',
    'left_elbow': 'LeftForeArm', 'right_elbow': 'RightForeArm',
    'left_wrist': 'LeftHand', 'right_wrist': 'RightHand',
    'left_hip': 'LeftUpLeg', 'right_hip': 'RightUpLeg',
    'left_knee': 'LeftLeg', 'right_knee': 'RightLeg',
    'left_ankle': 'LeftFoot', 'right_ankle': 'RightFoot',
    'left_toe': 'LeftToeBase', 'right_toe': 'RightToeBase',
    'left_toe_end': 'LeftToe_End', 'right_toe_end': 'RightToe_End',
}


class Builder:
    """Packs retained attribute data into one tightly aligned binary blob."""

    DTYPES = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}

    def __init__(self):
        self.blob = bytearray()
        self.views = []
        self.accessors = []

    def accessor(self, array, component_type, gltf_type, target=None):
        array = np.ascontiguousarray(array)
        # Guard the declaration against the payload: writing float64 under a FLOAT
        # declaration silently doubles every buffer view and corrupts every offset.
        expected = self.DTYPES[component_type]
        if array.dtype != expected:
            raise ValueError(f'Accessor declares {expected} but carries {array.dtype}.')
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        payload = array.tobytes()
        self.views.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(payload), target=target))
        self.blob.extend(payload)
        self.accessors.append(Accessor(bufferView=len(self.views) - 1, componentType=component_type,
                                       count=int(array.shape[0]), type=gltf_type))
        return len(self.accessors) - 1


def mesh_node_index(gltf, name):
    for index, node in enumerate(gltf.nodes):
        if node.name == name and node.mesh is not None:
            return index
    raise ValueError(f'Missing mesh node {name}.')


def extract_mesh(gltf, name):
    node = mesh_node_index(gltf, name)
    primitive = gltf.meshes[gltf.nodes[node].mesh].primitives[0]
    geometry = {
        'node': node,
        'position': rig.read_accessor(gltf, primitive.attributes.POSITION).astype(np.float32),
        'normal': rig.read_accessor(gltf, primitive.attributes.NORMAL).astype(np.float32),
        'joints': rig.read_accessor(gltf, primitive.attributes.JOINTS_0).astype(np.uint16),
        'weights': rig.read_accessor(gltf, primitive.attributes.WEIGHTS_0).astype(np.float32),
        'indices': rig.read_accessor(gltf, primitive.indices).astype(np.uint32).reshape(-1),
    }
    return geometry


def validate_geometry(geometry, joint_names, label):
    position, weights, joints = geometry['position'], geometry['weights'], geometry['joints']
    if joints.shape[0] != position.shape[0] or weights.shape[0] != position.shape[0]:
        raise ValueError(f'{label}: skin attributes do not line up with positions.')
    if joints.max() >= len(joint_names):
        raise ValueError(f'{label}: a skin index is outside the joint list.')
    for key in ('position', 'normal', 'weights'):
        if not np.isfinite(geometry[key]).all():
            raise ValueError(f'{label}: non-finite {key}.')
    error = float(np.abs(weights.sum(axis=1) - 1.0).max())
    if error > 1e-4:
        raise ValueError(f'{label}: skin weights do not sum to one (max error {error}).')
    return error


def build(gltf, avatar, include_joints):
    """Return the output document pieces plus the rig description used to write it."""
    source_rig = rig.load_skin(gltf)
    bones = source_rig['bones']
    names = [bone['name'] for bone in bones]
    if len(set(names)) != len(names):
        raise ValueError('Bone names are not unique after normalisation.')
    index_of = {name: index for index, name in enumerate(names)}

    armature = gltf.nodes[source_rig['armature_index']]
    at, aq, as_ = rig.node_trs(armature)
    out_nodes = [Node(name=rig.normalise_name(armature.name),
                      translation=at.tolist(), rotation=aq.tolist(), scale=as_.tolist(), children=[])]
    for position, bone in enumerate(bones):
        out_nodes.append(Node(name=bone['name'], translation=bone['t'].tolist(),
                              rotation=bone['q'].tolist(), scale=bone['s'].tolist(), children=[]))
        parent = index_of[bone['parent']] if bone['parent'] else None
        out_nodes[0 if parent is None else parent + 1].children.append(position + 1)

    builder = Builder()
    # Back to column-major for the file, reproducing the source matrices exactly.
    ibms = np.stack([source_rig['ibm'][name] for name in names]).transpose(0, 2, 1).astype(np.float32)
    if not np.isfinite(ibms).all():
        raise ValueError('Inverse bind matrices are not finite.')
    ibm_accessor = builder.accessor(ibms.reshape(-1, 16), FLOAT, 'MAT4')
    skin = Skin(joints=[bone + 1 for bone in range(len(bones))],
                inverseBindMatrices=ibm_accessor, skeleton=0)

    meshes, materials, geometry = [], [], {}
    specs = [(SURFACE, avatar['surface'], 'Body')]
    if include_joints:
        specs.append((JOINTS, avatar['joints'], 'Joints'))
    for material_spec, mesh_name, out_name in specs:
        extracted = extract_mesh(gltf, mesh_name)
        validate_geometry(extracted, names, mesh_name)
        attributes = {
            'POSITION': builder.accessor(extracted['position'], FLOAT, 'VEC3', 34962),
            'NORMAL': builder.accessor(extracted['normal'], FLOAT, 'VEC3', 34962),
            'JOINTS_0': builder.accessor(extracted['joints'], UNSIGNED_SHORT, 'VEC4', 34962),
            'WEIGHTS_0': builder.accessor(extracted['weights'], FLOAT, 'VEC4', 34962),
        }
        indices = builder.accessor(extracted['indices'], UNSIGNED_INT, 'SCALAR', 34963)
        materials.append(Material(
            name=material_spec['name'],
            pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorFactor=list(material_spec['base']),
                metallicFactor=material_spec['metallic'],
                roughnessFactor=material_spec['roughness']),
            doubleSided=False))
        meshes.append(Mesh(name=out_name, primitives=[Primitive(
            attributes=attributes, indices=indices, material=len(materials) - 1, mode=TRIANGLES)]))
        out_nodes.append(Node(name=out_name, mesh=len(meshes) - 1, skin=0, children=[]))
        out_nodes[0].children.append(len(out_nodes) - 1)
        geometry[out_name] = extracted

    document = {'nodes': out_nodes, 'meshes': meshes, 'skins': [skin], 'materials': materials,
                'accessors': builder.accessors, 'views': builder.views, 'blob': builder.blob}
    return document, source_rig, geometry['Body']


def rounded(values, places=6):
    return [round(float(v), places) for v in np.asarray(values).reshape(-1)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    PUBLIC.mkdir(parents=True, exist_ok=True)
    PROFILES.mkdir(parents=True, exist_ok=True)
    manifest = {'asset_version': ASSET_VERSION, 'prep_version': PREP_VERSION, 'avatars': {}}
    report = []
    produced = set()

    for avatar_id, avatar in AVATARS.items():
        source = SOURCE / avatar['source']
        gltf = GLTF2().load(str(source))
        if gltf.animations:
            raise ValueError(f'{source.name} contains animation clips; the static asset must not.')

        # The joints mesh stays: the surface is authored as separate segments, and the
        # joints mesh is what fills the gaps those segments open when a limb bends.
        document, source_rig, geometry = build(gltf, avatar, include_joints=True)
        out = GLTF2(
            asset=Asset(version='2.0', generator=f'3d_trainer prepare_avatars {PREP_VERSION}'),
            scene=0, scenes=[Scene(nodes=[0])],
            nodes=document['nodes'], meshes=document['meshes'], skins=document['skins'],
            materials=document['materials'], accessors=document['accessors'],
            bufferViews=document['views'],
            buffers=[Buffer(byteLength=len(document['blob']))])
        out.set_binary_blob(bytes(document['blob']))
        temp = PUBLIC / f'.{avatar_id}.tmp.glb'
        out.save_binary(str(temp))
        digest = hashlib.sha256(temp.read_bytes()).hexdigest()
        name = f'{avatar_id}-{digest[:12]}.glb'
        target = PUBLIC / name
        temp.replace(target)
        size = target.stat().st_size
        produced.add(name)
        print(f'{avatar_id:6} {name:32} {size:>9,} bytes  {digest[:16]}')

        profile = build_profile(gltf, source_rig, geometry, avatar_id, avatar, name, digest, size)
        (PROFILES / f'{avatar_id}.json').write_text(json.dumps(profile, indent=1) + '\n')
        report.append({'avatar_id': avatar_id, 'file': name, 'bytes': size,
                       'height': profile['measurements']['standing_height'],
                       'forward': profile['orientation']['forward'],
                       'floor': profile['measurements']['floor_y']})

        manifest['avatars'][avatar_id] = {
            'source': avatar['source'],
            'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'file': name, 'sha256': digest, 'bytes': size,
        }

    for stale in PUBLIC.glob('*.glb'):
        if stale.name not in produced:
            stale.unlink()
            print(f'removed stale {stale.name}')

    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    print()
    for row in report:
        print(f"{row['avatar_id']:6} height {row['height']:.4f} m  floor {row['floor']:+.4f}  "
              f"forward {row['forward']}")
    print(f'manifest -> {MANIFEST.relative_to(ROOT)}')


def build_profile(gltf, source_rig, geometry, avatar_id, avatar, file_name, digest, size):
    bones = source_rig['bones']
    names = [bone['name'] for bone in bones]
    index_of = {name: index for index, name in enumerate(names)}

    world = rig.mesh_world(gltf, source_rig, geometry['node'])
    points = (geometry['position'].astype(np.float64) @ world[:3, :3].T) + world[:3, 3]
    minimum, maximum = points.min(axis=0), points.max(axis=0)

    def joint_world(name):
        return (source_rig['bones'][index_of[name]]['world'] @ np.array([0.0, 0.0, 0.0, 1.0]))[:3]

    landmark_points = {key: joint_world(bone) for key, bone in LANDMARKS.items()}
    toe = (landmark_points['left_toe_end'] - landmark_points['left_toe']
           + landmark_points['right_toe_end'] - landmark_points['right_toe']) / 2.0
    toe[1] = 0.0
    length = float(np.linalg.norm(toe))
    forward = toe / length if length > 1e-6 else np.array([0.0, 0.0, 1.0])
    yaw = math.degrees(math.atan2(forward[0], forward[2]))

    source = SOURCE / avatar['source']
    return {
        'schema': PROFILE_SCHEMA,
        'avatar_id': avatar_id,
        'display_name': avatar['display_name'],
        'asset': {'file': file_name, 'sha256': digest, 'bytes': size,
                  'asset_version': ASSET_VERSION, 'prep_version': PREP_VERSION},
        'source': {'file': avatar['source'],
                   'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
        'units': {'world': 'metres',
                  'note': 'The armature node scales centimetre bone data to metres.'},
        'rig': {
            'family': 'mixamo',
            'joint_count': len(bones),
            'root_bone': 'Hips',
            'matrix_convention': 'ibm is row-major with translation in the last column, '
                                 'converted from the column-major glTF buffer on read',
            'armature': {
                't': rounded(rig.node_trs(gltf.nodes[source_rig['armature_index']])[0]),
                'r': rounded(rig.node_trs(gltf.nodes[source_rig['armature_index']])[1]),
                's': rounded(rig.node_trs(gltf.nodes[source_rig['armature_index']])[2]),
            },
            'bones': [{'name': bone['name'], 'parent': bone['parent'],
                       't': rounded(bone['t']), 'r': rounded(bone['q']), 's': rounded(bone['s']),
                       'ibm': rounded(source_rig['ibm'][bone['name']])}
                      for bone in bones],
        },
        'landmarks': {key: {'bone': LANDMARKS[key], 'rest': rounded(point)}
                      for key, point in landmark_points.items()},
        'measurements': {
            'standing_height': round(float(maximum[1] - minimum[1]), 6),
            'floor_y': round(float(minimum[1]), 6),
            'hip_height': round(float(landmark_points['hips'][1]), 6),
            'head_top_height': round(float(landmark_points['head_top'][1]), 6),
            'bounds': {'min': rounded(minimum), 'max': rounded(maximum)},
        },
        'orientation': {
            'up': [0, 1, 0],
            'forward': rounded(forward),
            'facing_yaw_degrees': round(yaw, 4),
            'note': 'Derived from the averaged toe direction in the authored bind pose.',
        },
        'bind_pose': {'pose': 'T-pose', 'clips': 0},
    }


if __name__ == '__main__':
    main()
