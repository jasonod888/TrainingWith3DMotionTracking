"""Phase 1 silhouette evaluation: dataset, metrics and contract-shaped artifacts.

The harness consumes a directory of clips with hand-labelled frames, runs a
predictor, writes production-shaped mask chunks through
:mod:`apps.api.silhouettes`, validates every archive, and reports measured
quality, runtime and storage.  It deliberately does not decide a production
model: it produces the numbers that decision needs.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.silhouettes import (  # noqa: E402
    CHUNK_SECONDS,
    MaskTransform,
    ModelRef,
    QualityFlags,
    Selection,
    SilhouetteManifest,
    SourceClip,
    Timeline,
    build_transform,
    chunk_manifest,
    verify_chunk_archive,
    write_chunk_archive,
)

LABEL_NAME = re.compile(r'^(\d{6})\.png$')


@dataclass
class Clip:
    identifier: str
    preview: Path
    directory: Path
    prompt_frame: int
    box: list[float]
    tags: list[str] = field(default_factory=list)
    subject_count: int | None = None
    labels: dict[int, float] = field(default_factory=dict)
    notes: str = ''


@dataclass
class ClipResult:
    clip: Clip
    width: int
    height: int
    frames: int
    timestamps: list[float]
    labelled: int
    mean_iou: float
    median_iou: float
    mean_boundary_f1: float
    absent_frames: list[int]
    empty_label_frames: int
    absent_correct: int
    subject_missing: int
    subject_replaced: int
    temporal_change: float
    gt_temporal_change: float
    chunks: int
    storage_bytes: int
    verified_frames: int
    manifest_path: Path
    quality: QualityFlags
    seconds: float
    peak_gpu_mib: float | None
    predictor: str
    mask_semantics: str

    @property
    def duration(self) -> float:
        return self.timestamps[-1] + final_duration(self.timestamps)

    def as_dict(self) -> dict:
        duration = max(1e-6, self.duration)
        return {
            'clip': self.clip.identifier,
            'tags': self.clip.tags,
            'subject_count': self.clip.subject_count,
            'predictor': self.predictor,
            'mask_semantics': self.mask_semantics,
            'width': self.width,
            'height': self.height,
            'frames': self.frames,
            'duration_seconds': round(duration, 3),
            'labelled_frames': self.labelled,
            'mean_iou': round(self.mean_iou, 4),
            'median_iou': round(self.median_iou, 4),
            'mean_boundary_f1': round(self.mean_boundary_f1, 4),
            'absent_frames': len(self.absent_frames),
            'empty_label_frames': self.empty_label_frames,
            'absent_accuracy': (round(self.absent_correct / self.empty_label_frames, 4)
                                if self.empty_label_frames else None),
            'subject_missing_frames': self.subject_missing,
            'subject_replaced_frames': self.subject_replaced,
            'temporal_change': round(self.temporal_change, 5),
            'gt_temporal_change': round(self.gt_temporal_change, 5),
            'excess_temporal_change': round(self.temporal_change - self.gt_temporal_change, 5),
            'chunks': self.chunks,
            'storage_bytes': self.storage_bytes,
            'bytes_per_video_minute': round(self.storage_bytes / duration * 60),
            'verified_frames': self.verified_frames,
            'seconds': round(self.seconds, 2),
            'seconds_per_video_minute': round(self.seconds / duration * 60, 2),
            'peak_gpu_mib': round(self.peak_gpu_mib, 1) if self.peak_gpu_mib is not None else None,
            'quality_flags': self.quality.model_dump(mode='json'),
            'manifest': str(self.manifest_path),
        }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def frame_times(video: Path) -> tuple[list[float], float]:
    """Decoded presentation times relative to the first frame.

    Mirrors ``scripts/process_video.py``: ffprobe preserves presentation times,
    and the decoder order is assumed to equal ffprobe order for a normalized
    15 fps preview.  Falls back to the container frame rate when ffprobe is
    unavailable, and says so through the returned frame rate.
    """
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(video)],
            capture_output=True, text=True, check=True, timeout=120)
        times = [float(frame['best_effort_timestamp_time'])
                 for frame in json.loads(probe.stdout)['frames']]
        if not times or not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
            raise ValueError('ffprobe returned missing or non-monotonic timestamps.')
        base = times[0]
        return [round(value - base, 6) for value in times], float(np.median(np.diff(times)))
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        import cv2
        capture = cv2.VideoCapture(str(video))
        if not capture.isOpened():
            raise SystemExit(f'Cannot read {video}: {exc}')
        fps = capture.get(cv2.CAP_PROP_FPS) or 15.0
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.release()
        if count <= 0:
            raise SystemExit(f'Cannot determine frame count for {video}')
        step = 1.0 / fps
        return [round(i * step, 6) for i in range(count)], step


def final_duration(timestamps: list[float]) -> float:
    steps = np.diff(timestamps)
    return float(np.median(steps)) if len(steps) else 1 / 15


def to_canvas(mask: np.ndarray, transform: MaskTransform) -> np.ndarray:
    """Resize a source-resolution mask into the fixed canvas (nearest neighbour)."""
    import cv2
    height, width = mask.shape
    target_w = max(1, round(width * transform.scale))
    target_h = max(1, round(height * transform.scale))
    resized = cv2.resize(mask.astype(np.uint8), (target_w, target_h), interpolation=cv2.INTER_NEAREST)
    canvas = np.zeros((transform.canvas_height, transform.canvas_width), np.uint8)
    offset_x = int(round(transform.offset_x))
    offset_y = int(round(transform.offset_y))
    canvas[offset_y:offset_y + target_h, offset_x:offset_x + target_w] = resized
    return canvas.astype(bool)


def iou(pred: np.ndarray, target: np.ndarray) -> float:
    union = np.logical_or(pred, target).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(pred, target).sum() / union)


def _boundary(mask: np.ndarray) -> np.ndarray:
    from scipy.ndimage import binary_erosion
    return np.logical_and(mask, np.logical_not(binary_erosion(mask, iterations=1)))


def boundary_f1(pred: np.ndarray, target: np.ndarray, tolerance: int = 2) -> float:
    """Boundary F1 with a pixel tolerance, robust to empty masks."""
    from scipy.ndimage import distance_transform_edt
    pred_edge, target_edge = _boundary(pred), _boundary(target)
    if not pred_edge.any() and not target_edge.any():
        return 1.0
    if not pred_edge.any() or not target_edge.any():
        return 0.0
    to_target = distance_transform_edt(np.logical_not(target_edge))
    to_pred = distance_transform_edt(np.logical_not(pred_edge))
    precision = float((to_target[pred_edge] <= tolerance).mean())
    recall = float((to_pred[target_edge] <= tolerance).mean())
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


def load_clip(directory: Path) -> Clip:
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}', directory.name):
        raise SystemExit(f'{directory.name}: clip directories must be simple identifiers '
                         '(letters, digits, underscore, dash); they become part of object keys.')
    spec = json.loads((directory / 'clip.json').read_text(encoding='utf-8'))
    prompt = spec.get('prompt') or {}
    if 'frame_index' not in prompt or 'box' not in prompt:
        raise SystemExit(f'{directory.name}: clip.json needs prompt.frame_index and prompt.box; '
                         'a clip without a subject prompt cannot be evaluated.')
    box = [float(value) for value in prompt['box']]
    if len(box) != 4 or not (box[0] < box[2] and box[1] < box[3]):
        raise SystemExit(f'{directory.name}: prompt.box must be [x1, y1, x2, y2].')
    labels = {}
    label_dir = directory / 'labels'
    if label_dir.is_dir():
        for mask_path in sorted(label_dir.glob('*.png')):
            match = LABEL_NAME.match(mask_path.name)
            if not match:
                raise SystemExit(f'{directory.name}: label {mask_path.name} must be NNNNNN.png')
            labels[int(match.group(1))] = 0.0
    for entry in spec.get('labels', []):
        index = int(entry['frame_index'])
        if index not in labels:
            raise SystemExit(f'{directory.name}: label entry {index} has no matching PNG.')
        labels[index] = float(entry.get('timestamp', 0.0))
    return Clip(identifier=directory.name, preview=directory / 'preview.mp4', directory=directory,
                prompt_frame=int(prompt['frame_index']), box=box, tags=list(spec.get('tags', [])),
                subject_count=spec.get('subject_count'), labels=labels, notes=spec.get('notes', ''))


def discover(dataset: Path, limit: int | None = None) -> list[Clip]:
    if not dataset.is_dir():
        raise SystemExit(f'Dataset directory not found: {dataset}')
    directories = [path for path in sorted(dataset.iterdir())
                   if path.is_dir() and (path / 'preview.mp4').is_file()]
    if limit:
        directories = directories[:limit]
    if not directories:
        raise SystemExit(f'No clips found under {dataset} (expected <clip>/preview.mp4).')
    return [load_clip(path) for path in directories]


def load_label_mask(path: Path, width: int, height: int) -> np.ndarray:
    import cv2
    mask = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise SystemExit(f'Cannot read label mask {path}')
    if mask.shape != (height, width):
        raise SystemExit(f'Label {path.name} is {mask.shape[1]}x{mask.shape[0]}, '
                         f'expected {width}x{height} at source resolution.')
    return mask > 127


def run_evaluation(clip: Clip, frames, predictor_name: str, mask_semantics: str,
                   checkpoint_sha256: str, settings: dict, out: Path,
                   width: int, height: int, transform: MaskTransform,
                   preview_sha256: str, preview_bytes: int, timestamps: list[float],
                   family: str = 'sam2', peak_gpu_mib=None) -> ClipResult:
    import time
    began = time.perf_counter()
    duration = final_duration(timestamps)
    per_chunk = max(1, int(round(CHUNK_SECONDS / duration)))
    output = out / clip.identifier
    (output / 'chunks').mkdir(parents=True, exist_ok=True)
    generation = hashlib.sha256(f'{clip.identifier}:{time.time_ns()}'.encode()).hexdigest()[:24]

    chunks = []
    frame_stats = {'iou': [], 'boundary': []}
    absent, uncertain, missing, replaced = [], [], 0, 0
    empty_labels = empty_correct = 0
    temporal, gt_temporal = [], []
    buffer: list[tuple[int, bytes]] = []
    chunk_start = 0
    previous: np.ndarray | None = None
    previous_gt: np.ndarray | None = None
    seams: list[float] = []
    index = -1
    for index, timestamp, mask in frames:
        if index >= len(timestamps):
            raise SystemExit(f'{clip.identifier}: predictor produced more frames than the source.')
        if abs(timestamp - timestamps[index]) > 1e-3:
            raise SystemExit(f'{clip.identifier}: predictor timestamp {timestamp} does not match '
                             f'frame {index} time {timestamps[index]}.')
        if mask.shape != (height, width):
            raise SystemExit(f'{clip.identifier}: predictor mask is {mask.shape[1]}x{mask.shape[0]}, '
                             f'expected {width}x{height}.')
        canvas = to_canvas(mask, transform)
        buffer.append((index, (canvas.astype(np.uint8) * 255).tobytes()))
        if previous is not None:
            temporal.append(float(np.logical_xor(canvas, previous).sum()) / canvas.size)
            if len(buffer) == 1:
                seams.append(iou(previous, canvas))
        previous = canvas
        if not canvas.any():
            absent.append(index)
        if index in clip.labels:
            label = load_label_mask(clip.directory / 'labels' / f'{index:06d}.png', width, height)
            target = to_canvas(label, transform)
            score = iou(canvas, target)
            frame_stats['iou'].append(score)
            frame_stats['boundary'].append(boundary_f1(canvas, target))
            if not target.any():
                empty_labels += 1
                empty_correct += 0 if canvas.any() else 1
            elif not canvas.any():
                missing += 1
            elif score == 0:
                replaced += 1
            if 0 < score < 0.5:
                uncertain.append(index)
            if previous_gt is not None:
                gt_temporal.append(float(np.logical_xor(target, previous_gt).sum()) / target.size)
            previous_gt = target
        if len(buffer) == per_chunk:
            chunks.append(_flush(output, chunks, buffer, chunk_start, clip, generation, transform))
            chunk_start = index + 1
            buffer = []
    if buffer:
        chunks.append(_flush(output, chunks, buffer, chunk_start, clip, generation, transform))
    if index + 1 != len(timestamps):
        raise SystemExit(f'{clip.identifier}: predictor stopped after {index + 1} of '
                         f'{len(timestamps)} frames; a silhouette must cover every decoded frame.')

    quality = QualityFlags(absent_frames=absent, uncertain_frames=uncertain,
                           identity_switch_suspected=replaced > 0,
                           subject_count_observed=clip.subject_count,
                           chunk_seam_iou=seams, notes=[clip.notes] if clip.notes else [])
    manifest = SilhouetteManifest(
        generation_id=generation, attempt=1,
        source=SourceClip(conversion_id=f'eval-{clip.identifier}', preview_sha256=preview_sha256,
                          preview_bytes=preview_bytes, width=width, height=height,
                          decoded_frames=len(timestamps)),
        model=ModelRef(family=family,
                       name=predictor_name, checkpoint_sha256=checkpoint_sha256, settings=settings),
        selection=Selection(source='owner', frame_index=clip.prompt_frame,
                            timestamp=timestamps[clip.prompt_frame], box=clip.box),
        transform=transform,
        timeline=Timeline(timestamps=timestamps, final_frame_duration=duration),
        chunks=chunks, quality=quality)
    manifest_path = output / 'silhouette.json'
    manifest_path.write_text(manifest.to_json(), encoding='utf-8')
    verified = sum(verify_chunk_archive((output / 'chunks' / Path(chunk.key).name).read_bytes(),
                                        chunk, transform) for chunk in chunks)
    seconds = time.perf_counter() - began
    return ClipResult(
        clip=clip, width=width, height=height, frames=len(timestamps), timestamps=timestamps,
        labelled=len(frame_stats['iou']),
        mean_iou=float(np.mean(frame_stats['iou'])) if frame_stats['iou'] else 0.0,
        median_iou=float(np.median(frame_stats['iou'])) if frame_stats['iou'] else 0.0,
        mean_boundary_f1=float(np.mean(frame_stats['boundary'])) if frame_stats['boundary'] else 0.0,
        absent_frames=absent, empty_label_frames=empty_labels, absent_correct=empty_correct,
        subject_missing=missing, subject_replaced=replaced,
        temporal_change=float(np.mean(temporal)) if temporal else 0.0,
        gt_temporal_change=float(np.mean(gt_temporal)) if gt_temporal else 0.0,
        chunks=len(chunks), storage_bytes=sum(chunk.bytes for chunk in chunks),
        verified_frames=verified, manifest_path=manifest_path, quality=quality,
        seconds=seconds, peak_gpu_mib=peak_gpu_mib() if callable(peak_gpu_mib) else peak_gpu_mib,
        predictor=predictor_name, mask_semantics=mask_semantics)


def _flush(output: Path, chunks: list, buffer: list[tuple[int, bytes]], first_frame: int,
           clip: Clip, generation: str, transform: MaskTransform):
    index = len(chunks)
    path = output / 'chunks' / f'masks-{index:05d}.zip'
    size, digest = write_chunk_archive(path, buffer, transform.canvas_width, transform.canvas_height)
    blob = path.read_bytes()
    assert len(blob) == size and hashlib.sha256(blob).hexdigest() == digest
    chunk = chunk_manifest(index, first_frame, len(buffer), blob,
                           f'eval-{clip.identifier}', generation)
    verify_chunk_archive(blob, chunk, transform)
    return chunk


def summarise(results: list[ClipResult]) -> dict:
    frames = sum(result.frames for result in results)
    labelled = sum(result.labelled for result in results)
    weight = max(1, labelled)
    total_seconds = sum(result.seconds for result in results)
    total_duration = sum(result.duration for result in results)
    storage = sum(result.storage_bytes for result in results)
    return {
        'clips': len(results),
        'frames': frames,
        'duration_seconds': round(total_duration, 2),
        'labelled_frames': labelled,
        'mean_iou': round(sum(result.mean_iou * result.labelled for result in results) / weight, 4),
        'mean_boundary_f1': round(
            sum(result.mean_boundary_f1 * result.labelled for result in results) / weight, 4),
        'absent_frames': sum(len(result.absent_frames) for result in results),
        'subject_missing_frames': sum(result.subject_missing for result in results),
        'subject_replaced_frames': sum(result.subject_replaced for result in results),
        'storage_bytes': storage,
        'bytes_per_video_minute': round(storage / max(1e-6, total_duration) * 60),
        'seconds_per_video_minute': round(total_seconds / max(1e-6, total_duration) * 60, 2),
        'peak_gpu_mib': max((result.peak_gpu_mib or 0) for result in results) or None,
        'verified_frames': sum(result.verified_frames for result in results),
    }


def markdown_report(results: list[ClipResult], summary: dict) -> str:
    lines = ['# Silhouette evaluation', '',
             'Measured on the clips present in the dataset. No accuracy promise is implied by these '
             'numbers; they are the evidence used to choose a model and settings.', '',
             f"- Clips: {summary['clips']}, frames: {summary['frames']}, "
             f"labelled frames: {summary['labelled_frames']}",
             f"- Mean IoU: {summary['mean_iou']}, mean boundary F1: {summary['mean_boundary_f1']}",
             f"- Storage: {summary['storage_bytes']} bytes "
             f"({summary['bytes_per_video_minute']} B per video minute)",
             f"- Runtime: {summary['seconds_per_video_minute']} s per video minute",
             f"- Peak GPU: {summary['peak_gpu_mib']} MiB" if summary['peak_gpu_mib'] else '- Peak GPU: n/a',
             '', '| clip | frames | IoU | boundary F1 | absent | replaced | excess change | '
             'B/min | s/min |', '|---|---|---|---|---|---|---|---|---|']
    for result in results:
        lines.append(
            f"| {result.clip.identifier} | {result.frames} | {result.mean_iou:.3f} | "
            f"{result.mean_boundary_f1:.3f} | {len(result.absent_frames)} | "
            f"{result.subject_replaced} | "
            f"{result.temporal_change - result.gt_temporal_change:+.4f} | "
            f"{result.as_dict()['bytes_per_video_minute']} | "
            f"{result.as_dict()['seconds_per_video_minute']} |")
    lines += ['', '## Flags per clip', '']
    for result in results:
        flags = result.quality
        lines.append(f"- **{result.clip.identifier}** ({', '.join(result.clip.tags) or 'untagged'}): "
                     f"absent {len(flags.absent_frames)}, uncertain {len(flags.uncertain_frames)}, "
                     f"identity switch suspected: {'yes' if flags.identity_switch_suspected else 'no'}")
    return '\n'.join(lines) + '\n'


def write_report(out: Path, results: list[ClipResult], summary: dict, settings: dict) -> None:
    payload = {'generated_at': datetime.now(timezone.utc).isoformat(), 'settings': settings,
               'summary': summary, 'clips': [result.as_dict() for result in results]}
    (out / 'report.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    (out / 'report.md').write_text(markdown_report(results, summary), encoding='utf-8')
