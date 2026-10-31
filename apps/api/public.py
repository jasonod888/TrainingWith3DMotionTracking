"""Public listing: deliberate, tagged sharing of an accepted release without private media."""
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .auth import now
from .database import Lesson, LessonAsset, LessonPublication, LessonTag, LessonRevision
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


def listing_item(session, publication, lesson):
    revision = session.get(LessonRevision, lesson.published_revision_id)
    if not revision or not accepted(session, lesson.id, revision.id):
        return None
    thumbnail = None  # Source-frame thumbnails are private.
    return {
        'lesson_id': lesson.id,
        'title': publication.title or lesson.title,
        'creator_name': publication.creator_name,
        'description': publication.description,
        'tags': tags_for(session, lesson.id),
        'duration': revision.manifest['duration'],
        'thumbnail_url': f"/api/public/moves/{lesson.id}/assets/{Path(thumbnail['key']).name}" if thumbnail else None,
    }


def public_keys(manifest, lesson_id):
    value = dict(manifest)
    for field in ('animation', 'landmarks'):
        asset = value.get(field)
        if asset:
            value[field] = {**asset, 'key': f"public/{lesson_id}/{Path(asset['key']).name}"}
    value['source_video'] = None
    return value


def install_public(app, settings, identity, db):
    router = APIRouter(prefix='/api/public')

    @router.get('/moves')
    def moves(q: str = '', tag: str = '', limit: int = 24, offset: int = 0, session: Session = Depends(db)):
        limit = max(1, min(limit, 50))
        offset = max(0, offset)
        statement = select(LessonPublication, Lesson).join(Lesson, Lesson.id == LessonPublication.lesson_id).where(
            LessonPublication.listed.is_(True), LessonPublication.moderation_hidden.is_(False), Lesson.archived.is_(False), Lesson.disabled.is_(False))
        if tag.strip():
            statement = statement.join(LessonTag, LessonTag.lesson_id == LessonPublication.lesson_id).where(
                LessonTag.tag == re.sub(r'\s+', ' ', tag.strip().lower())[:30])
        if q.strip():
            like = f'%{q.strip()[:80]}%'
            statement = statement.where(or_(LessonPublication.title.ilike(like), LessonPublication.creator_name.ilike(like)))
        statement = statement.order_by(LessonPublication.listed_at.desc().nullslast(), LessonPublication.lesson_id).offset(offset).limit(limit)
        items = []
        for publication, lesson in session.execute(statement).all():
            item = listing_item(session, publication, lesson)
            if item:
                items.append(item)
        return {'moves': items}

    @router.get('/tags')
    def tags(limit: int = 20, session: Session = Depends(db)):
        limit = max(1, min(limit, 50))
        rows = session.execute(select(LessonTag.tag, func.count()).join(
            LessonPublication, LessonPublication.lesson_id == LessonTag.lesson_id).join(Lesson, Lesson.id == LessonPublication.lesson_id).where(
            LessonPublication.listed.is_(True), LessonPublication.moderation_hidden.is_(False), Lesson.archived.is_(False), Lesson.disabled.is_(False)).group_by(LessonTag.tag).order_by(func.count().desc(), LessonTag.tag).limit(limit)).all()
        return {'tags': [{'tag': tag, 'count': int(count)} for tag, count in rows]}

    @router.get('/moves/{lesson_id}')
    def detail(lesson_id: str, session: Session = Depends(db)):
        lesson, revision, publication = public_lesson(session, lesson_id)
        value = public_keys(public_manifest(revision, publication, tags_for(session, lesson.id)), lesson.id)
        value['creator_name'] = publication.creator_name
        value['description'] = publication.description
        value['tags'] = tags_for(session, lesson.id)
        return value

    @router.get('/moves/{lesson_id}/assets/{name}')
    def asset(lesson_id: str, name: str, request: Request, session: Session = Depends(db)):
        lesson, revision, _ = public_lesson(session, lesson_id)
        allowed = {Path(revision.manifest[field]['key']).name for field in ('animation', 'landmarks')
                   if revision.manifest.get(field)}
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
            raise HTTPException(409, 'Check this move before listing it publicly.')
        if not body.rights_acknowledged:
            raise HTTPException(422, 'Confirm you have the right to share this move publicly.')
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
        publication.listed = True
        publication.rights_acknowledged_at = now()
        publication.listed_at = now()
        publication.withdrawn_at = None
        session.execute(LessonTag.__table__.delete().where(LessonTag.lesson_id == lesson.id))
        for tag in tags:
            session.add(LessonTag(lesson_id=lesson.id, tag=tag))
        session.commit()
        return {'listed': True, 'title': title, 'creator_name': creator, 'tags': tags,
                'lesson_id': lesson.id, 'revision_id': revision.id}

    app.include_router(router)
