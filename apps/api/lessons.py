"""Private lesson access, immutable revisions, and controlled local fixture import."""
import hashlib
import re
from pathlib import Path
from uuid import uuid4
from typing import Literal

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .contracts import (LessonManifest, LessonSummary, MusicLessonManifest,
                        MusicPlaybackSettings, Section, SectionSet, SummaryCapabilities)
from .music_verification import current_state_token
from .database import (Account, Lesson, LessonAsset, LessonRevision, MusicDraft, MusicVerificationDecision,
                       PracticeProgress, LessonGrant)
from .storage import storage_client
from .permissions import access_reasons, latest_acceptance, owned_lesson,latest_revision,public_lesson,public_manifest,readable_lesson
from .auth import now
from . import processing_routes, subjects


FORMAT_HEADER = 'x-lesson-formats'


def subject_filter(subject):
    """Validate a discovery subject filter; an unknown subject is a client error."""
    if subject is None or not str(subject).strip():
        return None
    try:
        return subjects.subject_spec(subject).id
    except subjects.SubjectError as exc:
        raise HTTPException(422, str(exc)) from exc


def client_formats(request):
    """Advertised lesson formats. An unversioned client is v1-only by default."""
    raw = request.headers.get(FORMAT_HEADER, '1')
    values = {part.strip() for part in raw.split(',') if part.strip()}
    return values or {'1'}


def ensure_supported(lesson, revision, request):
    """Refuse to hand a music object to a client that did not ask for v2."""
    family = subject_projection(lesson, revision)['experience_family']
    if family == 'music' and '2' not in client_formats(request):
        raise HTTPException(406, 'This lesson needs a newer version of the app. Refresh to update.',
                            headers={'X-Lesson-Format-Required': '2'})


def subject_projection(lesson, revision=None, current=False):
    """Release-aware subject projection.

    `current=True` is the owner's draft view: it reads the lesson row, so a relabel
    shows up immediately without creating a revision. Every other caller uses the
    label frozen on the revision it is serving, so a reader never inherits a later
    relabel. A revision with no snapshot (only possible for pre-subject data that the
    migration did not reach) falls back to the row for compatibility.
    """
    snapshot = revision is not None and revision.subject is not None
    if current or not snapshot:
        subject = lesson.subject or subjects.DEFAULT_SUBJECT
        family = lesson.experience_family or 'body'
        instrument = lesson.instrument
    else:
        subject = revision.subject
        family = revision.experience_family or 'body'
        instrument = revision.instrument
    return {
        'subject': subject,
        'subject_label': subjects.label_for(subject),
        'experience_family': family,
        'instrument': instrument,
    }


def summary_of(lesson, revision, settings, include_private_poster=True, current=False):
    """Card projection. Never carries body assets or musical events."""
    projection = subject_projection(lesson, revision, current=current)
    manifest = revision.manifest or {}
    family = projection['experience_family']
    poster = None
    if family == 'music':
        poster = manifest.get('public_poster')
    elif include_private_poster:
        poster = manifest.get('thumbnail')
    live_input = 'camera'
    if family == 'music':
        live_input = 'none'
        try:
            route = processing_routes.route_for(projection['subject'], projection['instrument'])
            if processing_routes.available(route, settings):
                live_input = 'midi'
        except subjects.SubjectError:
            live_input = 'none'
    return LessonSummary(
        lesson_id=lesson.id,
        revision_id=revision.id,
        title=manifest.get('title') or lesson.title,
        subject=projection['subject'],
        subject_label=projection['subject_label'],
        experience_family=family,
        instrument=projection['instrument'],
        duration=max(0.001, float(manifest.get('duration') or 0)),
        section_count=max(1, len((manifest.get('section_set') or {}).get('sections') or [])),
        poster=poster,
        capabilities=SummaryCapabilities(preview=True, practice=True, live_input=live_input),
    )



