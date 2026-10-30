"""Render inferred 3D joints beside their source video as a review MP4."""
import argparse
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np
import pymomentum.geometry as geometry
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('folder', type=Path)
    args = p.parse_args()
    folder = args.folder
    meta = json.loads((folder / 'motion.json').read_text())
    with np.load(folder / 'motion.npz', allow_pickle=False) as data:
        points = data['pred_joint_coords'].copy() * [1, -1, -1]
        translation = data['pred_cam_t'] * [1, -1, -1]
        points += (translation - translation[0])[:, None, :]
        indices, times = data['frame_indices'], data['timestamps']
    model_path = next((ROOT / 'models/mhr').rglob('compact_v6_1.model'))
    char = geometry.Character.load_fbx(str(model_path.parent / 'lod1.fbx'), str(model_path))
    parents = list(char.skeleton.joint_parents)
    names = list(char.skeleton.joint_names)
    rotation = Rotation.from_euler('yx', [30, 12], degrees=True).as_matrix()
    view = points @ rotation.T
    low, high = np.min(view[:, :, :2], axis=(0, 1)), np.max(view[:, :, :2], axis=(0, 1))
    center = (low + high) / 2
    scale = min(510 / max(high[0]-low[0], .1), 490 / max(high[1]-low[1], .1))
    def project(xyz):
        xy = (xyz[..., :2] - center) * scale
        return np.rint(np.stack([xy[..., 0]+320, 350-xy[..., 1]], axis=-1)).astype(int)
    projected = project(view)
    fps = (len(times)-1) / float(times[-1]-times[0])
    temp = folder / 'pose_preview_intermediate.mp4'
    writer = cv2.VideoWriter(str(temp), cv2.VideoWriter_fourcc(*'mp4v'), fps, (1280, 640))
    if not writer.isOpened():
        raise RuntimeError('Could not open preview encoder')
    cap = cv2.VideoCapture(meta['source_video'])
    next_source_index = 0
    try:
        for f, source_index in enumerate(indices):
            while next_source_index <= source_index:
                ok, image = cap.read()
                if not ok:
                    raise RuntimeError('Source video ended before the stored pose timestamps')
                next_source_index += 1
            canvas = np.full((640, 1280, 3), 246, np.uint8)
            ratio = min(620/image.shape[1], 510/image.shape[0])
            image = cv2.resize(image, None, fx=ratio, fy=ratio)
            y, x = 100+(510-image.shape[0])//2, (640-image.shape[1])//2
            canvas[y:y+image.shape[0], x:x+image.shape[1]] = image
            cv2.line(canvas, (640, 0), (640, 640), (210,210,210), 1)
            for j in np.argsort(view[f, :, 2])[::-1]:
                parent = parents[j]
                if parent < 0 or names[parent] == 'body_world':
                    continue
                a, b = projected[f, parent]+[640,0], projected[f, j]+[640,0]
                if np.linalg.norm(a-b) < 1:
                    continue
                color = (220,110,40) if names[j].startswith('l_') else (90,155,35) if names[j].startswith('r_') else (125,85,65)
                cv2.line(canvas, tuple(a), tuple(b), color, 3, cv2.LINE_AA)
                cv2.circle(canvas, tuple(b), 3, color, -1, cv2.LINE_AA)
            cv2.putText(canvas, 'Original demonstration', (25,45), cv2.FONT_HERSHEY_SIMPLEX,.8,(55,55,55),2,cv2.LINE_AA)
            cv2.putText(canvas, '3D pose - fixed oblique view', (665,45), cv2.FONT_HERSHEY_SIMPLEX,.75,(55,55,55),2,cv2.LINE_AA)
            cv2.putText(canvas, f'Source {times[f]:.2f}s | Raw SAM poses', (25,80), cv2.FONT_HERSHEY_SIMPLEX,.6,(95,95,95),1,cv2.LINE_AA)
            writer.write(canvas)
    finally:
        cap.release()
        writer.release()
    output = folder / 'pose_preview.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(temp),
                    '-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(output)], check=True)
    temp.unlink()
    print(output.resolve())

if __name__ == '__main__':
    main()
