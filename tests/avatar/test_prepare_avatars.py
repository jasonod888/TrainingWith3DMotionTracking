"""Guards for the prepared instructor avatars and their rig profiles.

The interesting assertions here are the ones that would let a repacked asset drift
from the model it claims to describe: skinning equivalence with the source, profile
agreement with the bytes on disk, and loader-safe bone names.
"""

import hashlib
import json
import math
import re

import numpy as np
import pytest

import avatar_rig as rig
import prepare_avatars as prep

AVATARS = ['male', 'female']
LOADER_SAFE = re.compile(r'^[A-Za-z0-9_]+$')


def manifest():
    return json.loads(prep.MANIFEST.read_text())


def prepared_path(avatar_id):
    return prep.PUBLIC / manifest()['avatars'][avatar_id]['file']


def load_profile(avatar_id):
    return json.loads((prep.PROFILES / f'{avatar_id}.json').read_text())


def source_path(avatar_id):
    return prep.SOURCE / prep.AVATARS[avatar_id]['source']


@pytest.fixture(scope='module')
def prepared():
    assert prepared_path('male').exists(), 'run python scripts/prepare_avatars.py --debug first'
    return {avatar_id: rig.load(prepared_path(avatar_id)) for avatar_id in AVATARS}


@pytest.fixture(scope='module')
def sources():
    return {avatar_id: rig.load(source_path(avatar_id)) for avatar_id in AVATARS}


def test_no_animation_clips_anywhere(prepared, sources):
    for avatar_id in AVATARS:
        assert not sources[avatar_id].animations, f'{avatar_id} source should carry no clips'
        assert not prepared[avatar_id].animations, f'{avatar_id} prepared asset must carry no clips'