def import_fixture(engine, settings, owner_id, manifest_path, asset_dir):
    """Operator-controlled import; never accepts arbitrary uploaded paths from HTTP."""
    manifest = LessonManifest.model_validate_json(Path(manifest_path).read_text(encoding='utf-8'))
    lesson_id, revision_id = uuid4().hex, uuid4().hex
    assets = [a for a in (manifest.animation, manifest.landmarks, manifest.source_video, manifest.thumbnail, manifest.focused_video) if a]
    names = [Path(a.key).name for a in assets]
    if len(names) != len(set(names)):
        raise ValueError('Fixture assets must have unique filenames.')
    root = Path(asset_dir).resolve()
    # Validate everything before performing any write.
    paths = []
    for asset, name in zip(assets, names):
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            raise ValueError('Missing or unsafe fixture asset.')
        with path.open('rb') as source:
            checksum = hashlib.file_digest(source, 'sha256').hexdigest()
        if path.stat().st_size != asset.bytes or checksum != asset.sha256:
            raise ValueError(f'Fixture checksum mismatch: {name}')
        paths.append(path)
    store = storage_client(settings)
    written = []
    with Session(engine) as session:
        account = session.get(Account, owner_id)
        if not account or not account.verified:
            raise ValueError('Import requires a verified owner account.')
        try:
            for asset, name, path in zip(assets, names, paths):
                asset.key = f'lessons/{lesson_id}/{name}'
                written.append(asset.key)
                store.upload_file(str(path), settings.storage_bucket, asset.key, ExtraArgs={'ContentType': asset.mime})
            manifest.lesson_id = lesson_id
            manifest.revision_id = revision_id
            manifest.section_set.id = uuid4().hex
            manifest.section_set.revision = 1
            session.add(Lesson(id=lesson_id, owner_id=owner_id, title=manifest.title, version=1, archived=False,
                               subject=subjects.DEFAULT_SUBJECT, experience_family='body'))
            session.flush()
            session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, manifest=manifest.model_dump(), version=1,
                                       subject=subjects.DEFAULT_SUBJECT, experience_family='body'))
            for asset in assets:
                session.add(LessonAsset(lesson_id=lesson_id, **asset.model_dump()))
            session.commit()
        except Exception:
            session.rollback()
            for key in written:
                try:
                    store.delete_object(Bucket=settings.storage_bucket, Key=key)
                except Exception:
                    pass  # No access grant exists; operator can clean orphan objects later.
            raise
    return manifest


def import_music_fixture(engine, settings, owner_id, manifest_path, asset_dir):
    """Operator-controlled music fixture import.

    Uses the same validate-before-write discipline as the body import. A music
    fixture never runs a worker, so it is the only way a v2 lesson exists during
    Phase 1. It is not publicly listable: publication requires the normal release
    path, and music publishing is guarded until a reviewed reference exists.
    """
    manifest = MusicLessonManifest.model_validate_json(Path(manifest_path).read_text(encoding='utf-8'))
    lesson_id, revision_id = uuid4().hex, uuid4().hex
    roles = ('reference', 'source_video', 'preview_video', 'piano_preview', 'waveform', 'midi_export', 'public_poster')
    assets = [getattr(manifest, role) for role in roles if getattr(manifest, role)]
    names = [Path(asset.key).name for asset in assets]
    if len(names) != len(set(names)):
        raise ValueError('Music fixture assets must have unique filenames.')
    root = Path(asset_dir).resolve()
    paths = []
    for asset, name in zip(assets, names):
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            raise ValueError('Missing or unsafe music fixture asset.')
        with path.open('rb') as source:
            checksum = hashlib.file_digest(source, 'sha256').hexdigest()
        if path.stat().st_size != asset.bytes or checksum != asset.sha256:
            raise ValueError(f'Music fixture checksum mismatch: {name}')
        paths.append(path)
    store = storage_client(settings)
    written = []
    with Session(engine) as session:
        account = session.get(Account, owner_id)
        if not account or not account.verified:
            raise ValueError('Import requires a verified owner account.')
        try:
            for asset, name, path in zip(assets, names, paths):
                asset.key = f'lessons/{lesson_id}/{name}'
                written.append(asset.key)
                store.upload_file(str(path), settings.storage_bucket, asset.key, ExtraArgs={'ContentType': asset.mime})
            manifest.lesson_id = lesson_id
            manifest.revision_id = revision_id
            manifest.section_set.id = uuid4().hex
            manifest.section_set.revision = 1
            projection = subject_projection_for(manifest.subject, manifest.instrument.instrument)
            session.add(Lesson(id=lesson_id, owner_id=owner_id, title=manifest.title, version=1, archived=False,
                               **projection))
            session.flush()
            session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, manifest=manifest.model_dump(), version=1,
                                       **projection))
            for asset in assets:
                session.add(LessonAsset(lesson_id=lesson_id, **asset.model_dump()))
            session.commit()
        except Exception:
            session.rollback()
            for key in written:
                try:
                    store.delete_object(Bucket=settings.storage_bucket, Key=key)
                except Exception:
                    pass
            raise
    return manifest


