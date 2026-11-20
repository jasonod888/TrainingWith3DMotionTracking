"""CPU MediaPipe route: clock, segmentation, missing-data contract and markers.

No model is downloaded and no runtime dependency is required: the inference test
injects a fake PoseLandmarker, so the real ``mediapipe`` package is only needed to
run the pipeline for actual clips.
"""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from process_video_mediapipe import (
    MAX_GAP_SECONDS, MIN_MASK_COVERAGE, MIN_POSE_COVERAGE, clock_milliseconds, frame_rate_filter,
    longest_gap, rational, segment_mask, standing_frame, target_frame_rate, thumbnail_frame,
    usable_scoring_pose,
)
from focus_instructor_video import (
    FLOW_MAX_HEIGHT, digest, limb_markers, load_landmarks, marker_source, reduce_gray,
    scale_flow, warp_previous,
)

FIGURE = {0: (.5, .18), 1: (.5, .18), 2: (.5, .18), 3: (.5, .18), 4: (.5, .18),
          5: (.5, .18), 6: (.5, .18), 7: (.5, .18), 8: (.5, .18),
          11: (.4, .3), 12: (.6, .3), 23: (.45, .55), 24: (.55, .55),
          25: (.45, .72), 26: (.55, .72), 27: (.45, .87), 28: (.55, .87),
          29: (.45, .88), 30: (.55, .88), 31: (.44, .9), 32: (.56, .9)}


def upright_figure(visibility=1.0):
    """A 33-landmark upright figure in normalized image coordinates and metres."""
    image = np.full((33, 2), .5, dtype=np.float32)
    world = np.zeros((33, 3), dtype=np.float32)
    for index, (u, v) in FIGURE.items():
        image[index] = (u, v)
        world[index] = ((u - .5) * 2, (v - .5) * 2, 0.)
    return image, world, np.full(33, visibility, dtype=np.float32)


# --------------------------------------------------------------------- clock / rates

def test_rational_parses_fractions_and_rejects_unusable_metadata():
    assert rational('30000/1001') == pytest.approx(29.97002997)
    assert rational('25') == pytest.approx(25)
    assert rational(29.97) == pytest.approx(29.97)
    for value in (None, '0/0', 'N/A', '0', '-30', '1/0', float('nan'), float('inf')):
        assert rational(value) is None
    assert target_frame_rate(23.976) == pytest.approx(23.976)
    assert target_frame_rate(25) == 25
    assert target_frame_rate(59.94) == 30
    with pytest.raises(ValueError):
        target_frame_rate(0)
    assert frame_rate_filter(29.97) == '29.97'
    assert frame_rate_filter(30) == '30'
    assert frame_rate_filter(23.976) == '23.976'
    for value in (0, 30.5, float('nan')):
        with pytest.raises(ValueError):
            frame_rate_filter(value)


def test_clock_milliseconds_are_strictly_increasing_and_zero_based():
    times = np.arange(16, dtype=np.float64) / 29.97
    milliseconds = clock_milliseconds(times)
    assert milliseconds[0] == 0
    assert np.all(np.diff(milliseconds) > 0)
    # The float clock is preserved for storage; only the API value is quantised.
    assert times[1] == pytest.approx(1 / 29.97)
    # A pair that would round to the same millisecond is nudged forward, never repeated.
    slow = np.array([0., .0004, .0008])
    nudged = clock_milliseconds(slow)
    assert list(nudged) == [0, 1, 2]


# ------------------------------------------------------------------- flow rescaling

def test_scale_flow_rescales_reduced_vectors_to_full_resolution():
    # A reduced 1x2 grid is spatially resized to 2x4 and each vector is then
    # multiplied by (4/2, 2/1). Constant vectors keep the expected values exact
    # without relying on interpolation weights.
    flow = np.full((1, 2, 2), [1., 1.], dtype=np.float32)
    scaled = scale_flow(flow, width=4, height=2, flow_w=2, flow_h=1)
    assert scaled.shape == (2, 4, 2)
    assert np.allclose(scaled, 2.0)


