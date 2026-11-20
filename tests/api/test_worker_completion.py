"""Shared worker artifact completion: required/optional coherence and lease checks."""
import hashlib
import json
from pathlib import Path

import pytest

import saas_worker


class Response:
    def __init__(self, payload=None): self.payload = payload or {}
    def raise_for_status(self): return None
    def json(self): return self.payload


class API:
    def __init__(self, fail=None): self.puts = []; self.posts = []; self.fail = fail or set()
    def put(self, url, headers=None, content=None):
        name = url.rsplit('/', 1)[-1]
        if name in self.fail: raise RuntimeError('upload failed')
        self.puts.append(name)
        data = content.read() if hasattr(content, 'read') else b''
        return Response({'key': name, 'sha256': hashlib.sha256(data).hexdigest()})
    def post(self, url, headers=None, json=None):
        self.posts.append((url, json)); return Response({'lesson_id': 'l1'})


@pytest.mark.parametrize('engine', ['sam-3d-body', 'mediapipe'])
def test_required_and_optional_artifacts_coherently_invalidate_derivatives(tmp_path, engine):
    for name in ('preview.mp4', 'reference.json', 'reference.glb'):
        (tmp_path / name).write_bytes(b'x')
    focused = tmp_path / 'instructor.mp4'; focused.write_bytes(b'v')
    (tmp_path / 'instructor-alpha.webm').write_bytes(b'a')
    api = API(fail={'instructor.mp4'})
    manifest = {'engine': engine, 'focused_video': {'key': 'old'}, 'focused_video_start': 0.,
                'focused_video_alpha': {'key': 'old-alpha'}, 'warnings': []}
    reference = {'duration': 1, 'instructorMarkers': {'left_wrist': {}}}
    assets = saas_worker.publish_required_artifacts(api, '/jobs/1', {}, tmp_path,
                                                    ('preview.mp4', 'reference.json'), lambda: None)
    result, changed = saas_worker.publish_optional_derivatives(
        api, '/jobs/1', {}, assets, reference, manifest, focused, lambda: None,
        manifest['warnings'])
    assert result is None and changed is True
    assert 'instructorMarkers' not in reference
    assert 'focused_video' not in manifest and 'focused_video_alpha' not in manifest
    assert 'instructor-alpha.webm' not in api.puts
    assert manifest['warnings']


def test_optional_alpha_is_never_uploaded_without_focused(tmp_path):
    api = API()
    manifest = {'focused_video': {'key': 'f'}, 'warnings': []}
    reference = {'instructorMarkers': {}}
    saas_worker.publish_optional_derivatives(api, '/jobs/1', {}, {}, reference, manifest,
                                             None, lambda: None, manifest['warnings'])
    assert api.puts == []
    assert 'focused_video' not in manifest


def test_lease_loss_stops_before_finish():
    api = API()
    def lost(): raise saas_worker.LeaseLost('lease lost')
    with pytest.raises(saas_worker.LeaseLost):
        saas_worker.complete_pipeline_job(api, '/jobs/1', {}, {'engine': 'mediapipe'}, lost)
    assert api.posts == []


def test_returned_checksum_must_match_the_uploaded_bytes(tmp_path):
    (tmp_path / 'preview.mp4').write_bytes(b'expected bytes')
    class BadChecksum(API):
        def put(self, url, headers=None, content=None):
            return Response({'key': 'preview.mp4', 'sha256': 'f' * 64})
    with pytest.raises(saas_worker.InvalidVideo, match='checksum mismatch'):
        saas_worker.publish_required_artifacts(BadChecksum(), '/jobs/1', {}, tmp_path,
                                               ('preview.mp4',), lambda: None)
