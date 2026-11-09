"""Default-off, explicit-save API for self-reported unscored music summaries."""
from typing import Literal
from uuid import UUID
from datetime import datetime, timezone
import base64
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, model_validator
from sqlalchemy import func, select, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .contracts import Contract
from .database import Account, MusicPracticeAttempt, LessonRevision
from .permissions import readable_lesson

MAX_SUMMARIES = 5000


class HistoryCursor(Contract):
    date: datetime
    id: UUID


def utc_date(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class NoteWindowSummary(Contract):
    total: int = Field(ge=0, le=20000, strict=True)
    eligible: int = Field(ge=0, le=20000, strict=True)
    matched: int = Field(ge=0, le=20000, strict=True)
    missing: int = Field(ge=0, le=20000, strict=True)
    extra: int = Field(ge=0, le=20000, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        if self.eligible > self.total or self.matched + self.missing > self.eligible or self.matched + self.extra > 20000:
            raise ValueError('Inconsistent note-window counts.')
        return self


class MusicAttemptInput(Contract):
    summary_version: Literal[1]
    status: Literal['complete']
    id: UUID
    save_requested: Literal[True]
    revision_id: str = Field(min_length=1, max_length=80)
    reference_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    rubric_version: Literal['piano-midi-v1']
    section_id: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    speed: Literal[0.5, 0.75, 1, 1.25]
    run: int = Field(ge=0, le=4, strict=True)
    assessment: Literal['unscored']
    alignment: Literal['none', 'visual-estimate']
    note_window: NoteWindowSummary

    @model_validator(mode='after')
    def ordered(self):
        if self.end <= self.start:
            raise ValueError('An attempt needs a positive range.')
        return self


def install_music_attempts(app, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    def enabled():
        if not settings.music_history_enabled:
            raise HTTPException(404, 'Music history is unavailable.')

    def music_revision(session, lesson_id, account_id, revision_id=None):
        _, revision = readable_lesson(session, lesson_id, account_id, revision_id)
        if not revision or revision.manifest.get('schema_version') != 2:
            raise HTTPException(409, 'Use music history only for a music lesson.')
        return revision

    def result(row):
        return {**row.summary, 'evidence': 'client-reported', 'date': utc_date(row.created_at).isoformat()}

    def page(session, account_id, limit, cursor, lesson_id=None):
        query = select(MusicPracticeAttempt).where(MusicPracticeAttempt.account_id == account_id)
        if lesson_id is not None:
            query = query.where(MusicPracticeAttempt.lesson_id == lesson_id)
        if cursor:
            try:
                decoded = base64.b64decode(cursor + '=' * (-len(cursor) % 4), altchars=b'-_', validate=True)
                boundary = HistoryCursor.model_validate_json(decoded)
                stamp = utc_date(boundary.date)
            except (ValueError, TypeError) as exc:
                raise HTTPException(422, 'Invalid history cursor. Refresh history.') from exc
            query = query.where(or_(MusicPracticeAttempt.created_at < stamp,
                and_(MusicPracticeAttempt.created_at == stamp, MusicPracticeAttempt.id < str(boundary.id))))
        rows = session.scalars(query.order_by(MusicPracticeAttempt.created_at.desc(), MusicPracticeAttempt.id.desc()).limit(limit+1)).all()
        more = len(rows) > limit
        rows = rows[:limit]
        items = []
        for row in rows:
            title = None
            try:
                lesson, readable = readable_lesson(session, row.lesson_id, account_id)
                if readable and (lesson.owner_id == account_id or readable.id == row.revision_id):
                    revision = session.get(LessonRevision, row.revision_id)
                    title = revision.manifest['title'] if revision else None
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
            items.append({**result(row), 'lesson_id': row.lesson_id, 'title': title})
        next_cursor = None
        if more:
            last = rows[-1]
            data = json.dumps({'date': utc_date(last.created_at).isoformat(), 'id': last.id}).encode()
            next_cursor = base64.urlsafe_b64encode(data).decode().rstrip('=')
        return {'items': items, 'next_cursor': next_cursor}

    @router.get('/{lesson_id}/music-attempts/page', dependencies=[Depends(enabled)])
    def lesson_page(lesson_id: str, limit: int=Query(20, ge=1, le=100), cursor: str | None=Query(None, max_length=400),
                    account=Depends(identity), session: Session=Depends(db)):
        music_revision(session, lesson_id, account.id)
        return page(session, account.id, limit, cursor, lesson_id)

    @app.get('/api/music-attempts', dependencies=[Depends(enabled)])
    def account_page(limit: int=Query(20, ge=1, le=100), cursor: str | None=Query(None, max_length=400),
                     account=Depends(identity), session: Session=Depends(db)):
        return page(session, account.id, limit, cursor)

    @router.get('/{lesson_id}/music-attempts', dependencies=[Depends(enabled)])
    def history(lesson_id: str, account=Depends(identity), session: Session=Depends(db)):
        music_revision(session, lesson_id, account.id)
        rows = session.scalars(select(MusicPracticeAttempt).where(
            MusicPracticeAttempt.lesson_id == lesson_id, MusicPracticeAttempt.account_id == account.id)
            .order_by(MusicPracticeAttempt.created_at.desc(), MusicPracticeAttempt.id.desc()).limit(100)).all()
        return [result(row) for row in rows]

    @router.post('/{lesson_id}/music-attempts', status_code=201, dependencies=[Depends(enabled)])
    def save(lesson_id: str, body: MusicAttemptInput, account=Depends(identity), session: Session=Depends(db)):
        revision = music_revision(session, lesson_id, account.id, body.revision_id)
        # Serializes account quota checks on PostgreSQL. No table is read while disabled.
        session.scalar(select(Account).where(Account.id == account.id).with_for_update())
        summary = body.model_dump(mode='json')
        existing = session.get(MusicPracticeAttempt, str(body.id))
        if existing:
            if existing.account_id != account.id or existing.lesson_id != lesson_id or existing.summary != summary:
                raise HTTPException(409, 'Attempt identifier already has different contents.')
            return result(existing)
        manifest = revision.manifest
        policy = manifest['assessment']
        if revision.id != body.revision_id or manifest['reference']['sha256'] != body.reference_sha256:
            raise HTTPException(409, 'The reviewed reference changed. Reopen the lesson.')
        if (manifest['subject'] != 'piano' or not manifest.get('reference_reviewed') or
            policy['assessment'] != 'notes' or policy['input_modes'] != ['midi'] or
            set(policy['dimensions']) != {'pitch', 'timing'} or policy['rubric_version'] != body.rubric_version):
            raise HTTPException(409, 'This reference does not support MIDI note-feedback history.')
        sections = manifest['section_set']['sections']
        ranges = [(section['start'], section['end']) for section in sections if section['id'] == body.section_id]
        if body.section_id == 'all':
            ranges.append((0, manifest['duration']))
        if not any(abs(body.start-start) <= 1e-6 and abs(body.end-end) <= 1e-6 for start, end in ranges):
            raise HTTPException(422, 'Attempt range must match the lesson or a teaching section.')
        count = session.scalar(select(func.count()).select_from(MusicPracticeAttempt).where(MusicPracticeAttempt.account_id == account.id))
        if count >= MAX_SUMMARIES:
            raise HTTPException(409, 'Music history is full. Practice still works; delete an old summary to save another.')
        row = MusicPracticeAttempt(id=str(body.id), account_id=account.id, lesson_id=lesson_id,
                                   revision_id=body.revision_id, summary=summary)
        session.add(row)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(409, 'Attempt identifier is unavailable. Retry the save.') from exc
        return result(row)

    @router.delete('/{lesson_id}/music-attempts/{attempt_id}', dependencies=[Depends(enabled)])
    def remove(lesson_id: str, attempt_id: UUID, account=Depends(identity), session: Session=Depends(db)):
        # A learner can remove their own summary even after lesson access is revoked.
        row = session.get(MusicPracticeAttempt, str(attempt_id))
        if not row or row.account_id != account.id or row.lesson_id != lesson_id:
            raise HTTPException(404, 'Summary unavailable.')
        session.delete(row)
        session.commit()
        return {'ok': True}

    app.include_router(router)
