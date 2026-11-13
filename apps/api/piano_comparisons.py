"""Owner-only raw model comparison: records, endpoints, execution and assets.

The browser never supplies a filesystem path or an adapter command. It selects a
server-registered source id and permitted model variant ids. Comparison jobs execute one
inference at a time in isolated subprocesses, never touch lesson documents, and store the
raw document, native sidecar and receipt per immutable attempt directory.
"""
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from scripts import compare_piano_models as comparison_module
    from scripts import piano_model_registry as registry_module
    from scripts import piano_reconstruction_harness as harness
    from scripts import render_piano_comparison as preview_module
    from scripts import run_piano_comparison as job_module
except ImportError:  # pragma: no cover - direct import outside the repository root
    comparison_module = registry_module = harness = preview_module = job_module = None

from .database import (Account, Lesson, LessonRevision, MusicDraft, PianoComparison,
                       PianoComparisonSource, PianoModelRun)
from .storage import storage_client

ASSET_FILES = {
    'document.json': 'document.json',
    'native.json': 'native.json',
    'receipt.json': 'receipt.json',
    'semantics.json': 'semantics.json',
    'prepared.wav': 'prepared.wav',
    'preview.wav': 'preview/preview.wav',
    'preview-notes.wav': 'preview/preview-notes.wav',
    'preview.json': 'preview/preview.json',
}
ALLOWED_STATUSES = ('queued', 'running', 'ready', 'partial', 'failed', 'cancelled',
                    'blocked_license', 'identity_unresolved')
MAX_VARIANTS = 8
_LOCK = threading.Lock()


class ComparisonRequest(BaseModel):
    source_id: str
    variants: list[str] | None = None


class SourceRequest(BaseModel):
    lesson_id: str


