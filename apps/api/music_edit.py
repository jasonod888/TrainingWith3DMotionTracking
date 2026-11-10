"""Explicit owner editing of a reviewed music revision.

A save creates a new immutable revision and never changes the shared release. Learners
keep the previously published revision until the owner explicitly updates it.
"""
import hashlib
import io
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import now
from .contracts import (Asset, Contract, MusicDraftDocument, MusicEvent, MusicLessonManifest,
                        MusicSpan, Section, SectionSet)
from .database import LessonAsset, LessonRevision, MusicRevisionEdit
from .music_review import ReviewAssessment, canonical
from .permissions import accept_revision, accepted, latest_revision, owned_lesson
from .storage import storage_client


class EditMusic(Contract):
    base_revision_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    events: list[MusicEvent] = Field(max_length=20000)
    spans: list[MusicSpan] = Field(max_length=500)
    sections: list[Section] = Field(min_length=1, max_length=500)
    assessment: ReviewAssessment = Field(default_factory=ReviewAssessment)
    confirm_reviewed: Literal[True]


def install_music_edit(app, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    @router.post('/{lesson_id}/music-revision', response_model=MusicLessonManifest)
    def edit(lesson_id: str, body: EditMusic, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        if (lesson.experience_family or 'body') != 'music':
            raise HTTPException(409, 'Only music lessons can be edited here.')
        request_hash = hashlib.sha256(canonical(body.model_dump())).hexdigest()
        previous = session.scalar(select(MusicRevisionEdit).where(
            MusicRevisionEdit.lesson_id == lesson_id, MusicRevisionEdit.base_revision_id == body.base_revision_id))
        if previous:
            if previous.document.get('request_sha256') != request_hash:
                raise HTTPException(409, 'This revision was already edited. Reopen the lesson.')
            return session.get(LessonRevision, previous.revision_id).manifest
        current = latest_revision(session, lesson)
        if current is None or current.manifest.get('schema_version') != 2:
            raise HTTPException(409, 'Review and save the music reference before editing it.')
        if current.id != body.base_revision_id:
            raise HTTPException(409, 'This lesson has a newer revision. Reopen it to edit.')
        if not accepted(session, lesson_id, current.id):
            raise HTTPException(409, 'Save the reviewed reference before editing it.')
        if body.assessment.assessment == 'notes' and (lesson.instrument or lesson.subject) != 'piano':
            raise HTTPException(422, 'MIDI note feedback is only available for piano lessons.')

        store = storage_client(settings)
        source = store.get_object(Bucket=settings.storage_bucket, Key=current.manifest['reference']['key'])['Body']
        try:
            previous_reference = json.loads(b''.join(source.iter_chunks(1024 * 1024)))
        finally:
            source.close()
        try:
            proposal = MusicDraftDocument.model_validate({
                'draft_version': 1, 'subject': current.manifest['subject'],
                'instrument': current.manifest['instrument'], 'duration': current.manifest['duration'],
                'reference': current.manifest['reference'], 'events': [event.model_dump() for event in body.events],
                'spans': [span.model_dump() for span in body.spans],
                'provenance': previous_reference['provenance'],
                'warnings': [],
            })
            version = current.version + 1
            sections = SectionSet(id=uuid4().hex, revision=version, duration=proposal.duration, sections=body.sections)
        except ValidationError as exc:
            raise HTTPException(422, 'Keep notes, spans and contiguous sections inside the clip.') from exc

        reviewed_at = now()
        reference_document = {
            'reference_version': 1, 'subject': proposal.subject,
            'instrument': proposal.instrument.model_dump(), 'duration': proposal.duration,
            'events': [event.model_dump() for event in proposal.events],
            'spans': [span.model_dump() for span in proposal.spans],
            'provenance': proposal.provenance.model_dump(),
            'review': {'reviewer_id': account.id, 'reviewed_at': reviewed_at.isoformat(),
                       'draft_id': current.id, 'source_reference_sha256': current.manifest['reference']['sha256'],
                       'edited_from_revision': current.id},
        }
        data = canonical(reference_document)
        digest = hashlib.sha256(data).hexdigest()
        key = f'lessons/{lesson_id}/{uuid4().hex}-reviewed-reference.json'
        asset = Asset(key=key, mime='application/json', bytes=len(data), sha256=digest)
        store.upload_fileobj(io.BytesIO(data), settings.storage_bucket, key,
                                                ExtraArgs={'ContentType': asset.mime, 'Metadata': {'sha256': digest}})

        revision_id = uuid4().hex
        manifest = MusicLessonManifest.model_validate({
            **current.manifest, 'revision_id': revision_id, 'title': body.title.strip() or current.manifest['title'],
            'section_set': sections.model_dump(), 'reference': asset.model_dump(),
            'assessment': body.assessment.model_dump(), 'reference_reviewed': True,
        })
        revision = LessonRevision(id=revision_id, lesson_id=lesson_id, version=version,
                                  manifest=manifest.model_dump(), subject=proposal.subject,
                                  experience_family='music', instrument=proposal.subject)
        session.add(revision)
        session.add(LessonAsset(lesson_id=lesson_id, **asset.model_dump()))
        session.flush()
        lesson.version = version
        lesson.title = manifest.title
        accept_revision(session, lesson, revision, account.id, warnings=manifest.warnings, source='music-review')
        session.add(MusicRevisionEdit(id=uuid4().hex, lesson_id=lesson_id, base_revision_id=current.id,
                                      revision_id=revision.id, editor_id=account.id, created_at=reviewed_at,
                                      document={'request_sha256': request_hash,
                                                'base_reference_sha256': current.manifest['reference']['sha256'],
                                                'reference_sha256': digest}))
        session.commit()
        return manifest

    app.include_router(router)
