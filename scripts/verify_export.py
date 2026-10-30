"""Exercise the real MHR rig/exporter with synthetic motion, not inferred video."""
import json
from pathlib import Path

import numpy as np
from pygltflib import GLTF2
import pymomentum.geometry as geometry

from export_glb import ROOT, export, smooth_motion

def read_accessor(gltf, index):
    acc = gltf.accessors[index]
    view = gltf.bufferViews[acc.bufferView]
    widths = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    assert acc.componentType == 5126 and view.byteStride in (None, 0)
    offset = (view.byteOffset or 0) + (acc.byteOffset or 0)
    return np.frombuffer(gltf.binary_blob(), dtype='<f4', count=acc.count*widths[acc.type], offset=offset).reshape(acc.count, widths[acc.type])

def main():
    folder = ROOT / 'outputs/export_check_synthetic'
    folder.mkdir(exist_ok=True, parents=True)
    assets = ROOT / 'models/mhr'
    model_path = next(assets.rglob('compact_v6_1.model'))
    char = geometry.Character.load_fbx(str(model_path.parent / 'lod1.fbx'), str(model_path))
    # A turn through the Euler wrap must stay near 180 degrees after smoothing,
    # with nontrivial tilt checking the upstream rotation convention as well.
    import roma
    import torch
    from scipy.spatial.transform import Rotation
    wrapped = np.zeros((5, 204), dtype=np.float32)
    wrapped[:, 3:6] = np.deg2rad([[15, 10, y] for y in [170, 175, 180, -175, -170]])
    smoothed = smooth_motion(wrapped, 0.75)
    actual_rotations = roma.euler_to_rotmat('xyz', torch.from_numpy(smoothed[:, 3:6])).numpy()
    expected_center = Rotation.from_euler('xyz', np.deg2rad([15, 10, 180])).as_matrix()
    np.testing.assert_allclose(actual_rotations[2], expected_center, atol=1e-5)
    params = np.zeros((3, 204), dtype=np.float32)
    params[:, 4] = [0, np.pi/2, np.pi]  # An explicit 180-degree turn.
    times = np.array([0, 0.1, 0.35], dtype=np.float64)
    translation = np.array([[0, 0, 3], [0.1, 0, 3], [0.3, 0, 3]], dtype=np.float32)
    np.savez_compressed(folder / 'motion.npz', mhr_model_params=params, timestamps=times, pred_cam_t=translation)
    export(folder / 'motion.npz', folder / 'synthetic.glb', assets)
    gltf = GLTF2().load(str(folder / 'synthetic.glb'))
    assert gltf.skins and gltf.meshes and gltf.animations
    animated_paths = {c.target.path for a in gltf.animations for c in a.channels}
    assert 'rotation' in animated_paths and 'translation' in animated_paths
    for animation in gltf.animations:
        for sampler in animation.samplers:
            np.testing.assert_allclose(read_accessor(gltf, sampler.input).ravel(), times, atol=1e-6)
    # Check global FK after re-evaluating every exported skeleton node. This
    # catches lost root translation, wrong units, wrong quaternion order, or
    # a broken parent/local transform in the actual GLB.
    values = {}
    for animation in gltf.animations:
        for channel in animation.channels:
            sampler = animation.samplers[channel.sampler]
            values[(channel.target.node, channel.target.path)] = read_accessor(gltf, sampler.output)
    expected = np.asarray(geometry.model_parameters_to_skeleton_state(char, params))[:, :, :3]/100
    expected += (translation-translation[0])[:, None, :] * [1, -1, -1]
    names = list(char.skeleton.joint_names)
    nodes_by_name = {n.name: i for i, n in enumerate(gltf.nodes)}
    for frame in range(3):
        globals_ = {}
        def walk(idx, parent):
            node = gltf.nodes[idx]
            def value(path, fallback):
                return values[(idx, path)][frame] if (idx, path) in values else fallback
            t = value('translation', node.translation or [0, 0, 0])
            q = value('rotation', node.rotation or [0, 0, 0, 1])
            s = value('scale', node.scale or [1, 1, 1])
            local = np.eye(4)
            local[:3, :3] = Rotation.from_quat(q).as_matrix() @ np.diag(s)
            local[:3, 3] = t
            globals_[idx] = parent @ local
            for child in node.children or []:
                walk(child, globals_[idx])
        for idx in gltf.scenes[gltf.scene or 0].nodes:
            walk(idx, np.eye(4))
        for joint, name in enumerate(names):
            np.testing.assert_allclose(globals_[nodes_by_name[name]][:3, 3], expected[frame, joint], atol=2e-5)
    report = {'synthetic_only': True, 'checks': ['skinned mesh', 'skeletal animation',
        'nonuniform timestamps', '180-degree turn', 'all exported joint positions match native MHR',
        'relative root translation and metre units', 'smoothing across 180-degree wrap with Roma conventions'], 'passed': True}
    (folder / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
