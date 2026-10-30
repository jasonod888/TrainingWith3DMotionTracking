"""Exercise security boundaries through HTTP, including revision and media access."""
import io
import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from pathlib import Path
from pydantic import ValidationError

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from apps.api.auth import COOKIE, digest, now
from apps.api.config import ROOT, Settings
from apps.api.database import Account, AccountToken, Base, Lesson, LessonRevision, LoginSession
from apps.api.lessons import import_fixture
from apps.api.main import create_app


class FakeStorage:
    def __init__(self):
        self.objects = {}

    def upload_file(self, path, bucket, key, **kwargs):
        self.objects[key] = Path(path).read_bytes()

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def get_object(self, Bucket, Key, **kwargs):
        body = io.BytesIO(self.objects[Key])
        class Stream:
            def iter_chunks(self, chunk_size):
                while data := body.read(chunk_size):
                    yield data
            def close(self):
                body.close()
        return {'Body': Stream(), 'ContentLength': len(self.objects[Key])}


@pytest.fixture
def system(tmp_path):
    settings = Settings(database_url=f'sqlite:///{(tmp_path/"accounts.db").as_posix()}', public_url='http://testserver',
                        demo_enabled=False, web_dist_dir=tmp_path/'no-web', _env_file=None)
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    mail, store = [], FakeStorage()
    with patch('apps.api.auth.send_account_mail', side_effect=lambda s,e,p,t: mail.append((e,p,t))), \
         patch('apps.api.lessons.storage_client', return_value=store), TestClient(app) as client:
        client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        yield client, app, settings, mail, store


def register(client, mail, email='owner@example.test', password='a long test password'):
    assert client.post('/api/auth/register', json={'email': email, 'password': password}).status_code == 202
    token = next(t for e,p,t in reversed(mail) if e == email and p == 'verify')
    assert client.post('/api/auth/verify', json={'token': token}).status_code == 200
    return token


def login(client, email='owner@example.test', password='a long test password'):
    response = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf']
    return response


def imported(system):
    client, app, settings, mail, _ = system
    register(client, mail)
    login(client)
    account_id = client.get('/api/auth/session').json()['account']['id']
    return import_fixture(app.state.engine, settings, account_id, ROOT/'packages/lesson-schema/fixture.json', ROOT/'packages/lesson-schema')


def test_verified_login_cookie_csrf_logout_and_replay(system):
    client, app, settings, mail, _ = system
    client.post('/api/auth/register', json={'email': 'owner@example.test', 'password': 'a long test password'})
    assert client.post('/api/auth/login', json={'email': 'owner@example.test', 'password': 'a long test password'}).status_code == 401
    token = mail[-1][2]
    assert client.post('/api/auth/verify', json={'token': token}).status_code == 200
    assert client.post('/api/auth/verify', json={'token': token}).status_code == 400
    response = login(client)
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=lax' in response.headers['set-cookie']
    raw = client.cookies.get(COOKIE)
    assert raw not in response.text
    with Session(app.state.engine) as session:
        assert session.get(LoginSession, digest(raw))
        assert session.get(AccountToken, digest(token)).used
    del client.headers['X-CSRF-Token']
    assert client.post('/api/auth/logout', json={}).status_code == 403
    client.headers['X-CSRF-Token'] = response.json()['csrf']
    assert client.post('/api/auth/logout', json={}).status_code == 200
    client.cookies.set(COOKIE, raw)
    assert client.get('/api/auth/session').status_code == 401


def test_origin_header_and_password_redaction(system):
    client, *_ = system
    body = {'email': 'owner@example.test', 'password': 'secret'}
    result = client.post('/api/auth/register', json=body)
    assert result.status_code == 422 and 'secret' not in result.text
    assert client.post('/api/auth/register', json=body, headers={'Origin':'https://evil.example'}).status_code == 403
    assert client.post('/api/auth/register', json=body, headers={'X-Form-Request':''}).status_code == 403
    assert client.post('/api/auth/register', content='email=x', headers={'Content-Type':'application/x-www-form-urlencoded'}).status_code == 415