def _freeze_retained_source(settings, asset):
    """Download the lesson's retained media and freeze a PCM WAV without accepting paths."""
    store = storage_client(settings)
    payload = store.get_object(Bucket=settings.storage_bucket, Key=asset['key'])['Body'].read()
    work = Path(settings.piano_comparison_dir) / 'sources'
    work.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=work) as directory:
        downloaded = Path(directory) / 'download.bin'
        downloaded.write_bytes(payload)
        target = Path(directory) / 'frozen.wav'
        mime = str(asset.get('mime') or '')
        if 'wav' in mime:
            target.write_bytes(payload)
            try:
                harness.inspect_wav(target)
            except Exception:  # noqa: BLE001 - fall through to ffmpeg for non-PCM WAV
                target.unlink()
        if not target.is_file():
            try:
                subprocess.run(
                    ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                     '-i', str(downloaded), '-vn', '-acodec', 'pcm_s16le', str(target)],
                    check=True, capture_output=True, timeout=180)
            except (FileNotFoundError, subprocess.SubprocessError) as error:
                raise HTTPException(422, 'The lesson source audio could not be extracted.') from error
        header = harness.inspect_wav(target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        destination = work / f'{digest}.wav'
        os.replace(target, destination)
    return destination, digest, header['frames'] / float(header['sample_rate'])


def _now():
    return datetime.now(timezone.utc)


def _owned(session, account, comparison_id):
    row = session.get(PianoComparison, comparison_id)
    if not row or row.owner_id != account.id:
        raise HTTPException(404, 'Comparison not found.')
    return row


def _children(session, comparison_id):
    return list(session.scalars(select(PianoModelRun)
                                .where(PianoModelRun.comparison_id == comparison_id)
                                .order_by(PianoModelRun.variant)).all())


def _view(row, children):
    return {'id': row.id, 'status': row.status,
            'source_id': row.source_id,
            'lesson_id': row.lesson_id,
            'interval': [row.interval_start, row.interval_end],
            'variants': list(row.variants),
            'cancel_requested': row.cancel_requested,
            'created_at': row.created_at.isoformat() if row.created_at else None,
            'updated_at': row.updated_at.isoformat() if row.updated_at else None,
            'result_available': row.result is not None,
            'runs': [{'variant': child.variant, 'status': child.status,
                      'attempt': child.attempt, 'error': child.error,
                      'blocked_reasons': list(child.blocked_reasons or [])}
                     for child in children]}


def _parent_status(children):
    statuses = [child.status for child in children]
    ready = sum(1 for status in statuses if status in ('ready', 'partial'))
    if statuses and all(status == 'ready' for status in statuses):
        return 'complete'
    if ready:
        return 'partial'
    if any(status == 'failed' for status in statuses):
        return 'failed'
    if statuses and all(status in ('blocked_license', 'identity_unresolved', 'cancelled')
                        for status in statuses):
        return 'blocked' if any(status != 'cancelled' for status in statuses) else 'cancelled'
    if any(status == 'running' for status in statuses):
        return 'running'
    return 'queued'


def _execute(comparison_id, engine, settings):
    """Run queued children sequentially; a DB row is the lease/attempt record."""
    with _LOCK:
        with Session(engine) as session:
            parent = session.get(PianoComparison, comparison_id)
            if not parent or parent.status in ('cancelled',):
                return
            source = session.get(PianoComparisonSource, parent.source_id)
            if not source or not Path(source.path).is_file():
                parent.status = 'failed'
                parent.error = 'the registered source is missing'
                session.commit()
                return
            parent.status = 'running'
            parent.updated_at = _now()
            session.commit()
            children = _children(session, comparison_id)
            registry = registry_module.build()
            for child in children:
                session.refresh(parent)
                if parent.cancel_requested:
                    child.status = 'cancelled'
                    session.commit()
                    continue
                if child.status != 'queued':
                    continue
                entry = registry_module.variant(registry, child.variant)
                if entry['status'] != registry_module.STATUS_READY:
                    child.status = ('blocked_license'
                                    if entry['status'] == registry_module.STATUS_BLOCKED
                                    else 'identity_unresolved')
                    child.blocked_reasons = (list(entry['rights']['blockers'])
                                             or [entry['identity_problem'] or 'identity incomplete'])
                    session.commit()
                    continue
                child.attempt += 1
                child.lease_token = uuid.uuid4().hex
                child.status = 'running'
                child.error = None
                child.updated_at = _now()
                run_dir = (Path(settings.piano_comparison_dir) / comparison_id / 'runs'
                           / child.variant / f'attempt-{child.attempt}')
                child.run_dir = str(run_dir)
                session.commit()
                try:
                    receipt = job_module._default_runner(
                        entry, Path(source.path),
                        [parent.interval_start, parent.interval_end], run_dir,
                        timeout=job_module.DEFAULT_TIMEOUT_SECONDS, python=None)
                    job_module._verify_receipt(child.variant, receipt)
                    # The preview is part of readiness: a model without playable audio is
                    # not a completed listening result. Rendering cannot alter the document.
                    preview = preview_module.render_run(run_dir / 'document.json',
                                                        run_dir / 'preview',
                                                        native_path=run_dir / 'native.json')
                    receipt = {**receipt, 'preview': {'manifest_sha256': hashlib.sha256(
                        (run_dir / 'preview' / 'preview.json').read_bytes()).hexdigest(),
                        'common_gain_db': preview['common']['gain_policy']['common_gain_db'],
                        'clipping': preview['previews']['as_transcribed']['clipping']}}
                    child.receipt = receipt
                    child.status = 'partial' if receipt.get('warnings') else 'ready'
                except Exception as error:  # noqa: BLE001 - recorded as the child failure
                    child.status = 'failed'
                    child.error = f'{type(error).__name__}: {error}'[:500]
                child.updated_at = _now()
                parent.updated_at = _now()
                parent.result = None
                session.commit()
            parent.status = _parent_status(_children(session, comparison_id))
            parent.updated_at = _now()
            session.commit()


def install_piano_comparisons(app, engine, settings, identity, db):
    router = APIRouter(prefix='/api/piano-comparisons')

    @router.post('')
    def create(body: ComparisonRequest, background: BackgroundTasks,
               account=Depends(identity), session: Session = Depends(db)):
        source = session.get(PianoComparisonSource, body.source_id)
        if not source or source.owner_id != account.id:
            raise HTTPException(404, 'Source not found.')
        if not Path(source.path).is_file():
            raise HTTPException(409, 'The registered source file is missing.')
        registry = registry_module.build()
        known = {entry['id']: entry for entry in registry['variants']}
        variants = body.variants or [entry['id'] for entry in registry['variants']]
        if not variants or len(variants) > MAX_VARIANTS:
            raise HTTPException(422, 'Request between one and eight model variants.')
        if len(set(variants)) != len(variants):
            raise HTTPException(422, 'Each model variant may be requested once.')
        unknown = [variant for variant in variants if variant not in known]
        if unknown:
            raise HTTPException(422, f'Unknown model variant: {unknown[0]}.')
        interval = [0.0, float(source.seconds)]
        comparison = PianoComparison(
            id=uuid.uuid4().hex, owner_id=account.id, source_id=source.id,
            lesson_id=source.lesson_id, interval_start=interval[0],
            interval_end=interval[1], variants=variants,
            registry_sha256=job_module._registry_sha256(registry),
            status='queued', created_at=_now(), updated_at=_now())
        session.add(comparison)
        for variant in variants:
            entry = known[variant]
            status = 'queued'
            reasons = []
            if entry['status'] == registry_module.STATUS_BLOCKED:
                status = 'blocked_license'
                reasons = list(entry['rights']['blockers'])
            elif entry['status'] != registry_module.STATUS_READY:
                status = 'identity_unresolved'
                reasons = [entry['identity_problem'] or 'identity incomplete']
            session.add(PianoModelRun(
                id=uuid.uuid4().hex, comparison_id=comparison.id, variant=variant,
                family=entry['family'], status=status, attempt=0,
                blocked_reasons=reasons, created_at=_now(), updated_at=_now()))
        session.flush()
        comparison.status = _parent_status(_children(session, comparison.id) or [])
        session.commit()
        background.add_task(_execute, comparison.id, engine, settings)
        return _view(comparison, _children(session, comparison.id))

    @router.post('/sources')
    def register_source(body: SourceRequest, account=Depends(identity),
                        session: Session = Depends(db)):
        lesson = session.get(Lesson, body.lesson_id)
        if not lesson or lesson.owner_id != account.id:
            raise HTTPException(404, 'Lesson not found.')
        revision = session.scalar(
            select(LessonRevision).where(LessonRevision.lesson_id == lesson.id)
            .order_by(LessonRevision.version.desc()))
        manifest = revision.manifest if revision else {}
        draft = session.scalar(select(MusicDraft).where(MusicDraft.lesson_id == lesson.id)
                               .order_by(MusicDraft.created_at.desc()))
        # A new upload's retained video lives in its unreviewed draft, before
        # a reviewed music revision exists. Never substitute another recording.
        draft_asset = (draft.document or {}).get('source_video') if draft else None
        asset = (draft_asset if draft and draft.status == 'draft' else None) or manifest.get('source_video') or draft_asset
        if not asset or not asset.get('key'):
            raise HTTPException(409, 'This lesson has no retained source media to freeze.')
        destination, digest, seconds = _freeze_retained_source(settings, asset)
        existing = session.scalar(select(PianoComparisonSource).where(
            PianoComparisonSource.owner_id == account.id,
            PianoComparisonSource.lesson_id == lesson.id,
            PianoComparisonSource.sha256 == digest))
        if existing:
            row = existing
        else:
            row = PianoComparisonSource(
                id=uuid.uuid4().hex, owner_id=account.id, lesson_id=lesson.id,
                label=lesson.title, path=str(destination), sha256=digest,
                seconds=seconds, reference_path=None, created_at=_now())
            session.add(row)
            session.commit()
        return {'id': row.id, 'label': row.label, 'lesson_id': row.lesson_id,
                'seconds': row.seconds, 'has_reference': row.reference_path is not None}

    @router.get('/sources')
    def sources(account=Depends(identity), session: Session = Depends(db)):
        rows = session.scalars(select(PianoComparisonSource)
                               .where(PianoComparisonSource.owner_id == account.id)
                               .order_by(PianoComparisonSource.created_at.desc())).all()
        return {'sources': [{'id': row.id, 'label': row.label,
                             'lesson_id': row.lesson_id,
                             'seconds': row.seconds,
                             'has_reference': row.reference_path is not None}
                            for row in rows]}

    @router.get('/{comparison_id}')
    def status(comparison_id: str, account=Depends(identity),
               session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        return _view(row, _children(session, comparison_id))

    @router.get('/{comparison_id}/results')
    def results(comparison_id: str, account=Depends(identity),
                session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        children = _children(session, comparison_id)
        source = session.get(PianoComparisonSource, row.source_id)
        runs = {}
        for child in children:
            if child.status not in ('ready', 'partial') or not child.run_dir:
                continue
            receipt = Path(child.run_dir) / 'receipt.json'
            if receipt.is_file():
                runs[child.variant] = {'receipt': str(receipt)}
        if not runs:
            raise HTTPException(409, 'No completed model runs yet.')
        reference = source.reference_path if source and source.reference_path else None
        result = comparison_module.evaluate(
            reference, runs, interval=[row.interval_start, row.interval_end],
            registry=registry_module.build(), source_audio=source.path)
        row.result = result
        row.updated_at = _now()
        session.commit()
        return result

    @router.get('/{comparison_id}/source')
    def source_audio(comparison_id: str, account=Depends(identity),
                     session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        source = session.get(PianoComparisonSource, row.source_id)
        if not source or not Path(source.path).is_file():
            raise HTTPException(404, 'Source audio is unavailable.')
        return FileResponse(source.path, media_type='audio/wav',
                            filename=f'{row.id}-source.wav')

    @router.get('/{comparison_id}/runs/{variant}/assets/{asset}')
    def asset(comparison_id: str, variant: str, asset: str, account=Depends(identity),
              session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        child = session.scalar(select(PianoModelRun).where(
            PianoModelRun.comparison_id == row.id, PianoModelRun.variant == variant))
        if not child or not child.run_dir:
            raise HTTPException(404, 'Run assets are unavailable.')
        relative = ASSET_FILES.get(asset)
        if not relative:
            raise HTTPException(404, 'Asset is not available.')
        base = Path(child.run_dir).resolve()
        path = (base / relative).resolve()
        if not path.is_relative_to(base):
            raise HTTPException(404, 'Asset is not available.')
        if not path.is_file():
            raise HTTPException(404, 'Asset has not been produced.')
        if asset.endswith('.wav'):
            return FileResponse(path, media_type='audio/wav', filename=asset)
        return JSONResponse(json.loads(path.read_text(encoding='utf-8')))

    @router.post('/{comparison_id}/runs/{variant}/retry')
    def retry(comparison_id: str, variant: str, background: BackgroundTasks,
              account=Depends(identity), session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        child = session.scalar(select(PianoModelRun).where(
            PianoModelRun.comparison_id == row.id, PianoModelRun.variant == variant))
        if not child:
            raise HTTPException(404, 'Run not found.')
        if child.status not in ('failed', 'cancelled'):
            raise HTTPException(409, 'Only a failed or cancelled run can be retried.')
        child.status = 'queued'
        child.error = None
        child.updated_at = _now()
        row.status = 'queued'
        row.result = None
        row.updated_at = _now()
        session.commit()
        background.add_task(_execute, row.id, engine, settings)
        return _view(row, _children(session, row.id))

    @router.post('/{comparison_id}/cancel')
    def cancel(comparison_id: str, account=Depends(identity),
               session: Session = Depends(db)):
        row = _owned(session, account, comparison_id)
        row.cancel_requested = True
        row.updated_at = _now()
        for child in _children(session, comparison_id):
            if child.status == 'queued':
                child.status = 'cancelled'
                child.updated_at = _now()
        children = _children(session, comparison_id)
        row.status = _parent_status(children)
        session.commit()
        return _view(row, children)

    app.include_router(router)
