"""Explicit owner review: proposal -> immutable private reference, never publication."""
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
from .contracts import (Contract, Asset, AssessmentPolicy, MusicDraftDocument, MusicEvent,
                        MusicLessonManifest, MusicSpan, Section, SectionSet)
from .database import LessonAsset, LessonRevision, MusicDraft, MusicReview
from .permissions import accept_revision, latest_revision, owned_lesson
from .storage import storage_client


class ReviewMusic(Contract):
    draft_id: str = Field(min_length=1,max_length=80)
    reference_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    title: str = Field(min_length=1,max_length=200)
    events: list[MusicEvent] = Field(max_length=20000)
    spans: list[MusicSpan] = Field(max_length=500)
    sections: list[Section] = Field(min_length=1,max_length=500)
    confirm_reviewed: Literal[True]


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')


def install_music_review(app,settings,identity,db):
    router=APIRouter(prefix='/api/lessons')

    @router.post('/{lesson_id}/music-draft/review',response_model=MusicLessonManifest)
    def review(lesson_id:str,body:ReviewMusic,account=Depends(identity),session:Session=Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id,True)
        row=session.scalar(select(MusicDraft).where(MusicDraft.id==body.draft_id,
            MusicDraft.lesson_id==lesson_id,MusicDraft.owner_id==account.id).with_for_update())
        if not row:raise HTTPException(404,'Draft unavailable.')
        if (lesson.experience_family or 'body')!='music' or (lesson.instrument or lesson.subject)!=row.instrument:
            raise HTTPException(409,'This draft belongs to a different instrument. Start a new lesson.')
        request_hash=hashlib.sha256(canonical(body.model_dump())).hexdigest()
        previous=session.scalar(select(MusicReview).where(MusicReview.draft_id==row.id))
        if previous:
            if previous.document['request_sha256']!=request_hash:
                raise HTTPException(409,'This draft has already been reviewed. Start a new review for further changes.')
            return session.get(LessonRevision,previous.revision_id).manifest
        newest=session.scalar(select(MusicDraft).where(MusicDraft.lesson_id==lesson_id)
                              .order_by(MusicDraft.created_at.desc(),MusicDraft.id.desc()))
        if newest.id!=row.id or row.status!='draft':raise HTTPException(409,'A newer draft is available. Reopen the review.')
        if row.document['reference']['sha256']!=body.reference_sha256:
            raise HTTPException(409,'The draft changed. Reopen the review.')
        try:
            proposal=MusicDraftDocument.model_validate({**row.document,
                'events':[event.model_dump() for event in body.events],
                'spans':[span.model_dump() for span in body.spans]})
            current=latest_revision(session,lesson)
            version=current.version+1 if current else 1
            sections=SectionSet(id=uuid4().hex,revision=version,duration=proposal.duration,sections=body.sections)
        except ValidationError as exc:
            raise HTTPException(422,'Keep notes, spans and contiguous sections inside the clip.') from exc
        reviewed_at=now()
        reference_document={'reference_version':1,'subject':proposal.subject,
            'instrument':proposal.instrument.model_dump(),'duration':proposal.duration,
            'events':[event.model_dump() for event in proposal.events],
            'spans':[span.model_dump() for span in proposal.spans],
            'provenance':proposal.provenance.model_dump(),
            'review':{'reviewer_id':account.id,'reviewed_at':reviewed_at.isoformat(),
                      'draft_id':row.id,'source_reference_sha256':body.reference_sha256}}
        data=canonical(reference_document)
        digest=hashlib.sha256(data).hexdigest()
        key=f'lessons/{lesson_id}/{row.id}-reviewed-reference.json'
        asset=Asset(key=key,mime='application/json',bytes=len(data),sha256=digest)
        store=storage_client(settings)
        store.upload_fileobj(io.BytesIO(data),settings.storage_bucket,key,
            ExtraArgs={'ContentType':asset.mime,'Metadata':{'sha256':digest}})
        manifest=MusicLessonManifest(lesson_id=lesson_id,revision_id=uuid4().hex,title=body.title.strip() or lesson.title,
            subject=proposal.subject,duration=proposal.duration,instrument=proposal.instrument,
            section_set=sections,reference=asset,reference_reviewed=True,source_video=proposal.source_video,
            assessment=AssessmentPolicy(rubric_version='music-watch-v1',assessment='none',input_modes=['none'],dimensions=[]),
            warnings=proposal.warnings)
        revision=LessonRevision(id=manifest.revision_id,lesson_id=lesson_id,version=version,
            manifest=manifest.model_dump(),subject=proposal.subject,experience_family='music',instrument=proposal.subject)
        session.add(revision)
        session.add(LessonAsset(lesson_id=lesson_id,**asset.model_dump()))
        session.flush()
        lesson.version=version;lesson.title=manifest.title
        session.add(MusicReview(id=uuid4().hex,draft_id=row.id,lesson_id=lesson_id,revision_id=revision.id,
            reviewer_id=account.id,reviewed_at=reviewed_at,document={'request_sha256':request_hash,
                'source_reference_sha256':body.reference_sha256,'reviewed_reference_sha256':digest,
                'provenance':proposal.provenance.model_dump()}))
        accept_revision(session,lesson,revision,account.id,warnings=proposal.warnings,source='music-review')
        row.status='reviewed'
        session.commit()
        return manifest

    app.include_router(router)
