"""One shared editor lifecycle/readiness contract for every Act.

This is the server-owned truth for "may this revision be reviewed/released?".
Act-specific validation lives behind the same contract:

* body playback validity is its manifest/timeline (3D animation or MediaPipe clip);
* music playback validity is a reviewed reference;
* assessment readiness is optional and never blocks review or practice.

The lifecycle values mirror the client contract. Processing job state stays in the
conversion record: a completed job only ever produces ``needs-review`` work here.
"""
from typing import Literal

from pydantic import BaseModel, Field

from . import acts, policy as policy_mod
from .database import LessonPublication
from .permissions import latest_acceptance, latest_revision


class ReadinessBlocker(BaseModel):
    code: str
    message: str


class EditorReadiness(BaseModel):
    playbackValid: bool
    assessmentReady: bool
    reviewReady: bool
    assessmentSupport: Literal['supported', 'unsupported', 'unavailable']
    unassessedReason: str | None = None
    blockers: list[ReadinessBlocker] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _descriptor(lesson, revision=None):
    act_id = getattr(lesson, 'act_id', None) or getattr(revision, 'act_id', None)
    subject = getattr(revision, 'subject', None) or getattr(lesson, 'subject', None)
    return acts.resolve_act(act_id, subject)


def _empty_readiness(message: str) -> EditorReadiness:
    return EditorReadiness(
        playbackValid=False, assessmentReady=False, reviewReady=False,
        assessmentSupport='unsupported', unassessedReason=message,
        blockers=[ReadinessBlocker(code='no_playable_revision', message=message)],
    )


def readiness_for(lesson, revision) -> EditorReadiness:
    """Resolve playback validity and optional assessment readiness for an Act."""
    try:
        descriptor = _descriptor(lesson, revision)
    except acts.ActError as exc:
        return _empty_readiness(str(exc))

    manifest = revision.manifest or {}
    warnings = [str(value) for value in (manifest.get('warnings') or [])]
    if descriptor.experience_family == 'body':
        engine = manifest.get('engine')
        playback = bool(manifest.get('animation')) or (
            engine == 'mediapipe' and bool(manifest.get('source_video'))
            and bool(manifest.get('landmarks')))
        playback_reason = ('This movement has no 3D reference or video-only source.'
                           if not playback else None)
        assessment_support = 'supported' if descriptor.assessment_adapters else 'unsupported'
        feedback = manifest.get('feedback_enabled') is not False
        assessment_ready = assessment_support == 'supported' and feedback
        if assessment_support != 'supported':
            unassessed = 'This Act has no assessment adapter.'
        elif not feedback:
            unassessed = 'The creator turned assessment feedback off.'
        else:
            unassessed = None
        review_ready = playback and bool(manifest.get('section_set'))
    elif descriptor.experience_family == 'visual':
        steps = manifest.get('steps') or []
        # Playback validity for drawing means an ordered, minimally complete step list.
        playback = bool(steps) and all(
            isinstance(step, dict) and step.get('id') and step.get('title') for step in steps)
        playback_reason = ('Add at least one valid drawing step.' if not playback else None)
        assessment_support = 'unsupported'
        assessment_ready = False
        unassessed = 'This Act has no assessment adapter.'
        review_ready = playback
    else:
        reference = manifest.get('reference') or {}
        reviewed = manifest.get('reference_reviewed') is True
        playback = bool(reference) and reviewed
        playback_reason = ('Review the reference before using this lesson.'
                           if not reviewed else
                           'This music lesson has no reviewed reference.' if not reference else None)
        policy = manifest.get('assessment') or {}
        kind = policy.get('assessment', 'none')
        assessment_support = 'supported' if kind != 'none' else 'unsupported'
        feedback = manifest.get('feedback_enabled')
        feedback = (kind != 'none') if feedback is None else bool(feedback)
        assessment_ready = assessment_support == 'supported' and feedback
        if assessment_support != 'supported':
            unassessed = 'This reference has no assessment policy.'
        elif not feedback:
            unassessed = 'The creator turned assessment feedback off.'
        else:
            unassessed = None
        review_ready = playback and bool(manifest.get('section_set'))

    blockers = []
    if not playback:
        blockers.append(ReadinessBlocker(
            code='invalid_playback', message=playback_reason or 'This lesson has no valid playback.'))
    return EditorReadiness(
        playbackValid=playback,
        assessmentReady=assessment_ready,
        reviewReady=review_ready,
        assessmentSupport=assessment_support,
        unassessedReason=unassessed,
        blockers=blockers,
        warnings=warnings,
    )


def lifecycle_for(lesson, revision, acceptance) -> str:
    """Saved revision state. Processing/cancelled live on the conversion job."""
    if revision is None:
        return 'needs-review'
    if acceptance is None or acceptance.revision_id != revision.id:
        return 'needs-review'
    if lesson.published_revision_id == revision.id:
        return 'saved-private'
    return 'ready-to-release'


def editor_state(session, lesson) -> dict:
    revision = latest_revision(session, lesson)
    acceptance = latest_acceptance(session, lesson.id)
    publication = session.get(LessonPublication, lesson.id)
    try:
        descriptor = _descriptor(lesson, revision)
        act_id = descriptor.id
        family = descriptor.experience_family
        policy = acts.publication_policy(descriptor.id)
    except acts.ActError:
        act_id, family, policy, descriptor = None, None, None, None

    readiness = (readiness_for(lesson, revision) if revision is not None
                 else _empty_readiness('This lesson has no saved revision yet.'))
    accepted_current = bool(revision and acceptance and acceptance.revision_id == revision.id)
    can_publish_public = False
    if revision is not None and accepted_current and policy is not None:
        from . import publication as publication_mod
        answer = publication_mod.publishability(
            session, lesson, revision, 'public', rights_acknowledged=True,
            existing_roles=publication.roles if publication else None)
        can_publish_public = bool(answer.publishable)
    return {
        'lesson_id': lesson.id,
        'act_id': act_id,
        'experience_family': family,
        'lifecycle': lifecycle_for(lesson, revision, acceptance),
        'latest_revision_id': revision.id if revision else None,
        'accepted_revision_id': acceptance.revision_id if acceptance else None,
        'published_revision_id': lesson.published_revision_id,
        'public_listed': bool(publication and publication.listed
                              and not publication.moderation_hidden),
        'readiness': readiness.model_dump(),
        'actions': (policy_mod.action_set(descriptor, revision.manifest or {})
                    if revision is not None and descriptor is not None else
                    {'watch': False, 'practice': False, 'challenge': False}),
        'can_save': revision is not None,
        'can_review': bool(revision and readiness.reviewReady and not accepted_current),
        'can_publish_private': bool(revision and accepted_current),
        'can_publish_public': can_publish_public,
    }


def ensure_reviewable(lesson, revision) -> None:
    """Raise 409 when an Act-specific review prerequisite is not met.

    Kept in this module so the accept endpoint, music review and music edit all
    consult one readiness rule instead of re-implementing playback checks.
    """
    from fastapi import HTTPException

    readiness = readiness_for(lesson, revision)
    if not readiness.playbackValid:
        raise HTTPException(409, readiness.blockers[0].message
                            if readiness.blockers else 'This lesson has no valid playback.')
    if not readiness.reviewReady:
        raise HTTPException(409, 'This lesson is not ready for review yet.')
