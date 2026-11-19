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
from . import acts, publication as publication_mod
from .database import Lesson, LessonAcceptance, LessonGrant, LessonPublication, LessonRevision


def _act_for(lesson, revision=None):
    """Resolve the Act behind a lesson without inferring one from the payload."""
    subject = getattr(revision, 'subject', None) or getattr(lesson, 'subject', None)
    act_id = getattr(lesson, 'act_id', None) or getattr(revision, 'act_id', None)
    return acts.resolve_act(act_id, subject)


def _is_music(lesson, revision):
    """True when the lesson belongs to a music Act.

    A stored v2 manifest is also music even if identity metadata is missing, so
    the existing strict check is preserved rather than replaced.
    """
    try:
        if _act_for(lesson, revision).experience_family == 'music':
            return True
    except acts.ActError:
        pass
    return (getattr(revision, 'manifest', None) or {}).get('schema_version') == 2


def audience_for(session, lesson, account_id, reasons):
    """Coarse audience label for the negotiated context envelope.

    Separate from ``access_reasons`` so a share-link reader is still described as a
    link without changing the authorization decisions those reasons drive.
    """
    if 'owner' in reasons:
        return 'owner'
    if 'group' in reasons:
        return 'group'
    if 'direct' in reasons:
        grant = session.get(LessonGrant, (lesson.id, account_id)) if account_id else None
        return 'link' if grant is not None and grant.source == 'link' else 'invited'
    return 'public'


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
        released = session.get(LessonRevision, lesson.published_revision_id)
        if released:
            try:
                policy = acts.publication_policy(_act_for(lesson, released).id)
            except acts.ActError:
                policy = None
            # Listed metadata without an approved role is not a public lesson.
            if (policy is not None and policy.public
                    and publication_mod.effective_roles(publication, released.manifest)):
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
    """Create the acceptance for an exact revision. Idempotent; never changes the manifest.

    A music revision is accepted only through its reference review. The movement
    check and the two legacy shortcuts (publish, trim-with-accept) must not be able
    to accept unreviewed music.
    """
    if _is_music(lesson, revision) and source != 'music-review':
        raise HTTPException(409, 'Accept this music lesson through the reference review, not the movement check.')
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
    """Point the shared release at an accepted revision.

    Body revisions may be accepted at publish time for legacy compatibility. A music
    revision is accepted only by its owner review, and only the latest reviewed revision
    may become the shared release; this never publishes music publicly.
    """
    try:
        descriptor = _act_for(lesson, revision)
    except acts.ActError as exc:
        raise HTTPException(409, str(exc)) from exc
    if descriptor.experience_family == 'music':
        record = accepted(session, lesson.id, revision.id)
        if not record or record.source != 'music-review' or record.account_id != lesson.owner_id or account_id != lesson.owner_id:
            raise HTTPException(409, 'Save the reviewed reference before sharing this music lesson.')
        current = latest_revision(session, lesson)
        if current is None or current.id != revision.id:
            raise HTTPException(409, 'Review the latest music revision before sharing it.')
        manifest = revision.manifest or {}
        if not manifest.get('reference_reviewed'):
            raise HTTPException(409, 'This music reference is not reviewed.')
        # Feedback availability is a creator choice, not a publication prerequisite.
        lesson.published_revision_id = revision.id
        return record
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
    """Public projection source: a listed, accepted release with approved roles."""
    lesson = active_lesson(session, lesson_id)
    if not lesson:
        raise HTTPException(404, 'Move unavailable.')
    publication = session.get(LessonPublication, lesson_id)
    if not publication or not publication.listed or publication.moderation_hidden or not lesson.published_revision_id:
        raise HTTPException(404, 'Move unavailable.')
    revision = session.get(LessonRevision, lesson.published_revision_id)
    if not revision or revision.lesson_id != lesson_id or not accepted(session, lesson_id, revision.id):
        raise HTTPException(404, 'Move unavailable.')
    roles = publication_mod.effective_roles(publication, revision.manifest)
    if not roles:
        raise HTTPException(404, 'Move unavailable.')
    try:
        descriptor = _act_for(lesson, revision)
        policy = acts.publication_policy(descriptor.id)
    except acts.ActError as exc:
        raise HTTPException(404, 'Move unavailable.') from exc
    if not policy.public:
        raise HTTPException(404, 'Move unavailable.')
    return lesson, revision, publication


def public_manifest(revision, publication, tags, act_id=None, lesson_id=None):
    """Project only the approved public roles; every private media slot is nulled."""
    try:
        descriptor = acts.resolve_act(act_id, revision.manifest.get('subject'))
        policy = acts.publication_policy(descriptor.id)
    except acts.ActError as exc:
        raise HTTPException(404, 'Move unavailable.') from exc
    if not policy.public:
        raise HTTPException(404, 'Move unavailable.')
    roles = publication_mod.effective_roles(publication, revision.manifest)
    if not roles:
        raise HTTPException(404, 'Move unavailable.')
    if lesson_id is None:
        # Derive from a stored asset key for callers that only hold the revision.
        for value in (revision.manifest or {}).values():
            if isinstance(value, dict) and str(value.get('key', '')).startswith('lessons/'):
                lesson_id = value['key'].split('/')[1]
                break
    if not lesson_id:
        raise HTTPException(404, 'Move unavailable.')
    return publication_mod.project_manifest(
        revision.manifest, lesson_id, roles,
        title=publication.title or revision.manifest.get('title', 'Move'),
        creator=publication.creator_name, tags=tags)


def visible_manifest(session, lesson, revision, account_id):
    """Use the same private-media boundary for detail and paired displays."""
    if (revision.manifest or {}).get('schema_version') != 1:
        # Music needs its own projection and paired-display capabilities; the body
        # helper must never hand a v2 object to a body-shaped caller.
        raise HTTPException(404, 'Move unavailable.')
    _, reasons = access_reasons(session, lesson.id, account_id)
    if reasons == ['public'] or ('owner' in reasons and revision.id != latest_revision(session, lesson).id):
        from .database import LessonTag
        tags = list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id == lesson.id)))
        publication = session.get(LessonPublication, lesson.id)
        if publication and publication.listed and not publication.moderation_hidden:
            return public_manifest(revision, publication, tags,
                                   act_id=_act_for(lesson, revision).id, lesson_id=lesson.id)
        from .music_assessment import with_effective_feedback
        return with_effective_feedback({**revision.manifest, 'source_video': None, 'focused_video': None, 'thumbnail': None})
    from .music_assessment import with_effective_feedback
    return with_effective_feedback(revision.manifest)
