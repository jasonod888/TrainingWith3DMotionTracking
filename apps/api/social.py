"""Neutral social discovery, deterministic recommendations and idempotent likes.

Discovery reads only released public metadata: title, creator display name,
subjects, tags, poster, duration, roles/representations and like counts. It never
reads camera frames, audio, practice evidence or private corrections.
"""
from math import log1p

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import acts, publication as publication_mod, rollout
from .database import (Lesson, LessonAcceptance, LessonLike, LessonPublication,
                       LessonRevision, LessonTag)
from .permissions import public_lesson

SOCIAL_POLICY = 'deterministic-social-v1'


def like_counts(session, lesson_ids, viewer_id=None):
    ids = list(dict.fromkeys(lesson_ids))
    counts = {}
    liked = set()
    if not ids:
        return counts, liked
    rows = session.execute(select(LessonLike.lesson_id, func.count()).where(
        LessonLike.lesson_id.in_(ids)).group_by(LessonLike.lesson_id)).all()
    counts = {lesson_id: int(count) for lesson_id, count in rows}
    if viewer_id:
        liked = set(session.scalars(select(LessonLike.lesson_id).where(
            LessonLike.lesson_id.in_(ids), LessonLike.account_id == viewer_id)).all())
    return counts, liked


def _action_set(lesson, revision):
    try:
        descriptor = acts.resolve_act(getattr(lesson, 'act_id', None) or getattr(revision, 'act_id', None),
                                      revision.subject or lesson.subject)
    except acts.ActError:
        return {'watch': False, 'practice': False, 'challenge': False}
    manifest = revision.manifest or {}
    practice = 'practice' in descriptor.practice_modes and bool(
        manifest.get('animation') or manifest.get('landmarks')
        or manifest.get('source_video') or manifest.get('reference')
        or manifest.get('steps'))
    challenge = ('challenge' in descriptor.practice_modes
                 and bool(descriptor.assessment_adapters)
                 and manifest.get('feedback_enabled') is not False)
    return {'watch': True, 'practice': practice, 'challenge': challenge}


def discovery_item(session, publication, lesson, viewer_id=None, likes=None, preloaded=None):
    if preloaded is not None:
        revision = preloaded['revisions'].get(lesson.published_revision_id)
    else:
        revision = session.get(LessonRevision, lesson.published_revision_id) if lesson.published_revision_id else None
    if revision is None:
        return None
    if preloaded is not None:
        accepted = (lesson.id, revision.id) in preloaded['accepted']
        tags = preloaded['tags'].get(lesson.id, [])
    else:
        accepted = session.scalar(select(LessonAcceptance.id).where(
            LessonAcceptance.lesson_id == lesson.id,
            LessonAcceptance.revision_id == revision.id))
        tags = _tags(session, lesson.id)
    if not accepted:
        return None
    roles = publication_mod.effective_roles(publication, revision.manifest)
    if not roles:
        return None
    try:
        descriptor = acts.resolve_act(
            getattr(lesson, 'act_id', None) or getattr(revision, 'act_id', None),
            revision.subject or lesson.subject)
    except acts.ActError:
        return None
    from .lessons import subject_projection
    projection = subject_projection(lesson, revision)
    manifest = revision.manifest or {}
    poster = (manifest.get('public_poster') or manifest.get('poster')) if 'poster' in roles else None
    representations = sorted({publication_mod.REPRESENTATION_FOR_ROLE[role] for role in roles})
    if likes is None:
        counts, liked = like_counts(session, [lesson.id], viewer_id)
    else:
        counts, liked = likes
    creator_name = publication.creator_name
    return {
        'lesson_id': lesson.id,
        'release_revision': revision.id,
        'act_id': descriptor.id,
        'title': publication.title or lesson.title,
        'creator': {'id': lesson.owner_id, 'display_name': creator_name},
        'subjects': [{'id': projection['subject'], 'label': projection['subject_label']}],
        'tags': list(tags),
        'poster': ({'url': f"/api/public/moves/{lesson.id}/assets/{poster['key'].split('/')[-1]}"}
                   if poster else None),
        'duration': float(manifest.get('duration') or 0),
        'content': {'sections': len((manifest.get('section_set') or {}).get('sections') or [])},
        'roles': roles,
        'representations': representations,
        'effective_actions': _action_set(lesson, revision),
        'audience': 'public',
        'like_count': counts.get(lesson.id, 0),
        'liked_by_viewer': lesson.id in liked,
        # Legacy fields kept for existing cards/clients.
        'creator_name': creator_name,
        'description': publication.description,
        'thumbnail_url': (f"/api/public/moves/{lesson.id}/assets/{poster['key'].split('/')[-1]}"
                          if poster else None),
        **projection,
    }


