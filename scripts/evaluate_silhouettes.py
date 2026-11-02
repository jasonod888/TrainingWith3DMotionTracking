"""Phase 1 silhouette evaluation runner.

Usage:
    python scripts/evaluate_silhouettes.py --dataset <dir> --predictor sam2 \
        --checkpoint <sam2.1_hiera_small.pt> --out outputs/silhouette-eval

The dataset layout and the metrics are documented in docs/video-silhouette-plan.md.
The harness writes contract-shaped chunks and a validated, unbound manifest for
every clip, so the evaluation exercises the same artifact code as production.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for entry in (ROOT, ROOT / 'scripts'):
    if str(entry) not in sys.path:
        sys.path.insert(0, str(entry))

from apps.api.silhouettes import SilhouetteManifest, build_transform  # noqa: E402
from silhouette_eval import (  # noqa: E402
    Clip,
    discover,
    frame_times,
    run_evaluation,
    sha256_bytes,
    sha256_file,
    summarise,
    write_report,
)

SAM2_CONFIG = 'configs/sam2.1/sam2.1_hiera_s.yaml'


class Predictor:
    family = 'sam2'
    supports_prompt = True
    name = 'predictor'
    mask_semantics = 'unknown'
    checkpoint_sha256 = ''
    settings: dict = {}
    load_seconds = 0.0

    def frames(self, clip: Clip, width: int, height: int, timestamps: list[float]):
        raise NotImplementedError

    def peak_gpu_mib(self) -> float | None:
        return None

    def close(self) -> None:
        pass


class TruthPredictor(Predictor):
    """Reads ground-truth masks; used to validate the metric pipeline."""

    name = 'perfect-labels'
    mask_semantics = 'exact hand labels'

    def __init__(self, truth: Path, width: int, height: int):
        import cv2
        self.cv2 = cv2
        self.masks = {}
        for path in sorted(truth.glob('*.png')):
            mask = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                raise SystemExit(f'Cannot read truth mask {path}')
            self.masks[int(path.stem)] = mask > 127

    def frames(self, clip, width, height, timestamps):
        for index, timestamp in enumerate(timestamps):
            if index not in self.masks:
                raise SystemExit(f'{clip.identifier}: truth is missing frame {index}.')
            yield index, timestamp, self.masks[index]


class PerturbedPredictor(TruthPredictor):
    """Deterministic damage: erosion, dilation, shifts, an absent gap, a distractor."""

    name = 'perturbed-labels'
    mask_semantics = 'perturbed hand labels'

    def __init__(self, truth: Path, width: int, height: int, seed: int = 7):
        super().__init__(truth, width, height)
        self.seed = seed

    def frames(self, clip, width, height, timestamps):
        rng = np.random.default_rng(self.seed)
        kernel = np.ones((3, 3), np.uint8)
        for index, timestamp in enumerate(timestamps):
            mask = self.masks[index].astype(np.uint8) * 255
            if index % 17 == 3:
                mask = self.cv2.erode(mask, kernel, iterations=1)
            elif index % 23 == 5:
                mask = self.cv2.dilate(mask, kernel, iterations=1)
            if index % 29 == 7:
                mask = np.roll(mask, 1, axis=1)
            if 20 <= index < 22:
                mask = np.zeros_like(mask)
            if index == 32:
                mask = np.zeros_like(mask)
                mask[20:50, 120:150] = 255  # a different person, subject left the frame
            if index == 36:
                mask[10:24, 10:24] = 255  # background equipment picked up as foreground
            if rng.random() < 0.05:
                mask = np.roll(mask, 1, axis=0)
            yield index, timestamp, mask > 127


class Sam2Predictor(Predictor):
    """SAM 2.1 video predictor with a box prompt on the selection frame."""

    family = 'sam2'
    name = 'sam2.1-video-predictor'
    mask_semantics = 'logit > 0.0 (probability 0.5); mask upsampled to source'

    def __init__(self, checkpoint: Path, model_cfg: str, device: str, threshold: float = 0.0):
        import torch
        from sam2.build_sam import build_sam2_video_predictor
        self.torch = torch
        self.device = device
        self.threshold = threshold
        self.predictor = build_sam2_video_predictor(model_cfg, str(checkpoint), device=device)

    def frames(self, clip, width, height, timestamps):
        import cv2
        try:
            state = self.predictor.init_state(video_path=str(clip.preview),
                                              offload_video_to_cpu=True, offload_state_to_cpu=True)
        except TypeError:
            state = self.predictor.init_state(video_path=str(clip.preview))
        self.predictor.add_new_points_or_box(state, frame_idx=clip.prompt_frame, obj_id=1,
                                             box=np.asarray(clip.box, dtype=np.float32))
        collected: dict[int, tuple[tuple[int, int], np.ndarray]] = {}
        for reverse in (False, True):
            try:
                propagation = self.predictor.propagate_in_video(
                    state, start_frame_idx=clip.prompt_frame, reverse=reverse)
            except TypeError as exc:
                raise SystemExit(f'This SAM 2 build does not support reverse propagation: {exc}') from exc
            for frame_index, _object_ids, logits in propagation:
                binary = (logits[0, 0] > self.threshold)
                if hasattr(binary, 'cpu'):
                    binary = binary.cpu().numpy()
                shape = binary.shape
                collected[int(frame_index)] = (shape, np.packbits(binary.reshape(-1)))
        if len(collected) != len(timestamps):
            raise SystemExit(f'{clip.identifier}: SAM 2 returned {len(collected)} frames, '
                             f'expected {len(timestamps)}.')
        for index, timestamp in enumerate(timestamps):
            shape, packed = collected[index]
            mask = np.unpackbits(packed)[:shape[0] * shape[1]].reshape(shape).astype(bool)
            if shape != (height, width):
                mask = cv2.resize(mask.astype(np.uint8), (width, height),
                                  interpolation=cv2.INTER_NEAREST).astype(bool)
            yield index, timestamp, mask

    def peak_gpu_mib(self) -> float | None:
        if not self.torch.cuda.is_available():
            return None
        return self.torch.cuda.max_memory_allocated() / 2 ** 20

    def close(self):
        del self.predictor
        if self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()


class MediaPipePredictor(Predictor):
    """MediaPipe Pose Landmarker with segmentation masks enabled."""

    family = 'mediapipe'
    supports_prompt = False
    name = 'mediapipe-pose-landmarker'
    mask_semantics = 'segmentation confidence > 0.5 (probability, not a logit)'

    def __init__(self, model: Path, threshold: float = 0.5):
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        self.mp = mp
        self.threshold = threshold
        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            output_segmentation_masks=True,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = vision.PoseLandmarker.create_from_options(options)

    def frames(self, clip, width, height, timestamps):
        import cv2
        capture = cv2.VideoCapture(str(clip.preview))
        index = 0
        while True:
            ok, bgr = capture.read()
            if not ok:
                break
            if index >= len(timestamps):
                raise SystemExit(f'{clip.identifier}: decoder produced more frames than timestamps.')
            image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB,
                                  data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            result = self.landmarker.detect_for_video(image, int(round(timestamps[index] * 1000)))
            mask = np.zeros((height, width), np.uint8)
            if result.segmentation_masks:
                values = np.squeeze(result.segmentation_masks[0].numpy_view())
                if values.shape != (height, width):
                    values = cv2.resize(values, (width, height), interpolation=cv2.INTER_LINEAR)
                mask = (values > self.threshold).astype(np.uint8)
            yield index, timestamps[index], mask.astype(bool)
            index += 1
        capture.release()
        if index != len(timestamps):
            raise SystemExit(f'{clip.identifier}: decoded {index} frames, expected {len(timestamps)}.')

    def close(self):
        self.landmarker.close()


def checkpoint_digest(path: Path) -> str:
    if not path.is_file():
        raise SystemExit(f'Checkpoint not found: {path}')
    return sha256_file(path)


def clip_geometry(clip: Clip) -> tuple[int, int]:
    import cv2
    capture = cv2.VideoCapture(str(clip.preview))
    if not capture.isOpened():
        raise SystemExit(f'Cannot open {clip.preview}')
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    capture.release()
    if width <= 0 or height <= 0:
        raise SystemExit(f'Cannot read dimensions for {clip.preview}')
    return width, height


def evaluate(dataset: Path, out: Path, make_predictor, canvas: int, limit: int | None) -> dict:
    clips = discover(dataset, limit)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for clip in clips:
        timestamps, _step = frame_times(clip.preview)
        width, height = clip_geometry(clip)
        if clip.prompt_frame >= len(timestamps):
            raise SystemExit(f'{clip.identifier}: prompt frame is outside the decoded clip.')
        transform = build_transform(width, height, canvas)
        began = time.perf_counter()
        predictor = make_predictor(clip)
        load_seconds = time.perf_counter() - began
        print(f'{clip.identifier}: {len(timestamps)} frames at {width}x{height}, '
              f'canvas {transform.canvas_width}x{transform.canvas_height}, '
              f'prompt frame {clip.prompt_frame}, {predictor.name}', flush=True)
        try:
            result = run_evaluation(
                clip, predictor.frames(clip, width, height, timestamps),
                predictor.name, predictor.mask_semantics, predictor.checkpoint_sha256,
                predictor.settings, out, width, height, transform,
                sha256_file(clip.preview), clip.preview.stat().st_size, timestamps,
                family=predictor.family, peak_gpu_mib=predictor.peak_gpu_mib)
        finally:
            predictor.close()
        result.seconds += load_seconds
        print(f'  IoU {result.mean_iou:.3f}, boundary {result.mean_boundary_f1:.3f}, '
              f'absent {len(result.absent_frames)}, replaced {result.subject_replaced}, '
              f'{result.storage_bytes} bytes, {result.seconds:.1f}s', flush=True)
        results.append(result)
    summary = summarise(results)
    write_report(out, results, summary, {'canvas': canvas, 'predictor': results[0].predictor,
                                         'clips': len(results)})
    return {'results': results, 'summary': summary}


def check(args) -> int:
    import importlib.util
    import shutil
    report = {}
    for module in ('numpy', 'scipy', 'cv2'):
        report[module] = bool(importlib.util.find_spec(module))
    report['torch'] = bool(importlib.util.find_spec('torch'))
    report['sam2'] = bool(importlib.util.find_spec('sam2'))
    report['mediapipe'] = bool(importlib.util.find_spec('mediapipe'))
    report['ffprobe'] = bool(shutil.which('ffprobe'))
    if args.checkpoint:
        report['checkpoint'] = str(args.checkpoint) if Path(args.checkpoint).is_file() else 'missing'
    if report['torch']:
        import torch
        report['cuda'] = torch.cuda.is_available()
        report['gpu'] = torch.cuda.get_device_name(0) if report['cuda'] else None
        report['gpu_mib'] = (round(torch.cuda.get_device_properties(0).total_memory / 2 ** 20)
                             if report['cuda'] else None)
    if args.dataset and Path(args.dataset).is_dir():
        report['clips'] = len([p for p in Path(args.dataset).iterdir()
                               if p.is_dir() and (p / 'preview.mp4').is_file()])
    print(json.dumps(report, indent=2))
    ready = report['numpy'] and report['cv2']
    return 0 if ready else 1


def build_predictor(args, clip: Clip, name: str):
    if name == 'perfect':
        return TruthPredictor(clip.directory / 'truth', *clip_geometry(clip))
    if name == 'synthetic':
        return PerturbedPredictor(clip.directory / 'truth', *clip_geometry(clip))
    if name == 'sam2':
        return Sam2Predictor(Path(args.checkpoint), args.model_cfg, args.device, args.threshold)
    if name == 'mediapipe':
        return MediaPipePredictor(Path(args.mediapipe_model), args.threshold)
    raise SystemExit(f'Unknown predictor {name}')


def attach_model_identity(predictor: Predictor, args) -> None:
    if isinstance(predictor, Sam2Predictor):
        predictor.checkpoint_sha256 = checkpoint_digest(Path(args.checkpoint))
    elif isinstance(predictor, MediaPipePredictor):
        predictor.checkpoint_sha256 = checkpoint_digest(Path(args.mediapipe_model))
    else:
        # Evaluation-only predictors have no weights; record the identity of the
        # harness instead of pretending a model file exists.
        predictor.checkpoint_sha256 = sha256_bytes(f'harness:{predictor.name}'.encode())
    predictor.settings = {'threshold': args.threshold, 'canvas': args.canvas,
                          'chunk_seconds': 10, 'harness': True,
                          'prompt_used': predictor.supports_prompt}


def make_factory(args, name: str | None = None):
    chosen = name or args.predictor

    def factory(clip: Clip) -> Predictor:
        predictor = build_predictor(args, clip, chosen)
        attach_model_identity(predictor, args)
        return predictor
    return factory


def self_test(args) -> int:
    import cv2
    out = ROOT / 'outputs/silhouette-selfcheck'
    with TemporaryDirectory(prefix='silhouette-selfcheck-') as temporary:
        dataset = Path(temporary) / 'dataset'
        clip_dir = dataset / 'synthetic-walk'
        (clip_dir / 'truth').mkdir(parents=True)
        (clip_dir / 'labels').mkdir(parents=True)
        width, height, frames = 160, 120, 48
        writer = cv2.VideoWriter(str(clip_dir / 'preview.mp4'),
                                 cv2.VideoWriter_fourcc(*'mp4v'), 15, (width, height))
        if not writer.isOpened():
            raise SystemExit('OpenCV cannot write the synthetic preview (mp4v).')
        labels = []
        for index in range(frames):
            canvas = np.zeros((height, width, 3), np.uint8)
            subject = np.zeros((height, width), np.uint8)
            distractor = np.zeros((height, width), np.uint8)
            if not 20 <= index < 22:
                centre = (30 + index * 2, 70)
                cv2.ellipse(subject, centre, (12, 26), 0, 0, 360, 255, -1)
                cv2.circle(subject, (centre[0], centre[1] - 32), 9, 255, -1)
            if 30 <= index < 34:
                cv2.rectangle(distractor, (128, 60), (152, 100), 255, -1)  # another person
            canvas[subject > 0] = (40, 180, 60)
            canvas[distractor > 0] = (30, 90, 200)
            writer.write(canvas)
            cv2.imwrite(str(clip_dir / 'truth' / f'{index:06d}.png'), subject)
            if index % 4 == 0:
                cv2.imwrite(str(clip_dir / 'labels' / f'{index:06d}.png'), subject)
                labels.append({'frame_index': index, 'timestamp': round(index / 15, 6)})
        writer.release()
        (clip_dir / 'clip.json').write_text(json.dumps({
            'prompt': {'frame_index': 0, 'box': [16, 30, 46, 110]},
            'tags': ['synthetic', 'selfcheck'],
            'subject_count': 1,
            'labels': labels,
            'notes': 'Self-check clip. Not part of the evaluation set.',
        }), encoding='utf-8')

        args.dataset = dataset
        args.out = out
        import shutil
        shutil.rmtree(out, ignore_errors=True)
        perfect = evaluate(dataset, out / 'perfect', make_factory(args, 'perfect'), args.canvas, None)
        damaged = evaluate(dataset, out / 'perturbed', make_factory(args, 'synthetic'),
                           args.canvas, None)
        exact, harmed = perfect['results'][0], damaged['results'][0]
        assert exact.mean_iou == 1.0 and exact.mean_boundary_f1 == 1.0, 'Exact labels must score 1.0'
        assert exact.empty_label_frames and exact.absent_correct == exact.empty_label_frames
        assert 0.5 < harmed.mean_iou < 1.0, 'Perturbed labels must lose measurable IoU'
        assert harmed.subject_replaced >= 1 and harmed.quality.identity_switch_suspected
        manifest = SilhouetteManifest.from_json(harmed.manifest_path.read_text(encoding='utf-8'))
        assert manifest.frame_count == frames and manifest.timeline.timestamps[-1] > 3
        assert manifest.binding is None, 'Evaluation generations are never bound to a revision.'
        print('Self-check passed:')
        print(f'  exact   IoU {exact.mean_iou:.3f}, boundary {exact.mean_boundary_f1:.3f}, '
              f'{exact.chunks} chunk(s)')
        print(f'  damaged IoU {harmed.mean_iou:.3f}, boundary {harmed.mean_boundary_f1:.3f}, '
              f'absent {len(harmed.absent_frames)}, replaced {harmed.subject_replaced}, '
              f'uncertain {len(harmed.quality.uncertain_frames)}')
        print(f'  artifacts under {out}')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, help='directory containing <clip>/preview.mp4')
    parser.add_argument('--out', type=Path, default=ROOT / 'outputs/silhouette-eval')
    parser.add_argument('--predictor', default='sam2',
                        choices=('sam2', 'mediapipe', 'perfect', 'synthetic'))
    parser.add_argument('--checkpoint', default=str(ROOT / 'models/sam2.1_hiera_small.pt'))
    parser.add_argument('--model-cfg', default=SAM2_CONFIG)
    parser.add_argument('--mediapipe-model',
                        default=str(ROOT / 'apps/web/public/tracking/pose_landmarker_lite.task'))
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--threshold', type=float, default=None,
                        help='logit threshold for SAM 2 (0.0) or probability threshold (MediaPipe)')
    parser.add_argument('--canvas', type=int, default=512, help='mask canvas long side')
    parser.add_argument('--limit', type=int, default=None, help='evaluate the first N clips')
    parser.add_argument('--check', action='store_true', help='report available dependencies and exit')
    parser.add_argument('--self-test', action='store_true',
                        help='run the metric pipeline on a generated synthetic clip')
    args = parser.parse_args()
    if args.self_test:
        args.predictor = 'perfect'
        args.threshold = 0.0
        args.canvas = args.canvas or 512
        return self_test(args)
    if args.check:
        return check(args)
    if not args.dataset:
        parser.error('--dataset is required unless --check or --self-test is used')
    if args.threshold is None:
        args.threshold = 0.5 if args.predictor == 'mediapipe' else 0.0
    if args.predictor in ('sam2', 'mediapipe'):
        # Fail before decoding anything if weights are missing.
        model = Path(args.checkpoint if args.predictor == 'sam2' else args.mediapipe_model)
        if not model.is_file():
            raise SystemExit(f'Model file not found: {model}')
    evaluate(args.dataset, args.out, make_factory(args), args.canvas, args.limit)
    print(f'Report written to {args.out / "report.md"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
