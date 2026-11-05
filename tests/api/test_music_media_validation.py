"""Server-side audio validation for music uploads (movement jobs keep their path)."""
import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest

from test_music_conversions import music_app
from apps.api.media_probe import probe_audio_media as real_probe

pytestmark = pytest.mark.skipif(shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None,
                                reason='ffmpeg/ffprobe are required for media validation tests')


@contextmanager
def real_media_app(tmp_path):
    """The shared fixture stubs probing for routing tests; restore the real probe here."""
    with music_app(tmp_path) as values:
        with patch('apps.api.conversions.probe_audio_media', side_effect=real_probe):
            yield values


def media(directory: Path, kind: str) -> Path:
    target = directory / f'{kind}.mp4'
    video = ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=15:d=2']
    audio = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2']
    silent = ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000']
    arguments = ['ffmpeg', '-v', 'error', *video]
    if kind == 'audio':
        arguments += [*audio, '-c:a', 'aac']
    elif kind == 'silent':
        arguments += [*silent, '-c:a', 'aac']
    arguments += ['-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', str(target)]
    subprocess.run(arguments, check=True)
    return target


def upload(client, path: Path, duration=2, subject='piano'):
    data = path.read_bytes()
    created = client.post('/api/conversions', json={
        'title': 'Piano clip', 'filename': path.name, 'bytes': len(data), 'start': 0, 'duration': duration,
        'subject': subject, 'instrument': subject,
        'preparation': {'preparation_version': 'music-clip-v1', 'selection_start': 1.0, 'selection_end': 3.0}})
    assert created.status_code == 201, created.text
    job = created.json()
    response = client.put(f"/api/conversions/{job['id']}/parts/1", content=data,
                          headers={'Content-Type': 'application/octet-stream'})
    assert response.status_code == 200, response.text
    return client.post(f"/api/conversions/{job['id']}/complete", json={})


def test_music_upload_with_audio_is_queued_with_measured_findings(tmp_path):
    with real_media_app(tmp_path) as (client, app, _settings, store, _mail):
        source = media(tmp_path, 'audio')
        completed = upload(client, source)
        assert completed.status_code == 200, completed.text
        body = completed.json()
        assert body['state'] == 'queued'
        findings = body['media_findings']
        assert findings['audio'] is True and findings['video'] is True
        assert findings['audio_codec'] == 'aac'
        assert 'missing_audio' not in findings['findings']


def test_music_upload_without_audio_is_rejected_before_queueing(tmp_path):
    with real_media_app(tmp_path) as (client, app, _settings, store, _mail):
        source = media(tmp_path, 'video-only')
        completed = upload(client, source)
        assert completed.status_code == 200, completed.text
        body = completed.json()
        assert body['state'] == 'failed'
        assert body['error'] == 'invalid_audio'
        assert 'missing_audio' in body['media_findings']['findings']
        assert body['retryable'] is False
        # The rejected source is not retained.
        assert not any('uploads' in key for key in store.objects)


def test_prepared_duration_mismatch_is_not_queued(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        body = upload(client, media(tmp_path, 'audio'), duration=1).json()
        assert body['state'] == 'failed'
        assert 'duration_mismatch' in body['media_findings']['findings']


def test_silence_is_recorded_as_a_finding_not_a_rejection(tmp_path):
    with real_media_app(tmp_path) as (client, app, _settings, store, _mail):
        source = media(tmp_path, 'silent')
        completed = upload(client, source)
        body = completed.json()
        assert body['state'] == 'queued'
        assert 'silent_audio' in body['media_findings']['findings']


def test_movement_upload_without_audio_is_unchanged(tmp_path):
    with real_media_app(tmp_path) as (client, app, _settings, store, _mail):
        source = media(tmp_path, 'video-only')
        data = source.read_bytes()
        created = client.post('/api/conversions', json={
            'title': 'Movement clip', 'filename': 'move.mp4', 'bytes': len(data),
            'start': 0, 'duration': 2, 'subject': 'movement_other'})
        assert created.status_code == 201, created.text
        job = created.json()
        assert client.put(f"/api/conversions/{job['id']}/parts/1", content=data,
                          headers={'Content-Type': 'application/octet-stream'}).status_code == 200
        completed = client.post(f"/api/conversions/{job['id']}/complete", json={})
        assert completed.status_code == 200, completed.text
        assert completed.json()['state'] == 'queued'
        assert completed.json()['media_findings'] == {}


def test_audio_only_upload_is_rejected_even_with_decodable_sound(tmp_path):
    source = tmp_path/'audio-only.m4a'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
                    'sine=frequency=440:sample_rate=48000:duration=2','-c:a','aac','-y',str(source)], check=True)
    with real_media_app(tmp_path) as (client, app, settings, store, _mail):
        body = upload(client, source).json()
        assert body['state'] == 'failed' and body['error'] == 'invalid_audio'
        assert 'missing_video' in body['media_findings']['findings']
        assert not any('uploads' in key for key in store.objects)
