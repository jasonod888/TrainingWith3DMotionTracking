"""Sequential official SAM 3D Body inference for one clearly visible person."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
os.environ['MOMENTUM_ENABLED'] = '0'
os.environ['TORCH_HOME'] = str(ROOT / 'models/torch')
sys.path.insert(0, str(ROOT / 'vendor/sam-3d-body'))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('video', type=Path)
    p.add_argument('--output', type=Path, default=ROOT / 'outputs/demo')
    p.add_argument('--model-dir', type=Path, default=ROOT / 'models/sam-3d-body-dinov3')
    p.add_argument('--fps', type=float, default=15, help='Maximum sampled frame rate; 0 keeps every source frame')
    p.add_argument('--start', type=float, default=0)
    p.add_argument('--duration', type=float, default=20)
    p.add_argument('--max-frames', type=int, default=0, help='Use 1 for the initial inference check')
    p.add_argument('--inference-type', choices=('body', 'full'), default='body')
    p.add_argument('--bbox', type=float, nargs=4, metavar=('X1', 'Y1', 'X2', 'Y2'))
    args = p.parse_args()
    if not args.video.is_file():
        p.error(f'Video does not exist: {args.video}')
    if args.start < 0 or args.duration <= 0 or args.fps < 0 or args.max_frames < 0:
        p.error('Start, fps and max-frames must be nonnegative; duration must be positive.')
    for name in ('model_config.yaml', 'model.ckpt', 'assets/mhr_model.pt'):
        if not (args.model_dir / name).is_file():
            p.error(f'Missing {name}. Run scripts/download_models.py (or --verified-mirror for the hash-checked public redistribution).')

    import cv2
    import numpy as np
    import torch
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body

    if not torch.cuda.is_available():
        p.error('CUDA is unavailable; run scripts/check_environment.py.')
    out = args.output.resolve()
    frames_dir = out / 'frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    if list(frames_dir.glob('*.npz')) or (out / 'motion.npz').exists():
        p.error('Output already contains inference data. Choose a new --output directory to avoid mixing runs.')
    cap = cv2.VideoCapture(str(args.video.resolve()))
    if not cap.isOpened():
        p.error('OpenCV could not decode this video.')
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    if not np.isfinite(source_fps) or source_fps <= 0:
        p.error('Video has invalid frame rate.')
    # ffprobe preserves presentation times for variable-frame-rate phone videos.
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                            '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json',
                            str(args.video.resolve())], capture_output=True, text=True, check=True)
    source_times = [float(f['best_effort_timestamp_time']) for f in json.loads(probe.stdout)['frames']]
    if not source_times or not np.isfinite(source_times).all() or np.any(np.diff(source_times) <= 0):
        p.error('Video timestamps are missing or non-monotonic.')
    source_times = np.asarray(source_times) - source_times[0]

    torch.cuda.reset_peak_memory_stats()
    began = time.perf_counter()
    backbone_source = ROOT / 'vendor/dinov3'
    if not (backbone_source / 'hubconf.py').is_file():
        p.error('Local DINOv3 source missing. Run scripts/setup.ps1.')
    original_hub_load = torch.hub.load
    def local_hub_load(repo, name, *values, **kwargs):
        if repo == 'facebookresearch/dinov3':
            # Call the same official backbone factory without importing every
            # unrelated segmentation/detection evaluation head in hubconf.py.
            import importlib
            sys.path.insert(0, str(backbone_source))
            backbones = importlib.import_module('dinov3.hub.backbones')
            kwargs.pop('source', None)
            return getattr(backbones, name)(*values, **kwargs)
        return original_hub_load(repo, name, *values, **kwargs)
    with patch.object(torch.hub, 'load', local_hub_load):
        model, cfg = load_sam_3d_body(str(args.model_dir / 'model.ckpt'),
                                     device='cuda', mhr_path=str(args.model_dir / 'assets/mhr_model.pt'))
    estimator = SAM3DBodyEstimator(model, cfg)
    load_seconds = time.perf_counter() - began
    rows, timestamps, indices, durations = [], [], [], []
    frame_index, next_time = 0, args.start
    keys = ('bbox', 'focal_length', 'pred_keypoints_3d', 'pred_keypoints_2d',
            'pred_cam_t', 'global_rot', 'body_pose_params', 'hand_pose_params',
            'scale_params', 'shape_params', 'expr_params', 'pred_joint_coords',
            'pred_global_rots', 'mhr_model_params')
    try:
        with torch.inference_mode():
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if frame_index >= len(source_times):
                    raise ValueError('Decoder produced more frames than ffprobe timestamp records.')
                t = float(source_times[frame_index])
                idx = frame_index
                frame_index += 1
                if t < args.start - 1e-7:
                    continue
                if t > args.start + args.duration + 1e-7:
                    break
                if t + 1e-7 < next_time:
                    continue
                if args.fps:
                    while next_time <= t + 1e-7:
                        next_time += 1 / args.fps
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                boxes = None if args.bbox is None else np.asarray([args.bbox], dtype=np.float32)
                if boxes is not None and not (0 <= boxes[0, 0] < boxes[0, 2] <= bgr.shape[1]
                                               and 0 <= boxes[0, 1] < boxes[0, 3] <= bgr.shape[0]):
                    raise ValueError('--bbox must be a nonempty rectangle within the source image.')
                torch.cuda.synchronize()
                tick = time.perf_counter()
                # Keep upstream mixed precision; no blanket half() or autocast on the MHR solver.
                result = estimator.process_one_image(rgb, bboxes=boxes, inference_type=args.inference_type)
                torch.cuda.synchronize()
                durations.append(time.perf_counter() - tick)
                if len(result) != 1:
                    raise ValueError(f'Expected exactly one body at frame {idx}, got {len(result)}.')
                row = {k: np.asarray(result[0][k]) for k in keys}
                if any(not np.isfinite(v).all() for v in row.values()):
                    raise ValueError(f'Non-finite model output at frame {idx}; raw export stopped.')
                np.savez_compressed(frames_dir / f'{idx:06d}.npz', timestamp=t, frame_index=idx, **row)
                rows.append(row)
                timestamps.append(t)
                indices.append(idx)
                if len(rows) == 1:
                    cv2.imwrite(str(out / 'first_frame.jpg'), bgr)
                    preview = bgr.copy()
                    for x, y in row['pred_keypoints_2d']:
                        if np.isfinite([x, y]).all():
                            cv2.circle(preview, (round(float(x)), round(float(y))), 3, (0, 230, 0), -1)
                    cv2.imwrite(str(out / 'first_frame_keypoints.jpg'), preview)
                print(f'Frame {idx}, source {t:.3f}s: {durations[-1]:.2f}s, '
                      f'CUDA peak {torch.cuda.max_memory_reserved()/2**30:.2f} GiB', flush=True)
                del result
                if args.max_frames and len(rows) >= args.max_frames:
                    break
    finally:
        cap.release()
    if not rows:
        raise ValueError('No frames in selected time range.')
    data = {k: np.stack([r[k] for r in rows]) for k in keys}
    data['timestamps'] = np.asarray(timestamps, dtype=np.float64)
    data['frame_indices'] = np.asarray(indices, dtype=np.int64)
    np.savez_compressed(out / 'motion.npz', **data)
    meta = {
        'schema_version': 1, 'source_video': str(args.video.resolve()),
        'source_fps': source_fps, 'sampled_frames': len(rows), 'requested_fps': args.fps,
        'timestamps_seconds': timestamps, 'frame_indices': indices,
        'inference_type': args.inference_type, 'gpu': torch.cuda.get_device_name(0),
        'torch': torch.__version__, 'model_load_seconds': load_seconds,
        'inference_seconds': sum(durations), 'mean_seconds_per_frame': float(np.mean(durations)),
        'cuda_peak_allocated_gib': torch.cuda.max_memory_allocated()/2**30,
        'cuda_peak_reserved_gib': torch.cuda.max_memory_reserved()/2**30,
        'coordinates': {'pred_keypoints_3d': 'metres, camera axes x-right/y-down/z-forward, translation excluded',
                        'pred_cam_t': 'metres, camera axes; an estimate, not a solved world trajectory',
                        'mhr_model_params': 'native MHR 204-vector; translation excluded by model'},
        'scope': 'Single-person framewise baseline; no validated world trajectory or foot-contact solver.',
        'arrays': {k: {'shape': list(v.shape), 'dtype': str(v.dtype)} for k, v in data.items()},
    }
    (out / 'motion.json').write_text(json.dumps(meta, indent=2))
    print(f'Saved {out / "motion.npz"} and motion.json', flush=True)

if __name__ == '__main__':
    main()
