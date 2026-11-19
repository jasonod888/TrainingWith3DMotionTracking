"""CPU MediaPipe Pose Landmarker (heavy) inference for one normalised clip.

This is the inference entry point for the ``body-mediapipe-v1`` pipeline. It is
deliberately separate from ``process_video.py`` (SAM 3D Body + CUDA):

* CPU only, one person, ``VIDEO`` running mode with ``pose_landmarker_heavy.task``.
* ``output_segmentation_masks=True``: the model's own probability masks are the
  segmentation this route uses, so no SAM 2 checkpoint or prompt is involved.
* No MHR parameters, no GLB export and no Mixamo retarget. The route is video-only.

One authoritative clock
-----------------------
Every frame is driven by a timestamp probed from the normalised ``preview.mp4``
presentation timestamps. The clock is zero based, strictly increasing and verified
to be constant-frame-rate within 2 ms. MediaPipe receives strictly increasing
integer milliseconds; the stored ``timestamps`` keep the full float precision.

Missing-data contract
---------------------
A landmark the model could not return is stored as a finite zero placeholder with
``0.0`` visibility. Nothing is NaN, so every JSON document stays valid with
``allow_nan=False``, and a placeholder can never be scored: the frontend gates on
``visibility`` and the reference is rejected unless usable scoring poses cover
>= 95% of frames with no continuous pose gap longer than 0.5 s.

Usage:
    python scripts/process_video_mediapipe.py preview.mp4 --output outputs/job/motion \
        --model models/pose_landmarker_heavy.task
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]

ENGINE = 'mediapipe'
ENGINE_VERSION = 'mediapipe-pose-heavy-v1'
LANDMARK_FORMAT = 'mediapipe-33'
MODEL_NAME = 'pose_landmarker_heavy.task'
DEFAULT_MODEL = ROOT / 'models' / MODEL_NAME

# Reference acceptance. A rejected pose contract fails the conversion instead of
# publishing a reference the scorer would silently treat as poor movement.
MIN_POSE_COVERAGE = .95
MIN_MASK_COVERAGE = .95
MAX_GAP_SECONDS = .5
# Marker presentation threshold (0.55) is intentionally separate from scoring.
MARKER_VISIBILITY = .55
# Scoring requires 0.60, matching web/dist/pose.js.
SCORING_VISIBILITY = .60
STANDING_VISIBILITY = .65
# pose.js scoring triples; a frame is usable when at least 6 of the 8 are confident.
SCORING_ANGLES = ((11, 13, 15), (12, 14, 16), (13, 11, 23), (14, 12, 24),
                  (11, 23, 25), (12, 24, 26), (23, 25, 27), (24, 26, 28))
STANDING_CORE = (0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32)
LEGACY_SAM_MARKER_NOTE = 'hip-relative world landmarks in metres, x-right/y-down/z-forward'
# Alias used in the provenance document; the axes match the SAM route.
WORLD_LANDMARK_NOTE = LEGACY_SAM_MARKER_NOTE


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def rational(value):
    """Parse ``num/den`` or a plain number into a finite positive float.

    Anything unusable (``0/0``, ``N/A``, negative, NaN, infinite) returns ``None``
    so the caller can reject the clip instead of guessing a frame rate.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    text = str(value).strip()
    if not text or text in ('0/0', '0', 'N/A', 'nan'):
        return None
    try:
        if '/' in text:
            numerator, denominator = text.split('/', 1)
            numerator, denominator = float(numerator), float(denominator)
            if denominator == 0:
                return None
            number = numerator / denominator
        else:
            number = float(text)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def probe_video(path):
    """Stream metadata needed to normalise: size, rotation, duration and rate."""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=width,height,avg_frame_rate,r_frame_rate,duration,start_time:stream_tags=rotate'
         ':stream_side_data=rotation:format=duration,format_name', '-of', 'json', str(path)],
        capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise ValueError('The uploaded video cannot be probed.')
    metadata = json.loads(result.stdout or '{}')
    streams = metadata.get('streams') or []
    if not streams:
        raise ValueError('The uploaded video has no video stream.')
    stream = streams[0]
    width, height = int(stream.get('width') or 0), int(stream.get('height') or 0)
    if width <= 0 or height <= 0:
        raise ValueError('The uploaded video has invalid dimensions.')
    rotation = 0
    for side in stream.get('side_data_list') or []:
        if 'rotation' in side:
            rotation = int(round(float(side['rotation'])))
    tags = stream.get('tags') or {}
    if not rotation and tags.get('rotate'):
        rotation = int(round(float(tags['rotate'])))
    # A phone clip stores landscape pixels plus a 90/270 display rotation. The
    # ceiling is applied to what a person sees, not to the coded frame.
    display_width, display_height = (height, width) if abs(rotation) % 180 == 90 else (width, height)
    duration = rational(stream.get('duration')) or rational((metadata.get('format') or {}).get('duration'))
    source_fps = rational(stream.get('avg_frame_rate')) or rational(stream.get('r_frame_rate'))
    if duration is None:
        raise ValueError('The uploaded video has no usable duration.')
    if source_fps is None:
        raise ValueError('The uploaded video has unusable frame-rate metadata.')
    return {'width': width, 'height': height, 'display_width': display_width,
            'display_height': display_height, 'rotation': rotation,
            'duration': duration, 'source_fps': source_fps,
            'container': (metadata.get('format') or {}).get('format_name', '')}


