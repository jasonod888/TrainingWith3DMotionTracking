"""The CPU MediaPipe worker path: video-only completion with no GLB or avatars.

The worker is driven with a fake API and a fake command runner, so no ffmpeg, model
or network is needed. The assertions are about the exact completion contract the
server enforces for ``body-mediapipe-v1``.
"""
import json

import numpy as np
import pytest

import process_video_mediapipe as mediapipe
import saas_worker


class FakeResponse:
    def __init__(self, payload=None):
        self.payload = payload or {}

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeApi:
    def __init__(self):
        self.files = []
        self.posts = []

    def put(self, url, headers=None, content=None):
        self.files.append(url)
        return FakeResponse({'key': url, 'mime': 'application/octet-stream', 'bytes': 1, 'sha256': 'a' * 64})

    def post(self, url, headers=None, json=None):
        self.posts.append((url, json))
        return FakeResponse({'lesson_id': 'lesson-1'})


def sample_job():
    return {'id': 'a' * 32, 'attempt_token': 'b' * 32, 'title': 'CPU move', 'start': 0.0,
            'duration': 2.0, 'pipeline_version': saas_worker.MEDIAPIPE_PIPELINE_VERSION}


@pytest.fixture
def harness(tmp_path, monkeypatch):
    folder = tmp_path / 'job'
    folder.mkdir()
    source = folder / 'input.bin'
    source.write_bytes(b'source')
    times = np.arange(5, dtype=np.float64) / 25.0
    monkeypatch.setattr(mediapipe, 'probe_video', lambda path: {
        'width': 1920, 'height': 1080, 'display_width': 1920, 'display_height': 1080,
        'rotation': 0, 'duration': 2.0, 'source_fps': 25.0, 'container': 'mov,mp4'})
    monkeypatch.setattr(mediapipe, 'normalized_clock', lambda path: (times, 25.0))
    calls = []

    def command(args, timeout=240, progress=None):
        text = ' '.join(str(value) for value in args)
        calls.append(text)
        if 'preview.mp4' in text and 'scale=w=' in text:
            (folder / 'preview.mp4').write_bytes(b'normalised preview')
        elif 'process_video_mediapipe.py' in text:
            motion = folder / 'motion'
            motion.mkdir(parents=True, exist_ok=True)
            count = len(times)
            np.savez(motion / 'mediapipe.npz',
                     world_landmarks=np.zeros((count, 33, 3), dtype=np.float32),
                     image_landmarks=np.zeros((count, 33, 2), dtype=np.float32),
                     visibility=np.zeros((count, 33), dtype=np.float32),
                     timestamps=times, frame_indices=np.arange(count, dtype=np.int64))
            (motion / 'mediapipe.json').write_text(json.dumps({'segmentation': {'available': False}}))
        elif 'thumbnail.jpg' in text:
            (folder / 'thumbnail.jpg').write_bytes(b'jpeg')

    worker = saas_worker.Worker('http://127.0.0.1:8001', 'token')
    api = FakeApi()
    worker.api = api
    state = {'stage': 'validating', 'frames': 0}

    def advance(value):
        state['stage'] = value

    return {'folder': folder, 'source': source, 'times': times, 'command': command,
            'worker': worker, 'api': api, 'advance': advance, 'state': state, 'calls': calls}


def run_mediapipe(harness, monkeypatch, standing=None, poster=None):
    if standing is not None:
        monkeypatch.setattr(mediapipe, 'standing_frame', lambda *args: standing)
    if poster is not None:
        monkeypatch.setattr(mediapipe, 'thumbnail_frame', lambda *args: poster)
    harness['worker'].run_mediapipe(sample_job(), harness['folder'], harness['command'],
                                    lambda: None, harness['advance'], harness['state'],
                                    {'X-Job-Lease': 'b' * 32}, '/api/worker/jobs/' + 'a' * 32,
                                    harness['source'])
    finish = [payload for url, payload in harness['api'].posts if url.endswith('/finish')]
    assert len(finish) == 1
    return finish[0]


def test_mediapipe_finish_is_video_only_and_skips_glb_and_avatars(harness, monkeypatch):
    manifest = run_mediapipe(harness, monkeypatch, standing=2, poster=1)
    assert manifest['engine'] == 'mediapipe'
    assert manifest['engine_version'] == 'mediapipe-pose-heavy-v1'
    assert manifest['animation'] is None
    assert manifest['root_motion'] == 'hip-relative'
    assert manifest['frame_rate'] == pytest.approx(25.0)
    assert manifest['standing_time'] == pytest.approx(harness['times'][2])
    assert manifest['source_video']['key'].endswith('/preview.mp4')
    assert manifest['thumbnail']['key'].endswith('/thumbnail.jpg')
    assert manifest['landmarks']['key'].endswith('/reference.json')
    assert 'focused_video' not in manifest
    assert manifest['duration'] == pytest.approx(float(harness['times'][-1]))
    # No 3D, grounding or retarget step ran, and no derivative was published.
    assert not any('export_glb.py' in call for call in harness['calls'])
    assert not any('retarget_mixamo.py' in call for call in harness['calls'])
    assert not any('source_grounding.py' in call for call in harness['calls'])
    assert not any(url.endswith('/derivatives') for url, _ in harness['api'].posts)
    assert all('reference.glb' not in url for url in harness['api'].files)
    reference = json.loads((harness['folder'] / 'reference.json').read_text())
    assert reference['landmarkFormat'] == 'mediapipe-33'
    assert reference['root_motion'] == 'hip-relative'
    assert reference['standingCalibrationAvailable'] is True
    assert reference['standingTime'] == pytest.approx(harness['times'][2])
    assert len(reference['visibility']) == len(harness['times'])
    assert len(reference['keypoints'][0]) == 33
    assert 'NaN' not in (harness['folder'] / 'reference.json').read_text()


def test_mediapipe_without_a_standing_frame_flags_calibration_unavailable(harness, monkeypatch):
    manifest = run_mediapipe(harness, monkeypatch)
    reference = json.loads((harness['folder'] / 'reference.json').read_text())
    assert reference['standingCalibrationAvailable'] is False
    # The manifest time stays finite and in bounds instead of pointing at a crouch.
    assert 0 <= reference['standingTime'] <= manifest['duration']
    assert manifest['standing_time'] == pytest.approx(reference['standingTime'])
    assert any('standing calibration is unavailable' in warning for warning in manifest['warnings'])


def test_mediapipe_falls_back_to_the_wide_video_when_segmentation_is_insufficient(harness, monkeypatch):
    manifest = run_mediapipe(harness, monkeypatch, standing=0, poster=0)
    assert 'focused_video' not in manifest
    assert any('wide video remains available' in warning for warning in manifest['warnings'])


def test_worker_refuses_a_pipeline_and_provider_it_does_not_own():
    worker = saas_worker.Worker('http://127.0.0.1:8001', 'token')
    worker.api = FakeApi()
    with pytest.raises(ValueError):
        worker.run({'id': 'a' * 32, 'attempt_token': 'b' * 32, 'pipeline_version': 'future-pipeline'})
    with pytest.raises(ValueError):
        worker.run({'id': 'a' * 32, 'attempt_token': 'b' * 32, 'provider': 'replicate',
                    'pipeline_version': saas_worker.SAM_PIPELINE_VERSION})
    assert worker.api.posts == []


def test_sam_engine_version_is_unchanged():
    assert saas_worker.SAM_PIPELINE_VERSION == 'sam-3d-body-v1'
    assert saas_worker.SAM_ENGINE_VERSION == 'b5c765a0d89d789985e186d396315e7590887b94'
