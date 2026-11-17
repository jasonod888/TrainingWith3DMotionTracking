"""Bounded owner-only CPU hand estimates.

The API process never imports NumPy/onnxruntime. It runs the pinned adapter in a
short-lived subprocess from an explicitly discovered project-local interpreter, with a
small event cap and timeout. The canonical baseline remains available when this
operation is disabled/unavailable.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import os
import re
import struct
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field
from sqlalchemy.orm import Session

from .config import ROOT, Settings
from .contracts import Contract, MusicEvent
from .permissions import owned_lesson

logger = logging.getLogger('form.hands')

MODEL_COMMIT = '78e546b520144b301de5e793ceb83be61356a65d'
MODEL_SHA256 = '6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd'
MODEL_BYTES = 252047
FINGERPRINT_RE = re.compile(r'^ph1:[0-9a-f]{64}$')


class HandEstimateRequest(Contract):
    events: list[MusicEvent] = Field(max_length=20000)


class HandModelUnavailable(RuntimeError):
    pass


_MODEL_SLOT = threading.BoundedSemaphore(1)
_CACHE_LOCK = threading.Lock()
_CACHE: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
_INFLIGHT: dict[str, threading.Event] = {}
_INFLIGHT_ERRORS: OrderedDict[str, str] = OrderedDict()


def clear_model_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _INFLIGHT.clear()
        _INFLIGHT_ERRORS.clear()


def _f64_hex(value: float) -> str:
    return struct.pack('>d', float(value)).hex()


def hand_fingerprint(events: list[Any]) -> str:
    rows = []
    for event in events:
        identifier = event.id
        encoded = identifier.encode('utf-8')
        duration = event.duration
        row = (f'{len(encoded)}:{identifier}\t{int(event.pitch)}\t'
               f'{_f64_hex(float(event.onset))}\t'
               f'{"null" if duration is None else _f64_hex(float(duration))}\n')
        rows.append((encoded, row))
    rows.sort(key=lambda item: (item[0], item[1]))
    body = f'piano-hand-v1\n{len(rows)}\n' + ''.join(row for _, row in rows)
    return 'ph1:' + hashlib.sha256(body.encode('utf-8')).hexdigest()


def _python_path(settings: Settings) -> Path | None:
    if settings.hands_model_python:
        candidate = Path(settings.hands_model_python)
        return candidate if candidate.is_file() else None
    candidates = [ROOT / '.venv-music/Scripts/python.exe', ROOT / '.venv-music/bin/python']
    return next((path for path in candidates if path.is_file()), None)


def _model_hash(path: Path) -> str | None:
    try:
        if path.stat().st_size != MODEL_BYTES:
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def model_status(settings: Settings) -> dict[str, Any]:
    python = _python_path(settings) if settings.hands_model_enabled else None
    adapter = settings.hands_model_adapter
    artifact = settings.hands_model_artifact
    digest = _model_hash(artifact) if artifact.is_file() else None
    available = bool(python and adapter.is_file() and digest == MODEL_SHA256)
    return {
        'available': available,
        'enabled': bool(settings.hands_model_enabled),
        'model': digest == MODEL_SHA256,
        'model_sha256': MODEL_SHA256 if digest == MODEL_SHA256 else None,
        'runtime': bool(python),
        'adapter': adapter.is_file(),
        'max_events': settings.hands_model_max_events,
        'fallback': 'canonical-baseline',
        'label_mapping': {'raw_0': 'right', 'raw_1': 'left',
                          'note': 'Raw and upstream labels preserved per occurrence.'},
    }


def _run_model_uncached(settings: Settings, events: list[MusicEvent]) -> dict[str, Any]:
    python = _python_path(settings)
    if python is None:
        raise HandModelUnavailable('The hand runtime is not configured.')
    command = [str(python), str(settings.hands_model_adapter), '--input', '-',
               '--model', str(settings.hands_model_artifact)]
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    try:
        completed = subprocess.run(
            command, input=json.dumps({'events': [event.model_dump() for event in events]}),
            capture_output=True, text=True, timeout=settings.hands_model_timeout_seconds,
            cwd=str(ROOT), env=env, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HandModelUnavailable('The hand model timed out. The musical baseline remains available.') from exc
    except OSError as exc:
        raise HandModelUnavailable('The hand runtime could not start. The musical baseline remains available.') from exc
    if completed.returncode != 0:
        logger.warning('Hand adapter failed rc=%s stderr=%s', completed.returncode, completed.stderr[-1000:])
        raise HandModelUnavailable('The hand model could not process these notes. The baseline remains available.')
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise HandModelUnavailable('The hand model returned an invalid report.') from exc
    if report.get('ok') is not True or report.get('adapter') != 'midi2hands-direct-note-adapter-v1':
        raise HandModelUnavailable('The hand model returned an invalid report.')
    if report.get('artifact', {}).get('sha256') != MODEL_SHA256:
        raise HandModelUnavailable('The hand model identity does not match the pinned artifact.')
    expected = hand_fingerprint(events)
    if report.get('performance_fingerprint') != expected:
        raise HandModelUnavailable('The hand model result is stale for these notes.')
    notes = report.get('notes')
    if not isinstance(notes, list):
        raise HandModelUnavailable('The hand model omitted its per-note result.')
    expected_ids = {event.id for event in events}
    seen: set[str] = set()
    predictions = []
    for note in notes:
        if not isinstance(note, dict) or note.get('id') not in expected_ids or note.get('id') in seen:
            raise HandModelUnavailable('The hand model returned mismatched occurrence ids.')
        seen.add(note['id'])
        if note.get('status') == 'predicted':
            if note.get('hand') not in ('left', 'right') or not math.isfinite(float(note.get('raw_score'))):
                raise HandModelUnavailable('The hand model returned an invalid prediction.')
            predictions.append({'id': note['id'], 'hand': note['hand'],
                                'raw_score': float(note['raw_score']), 'status': 'predicted'})
        else:
            predictions.append({'id': note['id'], 'hand': None, 'raw_score': None,
                                'status': note.get('status', 'unavailable')})
    if seen != expected_ids:
        raise HandModelUnavailable('The hand model did not return every occurrence.')
    return {
        'ok': True, 'performance_fingerprint': expected,
        'model': {'name': 'midi2hands', 'version': MODEL_COMMIT, 'sha256': MODEL_SHA256,
                  'label_mapping': report.get('label_mapping')},
        'runtime_ms': report.get('runtime', {}).get('inference_ms'),
        'predictions': predictions,
    }


def _cache_get(settings: Settings, key: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        expires, result = entry
        if expires <= now:
            _CACHE.pop(key, None)
            return None
        _CACHE.move_to_end(key)
        return copy.deepcopy(result)


def run_model(settings: Settings, events: list[MusicEvent]) -> dict[str, Any]:
    status = model_status(settings)
    if not status['available']:
        raise HandModelUnavailable('The hand model is not configured on this server.')
    if len(events) > settings.hands_model_max_events:
        raise HandModelUnavailable(f'This note set exceeds the {settings.hands_model_max_events}-event model limit.')
    key = f'{MODEL_SHA256}:{hand_fingerprint(events)}'
    cached = _cache_get(settings, key)
    if cached is not None:
        return cached

    with _CACHE_LOCK:
        event = _INFLIGHT.get(key)
        owner = event is None
        if owner:
            event = threading.Event()
            _INFLIGHT[key] = event
            _INFLIGHT_ERRORS.pop(key, None)
    if not owner:
        # Coalesce identical work instead of launching another CPU subprocess.
        if not event.wait(settings.hands_model_timeout_seconds + settings.hands_model_queue_wait_seconds):
            raise HandModelUnavailable('Hand estimates are busy. The musical baseline remains available.')
        cached = _cache_get(settings, key)
        if cached is not None:
            return cached
        with _CACHE_LOCK:
            error = _INFLIGHT_ERRORS.get(key)
        raise HandModelUnavailable(error or 'The hand model is unavailable. The baseline remains available.')

    acquired = _MODEL_SLOT.acquire(timeout=settings.hands_model_queue_wait_seconds)
    if not acquired:
        with _CACHE_LOCK:
            _INFLIGHT.pop(key, None)
            event.set()
        raise HandModelUnavailable('Hand estimates are busy. The musical baseline remains available.')
    try:
        result = _run_model_uncached(settings, events)
        with _CACHE_LOCK:
            _CACHE[key] = (time.monotonic() + settings.hands_model_cache_ttl_seconds, result)
            _CACHE.move_to_end(key)
            while len(_CACHE) > settings.hands_model_cache_entries:
                _CACHE.popitem(last=False)
            _INFLIGHT.pop(key, None)
            event.set()
        return copy.deepcopy(result)
    except HandModelUnavailable as exc:
        with _CACHE_LOCK:
            _INFLIGHT_ERRORS[key] = str(exc)
            while len(_INFLIGHT_ERRORS) > settings.hands_model_cache_entries:
                _INFLIGHT_ERRORS.popitem(last=False)
            _INFLIGHT.pop(key, None)
            event.set()
        raise
    except Exception:
        with _CACHE_LOCK:
            _INFLIGHT.pop(key, None)
            event.set()
        raise
    finally:
        _MODEL_SLOT.release()


def install_music_hands(app, settings: Settings, identity, db):
    router = APIRouter(prefix='/api')

    @router.get('/piano/hands/status')
    def status(_account=Depends(identity)):
        return model_status(settings)

    @router.post('/lessons/{lesson_id}/hand-estimates')
    def estimates(lesson_id: str, body: HandEstimateRequest, response: Response,
                  account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id)
        if (lesson.experience_family or 'body') != 'music' or (lesson.instrument or lesson.subject) != 'piano':
            raise HTTPException(422, 'Hand estimates are only available for piano lessons.')
        if len(body.events) > settings.hands_model_max_events:
            raise HTTPException(422, f'Choose at most {settings.hands_model_max_events} notes for a hand estimate.')
        try:
            result = run_model(settings, body.events)
        except HandModelUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        response.headers['Cache-Control'] = 'no-store'
        return result

    app.include_router(router)