def test_reduce_gray_caps_farneback_height():
    pytest.importorskip('cv2')
    tall = np.zeros((960, 640), dtype=np.uint8)
    reduced, flow_w, flow_h = reduce_gray(tall)
    assert flow_h == FLOW_MAX_HEIGHT == 480
    assert flow_w == 320
    assert reduced.shape == (480, 320)
    small = np.zeros((120, 80), dtype=np.uint8)
    same, width, height = reduce_gray(small)
    assert same is small and (width, height) == (80, 120)


def test_warp_previous_compensates_crop_movement():
    cv2 = pytest.importorskip('cv2')
    frame = np.zeros((96, 128), dtype=np.uint8)
    alpha = np.tile(np.arange(128, dtype=np.float32), (96, 1))
    previous = {'gray': frame, 'alpha': alpha}
    shifted = warp_previous(previous, frame, offset=(4, 0))
    # Identical frames give zero flow, so the crop origin shift alone drives sampling.
    assert np.allclose(shifted[:, :-4], alpha[:, 4:], atol=1e-2)
    unshifted = warp_previous(previous, frame, offset=(0, 0))
    assert np.allclose(unshifted, alpha, atol=1e-2)
    assert cv2 is not None


# --------------------------------------------------------------------- segmentation

def test_segment_mask_uses_a_change_gated_ema():
    import cv2
    blank = np.zeros((32, 32), dtype=np.float32)
    first, ema = segment_mask(np.full((32, 32), .5, dtype=np.float32), 32, 32, None)
    assert first.shape == (32, 32)
    assert np.allclose(ema, .5, atol=1e-6)
    previous = np.full((32, 32), .4, dtype=np.float32)
    _, near = segment_mask(np.full((32, 32), .5, dtype=np.float32), 32, 32, previous)
    assert np.allclose(near, .72 * .5 + .28 * .4, atol=1e-6)
    _, far = segment_mask(np.full((32, 32), .8, dtype=np.float32), 32, 32, previous)
    assert np.allclose(far, .8, atol=1e-6)
    binary, _ = segment_mask(np.full((32, 32), .9, dtype=np.float32), 32, 32, previous)
    assert binary.dtype == np.uint8 and binary.max() == 255
    assert cv2 is not None


# ---------------------------------------------------------------- missing-data contract

def test_longest_gap_boundary_is_one_half_second():
    times = np.arange(7) * .1
    assert longest_gap(times, [True, True, False, False, False, False, True]) == pytest.approx(.5)
    longer = np.arange(8) * .1
    assert longest_gap(longer, [True, True, False, False, False, False, False, True]) > MAX_GAP_SECONDS
    assert longest_gap(times, [True] * 7) == 0.0


def test_usable_scoring_pose_requires_six_confident_angles():
    _, world, visibility = upright_figure()
    assert usable_scoring_pose(world, visibility) is True
    hidden = visibility.copy()
    hidden[[15, 16]] = 0.
    assert usable_scoring_pose(world, hidden) is True  # six angles remain
    hidden[[13, 14]] = 0.
    assert usable_scoring_pose(world, hidden) is False
    assert usable_scoring_pose(world, np.zeros(33, dtype=np.float32)) is False


def test_standing_frame_rejects_a_crouch_and_keeps_the_poster_separate():
    image, world, visibility = upright_figure()
    width, height = 640, 480
    # `standing_frame` receives image landmarks in source pixels, exactly as the
    # worker stores them; `upright_figure` builds normalized coordinates.
    pixels = image * np.array([width, height], dtype=np.float32)
    one = np.array([0.])
    stacked = lambda value: value[None]  # noqa: E731
    assert standing_frame(stacked(world), stacked(pixels), stacked(visibility), one, width, height) == 0
    crouched = world.copy()
    crouched[25] = (-.1 + .6, .1, 0.)
    assert standing_frame(stacked(crouched), stacked(pixels), stacked(visibility), one, width, height) is None
    occluded = visibility.copy()
    occluded[27] = .1
    assert standing_frame(stacked(world), stacked(pixels), stacked(occluded), one, width, height) is None
    # The poster is chosen independently and prefers the confident frame.
    two = np.array([0., .1])
    weak = np.vstack([visibility * .2, visibility])
    assert thumbnail_frame(np.stack([world, world]), np.stack([pixels, pixels]), weak, two, width, height) == 1