def target_frame_rate(source_fps):
    """Cap at 30 fps without upsampling a lower or fractional source rate."""
    if source_fps is None or not math.isfinite(source_fps) or source_fps <= 0:
        raise ValueError('The uploaded video has an unusable frame rate.')
    return float(source_fps) if source_fps <= 30 else 30.0


def frame_rate_filter(value):
    """Render a validated numeric/rational rate for the FFmpeg ``fps`` filter."""
    if value is None or not math.isfinite(value) or value <= 0 or value > 30:
        raise ValueError('Frame rate must be a finite positive value at or below 30.')
    text = f'{value:.6f}'.rstrip('0').rstrip('.')
    return text or '30'


def normalized_clock(video):
    """One zero-based, strictly increasing, CFR-verified clock from the preview PTS."""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'frame=best_effort_timestamp_time', '-of', 'json', str(video)],
        capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise ValueError('The normalised clip has unreadable timestamps.')
    frames = json.loads(result.stdout or '{}').get('frames') or []
    values = []
    for frame in frames:
        stamp = frame.get('best_effort_timestamp_time')
        if stamp is None:
            continue
        try:
            values.append(float(stamp))
        except (TypeError, ValueError):
            raise ValueError('The normalised clip has a non-numeric timestamp.')
    if len(values) < 2:
        raise ValueError('The normalised clip does not expose a usable frame clock.')
    times = np.asarray(values, dtype=np.float64)
    if not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
        raise ValueError('Frame timestamps must be finite and strictly increasing.')
    times = times - times[0]
    if times[-1] <= 0:
        raise ValueError('The normalised clip has no duration.')
    fps = (len(times) - 1) / float(times[-1])
    # A normalised clip can never exceed 30 fps; the small tolerance only absorbs
    # float noise from a rational time base (30 or 30000/1001).
    if not np.isfinite(fps) or fps <= 0 or fps > 30 + 1e-3:
        raise ValueError('The normalised clip is not a usable rate at or below 30 fps.')
    expected = np.arange(len(times), dtype=np.float64) / fps
    if float(np.max(np.abs(times - expected))) > .002:
        raise ValueError('The normalised clip is not constant frame rate within 2 ms.')
    return times, float(fps)


def clock_milliseconds(times):
    """Strictly increasing integer milliseconds for MediaPipe's VIDEO API.

    The stored times keep float seconds; only the API value is quantised. A pair of
    frames that would round to the same millisecond is nudged forward so MediaPipe
    never receives a repeated or decreasing timestamp.
    """
    milliseconds = np.rint(np.asarray(times, dtype=np.float64) * 1000).astype(np.int64)
    milliseconds = milliseconds - milliseconds[0]
    for index in range(1, len(milliseconds)):
        if milliseconds[index] <= milliseconds[index - 1]:
            milliseconds[index] = milliseconds[index - 1] + 1
    if len(milliseconds) > 1 and milliseconds[-1] <= milliseconds[0]:
        raise ValueError('Frame timestamps collapse into one millisecond.')
    return milliseconds


