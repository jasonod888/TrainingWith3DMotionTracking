"""Publish a complete, validated source/avatar revision; old assets are retained.

Default is read-only inspection. --apply uploads versioned keys then switches the
lesson revision in one database transaction. Public releases remain unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from sqlalchemy.orm import Session
from apps.api.config import Settings
from apps.api.contracts import LessonManifest
from apps.api.database import Lesson,LessonRevision,LessonAsset,make_engine
from apps.api.permissions import latest_revision
from apps.api.storage import storage_client


def publish(lesson_id,folder,apply=False):
    settings=Settings();engine=make_engine(settings.sqlalchemy_url)
    grounding=json.loads((folder/'floor-data.json').read_text())
    summary=json.loads((folder/'avatar-report.json').read_text())
    paths={name:folder/name for name in ('floor-guided.glb','avatar-male.glb','avatar-female.glb','avatar-report.json')}
    hashes={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in paths.items()}
    if summary['source']['sha256']!=hashes['floor-guided.glb']:
        raise ValueError('Avatar summary does not match corrected source.')
    for avatar in ('male','female'):
        report=summary['avatars'][avatar]
        if report.get('status')!='ok' or report['source']['sha256']!=hashes['floor-guided.glb']:
            raise ValueError('Avatar validation or source identity mismatch.')
    with Session(engine) as session:
        lesson=session.get(Lesson,lesson_id)
        if not lesson or lesson.disabled or lesson.archived:raise ValueError('Lesson is unavailable.')
        previous=latest_revision(session,lesson)
        if previous.manifest['animation']['sha256']!=grounding['source_sha256']:
            raise ValueError('Lesson source changed since correction was generated.')
        original=LessonManifest.model_validate(previous.manifest)
        previous_id=previous.id;version=lesson.version
    print(f'Prepared complete grounded revision for {lesson_id}: MHR + male + female. Previous revision {previous_id}.')
    if not apply:return
    revision_id=uuid4().hex;store=storage_client(settings);assets={}
    for name,path in paths.items():
        mime='application/json' if name.endswith('.json') else 'model/gltf-binary'
        key=f'lessons/{lesson_id}/grounded-{revision_id}-{name}'
        with path.open('rb') as stream:
            store.put_object(Bucket=settings.storage_bucket,Key=key,Body=stream,
                             ContentType=mime,Metadata={'sha256':hashes[name]})
        head=store.head_object(Bucket=settings.storage_bucket,Key=key)
        if head['ContentLength']!=path.stat().st_size or head.get('Metadata',{}).get('sha256')!=hashes[name]:
            raise ValueError('Uploaded asset verification failed; revision not switched.')
        assets[name]={'key':key,'mime':mime,'bytes':path.stat().st_size,'sha256':hashes[name]}
    value=original.model_dump()
    value.update(revision_id=revision_id,animation=assets['floor-guided.glb'],root_motion='floor-guided',
                 presentation={avatar:assets[f'avatar-{avatar}.glb'] for avatar in ('male','female')})
    value['section_set']['revision']=version+1
    value['presentation']['report']=assets['avatar-report.json']
    value['warnings']=[w for w in original.warnings if not w.startswith('Floor movement')]
    value['warnings'].append('Floor movement corrected using a fixed-camera estimate. Review tracking, pose and foot placement.')
    manifest=LessonManifest.model_validate(value)
    with Session(engine) as session:
        lesson=session.scalar(select(Lesson).where(Lesson.id==lesson_id).with_for_update())
        if lesson.version!=version or latest_revision(session,lesson).id!=previous_id:
            raise ValueError('Lesson changed; uploaded revision not activated.')
        backup=folder/f'previous-manifest-{previous_id}.json'
        backup.write_text(json.dumps(latest_revision(session,lesson).manifest,indent=2),encoding='utf-8')
        for asset in assets.values():session.add(LessonAsset(lesson_id=lesson_id,**asset))
        lesson.version=version+1
        session.add(LessonRevision(id=revision_id,lesson_id=lesson_id,version=version+1,manifest=manifest.model_dump()))
        session.commit()
    engine.dispose();print(f'Activated revision {revision_id}; prior revision and assets retained. Public release unchanged.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--lesson',required=True)
    p.add_argument('--folder',required=True,type=Path);p.add_argument('--apply',action='store_true')
    a=p.parse_args();publish(a.lesson,a.folder,a.apply)