# ------------------------------------------------------------------------ inference

@pytest.fixture
def clip(tmp_path):
    pytest.importorskip('cv2')
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg unavailable')
    video = tmp_path / 'preview.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                    'color=c=gray:s=320x240:r=15:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart', str(video)], check=True)
    return video


class _Landmark:
    def __init__(self, x, y, z=0., visibility=1., presence=1.):
        self.x, self.y, self.z = float(x), float(y), float(z)
        self.visibility, self.presence = float(visibility), float(presence)


class _Result:
    def __init__(self, posed, masked):
        image, world, visibility = upright_figure()
        if posed:
            self.pose_landmarks = [[_Landmark(image[i][0], image[i][1], 0., visibility[i], visibility[i])
                                    for i in range(33)]]
            self.pose_world_landmarks = [[_Landmark(world[i][0], world[i][1], world[i][2])
                                          for i in range(33)]]
        else:
            self.pose_landmarks = []
            self.pose_world_landmarks = []
        if masked:
            mask = np.zeros((256, 256), dtype=np.float32)
            mask[40:220, 90:170] = 1.
            self.segmentation_masks = [mask]
        else:
            self.segmentation_masks = []


class FakeLandmarker:
    """Records the API milliseconds and returns per-frame synthetic detections."""

    def __init__(self, posed=lambda index: True, masked=lambda index: True):
        self.posed, self.masked = posed, masked
        self.milliseconds = []
        self.closed = False

    def detect_for_video(self, image, milliseconds):
        self.milliseconds.append(int(milliseconds))
        index = len(self.milliseconds) - 1
        return _Result(self.posed(index), self.masked(index))

    def close(self):
        self.closed = True


def test_run_writes_the_landmark_and_segmentation_contract(clip, tmp_path):
    from process_video_mediapipe import run
    landmarker = FakeLandmarker()
    report = run(clip, tmp_path / 'motion', landmarker=landmarker)
    motion = tmp_path / 'motion' / 'mediapipe.npz'
    with np.load(motion) as data:
        assert data['world_landmarks'].shape == (15, 33, 3)
        assert data['image_landmarks'].shape == (15, 33, 2)
        assert data['visibility'].shape == (15, 33)
        assert data['timestamps'].shape == (15,)
        assert np.all(np.diff(data['timestamps']) > 0)
        stored_times = data['timestamps'].round(6).tolist()
    assert landmarker.closed is True
    assert np.all(np.diff(landmarker.milliseconds) > 0)
    assert report['engine'] == 'mediapipe'
    assert report['engine_version'] == 'mediapipe-pose-heavy-v1'
    assert report['landmark_format'] == 'mediapipe-33'
    assert report['root_motion'] == 'hip-relative'
    assert report['frame_rate'] == pytest.approx(15, abs=1e-5)
    assert report['scoring_coverage'] == 1.0
    assert report['segmentation']['available'] is True
    segmentation = tmp_path / 'motion' / 'segmentation'
    metadata = json.loads((segmentation / 'data.json').read_text())
    assert metadata['motion_sha256'] == digest(motion)
    assert metadata['video_sha256'] == digest(clip)
    assert metadata['times'] == pytest.approx(stored_times)
    assert len(list((segmentation / 'masks').glob('*.png'))) == 15
    # The stored JSON must stay valid with allow_nan=False.
    for path in (tmp_path / 'motion' / 'mediapipe.json', segmentation / 'data.json'):
        assert 'NaN' not in path.read_text()