def playback_duration(times, frame_rate, probed_duration=None):
    """Playback end: last frame start plus one display interval.

    ``times`` remains exact zero-based frame starts; the duration shown to the
    player/section clock includes the final frame's display interval.
    """
    if not len(times):
        return float(probed_duration or 0.0)
    rate = float(frame_rate) if frame_rate and math.isfinite(float(frame_rate)) and frame_rate > 0 else None
    if rate is not None:
        return float(times[-1]) + 1.0 / rate
    if probed_duration and math.isfinite(float(probed_duration)) and probed_duration > 0:
        return float(probed_duration)
    return float(times[-1])


def empty_landmarks():
    """Finite zero placeholders with 0.0 visibility: never NaN, never scorable."""
    return (np.zeros((33, 3), dtype=np.float32),
            np.zeros((33, 2), dtype=np.float32),
            np.zeros(33, dtype=np.float32))


def usable_scoring_pose(world, visibility):
    """At least 6 of the 8 scoring angles have confident, finite landmarks."""
    usable = 0
    for a, b, c in SCORING_ANGLES:
        if min(visibility[a], visibility[b], visibility[c]) < SCORING_VISIBILITY:
            continue
        if not np.isfinite(world[[a, b, c]]).all():
            continue
        usable += 1
    return usable >= 6


def longest_gap(times, usable):
    """Longest continuous run of unusable frames, measured in seconds."""
    longest = 0.0
    start = None
    for index, value in enumerate(usable):
        if value:
            if start is not None:
                before = times[start - 1] if start else times[0]
                longest = max(longest, float(times[index] - before))
                start = None
        elif start is None:
            start = index
    if start is not None:
        before = times[start - 1] if start else times[0]
        longest = max(longest, float(times[-1] - before))
    return longest


def pose_reference_contract(times, usable):
    """Pose-quality contract, independent of matte/derivative quality."""
    coverage = float(sum(usable)) / max(len(usable), 1)
    gap = longest_gap(times, usable)
    acceptable = coverage >= MIN_POSE_COVERAGE - 1e-9 and gap <= MAX_GAP_SECONDS + 1e-9
    return {'acceptable': acceptable, 'coverage': coverage, 'gap_seconds': gap,
            'reason': None if acceptable else ('coverage' if coverage < MIN_POSE_COVERAGE - 1e-9 else 'gap')}


def segmentation_contract(times, mask_frames, observed, repaired_frames=0):
    """Complete observed matte contract.

    Until a validated motion-aligned repair exists, any unrepaired gap (including a
    single leading/interior/trailing frame) disables focused/alpha derivatives. A
    repaired frame, if ever added, can never count as observed.
    """
    total = len(times)
    observed = list(observed)
    coverage = float(mask_frames) / max(total, 1)
    gap = longest_gap(times, observed) if total else 0.0
    complete = (total > 0 and mask_frames == total and len(observed) == total
                and all(observed) and repaired_frames == 0)
    return {'available': complete, 'coverage': coverage, 'gap_seconds': gap,
            'observed_frames': int(sum(1 for value in observed if value)),
            'repaired_frames': int(repaired_frames),
            'policy': 'complete-observed-matte-required',
            'reason': None if complete else 'unrepaired_matte_gap'}


def _angle(a, b, c):
    u = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    v = np.asarray(c, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    denominator = float(np.linalg.norm(u) * np.linalg.norm(v))
    if denominator <= 1e-9:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(np.dot(u, v) / denominator, -1.0, 1.0))))


