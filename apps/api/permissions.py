"""Shared authorization boundary: ownership, independent audience reasons and accepted releases.

Views do not implement their own permission rules. Every protected read resolves through
`access_reasons` and `readable_lesson`, and recipients only ever follow an accepted release.
"""
from datetime import timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import now
from .database import Lesson, LessonAcceptance, LessonGrant, LessonPublication, LessonRevision


def latest_revision(session, lesson):
    return session.scalar(select(LessonRevision).where(LessonRevision.lesson_id == lesson.id, LessonRevision.version == lesson.version))


def active_lesson(session, lesson_id):
    return session.scalar(select(Lesson).where(Lesson.id == lesson_id, Lesson.archived.is_(False), Lesson.disabled.is_(False)))


def owned_lesson(session, lesson_id, account_id, lock=False):
    statement = select(Lesson).where(Lesson.id == lesson_id, Lesson.owner_id == account_id,
                                    Lesson.archived.is_(False), Lesson.disabled.is_(False))
    lesson = session.scalar(statement.with_for_update() if lock else statement)
    if not lesson:
        raise HTTPException(404, 'Move unavailable.')
    return lesson


def _future(value):
    if not value:
        return False
    if not value.tzinfo:
        value = value.replace(tzinfo=now().tzinfo)
    return value > now()


def _direct_grant_valid(lesson, grant):
    if not grant or grant.revoked or not lesson.published_revision_id or lesson.distribution == 'private':
        return False
    if grant.source == 'link':
        return (lesson.distribution == 'link' and grant.generation == lesson.share_generation
                and bool(lesson.share_token_hash) and _future(lesson.share_expires_at))
    return True


def access_reasons(session, lesson_id, account_id):
    """Return (lesson, reasons). Reasons are additive: owner, direct, group, public."""
    lesson = active_lesson(session, lesson_id)
    if not lesson:
        return None, []
    if account_id and lesson.owner_id == account_id:
        return lesson, ['owner']
    reasons = []
    if account_id:
        grant = session.get(LessonGrant, (lesson_id, account_id))
        if _direct_grant_valid(lesson, grant):
            reasons.append('direct')
        if _group_reason(session, lesson, account_id):
            reasons.append('group')
    publication = session.get(LessonPublication, lesson_id)
    if publication and publication.listed and not publication.moderation_hidden and lesson.published_revision_id:
        reasons.append('public')
    return lesson, reasons


def _group_reason(session, lesson, account_id):
    """Group access is added in W5; the hook keeps the decision in one place."""
    try:
        from .groups import group_access
    except ImportError:
        return False
    return group_access(session, lesson, account_id)


def accepted(session, lesson_id, revision_id):
    return session.scalar(select(LessonAcceptance).where(
        LessonAcceptance.lesson_id == lesson_id, LessonAcceptance.revision_id == revision_id))


def latest_acceptance(session, lesson_id):
    return session.scalar(select(LessonAcceptance).where(LessonAcceptance.lesson_id == lesson_id)
                          .order_by(LessonAcceptance.accepted_at.desc()))


def accept_revision(session, lesson, revision, account_id, warnings=None, source='owner'):
    """Create the acceptance for an exact revision. Idempotent; never changes the manifest."""
    existing = accepted(session, lesson.id, revision.id)
    if existing:
        return existing
    record = LessonAcceptance(id=uuid4().hex, lesson_id=lesson.id, revision_id=revision.id,
                              account_id=account_id, warnings=list(warnings or []), source=source,
                              accepted_at=now())
    session.add(record)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        existing = accepted(session, lesson.id, revision.id)
        if not existing:
            raise
        return existing
    return record


def ensure_release(session, lesson, revision, account_id, source='publish'):
    """Point the shared release at an accepted revision, accepting it when legacy publishers did not."""
    record = accept_revision(session, lesson, revision, account_id, warnings=[], source=source)
    lesson.published_revision_id = revision.id
    return record


def readable_lesson(session, lesson_id, account_id, revision_id=None):
    lesson, reasons = access_reasons(session, lesson_id, account_id)
    if not lesson or not reasons:
        raise HTTPException(404, 'Move unavailable.')
    if 'owner' in reasons:
        if revision_id and revision_id == lesson.published_revision_id and accepted(session, lesson_id, revision_id):
            return lesson, session.get(LessonRevision, revision_id)
        return lesson, latest_revision(session, lesson)
    revision_id = lesson.published_revision_id
    revision = session.get(LessonRevision, revision_id) if revision_id else None
    if not revision or revision.lesson_id != lesson_id:
        raise HTTPException(404, 'Move unavailable.')
    if not accepted(session, lesson_id, revision.id):
        raise HTTPException(404, 'Move unavailable.')
    return lesson, revision


def public_lesson(session, lesson_id):
    """Public projection source: only a listed, accepted release is readable."""
    lesson = active_lesson(session, lesson_id)
    if not lesson:
        raise HTTPException(404, 'Move unavailable.')
    publication = session.get(LessonPublication, lesson_id)
    if not publication or not publication.listed or publication.moderation_hidden or not lesson.published_revision_id:
        raise HTTPException(404, 'Move unavailable.')
    revision = session.get(LessonRevision, lesson.published_revision_id)
    if not revision or revision.lesson_id != lesson_id or not accepted(session, lesson_id, revision.id):
        raise HTTPException(404, 'Move unavailable.')
    return lesson, revision, publication


def public_manifest(revision, publication, tags):
    """Remove private media and private identity from a manifest for public delivery."""
    value = dict(revision.manifest)
    value['source_video'] = None
    # Conversion thumbnails contain frames from the private upload, not the 3D model.
    value['thumbnail'] = None
    value['title'] = publication.title or value.get('title', 'Move')
    value['public_tags'] = tags
    value['public_creator'] = publication.creator_name
    return value


def visible_manifest(session, lesson, revision, account_id):
    """Use the same private-media boundary for detail and paired displays."""
    _, reasons = access_reasons(session, lesson.id, account_id)
    if reasons == ['public'] or ('owner' in reasons and revision.id != latest_revision(session, lesson).id):
        from .database import LessonTag
        tags = list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id == lesson.id)))
        publication = session.get(LessonPublication, lesson.id)
        if publication and publication.listed and not publication.moderation_hidden:
            from .public import public_keys
            return public_keys(public_manifest(revision, publication, tags), lesson.id)
        return {**revision.manifest, 'source_video': None, 'thumbnail': None}
    return revision.manifest
