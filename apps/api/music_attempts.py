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
    rubric_version: Literal['piano-midi-v1', 'guitar-notes-v1']
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


class ChallengeTiming(Contract):
    available: bool
    confidence: Literal['none', 'limited', 'normal']
    matches: int = Field(ge=0, le=20000, strict=True)
    mean_absolute_error_seconds: float | None = Field(default=None, ge=0, le=10)
    score: float | None = Field(default=None, ge=0, le=1)
    on_time: int = Field(ge=0, le=20000, strict=True)
    early: int = Field(ge=0, le=20000, strict=True)
    late: int = Field(ge=0, le=20000, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        if self.available and self.on_time + self.early + self.late != self.matches:
            raise ValueError('Timing counts must sum to the matched timing events.')
        if not self.available:
            if self.mean_absolute_error_seconds is not None or self.score is not None:
                raise ValueError('Unavailable timing cannot carry values.')
            if self.on_time or self.early or self.late:
                raise ValueError('Unavailable timing cannot carry directions.')
        if self.available and (self.matches < 1 or self.mean_absolute_error_seconds is None or self.score is None):
            raise ValueError('Available timing needs evidence.')
        return self


class ChallengeSection(Contract):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    expected_required: int = Field(ge=0, le=20000, strict=True)
    assessed_required: int = Field(ge=0, le=20000, strict=True)
    matched_required: int = Field(ge=0, le=20000, strict=True)
    missing_required: int = Field(ge=0, le=20000, strict=True)
    extra: int = Field(ge=0, le=20000, strict=True)
    reference_coverage: float = Field(ge=0, le=1)
    recall: float | None = Field(default=None, ge=0, le=1)
    timing: ChallengeTiming

    @model_validator(mode='after')
    def consistent(self):
        if self.end <= self.start or self.assessed_required > self.expected_required:
            raise ValueError('A challenge section has an invalid range or coverage.')
        if self.matched_required + self.missing_required > self.assessed_required:
            raise ValueError('A challenge section has inconsistent note counts.')
        return self


class ChallengeCounts(Contract):
    expected_required: int = Field(ge=0, le=20000, strict=True)
    assessed_required: int = Field(ge=0, le=20000, strict=True)
    matched_required: int = Field(ge=0, le=20000, strict=True)
    matched_optional: int = Field(ge=0, le=20000, strict=True)
    missing_required: int = Field(ge=0, le=20000, strict=True)
    extra: int = Field(ge=0, le=20000, strict=True)
    unassessed_required: int = Field(ge=0, le=20000, strict=True)
    outside_attacks: int = Field(ge=0, le=20000, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        if self.assessed_required > self.expected_required:
            raise ValueError('Assessed notes cannot exceed the reference.')
        if self.matched_required + self.missing_required > self.assessed_required:
            raise ValueError('Matched and missing notes cannot exceed assessed notes.')
        if self.assessed_required + self.unassessed_required != self.expected_required:
            raise ValueError('Assessed and unassessed notes must cover the reference.')
        return self


class ChallengeCoverage(Contract):
    reference: float = Field(ge=0, le=1)
    capture: float = Field(ge=0, le=1)
    support: float = Field(ge=0, le=1)


class ChallengeAlignment(Contract):
    offset_seconds: float = Field(ge=-3600, le=3600)
    offset_real_seconds: float = Field(ge=-3600, le=3600)
    ambiguous: bool
    support: float = Field(ge=0, le=1)
    peak_separation_seconds: float = Field(ge=0, le=3600)


class MusicChallengeAttemptInput(Contract):
    """Experimental whole-piece MIDI report. A score is intentionally impossible."""
    report_version: Literal[2]
    status: Literal['insufficient-evidence']
    id: UUID
    save_requested: Literal[True]
    revision_id: str = Field(min_length=1, max_length=80)
    reference_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    rubric_version: Literal['piano-midi-v1', 'guitar-notes-v1']
    scorer_version: Literal['piano-challenge-v1']
    subject: Literal['piano', 'guitar']
    input_mode: Literal['midi', 'microphone']
    speed: Literal[1]
    policy_qualified: Literal[False]
    score: None = None
    score_reason: str | None = Field(default=None, max_length=200)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    offset_seconds: float = Field(ge=-3600, le=3600)
    alignment: ChallengeAlignment
    coverage: ChallengeCoverage
    counts: ChallengeCounts
    timing: ChallengeTiming
    sections: list[ChallengeSection] = Field(min_length=1, max_length=500)
    latency_measured: bool
    input_latency_ms: float = Field(ge=0, le=1000)
    model_profile: str | None = Field(default=None, max_length=120)

    @model_validator(mode='after')
    def consistent(self):
        if self.end <= self.start:
            raise ValueError('A challenge needs a positive range.')
        if self.timing.matches > self.counts.matched_required:
            raise ValueError('Timing cannot include more events than matched notes.')
        if abs(self.offset_seconds - self.alignment.offset_seconds) > 1e-6:
            raise ValueError('Challenge offset copies disagree.')
        if abs(self.coverage.reference - (self.counts.assessed_required / self.counts.expected_required if self.counts.expected_required else 0)) > .002:
            raise ValueError('Reference coverage does not match the counts.')
        if self.counts.expected_required and sum(section.matched_required for section in self.sections) > self.counts.matched_required:
            raise ValueError('Section matches cannot exceed the total.')
        if self.counts.expected_required and sum(section.missing_required for section in self.sections) > self.counts.missing_required:
            raise ValueError('Section misses cannot exceed the total.')
        return self


def install_music_attempts(app, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    def enabled():
        if not settings.music_history_enabled:
            raise HTTPException(404, 'Music history is unavailable.')

    def challenge_enabled():
        if not settings.music_challenge_enabled:
            raise HTTPException(404, 'Music challenge is unavailable.')

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
        from .music_assessment import effective_feedback_enabled, assessment_for_subject
        if not effective_feedback_enabled(manifest):
            raise HTTPException(409, 'Feedback is not enabled for this lesson.')
        policy = manifest.get('assessment') or {}
        expected = assessment_for_subject(manifest.get('subject'))
        if revision.id != body.revision_id or manifest['reference']['sha256'] != body.reference_sha256:
            raise HTTPException(409, 'The reviewed reference changed. Reopen the lesson.')
        if (expected is None or not manifest.get('reference_reviewed') or
            policy.get('assessment') != 'notes' or policy.get('input_modes') != expected['input_modes'] or
            set(policy.get('dimensions') or []) != {'pitch', 'timing'} or
            policy.get('rubric_version') != body.rubric_version):
            raise HTTPException(409, 'This reference does not support note-feedback history.')
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

    @router.post('/{lesson_id}/music-challenge-attempts', status_code=201,
                 dependencies=[Depends(enabled), Depends(challenge_enabled)])
    def save_challenge(lesson_id: str, body: MusicChallengeAttemptInput,
                       account=Depends(identity), session: Session=Depends(db)):
        revision = music_revision(session, lesson_id, account.id, body.revision_id)
        manifest = revision.manifest
        from .music_assessment import effective_feedback_enabled, assessment_for_subject
        if not effective_feedback_enabled(manifest):
            raise HTTPException(409, 'Feedback is not enabled for this lesson.')
        policy = manifest.get('assessment') or {}
        expected = assessment_for_subject(manifest.get('subject'))
        if (expected is None or not manifest.get('reference_reviewed') or
                policy.get('assessment') != 'notes' or body.input_mode not in (policy.get('input_modes') or []) or
                set(policy.get('dimensions') or []) != {'pitch', 'timing'} or
                policy.get('rubric_version') != body.rubric_version):
            raise HTTPException(409, 'This reference does not support this challenge input.')
        if revision.id != body.revision_id or manifest['reference']['sha256'] != body.reference_sha256:
            raise HTTPException(409, 'The reviewed reference changed. Reopen the lesson.')
        duration = manifest['duration']
        if abs(body.start) > 1e-6 or abs(body.end - duration) > 1e-6:
            raise HTTPException(422, 'A challenge report must cover the whole reviewed piece.')
        sections = manifest['section_set']['sections']
        if len(body.sections) != len(sections):
            raise HTTPException(422, 'Challenge sections must match the reviewed lesson.')
        known = {(section['id'], round(section['start'], 6), round(section['end'], 6)) for section in sections}
        reported = {(section.id, round(section.start, 6), round(section.end, 6)) for section in body.sections}
        if reported != known:
            raise HTTPException(422, 'Challenge sections must match the reviewed lesson.')
        summary = body.model_dump(mode='json')
        summary.update({
            'summary_version': 2,
            'assessment': 'unscored',
            'section_id': 'all',
            'run': 0,
            'speed': 1,
            'note_window': {
                'total': body.counts.expected_required,
                'eligible': body.counts.assessed_required,
                'matched': body.counts.matched_required,
                'missing': body.counts.missing_required,
                'extra': body.counts.extra,
            },
        })
        existing = session.get(MusicPracticeAttempt, str(body.id))
        if existing:
            if existing.account_id != account.id or existing.lesson_id != lesson_id or existing.summary != summary:
                raise HTTPException(409, 'Attempt identifier already has different contents.')
            return result(existing)
        session.scalar(select(Account).where(Account.id == account.id).with_for_update())
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
