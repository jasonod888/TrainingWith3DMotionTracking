"""Experimental source correction from reviewed image regions, without contact labels.

Stable foot silhouettes provide a constant-depth prior, NOT a recovered depth
measurement. Original joint rotations/scales are byte-for-byte preserved.
"""
import argparse
import json
from pathlib import Path
import shutil

import numpy as np
from scipy.ndimage import gaussian_filter1d
from pygltflib import GLTF2

from retarget_mixamo import load_motion
from ground_motion import digest

ROOT = Path(__file__).resolve().parents[1]


def corrected_offsets(feet, shifts, reliable, pixels_per_metre):
    """Fit whole-body placement to stable image regions with a stated depth prior.

    No joint edits, floor assumptions, fixed pelvis height, or clip-specific pose rules.
    Physical foot identity/visibility must be reviewed in this experimental version.
    """
    n = len(feet)
    if (feet.shape != (n, 2, 3) or shifts.shape != (n, 2, 2)
            or reliable.shape != (n, 2) or not np.isfinite(feet).all()
            or not np.isfinite(shifts).all() or pixels_per_metre <= 0):
        raise ValueError('Invalid image-guidance inputs.')
    offsets = np.zeros((n, 3))
    supported = reliable.any(axis=1)
    for i in range(n):
        candidates = []
        for j in range(2):
            if reliable[i, j]:
                target = feet[0, j].copy()
                target[:2] += shifts[i, j]*[1, -1]/pixels_per_metre
                candidates.append(target-feet[i, j])
        if candidates:
            offsets[i] = np.mean(candidates, axis=0)
    # Only bridge short missing runs. Fade correction when the observation disappears.
    strength = supported.astype(float)
    valid = np.flatnonzero(supported)
    for left, right in zip(valid[:-1], valid[1:]):
        if 1 < right-left <= 4:
            for k in range(left+1, right):
                alpha = (k-left)/(right-left)
                offsets[k] = (1-alpha)*offsets[left]+alpha*offsets[right]
                strength[k] = 1
    # Smooth the observed correction, never the articulated pose.
    denominator = gaussian_filter1d(strength, 1., mode='nearest')
    numerator = gaussian_filter1d(offsets*strength[:, None], 1., axis=0, mode='nearest')
    result = numerator/np.maximum(denominator[:, None], 1e-6)
    result *= np.minimum(1., denominator[:, None]/.8)
    # Boundary filtering must not introduce a global offset at the initial frame.
    if supported[0]:
        result[0] = offsets[0]
    if supported[-1]:
        result[-1] = offsets[-1]
    result -= result[0]
    return result, supported


def write_revision(source, destination, count, offsets=None):
    gltf = GLTF2().load(str(source))
    blob = bytearray(gltf.binary_blob())
    inputs, outputs = set(), set()
    for animation in gltf.animations:
        for channel in animation.channels:
            sampler = animation.samplers[channel.sampler]
            inputs.add(sampler.input); outputs.add(sampler.output)
            if channel.target.path == 'translation' and gltf.nodes[channel.target.node].name == 'body_world' and offsets is not None:
                accessor = gltf.accessors[sampler.output]
                view = gltf.bufferViews[accessor.bufferView]
                if accessor.type != 'VEC3' or accessor.componentType != 5126 or view.byteStride:
                    raise ValueError('Unexpected placement track layout.')
                start = (view.byteOffset or 0)+(accessor.byteOffset or 0)
                original = np.frombuffer(blob, dtype='<f4', count=count*3, offset=start).reshape(count, 3).copy()
                values = (original+offsets).astype('<f4')
                blob[start:start+values.nbytes] = values.tobytes()
                accessor.min = values.min(axis=0).tolist(); accessor.max = values.max(axis=0).tolist()
    for index in inputs|outputs:
        accessor = gltf.accessors[index]
        accessor.count = count
        if index in inputs:
            view = gltf.bufferViews[accessor.bufferView]
            start = (view.byteOffset or 0)+(accessor.byteOffset or 0)
            values = np.frombuffer(blob, dtype='<f4', count=count, offset=start)
            accessor.min = [float(values[0])]; accessor.max = [float(values[-1])]
    gltf.set_binary_blob(bytes(blob)); gltf.save_binary(str(destination))