def subject_projection_for(subject, instrument=None):
    resolved, family, resolved_instrument = subjects.validate_selection(subject, instrument)
    return {'subject': resolved, 'experience_family': family, 'instrument': resolved_instrument}


class SaveSections(BaseModel):
    base_revision_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    sections: list[Section] = Field(min_length=1, max_length=1000)

class RenameInput(BaseModel):
    title: str = Field(max_length=200)

class TrimInput(BaseModel):
    base_revision_id: str = Field(min_length=1, max_length=80)
    start_frame: int = Field(ge=0, strict=True)
    end_frame: int = Field(gt=0, strict=True)
    accept: bool = False


class SubjectInput(BaseModel):
    subject: str = Field(min_length=1, max_length=32)
    instrument: str | None = Field(default=None, max_length=16)

class ProgressInput(BaseModel):
    revision_id: str = Field(min_length=1, max_length=80)
    time: float = Field(ge=0, allow_inf_nan=False)
    speed: Literal[0.25, 0.5, 0.75, 1] = 1
    mode: Literal['sections', 'continuous'] = 'sections'


# Presentation derivatives stored beside a lesson. They are not part of the lesson manifest,
# so the asset route allows these names and still requires a stored asset record.
DERIVATIVE_NAMES = frozenset({'avatar-male.glb', 'avatar-female.glb', 'avatar-report.json'})