def test_prepared_is_static_two_part_mesh(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        assert len(gltf.skins) == 1
        assert [mesh.name for mesh in gltf.meshes] == ['Body', 'Joints']
        for mesh in gltf.meshes:
            assert gltf.nodes[0].children, 'meshes must hang off the armature'
        assert len(gltf.skins[0].joints) == 65
        assert not (gltf.images or []), 'the asset must not depend on external images'
        assert not (gltf.textures or [])
        assert not (gltf.extensionsUsed or []), 'Verge3D extensions must be gone'
        assert not (gltf.cameras or []), 'the orphan environment camera must be gone'


def test_both_meshes_share_one_skeleton(prepared):
    """The joints mesh fills gaps the segmented surface opens, so both must deform
    from the same skin and neither may be dropped."""
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        skinned = {}
        for node in gltf.nodes:
            if node.mesh is not None:
                skinned[gltf.meshes[node.mesh].name] = node.skin
        assert set(skinned) == {'Body', 'Joints'}
        assert len(set(skinned.values())) == 1
        assert set(skinned.values()) == {0}


def test_materials_are_standard_pbr(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        assert [material.name for material in gltf.materials] == [
            'Instructor_Surface', 'Instructor_Joints']
        for material in gltf.materials:
            pbr = material.pbrMetallicRoughness
            assert pbr is not None, f'{material.name} has no metallic/roughness block'
            assert pbr.baseColorFactor is not None
            assert 0.0 <= pbr.roughnessFactor <= 1.0
            assert not (material.extensions or {})
        # Surface and joints must stay visually distinct.
        surface, joints = (material.pbrMetallicRoughness for material in gltf.materials)
        assert surface.baseColorFactor[:3] != joints.baseColorFactor[:3]


def test_skinning_matches_the_source(prepared, sources):
    """Repacking must not move a single vertex of either mesh in the bind pose."""
    for avatar_id in AVATARS:
        source = sources[avatar_id]
        out = prepared[avatar_id]
        source_rig = rig.load_skin(source)
        out_rig = rig.load_skin(out)
        for source_name, out_name in ((prep.AVATARS[avatar_id]['surface'], 'Body'),
                                      (prep.AVATARS[avatar_id]['joints'], 'Joints')):
            expected = rig.skinned_positions(
                source, source_rig, prep.mesh_node_index(source, source_name))
            actual = rig.skinned_positions(out, out_rig, prep.mesh_node_index(out, out_name))
            assert actual.shape == expected.shape, f'{out_name} vertex count changed'
            drift = float(np.abs(actual - expected).max())
            assert drift < 1e-4, f'{avatar_id} {out_name} vertices moved by {drift * 1000:.3f} mm'


def test_inverse_bind_matrices_are_preserved_verbatim(prepared, sources):
    """The bind matrices are indexed by joint order, so pruning the armature joint
    must not change a single value for the remaining bones."""
    for avatar_id in AVATARS:
        source = sources[avatar_id]
        source_rig = rig.load_skin(source)
        expected = np.stack([source_rig['ibm'][bone['name']].T.reshape(-1)
                             for bone in source_rig['bones']])
        out = prepared[avatar_id]
        actual = rig.read_accessor(out, out.skins[0].inverseBindMatrices)
        assert actual.shape == expected.shape
        assert np.allclose(actual, expected, atol=1e-7)


def test_skin_weights_are_usable(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        primitive = gltf.meshes[0].primitives[0]
        joints = rig.read_accessor(gltf, primitive.attributes.JOINTS_0)
        weights = rig.read_accessor(gltf, primitive.attributes.WEIGHTS_0).astype(np.float64)
        assert int(joints.max()) < len(gltf.skins[0].joints)
        error = float(np.abs(weights.sum(axis=1) - 1.0).max())
        assert error < 1e-5, f'{avatar_id} weight sum error {error}'


def test_geometry_is_finite_and_indexed(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        primitive = gltf.meshes[0].primitives[0]
        position = rig.read_accessor(gltf, primitive.attributes.POSITION)
        normal = rig.read_accessor(gltf, primitive.attributes.NORMAL)
        indices = rig.read_accessor(gltf, primitive.indices)
        assert np.isfinite(position).all() and np.isfinite(normal).all()
        assert int(indices.max()) < position.shape[0]
        assert indices.shape[0] % 3 == 0


def test_bone_names_are_loader_safe(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        names = [rig.normalise_name(gltf.nodes[node].name) for node in gltf.skins[0].joints]
        assert len(set(names)) == len(names), 'duplicate node names break track binding'
        for name in names:
            assert LOADER_SAFE.match(name), f'{name} would be rewritten by the loader'
            assert ':' not in name and '.' not in name


def test_hierarchy_is_parent_before_child(prepared):
    for avatar_id in AVATARS:
        gltf = prepared[avatar_id]
        positions = {node: index for index, node in enumerate(gltf.skins[0].joints)}
        for node in gltf.skins[0].joints:
            for child in gltf.nodes[node].children or []:
                if child in positions:
                    assert positions[child] > positions[node], 'a child precedes its parent'


def test_profile_describes_the_shipped_bytes(prepared):
    for avatar_id in AVATARS:
        profile = load_profile(avatar_id)
        path = prepared_path(avatar_id)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert profile['asset']['sha256'] == digest
        assert profile['asset']['bytes'] == path.stat().st_size
        assert profile['asset']['file'] == path.name

        gltf = prepared[avatar_id]
        rig_desc = rig.load_skin(gltf)
        bones = {bone['name']: bone for bone in rig_desc['bones']}
        assert profile['rig']['joint_count'] == len(bones)
        assert {row['name'] for row in profile['rig']['bones']} == set(bones)
        for row in profile['rig']['bones']:
            bone = bones[row['name']]
            assert row['parent'] == bone['parent']
            assert np.allclose(row['r'], bone['q'], atol=1e-6)
            assert np.allclose(row['t'], bone['t'], atol=1e-6)
            assert np.allclose(row['ibm'], rig_desc['ibm'][row['name']].reshape(-1), atol=1e-6)


def test_profile_landmarks_and_measurements(prepared):
    for avatar_id in AVATARS:
        profile = load_profile(avatar_id)
        gltf = prepared[avatar_id]
        rig_desc = rig.load_skin(gltf)
        bones = {bone['name']: bone for bone in rig_desc['bones']}
        for key, landmark in profile['landmarks'].items():
            assert landmark['bone'] in bones, f'{key} points at a missing bone'
            world = (bones[landmark['bone']]['world'] @ np.array([0, 0, 0, 1.0]))[:3]
            assert np.allclose(landmark['rest'], world, atol=1e-5)

        mesh = prep.mesh_node_index(gltf, 'Body')
        world = rig.mesh_world(gltf, rig_desc, mesh)
        primitive = gltf.meshes[0].primitives[0]
        position = rig.read_accessor(gltf, primitive.attributes.POSITION).astype(np.float64)
        points = position @ world[:3, :3].T + world[:3, 3]
        height = float(points[:, 1].max() - points[:, 1].min())
        floor = float(points[:, 1].min())
        assert math.isclose(profile['measurements']['standing_height'], height, abs_tol=1e-4)
        assert math.isclose(profile['measurements']['floor_y'], floor, abs_tol=1e-4)
        assert abs(profile['measurements']['standing_height'] - 1.8) < 0.05

        forward = np.array(profile['orientation']['forward'])
        assert abs(forward[1]) < 1e-9, 'forward must be horizontal'
        assert forward[2] > 0.99, 'the prepared avatars must face +Z like the current camera expects'


def test_source_skin_lists_the_armature_as_an_unused_joint(sources):
    """Documents the 66th joint: it is the armature node, not a bone."""
    for avatar_id in AVATARS:
        gltf = sources[avatar_id]
        names = [rig.normalise_name(gltf.nodes[node].name) for node in gltf.skins[0].joints]
        assert names[-1] == 'Armature'
        assert len(names) == 66
        assert len([name for name in names if name != 'Armature']) == 65
        mesh = prep.mesh_node_index(gltf, prep.AVATARS[avatar_id]['surface'])
        primitive = gltf.meshes[gltf.nodes[mesh].mesh].primitives[0]
        joints = rig.read_accessor(gltf, primitive.attributes.JOINTS_0)
        weights = rig.read_accessor(gltf, primitive.attributes.WEIGHTS_0)
        armature_slot = 65
        referenced = ((joints == armature_slot) & (weights > 0)).any()
        assert not referenced, 'no vertex may weight to the armature node'


def test_preparation_is_deterministic():
    source = sources = rig.load(source_path('male'))
    rig_desc = rig.load_skin(source)
    document, _, geometry = prep.build(source, prep.AVATARS['male'], False)
    first = bytes(document['blob'])
    assert document['accessors'] and len(first) > 0
    # Rebuilding from the same source must produce byte-identical vertex data.
    document_again, _, _ = prep.build(sources, prep.AVATARS['male'], False)
    assert bytes(document_again['blob']) == first
