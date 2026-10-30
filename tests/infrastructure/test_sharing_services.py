"""Publication and revocation using real local PostgreSQL/S3, with synthetic data only."""
import os
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session
from apps.api.auth import COOKIE,csrf_token,digest,now,password_hash
from apps.api.config import ROOT,Settings
from apps.api.database import Account,AccountToken,Lesson,LessonAsset,LessonGrant,LessonInvitation,LessonReport,LessonRevision,LoginSession,PracticeProgress
from apps.api.lessons import import_fixture
from apps.api.main import create_app
from apps.api.storage import storage_client

pytestmark=pytest.mark.skipif(os.environ.get('FORM_TEST_LOCAL_SERVICES')!='1',reason='Local services opt-in required')


def test_real_published_access_and_revocation():
    settings=Settings()
    assert settings.environment=='development' and urlparse(settings.sqlalchemy_url).hostname in ('127.0.0.1','localhost')
    assert urlparse(settings.storage_endpoint or '').hostname in ('127.0.0.1','localhost')
    app=create_app(settings);engine=app.state.engine;store=storage_client(settings)
    ids=[uuid4().hex,uuid4().hex];raw=[uuid4().hex+uuid4().hex,uuid4().hex+uuid4().hex];mail=[];lesson=None
    try:
        with Session(engine) as session:
            for identity in ids:session.add(Account(id=identity,email=f'{identity}@example.test',password_hash=password_hash('local synthetic test password'),verified=True))
            session.flush()
            for identity,token in zip(ids,raw):session.add(LoginSession(token_hash=digest(token),account_id=identity,expires_at=now()+timedelta(hours=1)))
            session.commit()
        lesson=import_fixture(engine,settings,ids[0],ROOT/'packages/lesson-schema/fixture.json',ROOT/'packages/lesson-schema')
        with patch('apps.api.auth.send_account_mail',side_effect=lambda s,e,p,t:mail.append(t)),TestClient(app) as owner,TestClient(app) as student:
            for client,token in zip((owner,student),raw):
                client.cookies.set(COOKIE,token);client.headers.update({'Origin':settings.public_url,'X-Form-Request':'1','X-CSRF-Token':csrf_token(token)})
            path=f'/api/lessons/{lesson.lesson_id}'
            publication={'revision_id':lesson.revision_id,'mode':'invite','reviewed':True,'rights_acknowledged':True}
            assert owner.post(path+'/publish',json=publication).status_code==200
            assert owner.post(path+'/invitations',json={'email':f'{ids[1]}@example.test'}).status_code==201
            assert student.post('/api/shares/accept',json={'invite':mail[-1]}).status_code==200
            media=path+'/assets/synthetic.glb'
            assert student.get(media).content==(ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
            engine.dispose()
            assert student.get(path).json()['revision_id']==lesson.revision_id
            assert owner.request('DELETE',path+'/students/'+ids[1],json={}).status_code==200
            assert student.get(path).status_code==404 and student.get(media).status_code==404
            assert student.post('/api/shares/inspect',json={'invite':mail[-1]}).status_code==404
            assert student.get('/api/shared-lessons').json()==[]
    finally:
        if lesson:
            for asset in (lesson.animation,lesson.landmarks):store.delete_object(Bucket=settings.storage_bucket,Key=asset.key)
            with engine.begin() as connection:
                for model in (LessonReport,LessonInvitation,LessonGrant,PracticeProgress,LessonAsset,LessonRevision):connection.execute(delete(model).where(model.lesson_id==lesson.lesson_id))
                connection.execute(delete(Lesson).where(Lesson.id==lesson.lesson_id))
        with engine.begin() as connection:
            for model in (LoginSession,AccountToken):connection.execute(delete(model).where(model.account_id.in_(ids)))
            connection.execute(delete(Account).where(Account.id.in_(ids)))
        engine.dispose()
