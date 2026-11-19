"""Public listing: deliberate, tagged sharing of an accepted release without private media."""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import now
from . import acts, publication as publication_mod, rollout
from .database import Lesson, LessonAsset, LessonPublication, LessonTag, LessonRevision, LessonAcceptance
from .permissions import accepted, latest_revision, owned_lesson, public_lesson, public_manifest
from .storage import storage_client


class PublicUpdate(BaseModel):
    listed: bool
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    creator_name: str | None = Field(default=None, max_length=80)
    tags: list[str] | None = Field(default=None, max_length=8)
    rights_acknowledged: bool = False
    release_revision_id: str | None = None
    # Explicit public representation allowlist. Omitted keeps the stored roles.
    public_roles: list[str] | None = Field(default=None, max_length=8)


def clean_tags(tags):
    values = []
    for raw in tags or []:
        value = re.sub(r'\s+', ' ', raw.strip().lower())
        value = re.sub(r'[^a-z0-9 -]', '', value)[:30]
        if value and value not in values:
            values.append(value)
    if len(values) > 8:
        raise HTTPException(422, 'Use up to 8 tags.')
    return values


def tags_for(session, lesson_id):
    return list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id == lesson_id).order_by(LessonTag.tag)).all())


def release_enabled(lesson) -> bool:
    """Temporary flags gate a surface, never the stored release itself."""
    if getattr(lesson, 'act_id', None) == 'drawing' and not rollout.enabled('act_drawing_enabled'):
        return False
    if getattr(lesson, 'experience_family', None) == 'music' and not rollout.enabled('public_music_enabled'):
        return False
    return True


def public_keys(manifest, lesson_id, roles=None):
    """Role-projected public manifest. Private media can never slip through."""
    roles = list(roles) if roles is not None else (
        ['interactive_data'] if (manifest or {}).get('animation') else [])
    return publication_mod.project_manifest(
        dict(manifest), lesson_id, roles,
        title=manifest.get('title', 'Move'), creator='', tags=[])


