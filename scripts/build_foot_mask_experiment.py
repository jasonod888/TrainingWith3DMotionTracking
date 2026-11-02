"""Local-only SAM2 silhouette experiment; never modifies lesson assets."""
import argparse
import json
from pathlib import Path
import shutil
import sys

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def boundary_measure(mask, roi):
    """Bottom contour per occupied column in an explicit image-space region."""
    x0, y0, x1, y1 = map(int, roi)
    h, w = mask.shape
    x0, x1 = max(0, x0), min(w, x1)
    y0, y1 = max(0, y0), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return None
    points = []
    for x in range(x0, x1):
        ys = np.flatnonzero(mask[y0:y1, x])
        if len(ys):
            points.append((x, y0+int(ys[-1])))
    if len(points) < 4:
        return None
    p = np.asarray(points)
    return {'x': float(np.median(p[:, 0])), 'y': float(np.median(p[:, 1])),
            'width': len(points), 'edge': p[::max(1, len(p)//50)].tolist()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--video', type=Path, required=True)
    p.add_argument('--motion', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--box', type=float, nargs=4)
    p.add_argument('--chunk-frames', type=int, default=120)
    p.add_argument('--assets-only', action='store_true')
    p.add_argument('--duration', type=float, default=8)
    p.add_argument('--sam2', type=Path, default=ROOT/'.local/sam2')
    p.add_argument('--checkpoint', type=Path, default=ROOT/'models/sam2.1_hiera_small.pt')
    a = p.parse_args()
    sys.path.insert(0, str(a.sam2.resolve()))
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    from ground_motion import digest
    a.output.mkdir(parents=True, exist_ok=True)
    frames = a.output/'frames'
    masks = a.output/'masks'
    frames.mkdir(exist_ok=True); masks.mkdir(exist_ok=True)
    cap = cv2.VideoCapture(str(a.video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    with np.load(a.motion, allow_pickle=False) as motion:
        times = motion['timestamps'].copy()
        indices = motion['frame_indices'].astype(int)
        depth = (motion['pred_cam_t'][:, 2]-motion['pred_cam_t'][0, 2]).tolist()
        if a.box is None:
            points=motion['pred_keypoints_2d'][0]
            low,high=points.min(axis=0),points.max(axis=0)
            margin=max(20.,float(high[1]-low[1])*.20)
            a.box=[max(0.,float(low[0]-margin)),max(0.,float(low[1]-margin)),
                   min(float(width),float(high[0]+margin)),min(float(height),float(high[1]+margin))]
    if a.chunk_frames<2:
        raise ValueError('Segmentation chunk must contain at least two frames.')
    if len(indices) != len(times) or np.any(indices != np.arange(len(indices))):
        raise ValueError('Experiment requires frame-aligned normalized preview motion.')
    count = min(len(times), int(a.duration*fps)+1)
    try:
        for i in range(count):
            ok, image = cap.read()
            if not ok:
                raise ValueError('Preview is shorter than motion.')
            cv2.imwrite(str(frames/f'{i:06d}.jpg'), image)
    finally:
        cap.release()
    # Isolated frame directory prevents stale frames from a previous longer run.
    for path in frames.glob('*.jpg'):
        if int(path.stem) >= count:
            path.unlink()
    model = build_sam2_video_predictor('configs/sam2.1/sam2.1_hiera_s.yaml',
                                      str(a.checkpoint.resolve()), device='cuda',
                                      apply_postprocessing=False)
    with torch.inference_mode(), torch.autocast('cuda', dtype=torch.bfloat16):
        # Bounded memory: overlap one exact frame and seed its previous mask.
        chunk_dir=a.output/'segmentation-chunk';chunk_dir.mkdir(exist_ok=True)
        previous_mask=None
        for begin in range(0,count,a.chunk_frames):
            origin=max(0,begin-1);end=min(count,begin+a.chunk_frames)
            for old in chunk_dir.glob('*.jpg'):
                old.unlink()
            for source_index in range(origin,end):
                shutil.copyfile(frames/f'{source_index:06d}.jpg',chunk_dir/f'{source_index-origin:06d}.jpg')
            state=model.init_state(video_path=str(chunk_dir.resolve()),offload_video_to_cpu=True,offload_state_to_cpu=True)
            if previous_mask is None:
                model.add_new_points_or_box(state,frame_idx=0,obj_id=1,box=np.asarray(a.box,dtype=np.float32))
            else:
                model.add_new_mask(state,frame_idx=0,obj_id=1,mask=previous_mask>0)
            for local_index,_,logits in model.propagate_in_video(state):
                index=origin+local_index
                mask=(logits[0,0]>0).cpu().numpy().astype(np.uint8)*255
                if mask.shape!=(height,width):
                    mask=cv2.resize(mask,(width,height),interpolation=cv2.INTER_NEAREST)
                if index>=begin:
                    cv2.imwrite(str(masks/f'{index:06d}.png'),mask)
                previous_mask=mask
            del state
            print(f'Masks {end}/{count}',flush=True)
    if not a.assets_only:
        shutil.copyfile(a.video, a.output/'video.mp4')
    data = {'schema': 1, 'model': 'SAM2.1 small', 'frames': count,
            'width': width, 'height': height, 'fps': fps,
            'times': times[:count].tolist(), 'depth': depth[:count],
            'video_sha256': digest(a.video), 'motion_sha256': digest(a.motion),
            'checkpoint_sha256': digest(a.checkpoint),
            'person_box': a.box, 'analysed_duration': float(times[count-1]),
            'note': 'Whole-person masks. Image movement only; no automatic contact or trajectory correction.'}
    (a.output/'data.json').write_text(json.dumps(data), encoding='utf-8')
    if not a.assets_only:
        shutil.copyfile(ROOT/'scripts/foot-mask-experiment.html', a.output/'index.html')
    print(f'Experiment ready: {a.output}', flush=True)


if __name__ == '__main__':
    main()
