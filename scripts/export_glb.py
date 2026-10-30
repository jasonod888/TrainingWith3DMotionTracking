"""Export stored native MHR parameters as a skinned skeletal GLB on CPU."""
import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]

def smooth_motion(params, sigma):
    from scipy.ndimage import gaussian_filter1d
    from scipy.spatial.transform import Rotation
    result = params.copy()
    # Bone scales are constant for this subject throughout the exported clip.
    result[:, 136:204] = np.median(params[:, 136:204], axis=0)
    if sigma <= 0 or len(params) < 3:
        return result
    result[:, 6:136] = gaussian_filter1d(np.unwrap(params[:, 6:136], axis=0), sigma, axis=0, mode='nearest')
    # Roma's lowercase 'xyz' uses extrinsic rotations, matching SciPy lowercase.
    q = Rotation.from_euler('xyz', params[:, 3:6]).as_quat()
    for i in range(1, len(q)):
        if np.dot(q[i-1], q[i]) < 0:
            q[i] *= -1
    q = gaussian_filter1d(q, sigma, axis=0, mode='nearest')
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    result[:, 3:6] = Rotation.from_quat(q).as_euler('xyz')
    return result.astype(np.float32)

def set_timestamps(path, times):
    """Replace regular exporter sample times with preserved source presentation times."""
    from pygltflib import GLTF2
    gltf = GLTF2().load(str(path))
    blob = bytearray(gltf.binary_blob())
    inputs = {s.input for a in gltf.animations for s in a.samplers}
    for index in inputs:
        accessor = gltf.accessors[index]
        if accessor.count != len(times) or accessor.componentType != 5126 or accessor.type != 'SCALAR':
            raise ValueError('Exporter changed keyframe layout; cannot preserve original timing safely.')
        view = gltf.bufferViews[accessor.bufferView]
        if view.byteStride not in (None, 0, 4):
            raise ValueError('Unexpected interleaved animation timestamp layout.')
        offset = (view.byteOffset or 0) + (accessor.byteOffset or 0)
        raw = np.asarray(times, dtype='<f4').tobytes()
        blob[offset:offset + len(raw)] = raw
        accessor.min, accessor.max = [float(times[0])], [float(times[-1])]
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(str(path))

def export(motion_path, output, assets, sigma=0, root_motion=True):
    import pymomentum.geometry as geometry
    from scipy.ndimage import gaussian_filter1d

    models = list(assets.rglob('compact_v6_1.model'))
    if len(models) != 1:
        raise ValueError('Expected one MHR rig. Run scripts/download_models.py --assets-only.')
    asset_dir = models[0].parent
    char = geometry.Character.load_fbx(str(asset_dir / 'lod1.fbx'), str(models[0]))
    with np.load(motion_path, allow_pickle=False) as data:
        raw_params = data['mhr_model_params'].astype(np.float32)
        if raw_params.ndim != 2 or raw_params.shape[1] != 204:
            raise ValueError(f'Expected native [frames,204] MHR parameters; got {raw_params.shape}.')
        times = data['timestamps'] - data['timestamps'][0]
        if len(times) < 2 or np.any(np.diff(times) <= 0):
            raise ValueError('Animation requires at least two frames with increasing timestamps.')
        params = smooth_motion(raw_params, sigma)
        states = np.asarray(geometry.model_parameters_to_skeleton_state(char, params), dtype=np.float32).copy()
        # Native MHR skeleton states use cm, +Y up/-Z forward. SAM camera output
        # uses metres, +Y down/+Z forward. Add translation after FK to avoid any
        # assumptions about root parameter scaling or rig parameter transforms.
        translation = data['pred_cam_t'].astype(np.float32) * [1, -1, -1]
        translation -= translation[0]
        if sigma > 0 and len(times) >= 3:
            translation = gaussian_filter1d(translation, sigma, axis=0, mode='nearest')
            translation -= translation[0]
        if root_motion:
            states[:, :, :3] += translation[:, None, :] * 100
        if not np.isfinite(states).all():
            raise ValueError('Non-finite skeleton states; export stopped.')
    fps = (len(times)-1) / float(times[-1])
    output.parent.mkdir(parents=True, exist_ok=True)
    builder = geometry.GltfBuilder(fps=fps)
    builder.add_character(char)
    builder.add_skeleton_states(char, fps, states)
    builder.save(str(output))
    set_timestamps(output, times)
    details = {
        'source_motion': str(motion_path.resolve()), 'frames': len(times),
        'duration_seconds': float(times[-1]), 'joint_count': len(char.skeleton.joint_names),
        'smoothing_sigma_frames': sigma, 'body_scales': 'median over clip',
        'root_motion': 'relative camera estimate' if root_motion else 'in place',
        'limitations': 'Neutral MHR skin; no contact solver, no calibrated world trajectory. Gaussian smoothing may soften fast motion.',
    }
    output.with_suffix('.export.json').write_text(json.dumps(details, indent=2))
    print(json.dumps(details, indent=2))
    print(f'Saved {output} ({output.stat().st_size/2**20:.2f} MiB)')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('motion', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--assets', type=Path, default=ROOT / 'models/mhr')
    p.add_argument('--smooth', type=float, default=0, help='Optional smoothing sigma in frames; raw data stays untouched')
    p.add_argument('--in-place', action='store_true')
    args = p.parse_args()
    if args.smooth < 0:
        p.error('--smooth must be nonnegative.')
    export(args.motion, args.output or args.motion.with_suffix('.glb'), args.assets, args.smooth, not args.in_place)

if __name__ == '__main__':
    main()
