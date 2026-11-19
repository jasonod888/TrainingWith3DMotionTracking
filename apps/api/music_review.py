"""Explicit owner review: proposal -> immutable private reference, never publication."""
import hashlib
import io
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import now
from .contracts import (Contract, Asset, AssessmentPolicy, GuitarChord, MusicDraftDocument, MusicEvent,
                        MusicLessonManifest, MusicPlaybackSettings, MusicSpan, Section,
                        SectionSet)
from .database import LessonAsset, LessonRevision, MusicDraft, MusicReview, MusicVerificationDecision
from .music_verification import current_state_token, decisions_applied, proposal_sha256
from .permissions import accept_revision, latest_revision, owned_lesson
from .storage import storage_client
from .music_assessment import assessment_for_subject
from .music_alignment import validate_alignment
from .music_notation import validate_notation
from .music_preview import performance_changed, invalidate_preview
from . import interactive_limit


class ReviewAssessment(Contract):
    """Note rubric for new reviews, with a legacy watch-only representation.

    The creator switch is separate: this policy says what evidence a lesson accepts,
    not whether practice feedback is available to learners.
    """
    assessment: Literal['none', 'notes'] = 'notes'
    input_modes: list[Literal['none', 'midi', 'microphone']] = Field(
        default_factory=lambda: ['midi', 'microphone'], max_length=2)
    dimensions: list[Literal['pitch', 'timing']] = Field(
        default_factory=lambda: ['pitch', 'timing'], max_length=2)
    rubric_version: str = Field(default='piano-midi-v1', max_length=80)

    @model_validator(mode='after')
    def supported(self):
        if self.assessment == 'none':
            if self.input_modes not in ([], ['none']) or self.dimensions or self.rubric_version != 'music-watch-v1':
                raise ValueError('A watch-only policy takes no input modes or dimensions.')
            return self
        if set(self.dimensions) != {'pitch', 'timing'} or len(set(self.dimensions)) != len(self.dimensions):
            raise ValueError('Feedback requires unique pitch and timing dimensions.')
        if not set(self.input_modes).issubset({'midi', 'microphone'}) or not self.input_modes:
            raise ValueError('Feedback requires MIDI or microphone input.')
        if self.rubric_version not in ('piano-midi-v1', 'guitar-notes-v1'):
            raise ValueError('Unknown feedback rubric version.')
        return self


class ReviewMusic(Contract):
    draft_id: str = Field(min_length=1,max_length=80)
    # Optional: the shared music engine names its instrument, and older clients omit it.
    subject: Literal['piano','guitar'] | None = None
    reference_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    title: str = Field(min_length=1,max_length=200)
    events: list[MusicEvent] = Field(max_length=20000)
    spans: list[MusicSpan] = Field(max_length=500)
    guitar_chords: list[GuitarChord] = Field(default_factory=list, max_length=100)
    # Optional: legacy clients save without them, and piano clients send both.
    notation: dict | None = None
    alignment: dict | None = None
    offset_seconds: float | None = Field(default=None, ge=-10.0, le=10.0, allow_inf_nan=False)
    sections: list[Section] = Field(min_length=1,max_length=500)
    confirm_reviewed: Literal[True]
    assessment: ReviewAssessment = Field(default_factory=ReviewAssessment)
    # Explicit creator choice. Absent derives from the draft or legacy assessment.
    feedback_enabled: bool | None = Field(default=None, strict=True)
    # Required whenever verification decisions exist; binds the save to the exact
    # working state the owner reviewed.
    verification_state_token: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


GUITAR_TUNING_TEXT = {
    'standard': 'E2 A2 D3 G3 B3 E4',
    'drop_d': 'D2 A2 D3 G3 B3 E4',
    'half_step_down': 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4',
    'dadgad': 'D2 A2 D3 G3 A3 D4',
}


