"""Real PostgreSQL row-lock verification. Creates and removes only its own fixtures."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import urlparse
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session
from apps.api.auth import COOKIE,csrf_token,digest,now
from apps.api.config import Settings,ROOT
from apps.api.database import Account,Lesson,LessonRevision,LoginSession,MimicPair
from apps.api.main import create_app

pytestmark=pytest.mark.skipif(os.environ.get('FORM_TEST_LOCAL_SERVICES')!='1',reason='Requires local integration opt-in')

def test_concurrent_receiver_retries_enqueue_once_in_postgresql():
    settings=Settings();assert settings.environment=='development' and urlparse(settings.sqlalchemy_url).hostname in ('localhost','127.0.0.1')
    app=create_app(settings);engine=app.state.engine;owner,lesson,revision,token=[uuid4().hex for _ in range(4)]
    manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text());manifest.update(lesson_id=lesson,revision_id=revision)
    def client():
        value=TestClient(app);value.cookies.set(COOKIE,token);value.headers.update({'Origin':settings.public_url,'X-Form-Request':'1','X-CSRF-Token':csrf_token(token)});return value
    try:
        with Session(engine) as session:
            session.add(Account(id=owner,email=owner+'@example.test',password_hash='unused fixture',verified=True));session.flush()
            session.add(LoginSession(token_hash=digest(token),account_id=owner,expires_at=now()+timedelta(hours=1)))
            session.add(Lesson(id=lesson,owner_id=owner,title='Mimic database verification'));session.flush()
            session.add(LessonRevision(id=revision,lesson_id=lesson,version=1,manifest=manifest));session.commit()
        with client() as capture:
            pair=capture.post('/api/mimic-pairs',json={'lesson_id':lesson,'revision_id':revision}).json()
            receiver=capture.post('/api/mimic-pairs/claim',json={'code':pair['code']}).json();path='/api/mimic-pairs/'+pair['id']
            assert capture.post(path+'/approve',headers={'X-Mimic-Token':pair['token']},json={}).status_code==200
            body={'id':str(uuid4()),'sequence':1,'action':'resume'}
            def send(_):
                with client() as remote:return remote.post(path+'/commands',headers={'X-Mimic-Token':receiver['token']},json=body).status_code
            with ThreadPoolExecutor(max_workers=2) as pool:assert list(pool.map(send,range(2)))==[200,200]
            assert len(capture.get(path,headers={'X-Mimic-Token':pair['token']}).json()['commands'])==1
    finally:
        with Session(engine) as session:
            for model,clause in [(MimicPair,MimicPair.account_id==owner),(LoginSession,LoginSession.account_id==owner),(LessonRevision,LessonRevision.lesson_id==lesson),(Lesson,Lesson.id==lesson),(Account,Account.id==owner)]:session.execute(delete(model).where(clause))
            session.commit()
        engine.dispose()