def standing_frame(world, image, visibility, times, width, height):
    """First confident upright full-body frame, or ``None``.

    The rules mirror the client's standing assessment: confident core landmarks,
    the whole body inside a 2.5% margin, straight knees and hips, hips below the
    shoulders, facing the camera, and a plausible body height in frame. A crouch or
    an occluded frame is never reported as standing.
    """
    if width < 2 or height < 2:
        return None
    scale = np.array([width, height], dtype=np.float64)
    for index in range(len(times)):
        if float(np.min(visibility[index][list(STANDING_CORE)])) < STANDING_VISIBILITY:
            continue
        points = np.asarray(image[index], dtype=np.float64) / scale
        if not np.isfinite(points[list(STANDING_CORE)]).all():
            continue
        if np.any(points[list(STANDING_CORE)] < .025) or np.any(points[list(STANDING_CORE)] > .975):
            continue
        body = world[index]
        if not np.isfinite(body).all():
            continue
        if (_angle(body[23], body[25], body[27]) < 155 or _angle(body[24], body[26], body[28]) < 155
                or _angle(body[11], body[23], body[25]) < 155 or _angle(body[12], body[24], body[26]) < 155):
            continue
        shoulders = (points[11][1] + points[12][1]) / 2
        hips = (points[23][1] + points[24][1]) / 2
        shoulder_x = (points[11][0] + points[12][0]) / 2
        hip_x = (points[23][0] + points[24][0]) / 2
        if hips <= shoulders or abs(shoulder_x - hip_x) > (hips - shoulders) * .35:
            continue
        face = min(points[i][1] for i in range(9))
        crown = face - max(0.0, shoulders - face) * .35
        floor = max(points[i][1] for i in (27, 28, 29, 30, 31, 32))
        if crown < .015:
            continue
        if not .32 <= (floor - crown) <= .94:
            continue
        return index
    return None


def thumbnail_frame(world, image, visibility, times, width, height):
    """A confident, well-centred frame for the poster, chosen independently.

    Kept separate from the standing frame so a lesson without an upright pose still
    gets a useful thumbnail instead of a title frame.
    """
    center = (len(times) - 1) / 2
    best, best_score = 0, -1.0
    for index in range(len(times)):
        confident = int(np.count_nonzero(visibility[index] >= .5))
        finite = int(np.count_nonzero(np.isfinite(world[index]).all(axis=1)))
        score = confident + finite * .001 - abs(index - center) / max(len(times), 1) * .5
        if score > best_score:
            best, best_score = index, score
    return best


def mask_array(value):
    """Return a 2-D float probability array from a MediaPipe Image or an array.

    ``segmentation_masks`` entries are ``mp.Image`` objects in the Python Tasks API
    and plain arrays in tests, so both are accepted here.
    """
    view = value.numpy_view() if hasattr(value, 'numpy_view') else value
    array = np.asarray(view, dtype=np.float32)
    if array.ndim == 3:
        array = array[..., 0]
    if array.ndim != 2:
        raise ValueError('A segmentation mask must be two dimensional.')
    return array


def segment_mask(probability, width, height, previous=None):
    """Resize, change-gated EMA, light blur, threshold and elliptical closing.

    ``0.72 * prob + 0.28 * prev`` is used while the frame's probability stays close
    to the running value; a bigger change is a real silhouette change and replaces
    the estimate instead of being averaged into it. ``previous=None`` resets the
    filter after a discontinuity, so a gap never bleeds an old matte forward.
    """
    import cv2
    probability = np.asarray(probability, dtype=np.float32)
    if probability.ndim != 2:
        raise ValueError('A segmentation mask must be two dimensional.')
    resized = np.clip(cv2.resize(probability, (int(width), int(height)), interpolation=cv2.INTER_LINEAR), 0.0, 1.0)
    if previous is not None and previous.shape == resized.shape:
        changed = np.abs(resized - previous) >= .35
        ema = np.where(changed, resized, .72 * resized + .28 * previous).astype(np.float32)
    else:
        ema = resized
    smoothed = cv2.GaussianBlur(ema, (5, 5), 0)
    binary = (smoothed >= .5).astype(np.uint8) * 255
    size = max(3, min(15, int(round(height * .008)) | 1))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    return binary, ema


def _landmarker(model):
    """Create the CPU PoseLandmarker. Imported lazily so tests need no runtime."""
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except ImportError as exc:  # pragma: no cover - exercised only without the runtime
        raise RuntimeError('mediapipe is not installed for this interpreter; install the '
                           'CPU runtime or run the SAM route.') from exc
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        output_segmentation_masks=True,
        min_pose_detection_confidence=.5,
        min_pose_presence_confidence=.5,
        min_tracking_confidence=.5)
    return mp, vision.PoseLandmarker.create_from_options(options)


