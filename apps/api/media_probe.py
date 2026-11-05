"""Bounded server-side media probing for music uploads.

Movement uploads are validated elsewhere and are not touched here. A music clip must
decode, must contain a video track, and must contain a usable audio track before it can
be queued for a music worker. Silence and clipping are recorded as findings rather than
treated as proof that the demonstration is valid.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path

PROBE_TIMEOUT_SECONDS = 30
ANALYSIS_SECONDS = 30
SILENT_MAX_DB = -60.0
CLIPPING_MAX_DB = -0.1


class MediaProbeError(RuntimeError):
    """The file could not be inspected at all."""


def _run(arguments: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(arguments, capture_output=True, text=True, timeout=PROBE_TIMEOUT_SECONDS)


def probe_audio_media(path: Path) -> dict:
    """Inspect one uploaded clip and return stream facts plus quality findings.

    Raises MediaProbeError when the tooling cannot read the file, which the caller treats
    as a failed upload rather than queueing unknown media.
    """
    try:
        probe = _run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)])
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise MediaProbeError('Media inspection is unavailable.') from exc
    if probe.returncode != 0:
        raise MediaProbeError('This clip could not be decoded.')
    try:
        details = json.loads(probe.stdout or '{}')
    except json.JSONDecodeError as exc:
        raise MediaProbeError('This clip could not be decoded.') from exc

    streams = details.get('streams') or []
    video = next((stream for stream in streams if stream.get('codec_type') == 'video'), None)
    audio = next((stream for stream in streams if stream.get('codec_type') == 'audio'), None)
    duration = details.get('format', {}).get('duration')
    try:
        duration_value = float(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration_value = None

    findings: list[str] = []
    facts = {
        'video': bool(video),
        'audio': bool(audio),
        'video_codec': (video or {}).get('codec_name'),
        'container': details.get('format',{}).get('format_name'),
        'audio_codec': (audio or {}).get('codec_name'),
        'sample_rate': int(audio['sample_rate']) if audio and audio.get('sample_rate') else None,
        'channels': int(audio['channels']) if audio and audio.get('channels') else None,
        'duration': duration_value,
        'findings': findings,
    }
    if not video:
        findings.append('missing_video')
    if duration_value is None or not math.isfinite(duration_value) or duration_value <= 0:
        raise MediaProbeError('This clip has no usable duration.')
    if video:
        try:
            decoded = _run(['ffmpeg', '-hide_banner', '-nostats', '-v', 'error', '-xerror',
                            '-i', str(path), '-t', str(ANALYSIS_SECONDS), '-map', '0:v:0', '-an', '-f', 'null', '-'])
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            raise MediaProbeError('This clip video could not be decoded.') from exc
        if decoded.returncode != 0:
            raise MediaProbeError('This clip video could not be decoded.')
    if not audio:
        findings.append('missing_audio')
        return facts

    # Decode a bounded window to confirm the audio actually decodes and to measure level.
    try:
        level = _run(['ffmpeg', '-hide_banner', '-nostats', '-v', 'info', '-xerror', '-t', str(ANALYSIS_SECONDS),
                      '-i', str(path), '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'])
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise MediaProbeError('This clip audio could not be decoded.') from exc
    if level.returncode != 0:
        raise MediaProbeError('This clip audio could not be decoded.')
    output = f'{level.stdout}\n{level.stderr}'
    samples = re.findall(r'n_samples:\s*(\d+)', output)
    if not samples or int(samples[-1]) <= 0 or not facts['sample_rate'] or not facts['channels']:
        raise MediaProbeError('This clip has no decodable audio samples.')
    facts['decoded_audio_samples'] = int(samples[-1])
    match = re.search(r'max_volume:\s*(-?[\d.]+) dB', output)
    max_volume = float(match.group(1)) if match else None
    facts['max_volume_db'] = max_volume
    if max_volume is None:
        findings.append('audio_level_unmeasured')
    elif max_volume <= SILENT_MAX_DB:
        findings.append('silent_audio')
    if max_volume is not None and max_volume >= CLIPPING_MAX_DB:
        findings.append('clipping_audio')
    return facts