def test_reset_expires_single_use_and_revokes_all_sessions(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    raw = client.cookies.get(COOKIE)
    with TestClient(app) as other:
        other.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
        login(other)
        assert client.post('/api/auth/forgot', json={'email':'owner@example.test'}).status_code == 202
        token = mail[-1][2]
        assert client.post('/api/auth/reset', json={'token':token,'password':'a new long password'}).status_code == 200
        assert other.get('/api/auth/session').status_code == 401
    assert client.get('/api/auth/session').status_code == 401
    assert client.post('/api/auth/reset', json={'token':token,'password':'a new long password'}).status_code == 400
    login(client, password='a new long password')
    assert client.cookies.get(COOKIE) != raw
    client.post('/api/auth/forgot', json={'email':'owner@example.test'})
    token = mail[-1][2]
    with Session(app.state.engine) as session:
        session.execute(update(AccountToken).where(AccountToken.token_hash == digest(token)).values(expires_at=now()-timedelta(seconds=1)))
        session.commit()
    assert client.post('/api/auth/reset', json={'token':token,'password':'a new long password'}).status_code == 400


def test_login_throttle_persists_across_clients(system):
    client, app, *_ = system
    for _ in range(10):
        assert client.post('/api/auth/login', json={'email':'absent@example.test','password':'a long test password'}).status_code == 401
    with TestClient(app) as other:
        response = other.post('/api/auth/login', json={'email':'absent@example.test','password':'a long test password'},
                              headers={'Origin':'http://testserver','X-Form-Request':'1'})
        assert response.status_code == 429 and response.headers['retry-after'] == '900'


def test_private_lessons_assets_and_archive(system):
    lesson = imported(system)
    client, app, _, mail, store = system
    path = f'/api/lessons/{lesson.lesson_id}'
    asset = path+'/assets/'+lesson.animation.key.split('/')[-1]
    assert client.get(path).json()['revision_id'] == lesson.revision_id
    response = client.get(asset)
    assert response.status_code == 200 and response.content == store.objects[lesson.animation.key]
    assert response.headers['cache-control'] == 'no-store'
    assert client.get(path+'/assets/unlisted.key').status_code == 404
    with TestClient(app) as other:
        other.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
        assert other.get(path).status_code == 401
        assert other.get(asset).status_code == 401
        register(other, mail, 'other@example.test')
        login(other, 'other@example.test')
        assert other.get('/api/lessons').json() == []
        assert other.get(path).status_code == 404
        assert other.get(asset).status_code == 404
        assert other.request('DELETE', path, json={}).status_code == 404
        assert other.put(path+'/sections', json={'base_revision_id':lesson.revision_id,'title':'stolen','sections':[s.model_dump() for s in lesson.section_set.sections]}).status_code == 404
    assert client.request('DELETE', path, json={}).status_code == 200
    assert client.get(path).status_code == 404
    assert client.get(asset).status_code == 404
    assert client.get('/api/lessons').json() == []
    # Archived objects remain private pending controlled retention cleanup.
    assert lesson.animation.key in store.objects


def test_sections_reopen_immutable_revision_and_stale_save(system):
    lesson = imported(system)
    client, app, *_ = system
    path = f'/api/lessons/{lesson.lesson_id}'
    sections = [s.model_dump() for s in lesson.section_set.sections]
    sections[0]['label'] = 'First movement'
    body = {'base_revision_id':lesson.revision_id,'title':'My lesson','sections':sections}
    response = client.put(path+'/sections', json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['section_set']['revision'] == 2 and saved['revision_id'] != lesson.revision_id
    with TestClient(app) as another_browser:
        another_browser.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
        login(another_browser)
        assert another_browser.get(path).json() == saved
    assert client.put(path+'/sections', json=body).status_code == 409
    with Session(app.state.engine) as session:
        assert session.get(LessonRevision, lesson.revision_id).manifest['title'] == lesson.title
        assert session.scalar(select(Lesson).where(Lesson.id == lesson.lesson_id)).version == 2
    body['base_revision_id'] = saved['revision_id']
    body['sections'][0]['end'] = .01
    assert client.put(path+'/sections', json=body).status_code == 422
    assert client.get(path).json() == saved


def test_expired_session_and_disabled_import(system):
    client, app, _, mail, _ = system
    register(client, mail)
    login(client)
    assert client.post('/api/lessons/from-demo', json={}).status_code == 404
    with Session(app.state.engine) as session:
        session.execute(update(LoginSession).values(expires_at=now()-timedelta(seconds=1)))
        session.commit()
    assert client.get('/api/lessons').status_code == 401


def test_import_rejects_altered_assets_before_writing(system, tmp_path):
    client, app, settings, mail, store = system
    register(client, mail)
    login(client)
    owner_id = client.get('/api/auth/session').json()['account']['id']
    (tmp_path/'synthetic.glb').write_bytes(b'changed')
    with pytest.raises(ValueError, match='checksum'):
        import_fixture(app.state.engine, settings, owner_id, ROOT/'packages/lesson-schema/fixture.json', tmp_path)
    assert not store.objects and client.get('/api/lessons').json() == []


@pytest.mark.parametrize('values', [dict(public_url='http://example.com',smtp_starttls=True),dict(public_url='https://example.com',smtp_starttls=False)])
def test_hosted_configuration_requires_https_and_mail_encryption(values):
    with pytest.raises(ValidationError):
        Settings(environment='production',_env_file=None,**values)


def test_practice_progress_is_private_bounded_and_revision_bound(system):
    lesson = imported(system)
    client, app, _, mail, _ = system
    path = f'/api/lessons/{lesson.lesson_id}'
    progress = path+'/progress'
    assert client.get(progress).json() is None
    value = {'revision_id':lesson.revision_id,'time':1.25,'speed':.5,'mode':'sections'}
    assert client.put(progress,json=value).status_code == 200
    assert client.get(progress).json() == value
    with TestClient(app) as second:
        second.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
        register(second,mail,'other@example.test')
        login(second,'other@example.test')
        assert second.get(progress).status_code == 404
        assert second.put(progress,json=value).status_code == 404
    for changed in ({'time':-1},{'time':3},{'speed':2},{'revision_id':'stale'}):
        assert client.put(progress,json={**value,**changed}).status_code in (409,422)
    assert client.get(progress).json() == value
    assert client.put(path+'/sections',json={'base_revision_id':lesson.revision_id,'title':lesson.title,'sections':[s.model_dump() for s in lesson.section_set.sections]}).status_code == 200
    assert client.get(progress).json() is None
