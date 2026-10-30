"""Real PostgreSQL/S3 ownership and restart-connection checks, local opt-in only."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import urlparse
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from apps.api.auth import COOKIE, csrf_token, digest, now, password_hash
from apps.api.config import ROOT, Settings
from apps.api.database import Account, AccountToken, Lesson, LessonAsset, LessonRevision, LoginSession, PracticeProgress
from apps.api.lessons import import_fixture
from apps.api.main import create_app
from apps.api.storage import storage_client

pytestmark = pytest.mark.skipif(os.environ.get('FORM_TEST_LOCAL_SERVICES') != '1', reason='Local services opt-in required')


def test_private_revision_assets_concurrency_and_reconnection():
    settings = Settings()
    assert settings.environment == 'development'
    assert urlparse(settings.sqlalchemy_url).hostname in ('localhost', '127.0.0.1')
    assert urlparse(settings.storage_endpoint or '').hostname in ('localhost', '127.0.0.1')
    app = create_app(settings)
    engine = app.state.engine
    store = storage_client(settings)
    ids = [uuid4().hex, uuid4().hex]
    raw = [uuid4().hex+uuid4().hex, uuid4().hex+uuid4().hex]
    lessons = []
    try:
        with Session(engine) as session:
            for account_id in ids:
                session.add(Account(id=account_id, email=f'{account_id}@integration.invalid', password_hash=password_hash('integration only password'), verified=True))
            session.flush()
            for account_id, token in zip(ids, raw):
                session.add(LoginSession(token_hash=digest(token), account_id=account_id, expires_at=now()+timedelta(hours=1)))
            session.commit()
        lesson = import_fixture(engine, settings, ids[0], ROOT/'packages/lesson-schema/fixture.json', ROOT/'packages/lesson-schema')
        lessons.append(lesson)
        path = f'/api/lessons/{lesson.lesson_id}'
        media = path+'/assets/synthetic.glb'
        headers = {'Origin':settings.public_url,'X-Form-Request':'1','X-CSRF-Token':csrf_token(raw[0])}
        with TestClient(app) as owner, TestClient(app) as stranger:
            owner.cookies.set(COOKIE, raw[0])
            owner.headers.update(headers)
            stranger.cookies.set(COOKIE, raw[1])
            assert stranger.get(path).status_code == 404
            assert stranger.get(media).status_code == 404
            assert stranger.get('/api/lessons').json() == []
            result = owner.get(media, headers={'Range':'bytes=0-15'})
            assert result.status_code == 206 and result.content == (ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()[:16]
            assert result.headers['content-range'] == f'bytes 0-15/{lesson.animation.bytes}'
            with httpx.Client(trust_env=False) as anonymous:
                assert anonymous.get(f'{settings.storage_endpoint}/{settings.storage_bucket}/{lesson.animation.key}').status_code == 403
            sections = [s.model_dump() for s in lesson.section_set.sections]
            sections[0]['label'] = 'Saved privately'
            body = {'base_revision_id':lesson.revision_id,'title':'Persistent private fixture','sections':sections}
            # Independent clients/connections issue the same base revision concurrently.
            def save(_):
                with TestClient(app) as browser:
                    browser.cookies.set(COOKIE, raw[0])
                    return browser.put(path+'/sections', headers=headers, json=body).status_code
            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses = list(pool.map(save, range(2)))
            assert sorted(statuses) == [200, 409]
            engine.dispose()
            with TestClient(create_app(settings)) as reopened:
                reopened.cookies.set(COOKIE, raw[0])
                manifest = reopened.get(path).json()
                assert manifest['section_set']['sections'][0]['label'] == 'Saved privately'
                assert manifest['section_set']['revision'] == 2
                assert reopened.get(media).content == (ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
            progress = {'revision_id':manifest['revision_id'],'time':1.1,'speed':.75,'mode':'sections'}
            assert owner.put(path+'/progress',json=progress).status_code == 200
            engine.dispose()
            assert owner.get(path+'/progress').json() == progress
            assert stranger.get(path+'/progress').status_code == 404
            assert owner.request('DELETE',path,json={}).status_code == 200
            assert owner.get(path).status_code == 404
            assert owner.get(media).status_code == 404
    finally:
        for lesson in lessons:
            for asset in (lesson.animation, lesson.landmarks):
                store.delete_object(Bucket=settings.storage_bucket,Key=asset.key)
            with engine.begin() as connection:
                connection.execute(delete(PracticeProgress).where(PracticeProgress.lesson_id == lesson.lesson_id))
                connection.execute(delete(LessonAsset).where(LessonAsset.lesson_id == lesson.lesson_id))
                connection.execute(delete(LessonRevision).where(LessonRevision.lesson_id == lesson.lesson_id))
                connection.execute(delete(Lesson).where(Lesson.id == lesson.lesson_id))
        with engine.begin() as connection:
            connection.execute(delete(LoginSession).where(LoginSession.account_id.in_(ids)))
            connection.execute(delete(AccountToken).where(AccountToken.account_id.in_(ids)))
            connection.execute(delete(Account).where(Account.id.in_(ids)))
        engine.dispose()
