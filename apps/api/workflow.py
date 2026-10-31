"""Acceptance and release state for the everyday move workflow."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import Lesson, LessonAcceptance, LessonGrant, LessonPublication, LessonTag
from .permissions import access_reasons, latest_acceptance, latest_revision, owned_lesson


class AcceptInput(BaseModel):
    revision_id: str = Field(min_length=1, max_length=80)
    warnings: list[str] = Field(default_factory=list, max_length=50)


def public_tags(session, lesson_id):
    return list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id == lesson_id).order_by(LessonTag.tag)).all())


def status(session, lesson):
    latest = latest_revision(session, lesson)
    acceptance = latest_acceptance(session, lesson.id)
    publication = session.get(LessonPublication, lesson.id)
    direct = session.scalar(select(func.count()).select_from(LessonGrant).where(
        LessonGrant.lesson_id == lesson.id, LessonGrant.revoked.is_(False))) or 0
    groups = 0
    try:
        from .groups import group_count
        groups = group_count(session, lesson.id)
    except ImportError:
        pass
    return {
        'lesson_id': lesson.id,
        'latest_revision_id': latest.id if latest else None,
        'accepted_revision_id': acceptance.revision_id if acceptance else None,
        'accepted_at': acceptance.accepted_at.isoformat() if acceptance and acceptance.accepted_at else None,
        'published_revision_id': lesson.published_revision_id,
        'distribution': lesson.distribution,
        'audiences': {'direct': int(direct), 'groups': int(groups), 'public': bool(publication and publication.listed and not publication.moderation_hidden)},
        'public_listing': None if not publication or not publication.listed or publication.moderation_hidden else {
            'title': publication.title, 'creator_name': publication.creator_name,
            'tags': public_tags(session, lesson.id), 'listed_at': publication.listed_at.isoformat() if publication.listed_at else None,
        },
    }


def install_workflow(app, identity, db):
    router = APIRouter(prefix='/api/workflow')

    @router.get('/lessons')
    def statuses(account=Depends(identity), session: Session = Depends(db)):
        lessons = session.scalars(select(Lesson).where(Lesson.owner_id == account.id, Lesson.archived.is_(False),
                                                        Lesson.disabled.is_(False)).order_by(Lesson.created_at.desc())).all()
        return {'lessons': [status(session, lesson) for lesson in lessons]}

    @router.get('/lessons/{lesson_id}')
    def one(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        lesson, reasons = access_reasons(session, lesson_id, account.id)
        if not lesson or not reasons:
            raise HTTPException(404, 'Move unavailable.')
        if 'owner' not in reasons:
            return {'lesson_id': lesson.id, 'published_revision_id': lesson.published_revision_id,
                    'accepted_revision_id': lesson.published_revision_id, 'latest_revision_id': lesson.published_revision_id,
                    'distribution': lesson.distribution, 'audiences': {'direct': 0, 'groups': 0, 'public': 'public' in reasons},
                    'public_listing': None}
        return status(session, lesson)

    @router.post('/lessons/{lesson_id}/accept')
    def accept(lesson_id: str, body: AcceptInput, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        revision = latest_revision(session, lesson)
        if not revision or revision.id != body.revision_id:
            raise HTTPException(409, 'This move changed. Reopen it before accepting.')
        from .permissions import accept_revision
        record = accept_revision(session, lesson, revision, account.id, warnings=body.warnings, source='owner')
        session.commit()
        return status(session, lesson) | {'warnings': record.warnings}

    app.include_router(router)