def install_public(app, settings, identity, db, optional_identity=None):
    from . import social
    viewer_dependency = Depends(optional_identity) if optional_identity is not None else Depends(lambda: None)
    router = APIRouter(prefix='/api/public')

    @router.get('/subjects')
    def subject_facets(session: Session = Depends(db)):
        from .subjects import subject_spec
        # Use released labels, never draft labels or a paginated/search-filtered page.
        released = select(LessonAcceptance.id).where(
            LessonAcceptance.lesson_id == Lesson.id,
            LessonAcceptance.revision_id == LessonRevision.id).exists()
        rows = session.execute(select(LessonRevision.subject, func.count()).select_from(LessonPublication)
            .join(Lesson, Lesson.id == LessonPublication.lesson_id)
            .join(LessonRevision, LessonRevision.id == Lesson.published_revision_id)
            .where(LessonPublication.listed.is_(True), LessonPublication.moderation_hidden.is_(False),
                   Lesson.archived.is_(False), Lesson.disabled.is_(False), released,
                   LessonPublication.roles.is_not(None))
            .group_by(LessonRevision.subject).order_by(LessonRevision.subject)).all()
        return {'subjects': [{'subject': subject_spec(subject).id,
                              'subject_label': subject_spec(subject).label, 'count': int(count)}
                             for subject, count in rows]}

    @router.get('/moves')
    def moves(q: str = '', tag: str = '', subject: str = '', act: str = '',
              limit: int = 24, offset: int = 0, viewer=viewer_dependency,
              session: Session = Depends(db)):
        from . import subjects
        wanted = None
        if subject.strip():
            try:
                wanted = subjects.subject_spec(subject).id
            except subjects.SubjectError as exc:
                raise HTTPException(422, str(exc)) from exc
        act_id = None
        if act.strip():
            try:
                act_id = acts.descriptor_for(act.strip()).id
            except acts.ActError as exc:
                raise HTTPException(422, str(exc)) from exc
        limit = max(1, min(limit, 50))
        offset = max(0, offset)
        if act_id == 'drawing' and not rollout.enabled('act_drawing_enabled'):
            raise HTTPException(404, 'Drawing is not enabled on this deployment.')
        cleaned_tag = re.sub(r'\s+', ' ', tag.strip().lower())[:30] if tag.strip() else None
        statement = social.visible_rows(
            session, act=act_id, subject=wanted, tag=cleaned_tag,
            q=q.strip() or None).order_by(
            LessonPublication.listed_at.desc().nullslast(),
            LessonPublication.lesson_id).offset(offset).limit(limit)
        rows = session.execute(statement).all()
        viewer_id = getattr(viewer, 'id', None)
        items = social.discovery_items(session, rows, viewer_id)
        return {'moves': items,
                'next_offset': offset + len(items) if len(items) == limit else None,
                'policy': social.SOCIAL_POLICY}

    @router.get('/recommendations')
    def recommendations(lesson_id: str | None = None, limit: int = 12,
                        viewer=viewer_dependency, session: Session = Depends(db)):
        rollout.require('social_recommendations_enabled', 'Recommendations are not enabled.')
        return social.recommendations(session, lesson_id, limit,
                                      getattr(viewer, 'id', None))

    @router.get('/tags')
    def tags(limit: int = 20, session: Session = Depends(db)):
        limit = max(1, min(limit, 50))
        rows = session.execute(select(LessonTag.tag, func.count()).join(
            LessonPublication, LessonPublication.lesson_id == LessonTag.lesson_id).join(Lesson, Lesson.id == LessonPublication.lesson_id)
            .join(LessonRevision,LessonRevision.id==Lesson.published_revision_id).where(
            LessonPublication.listed.is_(True), LessonPublication.moderation_hidden.is_(False), Lesson.archived.is_(False), Lesson.disabled.is_(False),
            LessonPublication.roles.is_not(None)).group_by(LessonTag.tag).order_by(func.count().desc(), LessonTag.tag).limit(limit)).all()
        return {'tags': [{'tag': tag, 'count': int(count)} for tag, count in rows]}

    @router.get('/moves/{lesson_id}')
    def detail(lesson_id: str, request: Request, viewer=viewer_dependency, session: Session = Depends(db)):
        lesson, revision, publication = public_lesson(session, lesson_id)
        if not release_enabled(lesson):
            raise HTTPException(404)
        formats = request.headers.get('X-Lesson-Formats')
        schema = (revision.manifest or {}).get('schema_version')
        if formats:
            advertised = {part.strip() for part in formats.split(',') if part.strip()}
            if (schema == 2 and '2' not in advertised) or (schema == 3 and '3' not in advertised):
                required = '3' if schema == 3 else '2'
                raise HTTPException(406, 'This lesson needs a newer version of the app. Refresh to update.',
                                    headers={'X-Lesson-Format-Required': required})
        try:
            descriptor = acts.resolve_act(lesson.act_id, revision.subject or lesson.subject)
        except acts.ActError as exc:
            raise HTTPException(404, 'Move unavailable.') from exc
        value = public_manifest(revision, publication, tags_for(session, lesson.id),
                                act_id=descriptor.id, lesson_id=lesson.id)
        item = social.discovery_item(session, publication, lesson, getattr(viewer, 'id', None))
        if item:
            for key in ('act_id', 'release_revision', 'creator', 'subjects',
                        'effective_actions', 'audience', 'like_count', 'liked_by_viewer',
                        'roles', 'representations'):
                value[key] = item[key]
        value['creator_name'] = publication.creator_name
        value['description'] = publication.description
        value['tags'] = tags_for(session, lesson.id)
        value['published_revision_id'] = revision.id
        return value

    @router.get('/moves/{lesson_id}/assets/{name}')
    def asset(lesson_id: str, name: str, request: Request, session: Session = Depends(db)):
        lesson, revision, publication = public_lesson(session, lesson_id)
        if not release_enabled(lesson):
            raise HTTPException(404)
        formats = request.headers.get('X-Lesson-Formats')
        schema = (revision.manifest or {}).get('schema_version')
        if formats:
            advertised = {part.strip() for part in formats.split(',') if part.strip()}
            if (schema == 2 and '2' not in advertised) or (schema == 3 and '3' not in advertised):
                required = '3' if schema == 3 else '2'
                raise HTTPException(406, 'This lesson needs a newer version of the app. Refresh to update.',
                                    headers={'X-Lesson-Format-Required': required})
        roles = publication_mod.effective_roles(publication, revision.manifest)
        allowed = publication_mod.allowed_asset_names(revision.manifest, roles)
        if name not in allowed:
            raise HTTPException(404, 'Media unavailable.')
        key = f'lessons/{lesson_id}/{name}'
        record = session.scalar(select(LessonAsset).where(LessonAsset.key == key, LessonAsset.lesson_id == lesson_id))
        if not record:
            raise HTTPException(404, 'Media unavailable.')
        options = {}
        byte_range = request.headers.get('range')
        if byte_range:
            if not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', byte_range):
                raise HTTPException(416, 'Unsupported byte range.')
            options['Range'] = byte_range
        try:
            obj = storage_client(settings).get_object(Bucket=settings.storage_bucket, Key=key, **options)
        except Exception as exc:
            from botocore.exceptions import ClientError
            if isinstance(exc, ClientError):
                status = exc.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
                raise HTTPException(416 if status == 416 else 404 if status == 404 else 503, 'Media unavailable.') from exc
            raise
        def stream():
            try:
                yield from obj['Body'].iter_chunks(chunk_size=256 * 1024)
            finally:
                obj['Body'].close()
        headers = {'Content-Length': str(obj['ContentLength']), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=300'}
        if 'ContentRange' in obj:
            headers['Content-Range'] = obj['ContentRange']
        return StreamingResponse(stream(), status_code=206 if 'ContentRange' in obj else 200,
                                 media_type=record.mime, headers=headers)

    @router.patch('/lessons/{lesson_id}')
    def update(lesson_id: str, body: PublicUpdate, account=Depends(identity), session: Session = Depends(db)):
        lesson = owned_lesson(session, lesson_id, account.id, True)
        publication = session.get(LessonPublication, lesson_id)
        if not body.listed:
            if publication:
                publication.listed = False
                publication.withdrawn_at = now()
                session.commit()
            return {'listed': False}
        # Metadata edits retain the current release. Advancing it is explicit.
        revision_id = body.release_revision_id or lesson.published_revision_id
        revision = session.get(LessonRevision, revision_id) if revision_id else latest_revision(session, lesson)
        if revision and revision.lesson_id != lesson.id:
            raise HTTPException(409, 'Choose an accepted version of this move.')
        if not revision or not accepted(session, lesson.id, revision.id):
            raise HTTPException(409, 'Check this revision before publishing it.')
        # Publication policy is Act-neutral. The release names its approved roles;
        # anything unapproved (source media, reports) is never projected.
        existing_roles = publication.roles if publication and publication.roles else None
        result = publication_mod.publishability(
            session, lesson, revision, 'public', body.public_roles,
            body.rights_acknowledged, existing_roles)
        if not result.publishable:
            if 'rights_not_acknowledged' in result.missing:
                raise HTTPException(422, 'Confirm you have the right to share this move publicly.')
            raise HTTPException(409, result.reasons[0] if result.reasons
                                else 'This lesson cannot be published with these representations.')
        title = (body.title if body.title is not None else (publication.title if publication and publication.title else lesson.title)).strip()
        creator = (body.creator_name if body.creator_name is not None else (publication.creator_name if publication else '')).strip()
        if not title:
            raise HTTPException(422, 'Add a public title.')
        if not creator or '@' in creator:
            raise HTTPException(422, 'Add a public display name (no email addresses).')
        tags = clean_tags(body.tags if body.tags is not None else (tags_for(session, lesson.id) if publication else []))
        if not tags:
            raise HTTPException(422, 'Add at least one tag.')
        if not publication:
            publication = LessonPublication(lesson_id=lesson.id)
            session.add(publication)
        lesson.published_revision_id = revision.id
        publication.revision_id = revision.id  # Compatibility mirror; reads use Lesson.
        publication.title = title
        publication.description = (body.description if body.description is not None else publication.description or '').strip()
        publication.creator_name = creator
        publication.roles = list(result.roles)
        publication.listed = True
        publication.rights_acknowledged_at = now()
        publication.listed_at = now()
        publication.withdrawn_at = None
        session.execute(LessonTag.__table__.delete().where(LessonTag.lesson_id == lesson.id))
        for tag in tags:
            session.add(LessonTag(lesson_id=lesson.id, tag=tag))
        session.commit()
        return {'listed': True, 'title': title, 'creator_name': creator, 'tags': tags,
                'lesson_id': lesson.id, 'revision_id': revision.id,
                'roles': list(publication.roles),
                'representations': result.representations}

    app.include_router(router)
