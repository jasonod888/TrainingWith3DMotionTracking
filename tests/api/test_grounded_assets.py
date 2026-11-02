from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import system,imported
from apps.api.database import LessonAsset,LessonRevision
from apps.api.public import public_keys


def test_revision_avatar_assets_require_lesson_access(system):
    lesson=imported(system);client,app,_,_,store=system
    key=f'lessons/{lesson.lesson_id}/grounded-revision-avatar-male.glb'
    asset={'key':key,'mime':'model/gltf-binary','bytes':6,'sha256':'a'*64}
    with Session(app.state.engine) as session:
        revision=session.get(LessonRevision,lesson.revision_id)
        revision.manifest={**revision.manifest,'root_motion':'floor-guided','presentation':{'male':asset}}
        session.add(LessonAsset(lesson_id=lesson.lesson_id,**asset));session.commit()
    store.objects[key]=b'avatar'
    route=f'/api/lessons/{lesson.lesson_id}/assets/{Path(key).name}'
    assert client.get(route).content==b'avatar'
    with TestClient(app) as anonymous:
        assert anonymous.get(route).status_code in (401,404)
    assert client.get(route.replace('grounded-revision','other-revision')).status_code==404


def test_public_presentation_excludes_report():
    value=public_keys({'presentation':{k:{'key':f'lessons/one/{k}.glb'} for k in ('male','female','report')}},'one')
    assert set(value['presentation'])=={'male','female'}
    assert value['presentation']['male']['key']=='public/one/male.glb'