def main():
    import cv2
    from build_foot_mask_experiment import boundary_measure
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--experiment', type=Path, required=True)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--motion', type=Path, required=True)
    a = p.parse_args(); out = a.experiment
    meta = json.loads((out/'data.json').read_text())
    if meta['motion_sha256'] != digest(a.motion):
        raise ValueError('Experiment motion identity mismatch.')
    motion = load_motion(a.source)
    n = meta['frames']
    if not np.allclose(motion.times[:n], meta['times'], atol=1e-5, rtol=0):
        raise ValueError('Source times differ from mask timeline.')
    regions = [[624, 523, 650, 552], [650, 523, 679, 552]]
    masks = [cv2.imread(str(out/'masks'/f'{i:06d}.png'), 0)>127 for i in range(n)]
    feet = np.asarray([[motion.worlds_at(i)[foot][:3, 3] for foot in ('r_foot', 'l_foot')] for i in range(n)])
    shifts = np.zeros((n, 2, 2)); reliable = np.zeros((n, 2), bool); overlaps = np.zeros((n, 2))
    for j, r in enumerate(regions):
        x0, y0, x1, y1 = r
        baseline = boundary_measure(masks[0], r)
        for i, mask in enumerate(masks):
            m = boundary_measure(mask, r)
            aa, bb = masks[0][y0:y1, x0:x1], mask[y0:y1, x0:x1]
            union = (aa|bb).sum()
            overlaps[i, j] = (aa&bb).sum()/union if union else 0
            if m and baseline:
                shifts[i, j] = [m['x']-baseline['x'], m['y']-baseline['y']]
                reliable[i, j] = overlaps[i, j] >= .7 and np.linalg.norm(shifts[i, j]) <= 4 and .7 <= m['width']/baseline['width'] <= 1.3
    with np.load(a.motion, allow_pickle=False) as raw:
        pixels_per_metre = float(raw['focal_length'][0]/raw['pred_cam_t'][0, 2])
    offsets, supported = corrected_offsets(feet, shifts, reliable, pixels_per_metre)
    write_revision(a.source, out/'original.glb', n)
    write_revision(a.source, out/'revised.glb', n, offsets)
    revised = load_motion(out/'revised.glb')
    for name, tracks in motion.tracks.items():
        for kind, values in tracks.items():
            if name != 'body_world' or kind != 'translation':
                np.testing.assert_array_equal(values[:n], revised.tracks[name][kind])
    report = {'schema': 1, 'status': 'experimental-image-stability-prior',
              'duration': meta['analysed_duration'], 'frames': n, 'times': meta['times'],
              'offsets': offsets.tolist(), 'supported': supported.tolist(),
              'reliable_regions': reliable.tolist(), 'region_iou': overlaps.tolist(),
              'regions': regions, 'max_correction_m': float(np.linalg.norm(offsets, axis=1).max()),
              'source_sha256': digest(a.source), 'motion_sha256': digest(a.motion),
              'pose_tracks': 'unchanged byte-for-byte',
              'assumptions': ['Reviewed fixed-camera clip and initial foot regions.',
                              'Stable foot silhouette supports approximately constant depth.',
                              'This prior cannot distinguish movement along the camera ray.',
                              'Region-to-foot identity is reviewed, not automatically inferred.']}
    (out/'revision-data.json').write_text(json.dumps(report), encoding='utf-8')
    shutil.copyfile(ROOT/'scripts/image-motion-experiment.html', out/'animation.html')
    from experiment_video import prepare_video
    prepare_video(out/'video.mp4', out/'video.webm')
    vendor = out/'vendor'; vendor.mkdir(exist_ok=True)
    three = ROOT/'apps/web/node_modules/three'
    for src, dst in [('build/three.module.js', 'three.module.js'), ('build/three.core.js', 'three.core.js'),
                     ('examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'),
                     ('examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'),
                     ('examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js')]:
        target = vendor/dst; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(three/src, target)
    print(json.dumps({k:v for k,v in report.items() if k not in ('offsets','times','supported','reliable_regions','region_iou')}, indent=2))


if __name__ == '__main__':
    main()