def _tags(session, lesson_id):
    return list(session.scalars(select(LessonTag.tag).where(
        LessonTag.lesson_id == lesson_id).order_by(LessonTag.tag)).all())


def discovery_items(session, rows, viewer_id=None):
    """Build a page of items with a constant number of batch queries.

    Revisions, acceptances, tags and likes are fetched with ``IN``/``GROUP BY``
    rather than once per card, so page size never changes the query count.
    """
    rows = list(rows)
    if not rows:
        return []
    lesson_ids = [lesson.id for _publication, lesson in rows]
    revision_ids = [lesson.published_revision_id for _publication, lesson in rows
                    if lesson.published_revision_id]
    revisions = {revision.id: revision for revision in session.scalars(
        select(LessonRevision).where(LessonRevision.id.in_(revision_ids)))}
    accepted = {(lesson_id, revision_id) for lesson_id, revision_id in session.execute(
        select(LessonAcceptance.lesson_id, LessonAcceptance.revision_id).where(
            LessonAcceptance.lesson_id.in_(lesson_ids))).all()}
    tag_map: dict[str, list[str]] = {}
    for lesson_id, tag in session.execute(select(LessonTag.lesson_id, LessonTag.tag).where(
            LessonTag.lesson_id.in_(lesson_ids)).order_by(LessonTag.tag)).all():
        tag_map.setdefault(lesson_id, []).append(tag)
    counts, liked = like_counts(session, lesson_ids, viewer_id)
    preloaded = {'revisions': revisions, 'accepted': accepted, 'tags': tag_map}
    items = []
    for publication, lesson in rows:
        item = discovery_item(session, publication, lesson, viewer_id,
                              likes=(counts, liked), preloaded=preloaded)
        if item:
            items.append(item)
    return items


def visible_rows(session, *, act: str | None = None, subject: str | None = None,
                 tag: str | None = None, q: str | None = None, exclude_lesson_id: str | None = None):
    """Released, visible rows. All filtering happens before pagination."""
    statement = select(LessonPublication, Lesson).join(
        Lesson, Lesson.id == LessonPublication.lesson_id).join(
        LessonRevision, LessonRevision.id == Lesson.published_revision_id).where(
        LessonPublication.listed.is_(True), LessonPublication.moderation_hidden.is_(False),
        Lesson.archived.is_(False), Lesson.disabled.is_(False),
        LessonPublication.roles.is_not(None))
    if not rollout.enabled('act_drawing_enabled'):
        statement = statement.where(Lesson.act_id != 'drawing')
    if not rollout.enabled('public_music_enabled'):
        statement = statement.where(Lesson.experience_family != 'music')
    if exclude_lesson_id:
        statement = statement.where(Lesson.id != exclude_lesson_id)
    if act:
        statement = statement.where(Lesson.act_id == act)
    if subject:
        statement = statement.where(LessonRevision.subject == subject)
    if tag:
        statement = statement.join(
            LessonTag, LessonTag.lesson_id == LessonPublication.lesson_id).where(
            LessonTag.tag == tag)
    if q:
        like = f'%{q[:80]}%'
        from sqlalchemy import or_
        statement = statement.where(or_(LessonPublication.title.ilike(like),
                                        LessonPublication.creator_name.ilike(like)))
    return statement


def score_candidate(seed, candidate):
    seed_tags = set(seed['tags'])
    candidate_tags = set(candidate['tags'])
    shared = sorted(seed_tags & candidate_tags)
    score = 0
    if candidate['act_id'] == seed['act_id']:
        score += 5
    if candidate['subjects'][0]['id'] == seed['subjects'][0]['id']:
        score += 2
    score += 3 * len(shared)
    score += min(3.0, log1p(candidate['like_count']))
    if candidate['creator']['id'] == seed['creator']['id']:
        score += 1
    if shared:
        reason, matched = 'shared_tags', {'tags': shared}
    elif candidate['act_id'] == seed['act_id']:
        reason, matched = 'same_act', {'act_id': seed['act_id']}
    elif candidate['subjects'][0]['id'] == seed['subjects'][0]['id']:
        reason, matched = 'same_subject', {'subject': seed['subjects'][0]['id']}
    elif candidate['like_count']:
        reason, matched = 'popular', {'like_count': candidate['like_count']}
    else:
        reason, matched = 'newest', {}
    return score, reason, matched


