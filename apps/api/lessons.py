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

from .contracts import LessonManifest, Section, SectionSet
from .database import Account, Lesson, LessonAsset, LessonRevision, PracticeProgress
from .storage import storage_client


def import_fixture(engine, settings, owner_id, manifest_path, asset_dir):
    """Operator-controlled import; never accepts arbitrary uploaded paths from HTTP."""
    manifest = LessonManifest.model_validate_json(Path(manifest_path).read_text(encoding='utf-8'))
    lesson_id, revision_id = uuid4().hex, uuid4().hex
    assets = [a for a in (manifest.animation, manifest.landmarks, manifest.source_video, manifest.thumbnail) if a]
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
            session.add(Lesson(id=lesson_id, owner_id=owner_id, title=manifest.title, version=1, archived=False))
            session.flush()
            session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, manifest=manifest.model_dump(), version=1))
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


class SaveSections(BaseModel):
    base_revision_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    sections: list[Section] = Field(min_length=1, max_length=1000)

class ProgressInput(BaseModel):
    revision_id: str = Field(min_length=1, max_length=80)
    time: float = Field(ge=0, allow_inf_nan=False)
    speed: Literal[0.5, 0.75, 1] = 1
    mode: Literal['sections', 'continuous'] = 'sections'


def install_lessons(app, engine, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    def owned(session, lesson_id, owner_id):
        lesson = session.scalar(select(Lesson).where(Lesson.id == lesson_id, Lesson.owner_id == owner_id, Lesson.archived.is_(False)))
        if not lesson:
            raise HTTPException(404, 'Lesson unavailable.')
        return lesson

    def latest(session, lesson):
        return session.scalar(select(LessonRevision).where(LessonRevision.lesson_id == lesson.id, LessonRevision.version == lesson.version))

    @router.get('')
    def library(account=Depends(identity), session: Session = Depends(db)):
        rows = session.execute(select(LessonRevision).join(Lesson, Lesson.id == LessonRevision.lesson_id).where(
            Lesson.owner_id == account.id, Lesson.archived.is_(False), LessonRevision.version == Lesson.version)
            .order_by(Lesson.created_at.desc())).scalars().all()
        return [row.manifest for row in rows]

    @router.post('/from-demo', response_model=LessonManifest, status_code=201)
    def copy_demo(account=Depends(identity), session: Session = Depends(db)):
        if not settings.demo_enabled:
            raise HTTPException(404, 'Demonstration unavailable.')
        try:
            return import_fixture(engine, settings, account.id, settings.demo_assets_dir / 'manifest.json', settings.demo_assets_dir)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(503, 'The demonstration is unavailable for import.') from exc

    @router.get('/{lesson_id}', response_model=LessonManifest)
    def detail(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        return latest(session, lesson).manifest

    @router.get('/{lesson_id}/progress')
    def progress(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        revision = latest(session, lesson)
        value = session.get(PracticeProgress, (account.id, lesson_id))
        if not value or value.revision_id != revision.id:
            return None
        return {'revision_id':value.revision_id,'time':value.time,'speed':value.speed,'mode':value.mode}

    @router.put('/{lesson_id}/progress')
    def keep_progress(lesson_id: str, body: ProgressInput, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        revision = latest(session, lesson)
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
            Lesson.archived.is_(False), Lesson.version == revision.version).values(version=revision.version+1, title=manifest.title))
        if updated.rowcount != 1:
            raise HTTPException(409, 'This lesson has newer changes. Reopen it from your library before editing.')
        manifest.revision_id = uuid4().hex
        manifest.section_set = section_set
        session.add(LessonRevision(id=manifest.revision_id, lesson_id=lesson.id, manifest=manifest.model_dump(), version=section_set.revision))
        session.commit()
        return manifest

    @router.delete('/{lesson_id}')
    def archive(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned(session, lesson_id, account.id)
        lesson.archived = True
        session.commit()
        return {'message': 'Lesson removed from your library.'}

    @router.get('/{lesson_id}/assets/{name}')
    def asset(lesson_id: str, name: str, request: Request, account=Depends(identity), session: Session = Depends(db)):
        owned(session, lesson_id, account.id)
        key = f'lessons/{lesson_id}/{name}'
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