def sync_guitar_instrument(proposal: MusicDraftDocument, notation: dict) -> None:
    """Persist the authored tuning/capo so Watch and the manifest agree with TAB."""
    if proposal.subject != 'guitar':
        return
    tuning = notation.get('guitar_tuning') or 'standard'
    capo = notation.get('guitar_capo') or 0
    proposal.instrument.tuning = GUITAR_TUNING_TEXT.get(tuning, GUITAR_TUNING_TEXT['standard'])
    proposal.instrument.capo = int(capo) if isinstance(capo, int) and not isinstance(capo, bool) and capo > 0 else None


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
        if body.subject is not None and body.subject!=row.subject:
            raise HTTPException(409,'The review subject does not match this draft.')
        if row.document['reference']['sha256']!=body.reference_sha256:
            raise HTTPException(409,'The draft changed. Reopen the review.')
        try:
            proposal=MusicDraftDocument.model_validate({**row.document,
                'events':[event.model_dump() for event in body.events],
                'spans':[span.model_dump() for span in body.spans],
                'guitar_chords':[chord.model_dump() for chord in body.guitar_chords]})
            current=latest_revision(session,lesson)
            version=current.version+1 if current else 1
            sections=SectionSet(id=uuid4().hex,revision=version,duration=proposal.duration,sections=body.sections)
        except ValidationError as exc:
            raise HTTPException(422,'Keep notes, spans and contiguous sections inside the clip.') from exc
        reviewed_at=now()
        limit_error=interactive_limit.write_error(
            len(proposal.events), interactive_limit.INTERACTIVE_LIMIT_APPROVED)
        if limit_error:
            raise HTTPException(422, limit_error)
        if performance_changed(row.document, proposal.events):
            invalidate_preview(proposal)
        decision_rows=list(session.scalars(select(MusicVerificationDecision).where(
            MusicVerificationDecision.draft_id==row.id)).all())
        automatic_history=list(row.correction_history or [])
        if decision_rows or row.working_document or automatic_history:
            expected_token=current_state_token(row,decision_rows)
            if body.verification_state_token!=expected_token:
                raise HTTPException(409,'The working notes changed. Reopen the review before saving.')
        if decision_rows:
            baseline=proposal_sha256(row.document.get('events') or [])
            if any(item.proposal_sha256!=baseline for item in decision_rows):
                raise HTTPException(409,'Verification decisions were recorded against an earlier proposal. Reopen verification.')
            if not decisions_applied([event.model_dump() for event in proposal.events],
                                     decision_rows,proposal.duration):
                raise HTTPException(409,'The reviewed notes do not include every accepted suggestion. Reopen verification or undo it first.')
        notation=None
        if body.notation is not None:
            try:
                notation=validate_notation(body.notation, proposal.events, proposal.duration)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            if notation.get('subject')!=proposal.subject:
                raise HTTPException(422,'The notation instrument does not match this draft.')
            sync_guitar_instrument(proposal, notation)
        alignment=None
        if body.alignment is not None:
            candidate=dict(body.alignment)
            if body.offset_seconds is not None:
                candidate['offset_seconds']=body.offset_seconds
            try:
                alignment=validate_alignment(candidate, proposal.duration)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        verification=None
        if decision_rows or automatic_history:
            verification={
                'proposal_sha256': (decision_rows[0].proposal_sha256 if decision_rows
                                    else proposal_sha256(row.document.get('events') or [])),
                'baseline_sha256': proposal_sha256(row.document.get('events') or []),
                'working_sha256': proposal_sha256([event.model_dump() for event in proposal.events]),
                'working_corrected': bool(row.working_document),
                'automatic_corrections': automatic_history}
            if decision_rows:
                verification['decisions']=[{'finding_id':item.finding_id,'decision':item.decision,
                    'decided_at':item.decided_at.isoformat() if item.decided_at else None,
                    'document':item.document} for item in sorted(decision_rows,key=lambda value:value.finding_id)]
        reference_document={'reference_version':1,'subject':proposal.subject,
            'instrument':proposal.instrument.model_dump(),'duration':proposal.duration,
            'events':[event.model_dump() for event in proposal.events],
            'spans':[span.model_dump() for span in proposal.spans],
            'guitar_chords':[chord.model_dump() for chord in proposal.guitar_chords],
            'pedal':[span.model_dump() for span in proposal.pedal],
            'provenance':proposal.provenance.model_dump(),
            **({'notation':notation} if notation is not None else {}),
            **({'alignment':alignment} if alignment is not None else {}),
            'review':{'reviewer_id':account.id,'reviewed_at':reviewed_at.isoformat(),
                      'draft_id':row.id,'source_reference_sha256':body.reference_sha256,
                      **({'verification':verification} if verification else {})}}
        data=canonical(reference_document)
        digest=hashlib.sha256(data).hexdigest()
        key=f'lessons/{lesson_id}/{row.id}-reviewed-reference.json'
        asset=Asset(key=key,mime='application/json',bytes=len(data),sha256=digest)
        store=storage_client(settings)
        store.upload_fileobj(io.BytesIO(data),settings.storage_bucket,key,
            ExtraArgs={'ContentType':asset.mime,'Metadata':{'sha256':digest}})
        stored_feedback=row.document.get('feedback_enabled')
        if body.feedback_enabled is not None:
            feedback_enabled=body.feedback_enabled
        elif isinstance(stored_feedback,bool):
            feedback_enabled=stored_feedback
        else:
            feedback_enabled=body.assessment.assessment!='none'
        if feedback_enabled and body.assessment.assessment=='none':
            raise HTTPException(422,'Enabled practice feedback needs a note rubric.')
        if feedback_enabled or body.assessment.assessment!='none':
            policy=AssessmentPolicy(**assessment_for_subject(proposal.subject))
        else:
            policy=AssessmentPolicy(**body.assessment.model_dump())
        manifest=MusicLessonManifest(lesson_id=lesson_id,revision_id=uuid4().hex,title=body.title.strip() or lesson.title,
            subject=proposal.subject,duration=proposal.duration,instrument=proposal.instrument,
            section_set=sections,reference=asset,reference_reviewed=True,source_video=proposal.source_video,
            piano_preview=proposal.piano_preview,
            playback=proposal.playback or MusicPlaybackSettings(),
            pedal=proposal.pedal,
            preview_identity=proposal.preview_identity,
            assessment=policy,feedback_enabled=feedback_enabled,
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
                'provenance':proposal.provenance.model_dump(),'assessment':body.assessment.model_dump(),
                'feedback_enabled':feedback_enabled}))
        accept_revision(session,lesson,revision,account.id,warnings=proposal.warnings,source='music-review')
        row.status='reviewed'
        session.commit()
        return manifest

    app.include_router(router)