def test_run_rejects_insufficient_pose_coverage(clip, tmp_path):
    from process_video_mediapipe import run
    assert MIN_POSE_COVERAGE == .95
    with pytest.raises(ValueError, match='95%'):
        run(clip, tmp_path / 'motion', landmarker=FakeLandmarker(posed=lambda index: index < 6))


def test_run_rejects_a_pose_gap_longer_than_half_a_second(clip, tmp_path):
    from process_video_mediapipe import run
    # Frames 6..14 are missing: 0.6 s at 15 fps, past the documented limit.
    with pytest.raises(ValueError, match='gap|95%'):
        run(clip, tmp_path / 'motion', landmarker=FakeLandmarker(posed=lambda index: index < 6))


def test_run_drops_segmentation_instead_of_publishing_a_person_video(clip, tmp_path):
    from process_video_mediapipe import run
    report = run(clip, tmp_path / 'motion', landmarker=FakeLandmarker(masked=lambda index: index < 6))
    assert report['mask_coverage'] < MIN_MASK_COVERAGE
    assert report['segmentation']['available'] is False
    assert not (tmp_path / 'motion' / 'segmentation').exists()
    # The landmarks still exist, so the lesson keeps its wide video.
    assert (tmp_path / 'motion' / 'mediapipe.npz').is_file()


# --------------------------------------------------------------------------- markers

def test_load_landmarks_validates_the_mediapipe_keys_and_shapes(tmp_path):
    good = tmp_path / 'good.npz'
    np.savez(good, image_landmarks=np.zeros((2, 33, 2)), visibility=np.zeros((2, 33)),
             timestamps=np.array([0., .1]), frame_indices=np.array([0, 1]),
             world_landmarks=np.zeros((2, 33, 3)))
    points, visibility, times, indices = load_landmarks(good, 'mediapipe-33')
    assert points.shape == (2, 33, 2) and visibility.shape == (2, 33)
    assert list(times) == [0., .1] and list(indices) == [0, 1]
    partial = tmp_path / 'partial.npz'
    np.savez(partial, image_landmarks=np.zeros((2, 33, 2)), timestamps=np.array([0., .1]),
             frame_indices=np.array([0, 1]))
    with pytest.raises(ValueError, match='visibility'):
        load_landmarks(partial, 'mediapipe-33')
    with pytest.raises(ValueError):
        load_landmarks(good, 'unknown-format')


def test_mediapipe_markers_use_wrists_feet_and_the_ankle_fallback():
    points = np.full((33, 2), -1.0)
    points[15] = (50, 60)
    points[16] = (70, 60)
    points[31] = (54, 90)
    points[32] = (66, 90)
    points[27] = (53, 88)
    points[28] = (67, 88)
    visibility = np.full(33, 1.0)
    mask = np.zeros((300, 200), dtype=np.uint8)
    mask[40:100, 40:80] = 255
    crop = (0, 0, 200, 300)
    markers = limb_markers(points, crop, mask, 'mediapipe-33', visibility)
    assert markers[0] == [round(50 / 200, 6), round(60 / 300, 6)]
    assert markers[1] == [round(70 / 200, 6), round(60 / 300, 6)]
    assert marker_source('mediapipe-33') == 'mediapipe-pose-heavy-image'
    # A hidden foot tip falls back to the ankle when the ankle is confident.
    hidden = visibility.copy()
    hidden[31] = .2
    fallback = limb_markers(points, crop, mask, 'mediapipe-33', hidden)
    assert fallback[2] == [round(53 / 200, 6), round(88 / 300, 6)]
    hidden[27] = .2
    assert limb_markers(points, crop, mask, 'mediapipe-33', hidden)[2] is None
    # A landmark outside the crop or without mask support is never emitted.
    outside = points.copy()
    outside[15] = (500, 500)
    assert limb_markers(outside, crop, mask, 'mediapipe-33', visibility)[0] is None
    assert limb_markers(points, crop, np.zeros((300, 200), dtype=np.uint8), 'mediapipe-33', visibility) == [None] * 4