def install_lessons(app, engine, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    def owned(session, lesson_id, owner_id):
        return owned_lesson(session,lesson_id,owner_id)

    def latest(session, lesson):
        return latest_revision(session,lesson)

    @router.get('')
    def library(account=Depends(identity), session: Session = Depends(db)):
        # Body-shaped list: a client that assumes v1 must never receive a v2 object.
        # Mixed-subject clients use /lessons/summaries instead.
        rows = session.execute(select(LessonRevision).join(Lesson, Lesson.id == LessonRevision.lesson_id).where(
            Lesson.owner_id == account.id, Lesson.archived.is_(False), Lesson.disabled.is_(False),
            Lesson.experience_family == 'body', LessonRevision.version == Lesson.version)
            .order_by(Lesson.created_at.desc())).scalars().all()
        return [row.manifest for row in rows]

    @router.get('/summaries')
    def summaries(request: Request, subject: str | None = None, account=Depends(identity), session: Session = Depends(db)):
        """Mixed-subject card projection for clients that advertise v1 and v2."""
        formats = client_formats(request)
        wanted = subject_filter(subject)
        rows = session.execute(select(Lesson, LessonRevision).join(
            LessonRevision, LessonRevision.lesson_id == Lesson.id).where(
            Lesson.owner_id == account.id, Lesson.archived.is_(False), Lesson.disabled.is_(False),
            LessonRevision.version == Lesson.version).order_by(Lesson.created_at.desc())).all()
        values = []
        for lesson, revision in rows:
            # The owner's list is the draft view: a relabel shows immediately.
            projection = subject_projection(lesson, revision, current=True)
            if projection['experience_family'] == 'music' and '2' not in formats:
                continue
            if wanted is not None and projection['subject'] != wanted:
                continue
            values.append(summary_of(lesson, revision, settings, current=True).model_dump())
        return values

    @router.post('/from-demo', response_model=LessonManifest, status_code=201)
    def copy_demo(account=Depends(identity), session: Session = Depends(db)):
        if not settings.demo_enabled:
            raise HTTPException(404, 'Demonstration unavailable.')
        try:
            return import_fixture(engine, settings, account.id, settings.demo_assets_dir / 'manifest.json', settings.demo_assets_dir)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(503, 'The demonstration is unavailable for import.') from exc

    @router.get('/{lesson_id}')
    def detail(lesson_id: str, request: Request, account=Depends(identity), session: Session = Depends(db)):
        lesson,reasons=access_reasons(session,lesson_id,account.id)
        if not lesson or not reasons:raise HTTPException(404,'Move unavailable.')
        if (lesson.experience_family or 'body')=='music' and latest_revision(session,lesson) is None:
            # A draft reference has no manifest yet; it is not readable as a lesson.
            if 'owner' in reasons:
                raise HTTPException(409,'This music lesson is still a draft. Review its reference before opening it.')
            raise HTTPException(404,'Move unavailable.')
        if 'owner' in reasons or 'direct' in reasons or 'group' in reasons:
            _,revision=readable_lesson(session,lesson_id,account.id)
            ensure_supported(lesson, revision, request)
            return revision.manifest
        # A public-only reader never receives private source media.
        _,revision,publication=public_lesson(session,lesson_id)
        ensure_supported(lesson, revision, request)
        from .workflow import public_tags
        return public_manifest(revision,publication,public_tags(session,lesson_id))

    @router.patch('/{lesson_id}/subject')
    def set_subject(lesson_id: str, body: SubjectInput, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        try:
            resolved, family, instrument = subjects.validate_selection(body.subject, body.instrument)
        except subjects.SubjectError as exc:
            raise HTTPException(422, str(exc)) from exc
        latest = latest_revision(session, lesson)
        published = session.get(LessonRevision, lesson.published_revision_id) if lesson.published_revision_id else None
        # Discipline and instrument are fixed by the content that was processed: the stored
        # manifest has no music or body assets for anything else. A label may become more
        # specific only inside the discipline the lesson already belongs to.
        provenance = subject_projection(lesson, published or latest)
        if provenance['experience_family'] != family or provenance['instrument'] != instrument:
            raise HTTPException(422, 'Changing between movement and music needs new content. Upload or convert the lesson again.')
        # Metadata only. No revision is created, so practice progress, acceptance and the
        # published pointer keep referring to the same revision. A reader keeps the label
        # frozen on that revision; the public label changes when the owner next publishes.
        lesson.subject, lesson.experience_family, lesson.instrument = resolved, family, instrument
        session.commit()
        return {'lesson_id': lesson.id, 'revision_id': latest.id if latest else None,
                **subject_projection(lesson, latest, current=True)}


    @router.get('/{lesson_id}/music-draft')
    def music_draft(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        """Owner-only view of an unreviewed proposal. Never served to recipients."""
        owned_lesson(session, lesson_id, account.id)
        row=session.scalar(select(MusicDraft).where(MusicDraft.lesson_id==lesson_id).order_by(MusicDraft.created_at.desc()))
        if not row:raise HTTPException(404,'No draft reference is available.')
        document = row.working_document or row.document
        response = {**document,'draft_id':row.id,'title':session.get(Lesson,lesson_id).title,'lesson_id':lesson_id,'revision_id':None,'status':row.status}
        if row.working_document:
            response.update({'working_corrected':True,'baseline_events':row.document.get('events') or [],
                             'automatic_corrections':row.correction_history or []})
        response.update({'raw_model':bool(row.raw_model),
                         'correction_operations':int(row.correction_operations or 0)})
        decisions=list(session.scalars(select(MusicVerificationDecision).where(
            MusicVerificationDecision.draft_id==row.id)).all())
        if decisions or row.working_document or (row.correction_history or []):
            response['verification_state_token']=current_state_token(row,decisions)
        return response

    class MusicPlaybackInput(BaseModel):
        draft_id: str = Field(min_length=1, max_length=80)
        sync_offset_seconds: float = Field(ge=-10.0, le=10.0, allow_inf_nan=False)
        revision: int = Field(ge=1)

    @router.patch('/{lesson_id}/music-draft/playback')
    def set_playback(lesson_id: str, body: MusicPlaybackInput,
                     account=Depends(identity), session: Session = Depends(db)):
        """Owner-only optimistic update of the global note/audio sync offset."""
        owned_lesson(session, lesson_id, account.id, True)
        row=session.scalar(select(MusicDraft).where(MusicDraft.lesson_id==lesson_id)
                           .order_by(MusicDraft.created_at.desc()).with_for_update())
        if not row:raise HTTPException(404,'No draft reference is available.')
        if row.id!=body.draft_id or row.status!='draft':
            raise HTTPException(409,'This draft was replaced or finalized. Reopen the lesson.')
        current=row.playback or {'sync_offset_seconds':0.0,'revision':1}
        if body.revision!=current.get('revision'):
            raise HTTPException(409,'Playback settings changed. Reopen the review.')
        saved=MusicPlaybackSettings(sync_offset_seconds=body.sync_offset_seconds,
                                    revision=int(current.get('revision',1))+1)
        row.playback=saved.model_dump()
        row.document={**row.document,'playback':row.playback}
        if row.working_document:
            row.working_document={**row.working_document,'playback':row.playback}
        session.commit()
        return row.playback

    @router.get('/{lesson_id}/progress')
    def progress(lesson_id: str, revision_id: str | None = None, account=Depends(identity), session: Session = Depends(db)):
        lesson,revision = readable_lesson(session,lesson_id,account.id,revision_id)
        value = session.get(PracticeProgress, (account.id, lesson_id))
        if not value or value.revision_id != revision.id:
            return None
        return {'revision_id':value.revision_id,'time':value.time,'speed':value.speed,'mode':value.mode}

    @router.put('/{lesson_id}/progress')
    def keep_progress(lesson_id: str, body: ProgressInput, account=Depends(identity), session: Session = Depends(db)):
        lesson,revision = readable_lesson(session,lesson_id,account.id,body.revision_id)
        if body.revision_id != revision.id:
            raise HTTPException(409, 'This lesson has a newer revision. Reopen it to save your position.')
        if body.time > revision.manifest['duration']:
            raise HTTPException(422, 'Position is outside this lesson.')
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert = pg_insert if engine.dialect.name == 'postgresql' else sqlite_insert
        values = body.model_dump()
        statement = insert(PracticeProgress).values(account_id=account.id,lesson_id=lesson_id,**values)
        statement = statement.on_conflict_do_update(index_elements=['account_id','lesson_id'],set_=values)
        session.execute(statement)
        if lesson.owner_id!=account.id:
            grant=session.get(LessonGrant,(lesson_id,account.id))
            if grant:grant.last_active_at=now()
        session.commit()
        return {'saved':True}

    @router.put('/{lesson_id}/sections', response_model=LessonManifest)
    def save(lesson_id: str, body: SaveSections, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        revision = latest(session, lesson)
        if revision.id != body.base_revision_id:
            raise HTTPException(409, 'This lesson has newer changes. Reopen it from your library before editing.')
        manifest = LessonManifest.model_validate(revision.manifest)
        from pydantic import ValidationError
        try:
            section_set = SectionSet(id=manifest.section_set.id, revision=lesson.version+1,
                                     duration=manifest.duration, sections=body.sections)
        except ValidationError as exc:
            raise HTTPException(422, 'Sections must cover the animation without gaps or overlaps.') from exc
        manifest.title = body.title.strip()
        if not manifest.title:
            raise HTTPException(422, 'Give your lesson a name.')
        # Compare-and-swap remains safe when two requests read the same base revision.
        updated = session.execute(update(Lesson).where(Lesson.id == lesson.id, Lesson.owner_id == account.id,
            Lesson.archived.is_(False), Lesson.disabled.is_(False), Lesson.version == revision.version).values(version=revision.version+1, title=manifest.title))
        if updated.rowcount != 1:
            raise HTTPException(409, 'This lesson has newer changes. Reopen it from your library before editing.')
        manifest.revision_id = uuid4().hex
        manifest.section_set = section_set
        session.add(LessonRevision(id=manifest.revision_id, lesson_id=lesson.id, manifest=manifest.model_dump(),
                                   version=section_set.revision, subject=lesson.subject,
                                   experience_family=lesson.experience_family, instrument=lesson.instrument))
        session.commit()
        return manifest

    @router.put('/{lesson_id}/trim', response_model=LessonManifest)
    def trim(lesson_id: str, body: TrimInput, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        revision = latest(session, lesson)
        # The frame-based movement trim is not a music trim, and `accept` must never
        # become a way to accept an unreviewed music reference.
        if subject_projection(lesson, revision)['experience_family'] == 'music':
            raise HTTPException(409, 'Music lessons are trimmed through the reviewed reference, not the movement trim.')
        if revision.id != body.base_revision_id:
            raise HTTPException(409, 'This move changed. Reopen it before trimming.')
        manifest = LessonManifest.model_validate(revision.manifest)
        fps = manifest.frame_rate
        from math import ceil
        if body.end_frame > ceil(manifest.duration * fps) or body.end_frame - body.start_frame < max(1, ceil(.05 * fps)):
            raise HTTPException(422, 'Choose a start and end within this move.')
        start, end = body.start_frame / fps, min(body.end_frame / fps, manifest.duration)
        duration = end - start
        if duration < .05:
            raise HTTPException(422, 'Keep at least one movement frame.')
        sections = [Section(id=s.id, label=s.label, start=max(s.start, start)-start, end=min(s.end, end)-start)
                    for s in manifest.section_set.sections if min(s.end, end)-max(s.start, start) > 1e-6]
        # Absorb tiny boundary fragments into the neighbouring teaching section.
        while len(sections) > 1 and any(s.end-s.start < .05 for s in sections):
            index = next(i for i,s in enumerate(sections) if s.end-s.start < .05)
            if index == 0:
                sections[1].start = 0
            else:
                sections[index-1].end = sections[index].end
            sections.pop(index)
        updated = session.execute(update(Lesson).where(Lesson.id == lesson.id, Lesson.version == revision.version)
                                  .values(version=revision.version+1))
        if updated.rowcount != 1:
            raise HTTPException(409, 'This move changed. Reopen it before trimming.')
        manifest.animation_duration = manifest.animation_duration or manifest.duration
        manifest.animation_start += start
        manifest.source_start += start
        if manifest.focused_video_start is not None:
            manifest.focused_video_start += start
        manifest.duration = duration
        manifest.standing_time = max(0, min(manifest.standing_time-start, duration))
        manifest.revision_id = uuid4().hex
        manifest.section_set = SectionSet(id=manifest.section_set.id, revision=revision.version+1, duration=duration, sections=sections)
        trimmed = LessonRevision(id=manifest.revision_id, lesson_id=lesson.id, manifest=manifest.model_dump(),
                                 version=revision.version+1, subject=lesson.subject,
                                 experience_family=lesson.experience_family, instrument=lesson.instrument)
        session.add(trimmed)
        if body.accept:
            from .permissions import accept_revision
            accept_revision(session, lesson, trimmed, account.id, warnings=manifest.warnings, source='owner')
        session.commit()
        return manifest

    @router.patch('/{lesson_id}', response_model=LessonManifest)
    def rename(lesson_id: str, body: RenameInput, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        title = body.title.strip() or 'Untitled move'
        lesson.title = title
        revision = latest(session, lesson)
        # A name is metadata: no new revision, inference, acceptance or release change.
        manifest = dict(revision.manifest)
        manifest['title'] = title
        revision.manifest = manifest
        session.commit()
        return manifest

    @router.delete('/{lesson_id}')
    def archive(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        lesson.archived = True
        session.commit()
        return {'message': 'Lesson removed from your library.'}

    @router.get('/{lesson_id}/music-analysis')
    def music_analysis(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        """Owner-only metadata for the retained raw prediction artifact."""
        lesson=owned_lesson(session,lesson_id,account.id)
        record=session.scalar(select(LessonAsset).where(
            LessonAsset.lesson_id==lesson_id,
            LessonAsset.key.like(f'lessons/{lesson_id}/%-analysis.zip')).order_by(LessonAsset.key.desc()))
        if not record:raise HTTPException(404,'No retained analysis for this lesson.')
        return {'key':record.key,'mime':record.mime,'bytes':record.bytes,'sha256':record.sha256,
                'retention_days':settings.music_analysis_retention_days,
                'note':'Internal diagnostic artifact. Owner access only; expires by retention policy.'}

    @router.get('/{lesson_id}/music-analysis/artifact')
    def music_analysis_artifact(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id)
        record=session.scalar(select(LessonAsset).where(
            LessonAsset.lesson_id==lesson_id,
            LessonAsset.key.like(f'lessons/{lesson_id}/%-analysis.zip')).order_by(LessonAsset.key.desc()))
        if not record:raise HTTPException(404,'No retained analysis for this lesson.')
        try:
            obj=storage_client(settings).get_object(Bucket=settings.storage_bucket,Key=record.key)
        except ClientError as exc:
            raise HTTPException(404,'Analysis artifact unavailable.') from exc
        def stream():
            try:
                yield from obj['Body'].iter_chunks(chunk_size=256*1024)
            finally:
                obj['Body'].close()
        return StreamingResponse(stream(),media_type='application/zip',headers={
            'Content-Length':str(obj['ContentLength']),'Cache-Control':'private, no-store',
            'Content-Disposition':'attachment; filename="basic-pitch-analysis.zip"'})

    @router.get('/{lesson_id}/assets/{name}')
    def asset(lesson_id: str, name: str, request: Request, account=Depends(identity), session: Session = Depends(db)):
        lesson,reasons=access_reasons(session,lesson_id,account.id)
        if not lesson or not reasons:raise HTTPException(404,'Move unavailable.')
        _,revision=readable_lesson(session,lesson_id,account.id)
        manifest=revision.manifest if revision else {}
        key = f'lessons/{lesson_id}/{name}'
        family = subject_projection(lesson, revision)['experience_family']
        if family == 'music':
            # Private extracted audio follows private source-video rules. A public
            # viewer never receives audio, video, MIDI or the reference itself.
            fields = ('public_poster',) if reasons == ['public'] else (
                'reference', 'source_video', 'preview_video', 'piano_preview', 'waveform', 'midi_export', 'public_poster')
        else:
            fields=('animation','landmarks') if reasons==['public'] else ('animation','landmarks','source_video','thumbnail','focused_video','focused_video_alpha')
        allowed={value['key'] for value in (manifest.get(field) for field in fields) if value}
        allowed.update(value['key'] for kind,value in manifest.get('presentation',{}).items()
                       if reasons!=['public'] or kind in ('male','female'))
        if 'owner' in reasons:
            for proposal in session.scalars(select(MusicDraft).where(MusicDraft.lesson_id==lesson_id)).all():
                allowed.update(value['key'] for value in (proposal.document.get(field) for field in ('reference','source_video','piano_preview')) if value)
        # Avatar clips are presentation derivatives: they are not in the immutable manifest, so
        # they are allowed by name and still require a stored record for this lesson below.
        if name in DERIVATIVE_NAMES:
            allowed.add(key)
        if key not in allowed:raise HTTPException(404,'Media unavailable.')
        record = session.scalar(select(LessonAsset).where(LessonAsset.key == key, LessonAsset.lesson_id == lesson_id))
        if not record:
            raise HTTPException(404, 'Media unavailable.')
        options = {}
        byte_range = request.headers.get('range')
        if byte_range:
            if not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', byte_range):
                raise HTTPException(416, 'Unsupported byte range.')
            options['Range'] = byte_range
        try:
            obj = storage_client(settings).get_object(Bucket=settings.storage_bucket, Key=key, **options)
        except ClientError as exc:
            status = exc.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
            raise HTTPException(416 if status == 416 else 404 if status == 404 else 503, 'Media unavailable.') from exc
        def stream():
            try:
                yield from obj['Body'].iter_chunks(chunk_size=256*1024)
            finally:
                obj['Body'].close()
        headers = {'Content-Length': str(obj['ContentLength']), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store'}
        if 'ContentRange' in obj:
            headers['Content-Range'] = obj['ContentRange']
        return StreamingResponse(stream(), status_code=206 if 'ContentRange' in obj else 200,
                                 media_type=record.mime, headers=headers)

    app.include_router(router)
    from .music_review import install_music_review
    install_music_review(app,settings,identity,db)