def _extract(result, width, height):
    """World metres, image pixels and min(visibility, presence) for one frame."""
    world, image, confidence = empty_landmarks()
    poses = getattr(result, 'pose_world_landmarks', None) or []
    normalized = getattr(result, 'pose_landmarks', None) or []
    if not poses or not normalized:
        return world, image, confidence
    for index in range(33):
        point = poses[0][index]
        world[index] = (float(point.x), float(point.y), float(point.z))
        visible = normalized[0][index]
        image[index] = (float(visible.x) * width, float(visible.y) * height)
        visibility = float(getattr(visible, 'visibility', 0.0) or 0.0)
        presence = float(getattr(visible, 'presence', 1.0) or 0.0)
        confidence[index] = max(0.0, min(1.0, min(visibility, presence)))
    if not np.isfinite(world).all() or not np.isfinite(image).all():
        return empty_landmarks()
    return world, image, confidence


def run(video, output, model=DEFAULT_MODEL, max_frames=0, landmarker=None):
    """Run checkpoint inference and write ``mediapipe.npz`` + ``mediapipe.json``."""
    import cv2

    video, output, model = Path(video), Path(output), Path(model)
    if not video.is_file():
        raise ValueError(f'Normalised clip does not exist: {video}')
    if landmarker is None and not model.is_file():
        raise ValueError(f'Missing {MODEL_NAME}. Run scripts/download_models.py --assets-only.')
    times, fps = normalized_clock(video)
    milliseconds = clock_milliseconds(times)
    created = None
    if landmarker is None:
        mp, landmarker = _landmarker(model)
        created = landmarker
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise ValueError('OpenCV could not decode the normalised clip.')
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    reported = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if width <= 0 or height <= 0 or reported != len(times):
        capture.release()
        raise ValueError('The normalised clip and its timestamp clock disagree on frame count.')
    if max_frames:
        times = times[:max_frames]
        milliseconds = milliseconds[:max_frames]
    total = len(times)

    world_frames, image_frames, visibility_frames = [], [], []
    segmentation_root = output / 'segmentation'
    masks_root = segmentation_root / 'masks'
    masks_root.mkdir(parents=True, exist_ok=True)
    mask_frames = 0
    observed = []
    previous_ema = None
    index = 0
    try:
        while index < total:
            ok, frame = capture.read()
            if not ok:
                raise ValueError('The normalised clip ended before its frame clock.')
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            if created is not None:
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            else:
                image = _Image(rgb)
            result = landmarker.detect_for_video(image, int(milliseconds[index]))
            world, points, confidence = _extract(result, width, height)
            world_frames.append(world)
            image_frames.append(points)
            visibility_frames.append(confidence)
            masks = getattr(result, 'segmentation_masks', None) or []
            mask = None
            if masks:
                mask, previous_ema = segment_mask(mask_array(masks[0]), width, height, previous_ema)
            else:
                previous_ema = None  # A gap is a discontinuity: never smooth across it.
            if mask is not None and np.count_nonzero(mask):
                cv2.imwrite(str(masks_root / f'{index:06d}.png'), mask)
                mask_frames += 1
                observed.append(True)
            else:
                previous_ema = None
                observed.append(False)
            printable = usable_scoring_pose(world, confidence)
            print(f'MediaPipe frame {index + 1}/{total} usable={int(printable)}', flush=True)
            index += 1
    finally:
        capture.release()
        if created is not None:
            created.close()

    world_array = np.stack(world_frames).astype(np.float32)
    image_array = np.stack(image_frames).astype(np.float32)
    visibility_array = np.stack(visibility_frames).astype(np.float32)
    if not (np.isfinite(world_array).all() and np.isfinite(image_array).all()
            and np.isfinite(visibility_array).all()):
        raise ValueError('Inference produced non-finite landmarks.')

    output.mkdir(parents=True, exist_ok=True)
    motion = output / 'mediapipe.npz'
    np.savez_compressed(motion, world_landmarks=world_array, image_landmarks=image_array,
                        visibility=visibility_array, timestamps=times.astype(np.float64),
                        frame_indices=np.arange(total, dtype=np.int64))

    usable = [usable_scoring_pose(world_array[i], visibility_array[i]) for i in range(total)]
    pose_contract = pose_reference_contract(times, usable)
    pose_coverage = pose_contract['coverage']
    pose_gap = pose_contract['gap_seconds']
    if not pose_contract['acceptable']:
        if pose_coverage < MIN_POSE_COVERAGE - 1e-9:
            raise ValueError(f'Usable scoring poses cover {pose_coverage:.1%} of frames; at least 95% is required.')
        raise ValueError(f'A pose gap of {pose_gap:.2f}s exceeds the 0.5s limit.')

    segmentation = segmentation_contract(times, mask_frames, observed, repaired_frames=0)
    mask_coverage = segmentation['coverage']
    mask_gap = segmentation['gap_seconds']
    segmentation_available = segmentation['available']
    motion_hash = digest(motion)
    video_hash = digest(video)
    if segmentation_available:
        (segmentation_root / 'data.json').write_text(json.dumps({
            'schema': 1, 'version': 'mediapipe-segmentation-v1',
            'video_sha256': video_hash, 'motion_sha256': motion_hash,
            'width': width, 'height': height, 'times': times.round(6).tolist(),
            'frames': total, 'mask_frames': mask_frames,
            'source': 'mediapipe-pose-heavy-probability',
            'smoothing': {'mode': 'change-gated-ema', 'previous_weight': .28, 'gate': .35,
                          'blur': 5, 'threshold': .5, 'closing': 'ellipse'},
        }, indent=2, allow_nan=False), encoding='utf-8')
    else:
        # The mask contract is not met; keep the wide clip as the instructor
        # presentation instead of publishing a person video that can vanish.
        for path in masks_root.glob('*.png'):
            path.unlink(missing_ok=True)
        masks_root.rmdir()
        segmentation_root.rmdir()

    standing = standing_frame(world_array, image_array, visibility_array, times, width, height)
    thumbnail = thumbnail_frame(world_array, image_array, visibility_array, times, width, height)
    report = {
        'schema_version': 1, 'engine': ENGINE, 'engine_version': ENGINE_VERSION,
        'model': MODEL_NAME, 'model_sha256': digest(model) if model.is_file() else None,
        'landmark_format': LANDMARK_FORMAT, 'root_motion': 'hip-relative',
        'coordinates': {'world_landmarks': WORLD_LANDMARK_NOTE,
                        'image_landmarks': 'pixels in the normalised preview',
                        'visibility': 'min(visibility, presence), 0.0 when unavailable'},
        'video_sha256': video_hash, 'motion_sha256': motion_hash,
        'width': width, 'height': height, 'frames': total, 'frame_rate': fps,
        'duration': playback_duration(times, fps),
        'scoring_coverage': pose_coverage, 'pose_gap_seconds': pose_gap,
        'mask_coverage': mask_coverage, 'mask_gap_seconds': mask_gap,
        'segmentation': {'available': segmentation_available, 'mask_frames': mask_frames,
                         'observed_frames': segmentation['observed_frames'],
                         'repaired_frames': segmentation['repaired_frames'],
                         'policy': segmentation['policy'], 'reason': segmentation['reason'],
                         'path': 'segmentation' if segmentation_available else None},
        'derivatives': {'focused': segmentation_available, 'alpha': segmentation_available,
                        'reason': None if segmentation_available else 'unrepaired_matte_gap'},
        'standing_index': standing, 'thumbnail_index': thumbnail,
        'thresholds': {'min_pose_coverage': MIN_POSE_COVERAGE, 'min_mask_coverage': MIN_MASK_COVERAGE,
                       'max_gap_seconds': MAX_GAP_SECONDS, 'scoring_visibility': SCORING_VISIBILITY,
                       'marker_visibility': MARKER_VISIBILITY,
                       'standing_visibility': STANDING_VISIBILITY},
        'limitations': ('Single-person CPU pose estimate. World landmarks are hip-relative metres '
                        'with no validated world trajectory or foot-contact solver.'),
    }
    (output / 'mediapipe.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    return report


class _Image:
    """Minimal stand-in for ``mp.Image`` when a test injects its own landmarker."""

    def __init__(self, rgb):
        self.rgb = rgb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    parser.add_argument('--max-frames', type=int, default=0)
    args = parser.parse_args()
    if args.max_frames < 0:
        parser.error('--max-frames must be nonnegative.')
    report = run(args.video, args.output, args.model, args.max_frames)
    print(json.dumps({key: value for key, value in report.items() if key != 'coordinates'}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
