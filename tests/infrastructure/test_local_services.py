"""Opt-in checks against real, isolated local PostgreSQL and S3 services."""
import hashlib
import json
import os
from urllib.parse import urlparse
from uuid import uuid4
import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from apps.api.config import Settings, ROOT
from apps.api.database import Lesson, LessonRevision, make_engine, database_ready
from apps.api.storage import storage_client

pytestmark=pytest.mark.skipif(os.environ.get('FORM_TEST_LOCAL_SERVICES')!='1',reason='Requires explicit local integration-test opt-in')

@pytest.fixture
def services():
    settings=Settings()
    assert settings.environment=='development'
    assert urlparse(settings.sqlalchemy_url).hostname in ('localhost','127.0.0.1')
    assert urlparse(settings.storage_endpoint or '').hostname in ('localhost','127.0.0.1')
    engine=make_engine(settings.sqlalchemy_url)
    client=storage_client(settings)
    yield settings,engine,client
    engine.dispose()

def test_migrated_postgresql_schema(services):
    _,engine,_=services
    database_ready(engine)
    with engine.connect() as connection:
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar_one()=='0002'

def test_lesson_revision_round_trip_across_connections(services):
    _,engine,_=services
    identity=f'verification-{uuid4().hex}'
    manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
    try:
        with Session(engine) as session:
            session.add(Lesson(id=identity,owner_id='verification',title='Synthetic infrastructure verification'))
            session.flush()
            session.add(LessonRevision(id=identity,lesson_id=identity,manifest=manifest,version=1))
            session.commit()
        engine.dispose()
        with Session(engine) as session:
            assert session.get(LessonRevision,identity).manifest==manifest
    finally:
        with engine.begin() as connection:
            connection.execute(LessonRevision.__table__.delete().where(LessonRevision.id==identity))
            connection.execute(Lesson.__table__.delete().where(Lesson.id==identity))

def test_private_s3_object_signed_download_and_checksum(services):
    settings,_,client=services
    key=f'verification/{uuid4().hex}/synthetic.glb'
    data=(ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
    try:
        client.put_object(Bucket=settings.storage_bucket,Key=key,Body=data,ContentType='model/gltf-binary')
        result=client.get_object(Bucket=settings.storage_bucket,Key=key)['Body'].read()
        assert hashlib.sha256(result).digest()==hashlib.sha256(data).digest()
        url=client.generate_presigned_url('get_object',Params={'Bucket':settings.storage_bucket,'Key':key},ExpiresIn=60)
        with httpx.Client(trust_env=False,timeout=10) as http:
            signed=http.get(url)
            assert signed.status_code==200
            assert signed.content==data
            unsigned=http.get(url.split('?',1)[0])
            assert unsigned.status_code==403
    finally:
        client.delete_object(Bucket=settings.storage_bucket,Key=key)

def test_missing_object_is_not_silently_served(services):
    settings,_,client=services
    with pytest.raises(client.exceptions.ClientError) as caught:
        client.head_object(Bucket=settings.storage_bucket,Key=f'verification/{uuid4().hex}/missing')
    assert caught.value.response['ResponseMetadata']['HTTPStatusCode']==404
