"""Acceptance and release state for the everyday move workflow."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import (Group, GroupLesson, Lesson, LessonAcceptance, LessonGrant,
                       LessonPublication, LessonRevision, LessonTag)
from .permissions import access_reasons, latest_acceptance, latest_revision, owned_lesson


class AcceptInput(BaseModel):
    revision_id: str = Field(min_length=1, max_length=80)
    warnings: list[str] = Field(default_factory=list, max_length=50)


def public_tags(session, lesson_id):
    return list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id == lesson_id).order_by(LessonTag.tag)).all())


def status(session, lesson, preloaded=None):
    if preloaded is None:
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
        tags = public_tags(session, lesson.id)
    else:
        latest, acceptance, publication, direct, groups, tags = preloaded[lesson.id]
    from .lessons import subject_projection
    return {
        'lesson_id': lesson.id,
        # Owner view: the draft label, not a snapshot frozen at release time.
        **subject_projection(lesson, latest, current=True),
        'latest_revision_id': latest.id if latest else None,
        'accepted_revision_id': acceptance.revision_id if acceptance else None,
        'accepted_at': acceptance.accepted_at.isoformat() if acceptance and acceptance.accepted_at else None,
        'published_revision_id': lesson.published_revision_id,
        'distribution': lesson.distribution,
        'audiences': {'direct': int(direct), 'groups': int(groups), 'public': bool(publication and publication.listed and not publication.moderation_hidden)},
        'public_listing': None if not publication or not publication.listed or publication.moderation_hidden else {
            'title': publication.title, 'creator_name': publication.creator_name,
            'tags': tags, 'listed_at': publication.listed_at.isoformat() if publication.listed_at else None,
        },
    }


def install_workflow(app, identity, db):
    router = APIRouter(prefix='/api/workflow')

    @router.get('/lessons')
    def statuses(account=Depends(identity), session: Session = Depends(db)):
        lessons = session.scalars(select(Lesson).where(Lesson.owner_id == account.id, Lesson.archived.is_(False),
                                                        Lesson.disabled.is_(False)).order_by(Lesson.created_at.desc())).all()
        ids = [lesson.id for lesson in lessons]
        revisions = {row.lesson_id: row for row in session.scalars(select(LessonRevision).join(
            Lesson, Lesson.id == LessonRevision.lesson_id).where(
            LessonRevision.lesson_id.in_(ids), LessonRevision.version == Lesson.version)).all()} if ids else {}
        acceptances = {}
        for row in session.scalars(select(LessonAcceptance).where(
                LessonAcceptance.lesson_id.in_(ids)).order_by(LessonAcceptance.accepted_at.asc())).all() if ids else []:
            acceptances[row.lesson_id] = row
        publications = {row.lesson_id: row for row in session.scalars(select(LessonPublication).where(
            LessonPublication.lesson_id.in_(ids))).all()} if ids else {}
        direct = dict(session.execute(select(LessonGrant.lesson_id, func.count()).where(
            LessonGrant.lesson_id.in_(ids), LessonGrant.revoked.is_(False)).group_by(LessonGrant.lesson_id)).all()) if ids else {}
        groups = dict(session.execute(select(GroupLesson.lesson_id, func.count()).join(
            Group, Group.id == GroupLesson.group_id).where(
            GroupLesson.lesson_id.in_(ids), Group.archived.is_(False)).group_by(GroupLesson.lesson_id)).all()) if ids else {}
        tags = {}
        for lesson_id, tag in session.execute(select(LessonTag.lesson_id, LessonTag.tag).where(
                LessonTag.lesson_id.in_(ids)).order_by(LessonTag.tag)).all() if ids else []:
            tags.setdefault(lesson_id, []).append(tag)
        preloaded = {lesson_id: (revisions.get(lesson_id), acceptances.get(lesson_id),
                                 publications.get(lesson_id), int(direct.get(lesson_id, 0)),
                                 int(groups.get(lesson_id, 0)), tags.get(lesson_id, []))
                     for lesson_id in ids}
        return {'lessons': [status(session, lesson, preloaded) for lesson in lessons]}

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
        # One shared readiness rule for every Act; acceptance remains revision-bound.
        from .editor_lifecycle import ensure_reviewable
        ensure_reviewable(lesson, revision)
        from .permissions import accept_revision
        record = accept_revision(session, lesson, revision, account.id, warnings=body.warnings, source='owner')
        session.commit()
        return status(session, lesson) | {'warnings': record.warnings}

    app.include_router(router)
