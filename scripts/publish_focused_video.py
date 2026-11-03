"""Attach a focused video to an existing lesson as a new immutable revision.

Use the exporter first. The report must match the lesson's exact source bytes.
Defaults to validation only; --apply stores the video and activates the revision.
Old assets and public releases are retained. No reconstruction is repeated.
"""
import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from sqlalchemy.orm import Session
from apps.api.config import Settings
from apps.api.contracts import Asset, LessonManifest
from apps.api.database import Lesson, LessonAsset, LessonRevision, make_engine
from apps.api.permissions import latest_revision
from apps.api.storage import storage_client
from focus_instructor_video import digest


def publish(lesson_id, video, apply=False):
    video = Path(video)
    report = json.loads(video.with_suffix('.json').read_text(encoding='utf-8'))
    if report.get('version') not in ('focused-instructor-v1','focused-instructor-v2') or report.get('video_sha256') != digest(video):
        raise ValueError('Focused video does not match its export report.')
    settings = Settings()
    engine = make_engine(settings.sqlalchemy_url)
    try:
        with Session(engine) as session:
            lesson = session.get(Lesson, lesson_id)
            if not lesson or lesson.disabled or lesson.archived:
                raise ValueError('Lesson unavailable.')
            previous = latest_revision(session, lesson)
            manifest = LessonManifest.model_validate(previous.manifest)
            if not manifest.source_video or manifest.source_video.sha256 != report.get('source_sha256'):
                raise ValueError('Focused video belongs to a different source.')
            previous_id, version = previous.id, lesson.version
        print(f'Validated focused video for lesson {lesson_id}; crop {report["crop"]}.')
        if not apply:
            return
        revision_id = uuid4().hex
        asset = Asset(key=f'lessons/{lesson_id}/{revision_id}-instructor.mp4', mime='video/mp4',
                      bytes=video.stat().st_size, sha256=report['video_sha256'])
        store = storage_client(settings)
        with video.open('rb') as stream:
            store.put_object(Bucket=settings.storage_bucket, Key=asset.key, Body=stream,
                             ContentType=asset.mime, Metadata={'sha256': asset.sha256})
        head = store.head_object(Bucket=settings.storage_bucket, Key=asset.key)
        if head['ContentLength'] != asset.bytes or head.get('Metadata', {}).get('sha256') != asset.sha256:
            raise ValueError('Uploaded video failed verification; revision not activated.')
        with Session(engine) as session:
            lesson = session.scalar(select(Lesson).where(Lesson.id == lesson_id).with_for_update())
            if (not lesson or lesson.disabled or lesson.archived or lesson.version != version
                    or latest_revision(session, lesson).id != previous_id):
                raise ValueError('Lesson changed; revision not activated.')
            manifest.focused_video = asset
            manifest.focused_video_start = manifest.source_start
            manifest.revision_id = revision_id
            manifest.section_set.revision = version + 1
            lesson.version = version + 1
            session.add(LessonAsset(lesson_id=lesson_id, **asset.model_dump()))
            session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=version + 1,
                                       manifest=manifest.model_dump()))
            session.commit()
        print(f'Activated focused video revision {revision_id}. Public release unchanged.')
    finally:
        engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lesson', required=True)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    publish(args.lesson, args.video, args.apply)
