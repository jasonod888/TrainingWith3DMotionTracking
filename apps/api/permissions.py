"""Shared authorization boundary. Mimic views do not implement roles or ownership."""
from fastapi import HTTPException
from sqlalchemy import select
from .auth import now
from .database import Lesson,LessonGrant,LessonRevision


def latest_revision(session,lesson):
    return session.scalar(select(LessonRevision).where(LessonRevision.lesson_id==lesson.id,LessonRevision.version==lesson.version))


def owned_lesson(session,lesson_id,account_id,lock=False):
    statement=select(Lesson).where(Lesson.id==lesson_id,Lesson.owner_id==account_id,Lesson.archived.is_(False),Lesson.disabled.is_(False))
    lesson=session.scalar(statement.with_for_update() if lock else statement)
    if not lesson:raise HTTPException(404,'Lesson unavailable.')
    return lesson


def readable_lesson(session,lesson_id,account_id):
    lesson=session.scalar(select(Lesson).where(Lesson.id==lesson_id,Lesson.archived.is_(False),Lesson.disabled.is_(False)))
    if not lesson:raise HTTPException(404,'Lesson unavailable.')
    if lesson.owner_id==account_id:return lesson,latest_revision(session,lesson)
    grant=session.get(LessonGrant,(lesson_id,account_id))
    if not grant or grant.revoked or not lesson.published_revision_id or lesson.distribution=='private':raise HTTPException(404,'Lesson unavailable.')
    if grant.source=='link':
        expiry=lesson.share_expires_at
        if expiry and not expiry.tzinfo:expiry=expiry.replace(tzinfo=now().tzinfo)
        if lesson.distribution!='link' or grant.generation!=lesson.share_generation or not lesson.share_token_hash or not expiry or expiry<=now():raise HTTPException(404,'Lesson unavailable.')
    revision=session.get(LessonRevision,lesson.published_revision_id)
    if not revision or revision.lesson_id!=lesson_id:raise HTTPException(404,'Lesson unavailable.')
    return lesson,revision
