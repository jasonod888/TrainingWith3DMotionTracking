"""Private drawing authoring: ordered steps saved as immutable revisions.

Drawing has no AI processing route. A save is an explicit private revision; review
and public release use the same shared lifecycle/publication endpoints as every Act.
"""
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .contracts import Asset, DrawingLessonManifest, DrawingStep
from .database import Lesson, LessonRevision
from .permissions import latest_revision, owned_lesson
from . import rollout


class DrawingInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=200)
    medium: Literal['pencil', 'charcoal', 'digital'] = 'pencil'
    steps: list[DrawingStep] = Field(min_length=1, max_length=200)
    poster: Asset | None = None
    reference_guide: Asset | None = None
    warnings: list[str] = Field(default_factory=list)
    feedback_enabled: bool | None = None


class DrawingUpdate(DrawingInput):
    base_revision_id: str = Field(min_length=1, max_length=80)


def _manifest(lesson_id: str, revision_id: str, body: DrawingInput) -> DrawingLessonManifest:
    return DrawingLessonManifest(
        lesson_id=lesson_id, revision_id=revision_id, title=body.title,
        medium=body.medium, steps=body.steps, poster=body.poster,
        reference_guide=body.reference_guide, warnings=body.warnings,
        feedback_enabled=body.feedback_enabled)


def install_drawing(app, identity, db):
    router = APIRouter(prefix='/api/drawing')

    @router.post('/lessons', status_code=201)
    def create(body: DrawingInput, account=Depends(identity), session: Session = Depends(db)):
        rollout.require('act_drawing_enabled', 'Drawing is not enabled on this deployment.')
        lesson_id, revision_id = uuid4().hex, uuid4().hex
        manifest = _manifest(lesson_id, revision_id, body)
        session.add(Lesson(id=lesson_id, owner_id=account.id, title=body.title,
                           subject='drawing', experience_family='visual', instrument=None,
                           act_id='drawing', version=1))
        session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=1,
                                   manifest=manifest.model_dump(), subject='drawing',
                                   experience_family='visual', instrument=None,
                                   act_id='drawing'))
        session.commit()
        return manifest.model_dump()

    @router.put('/lessons/{lesson_id}')
    def save(lesson_id: str, body: DrawingUpdate,
             account=Depends(identity), session: Session = Depends(db)):
        rollout.require('act_drawing_enabled', 'Drawing is not enabled on this deployment.')
        lesson = owned_lesson(session, lesson_id, account.id, True)
        from . import acts
        try:
            lesson_act = acts.resolve_act(lesson.act_id, lesson.subject)
        except acts.ActError:
            lesson_act = None
        if lesson.act_id != 'drawing' or lesson_act is None or lesson_act.id != 'drawing':
            raise HTTPException(409, 'This lesson is not a drawing lesson.')
        latest = latest_revision(session, lesson)
        if latest is None or latest.id != body.base_revision_id:
            raise HTTPException(409, 'This drawing has a newer saved revision. Reopen it.')
        revision_id = uuid4().hex
        manifest = _manifest(lesson_id, revision_id, body)
        version = (latest.version or 1) + 1
        session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=version,
                                   manifest=manifest.model_dump(), subject='drawing',
                                   experience_family='visual', instrument=None,
                                   act_id='drawing'))
        lesson.version = version
        lesson.title = body.title
        session.commit()
        return manifest.model_dump()

    app.include_router(router)