def recommendations(session, lesson_id=None, limit=12, viewer_id=None):
    """Deterministic, explainable recommendations with diversity caps."""
    limit = max(1, min(limit, 24))
    # Bound DB rows before hydrating. Recency is a cheap deterministic prefilter;
    # ranking still happens only inside this bounded candidate set.
    candidate_limit = min(max(limit * 5, 60), 240)
    seed = None
    if lesson_id:
        _lesson, _revision, publication = public_lesson(session, lesson_id)
        from .database import Lesson
        seed_lesson = session.get(Lesson, lesson_id)
        seed = discovery_item(session, publication, seed_lesson, viewer_id)
        if seed is None:
            raise HTTPException(404, 'Move unavailable.')
        rows = session.execute(
            visible_rows(session, exclude_lesson_id=lesson_id)
            .order_by(LessonPublication.listed_at.desc().nullslast(),
                      LessonPublication.lesson_id).limit(candidate_limit)).all()
    else:
        rows = session.execute(
            visible_rows(session)
            .order_by(LessonPublication.listed_at.desc().nullslast(),
                      LessonPublication.lesson_id).limit(candidate_limit)).all()

    candidates = discovery_items(session, rows, viewer_id)
    if not candidates:
        return {'policy': SOCIAL_POLICY, 'items': [], 'candidate_count': len(rows),
                'candidate_limit': candidate_limit}

    if seed is None:
        fallback = candidates[:limit]
        return {'policy': SOCIAL_POLICY, 'items': [
            {**item, 'explanation': {'reason': 'newest_fallback', 'policy': SOCIAL_POLICY}}
            for item in fallback], 'candidate_count': len(rows),
            'candidate_limit': candidate_limit}

    scored = []
    for item in candidates:
        score, reason, matched = score_candidate(seed, item)
        scored.append((score, item, reason, matched))
    scored.sort(key=lambda row: (-row[0], -row[1]['like_count'], row[1]['lesson_id']))

    picked = []
    per_creator: dict[str, int] = {}
    per_act: dict[str, int] = {}
    for _score, item, reason, matched in scored:
        creator = item['creator']['id']
        act = item['act_id']
        if per_creator.get(creator, 0) >= 3 or per_act.get(act, 0) >= 3:
            continue
        per_creator[creator] = per_creator.get(creator, 0) + 1
        per_act[act] = per_act.get(act, 0) + 1
        picked.append({**item, 'explanation': {
            'reason': reason, 'policy': SOCIAL_POLICY, 'matched': matched}})
        if len(picked) >= limit:
            break
    return {'policy': SOCIAL_POLICY, 'items': picked, 'candidate_count': len(rows),
            'candidate_limit': candidate_limit}


def _surface_enabled(lesson) -> bool:
    if getattr(lesson, 'act_id', None) == 'drawing' and not rollout.enabled('act_drawing_enabled'):
        return False
    if getattr(lesson, 'experience_family', None) == 'music' and not rollout.enabled('public_music_enabled'):
        return False
    return True


def install_social(app, identity, db, optional_identity=None):
    router = APIRouter(prefix='/api/social')

    @router.put('/moves/{lesson_id}/like')
    @router.post('/moves/{lesson_id}/like')
    def like(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        rollout.require('social_likes_enabled', 'Likes are not enabled on this deployment.')
        # Liking requires a currently visible, accepted release with roles.
        lesson = public_lesson(session, lesson_id)[0]
        if not _surface_enabled(lesson):
            raise HTTPException(404)
        try:
            session.add(LessonLike(lesson_id=lesson_id, account_id=account.id))
            session.commit()
        except IntegrityError:
            session.rollback()  # idempotent: the unique pair already exists
        counts, _ = like_counts(session, [lesson_id], account.id)
        return {'liked': True, 'like_count': counts.get(lesson_id, 0)}

    @router.delete('/moves/{lesson_id}/like')
    def unlike(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        rollout.require('social_likes_enabled', 'Likes are not enabled on this deployment.')
        row = session.get(LessonLike, (lesson_id, account.id))
        if row is not None:
            session.delete(row)
            session.commit()
        counts, _ = like_counts(session, [lesson_id], account.id)
        return {'liked': False, 'like_count': counts.get(lesson_id, 0)}

    @router.get('/moves/{lesson_id}/likes')
    def likes(lesson_id: str, account=Depends(identity), session: Session = Depends(db)):
        public_lesson(session, lesson_id)
        counts, liked = like_counts(session, [lesson_id], account.id)
        return {'like_count': counts.get(lesson_id, 0), 'liked': lesson_id in liked}

    app.include_router(router)