def test_sam_markers_keep_the_mhr70_mapping():
    points = np.full((70, 2), -1.0)
    points[62] = (40, 50)
    points[41] = (60, 50)
    points[15:18] = (30, 200)
    points[18:21] = (70, 200)
    mask = np.full((300, 200), 255, dtype=np.uint8)
    markers = limb_markers(points, (0, 0, 200, 300), mask)
    assert markers == [[round(40 / 200, 6), round(50 / 300, 6)],
                       [round(60 / 200, 6), round(50 / 300, 6)],
                       [round(30 / 200, 6), round(200 / 300, 6)],
                       [round(70 / 200, 6), round(200 / 300, 6)]]
    assert marker_source('sam-3d-body') == 'sam-3d-body-mhr70-image'
    # Short rows still return four empty markers rather than raising.
    assert limb_markers(np.zeros((10, 2)), (0, 0, 10, 10), mask) == [None] * 4


# ------------------------------------------------------- instructor composition

def mediapipe_job(tmp_path, count=10):
    folder = tmp_path / 'job'
    (folder / 'motion').mkdir(parents=True)
    (folder / 'preview.mp4').write_bytes(b'normalised source')
    times = (np.arange(count) / 25).tolist()
    np.savez(folder / 'motion' / 'mediapipe.npz', timestamps=np.array(times),
             frame_indices=np.arange(count), image_landmarks=np.zeros((count, 33, 2)),
             visibility=np.zeros((count, 33)), world_landmarks=np.zeros((count, 33, 3)))
    root = folder / 'motion' / 'segmentation'
    (root / 'masks').mkdir(parents=True)
    (root / 'data.json').write_text(json.dumps({
        'video_sha256': digest(folder / 'preview.mp4'),
        'motion_sha256': digest(folder / 'motion' / 'mediapipe.npz'),
        'times': times, 'frames': count, 'width': 320, 'height': 240}))
    for index in range(count):
        (root / 'masks' / f'{index:06d}.png').write_bytes(b'mask')
    return folder, root


def test_prepare_mediapipe_instructor_feeds_the_mediapipe_arrays(tmp_path):
    from instructor_pipeline import prepare_mediapipe_instructor
    folder, segmentation = mediapipe_job(tmp_path)
    calls = []

    def command(args, timeout):
        calls.append(args)
        output = Path(args[args.index('--output') + 1])
        output.write_bytes(b'person video')
        output.with_suffix('.json').write_text(json.dumps({
            'video_sha256': digest(output),
            'edge_treatment': {'style': 'outlined', 'body_opacity': 1},
            'landmark_format': 'mediapipe-33'}))

    result = prepare_mediapipe_instructor(folder, command, .4)
    assert result == folder / 'instructor.mp4'
    args = calls[0]
    assert args[args.index('--motion') + 1] == str(folder / 'motion/mediapipe.npz')
    assert args[args.index('--masks') + 1] == str(segmentation)
    assert args[args.index('--landmark-format') + 1] == 'mediapipe-33'
    assert '--alpha' in args
    # No SAM 2 segmentation was requested for this route.
    assert not any('build_foot_mask_experiment.py' in str(arg) for arg in args)


def test_prepare_mediapipe_instructor_rejects_a_non_mediapipe_report(tmp_path):
    from instructor_pipeline import prepare_mediapipe_instructor
    folder, _ = mediapipe_job(tmp_path)

    def command(args, timeout):
        output = Path(args[args.index('--output') + 1])
        output.write_bytes(b'person video')
        output.with_suffix('.json').write_text(json.dumps({
            'video_sha256': digest(output),
            'edge_treatment': {'style': 'outlined', 'body_opacity': 1},
            'landmark_format': 'sam-3d-body'}))

    with pytest.raises(ValueError, match='approved treatment'):
        prepare_mediapipe_instructor(folder, command, .4)
