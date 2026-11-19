"""Authenticated, plan-scoped practice progress and neutral attempts.

Progress is scoped by (account, lesson, revision, plan). The legacy body progress
endpoint and Act-specific attempt tables remain unchanged; this is the shared
service the client syncs to for every Act, with local storage as its fallback.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from . import acts
from .auth import now
from .database import PracticeAttempt, PracticePlanProgress
from .permissions import readable_lesson

AttemptStatus = Literal['completed', 'interrupted', 'unassessed', 'insufficient_evidence']


class ProgressInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lesson_id: str = Field(min_length=1, max_length=80)
    revision_id: str = Field(min_length=1, max_length=80)
    plan_id: str = Field(min_length=1, max_length=160)
    unit_id: str | None = Field(default=None, max_length=120)
    time: float = Field(ge=0, allow_inf_nan=False)
    speed: float = Field(gt=0, le=4, allow_inf_nan=False)
    mode: Literal['sections', 'continuous'] = 'sections'
    loop: bool = False
    repetitions: int = Field(default=0, ge=0, le=100)
    countdown_seconds: int = Field(default=0, ge=0, le=60)
    rest_seconds: float = Field(default=0.0, ge=0, le=120)


class AttemptInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: str = Field(min_length=1, max_length=80)
    lesson_id: str = Field(min_length=1, max_length=80)
    revision_id: str = Field(min_length=1, max_length=80)
    act_id: str = Field(min_length=1, max_length=16)
    mode: Literal['watch', 'practice', 'challenge']
    plan_id: str = Field(min_length=1, max_length=160)
    unit_id: str | None = Field(default=None, max_length=120)
    duration_ms: int = Field(ge=0)
    status: AttemptStatus
    assessment_adapter: str | None = Field(default=None, max_length=80)
    rubric_version: str | None = Field(default=None, max_length=80)
    report: dict | None = None


def _progress_dict(row: PracticePlanProgress) -> dict:
    return {
        'lesson_id': row.lesson_id, 'revision_id': row.revision_id, 'plan_id': row.plan_id,
        'unit_id': row.unit_id, 'time': row.time, 'speed': row.speed, 'mode': row.mode,
        'loop': row.loop, 'repetitions': row.repetitions,
        'countdown_seconds': row.countdown_seconds, 'rest_seconds': row.rest_seconds,
        'updated_at': row.updated_at.isoformat() if row.updated_at else None,
    }


def _attempt_dict(row: PracticeAttempt) -> dict:
    return {
        'attempt_id': row.id, 'lesson_id': row.lesson_id, 'revision_id': row.revision_id,
        'act_id': row.act_id, 'mode': row.mode, 'plan_id': row.plan_id,
        'unit_id': row.unit_id, 'duration_ms': row.duration_ms, 'status': row.status,
        'assessment_adapter': row.assessment_adapter, 'rubric_version': row.rubric_version,
        'report': row.report,
        'created_at': row.created_at.isoformat() if row.created_at else None,
    }


def validate_attempt(body: AttemptInput) -> None:
    """Reject an internally inconsistent envelope before it is stored."""
    if body.act_id not in acts.ACT_IDS:
        raise HTTPException(422, 'This attempt uses an unsupported Act.')
    if body.status == 'unassessed' and (body.assessment_adapter or body.rubric_version):
        raise HTTPException(422, 'An unassessed attempt cannot claim an assessment adapter.')
    if body.status == 'completed' and not (body.assessment_adapter and body.rubric_version):
        raise HTTPException(422, 'A completed assessed attempt needs its adapter and rubric.')
    if body.report is not None and not isinstance(body.report, dict):
        raise HTTPException(422, 'The attempt report must be an object.')


def install_practice_progress(app, identity, db):
    router = APIRouter(prefix='/api/practice')

    @router.get('/progress')
    def get_progress(lesson_id: str, plan_id: str, revision_id: str | None = None,
                     account=Depends(identity), session: Session = Depends(db)):
        if not plan_id:
            raise HTTPException(422, 'A practice plan is required.')
        _lesson, revision = readable_lesson(session, lesson_id, account.id, revision_id)
        if revision_id and revision.id != revision_id:
            raise HTTPException(409, 'This lesson has a newer revision. Reopen it to resume.')
        row = session.get(PracticePlanProgress, (account.id, lesson_id, revision.id, plan_id))
        return _progress_dict(row) if row else None

    @router.put('/progress')
    def put_progress(body: ProgressInput, account=Depends(identity), session: Session = Depends(db)):
        _lesson, revision = readable_lesson(session, body.lesson_id, account.id, body.revision_id)
        if revision.id != body.revision_id:
            raise HTTPException(409, 'This lesson has a newer revision. Reopen it to save your position.')
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert = pg_insert if session.get_bind().dialect.name == 'postgresql' else sqlite_insert
        values = {
            'account_id': account.id, 'lesson_id': body.lesson_id,
            'revision_id': body.revision_id, 'plan_id': body.plan_id,
            'unit_id': body.unit_id, 'time': body.time, 'speed': body.speed,
            'mode': body.mode, 'loop': body.loop, 'repetitions': body.repetitions,
            'countdown_seconds': body.countdown_seconds, 'rest_seconds': body.rest_seconds,
            'updated_at': now(),
        }
        statement = insert(PracticePlanProgress).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=['account_id', 'lesson_id', 'revision_id', 'plan_id'],
            set_={key: value for key, value in values.items()
                  if key not in ('account_id', 'lesson_id', 'revision_id', 'plan_id')})
        session.execute(statement)
        session.commit()
        row = session.get(PracticePlanProgress,
                          (account.id, body.lesson_id, body.revision_id, body.plan_id))
        return _progress_dict(row)

    @router.post('/attempts', status_code=201)
    def create_attempt(body: AttemptInput, account=Depends(identity), session: Session = Depends(db)):
        validate_attempt(body)
        _lesson, revision = readable_lesson(session, body.lesson_id, account.id, body.revision_id)
        if revision.id != body.revision_id:
            raise HTTPException(409, 'This attempt refers to an outdated revision.')
        existing = session.get(PracticeAttempt, body.attempt_id)
        if existing:
            if existing.account_id != account.id:
                raise HTTPException(409, 'This attempt id is already in use.')
            # Same attempt delivered twice: report it, do not duplicate it.
            return JSONResponse(_attempt_dict(existing), status_code=200)
        row = PracticeAttempt(
            id=body.attempt_id, account_id=account.id, lesson_id=body.lesson_id,
            revision_id=body.revision_id, act_id=body.act_id, mode=body.mode,
            plan_id=body.plan_id, unit_id=body.unit_id, duration_ms=body.duration_ms,
            status=body.status, assessment_adapter=body.assessment_adapter,
            rubric_version=body.rubric_version, report=body.report)
        session.add(row)
        session.commit()
        return _attempt_dict(row)

    @router.get('/attempts')
    def list_attempts(lesson_id: str, revision_id: str | None = None,
                      limit: int = 50, account=Depends(identity), session: Session = Depends(db)):
        _lesson, revision = readable_lesson(session, lesson_id, account.id, revision_id)
        if revision_id and revision.id != revision_id:
            raise HTTPException(409, 'This lesson has a newer revision.')
        rows = session.scalars(select(PracticeAttempt).where(
            PracticeAttempt.account_id == account.id,
            PracticeAttempt.lesson_id == lesson_id,
            PracticeAttempt.revision_id == revision.id)
            .order_by(desc(PracticeAttempt.created_at), desc(PracticeAttempt.id)).limit(max(1, min(limit, 100)))).all()
        return [_attempt_dict(row) for row in rows]

    app.include_router(router)
