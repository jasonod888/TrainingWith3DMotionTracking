"""Verify paid-provider concurrency locking in real PostgreSQL. No provider network calls."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from urllib.parse import urlparse
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session
from apps.api.auth import COOKIE,csrf_token,digest,now,password_hash
from apps.api.config import Settings
from apps.api.database import Account,Conversion,LoginSession,WorkerCredential
from apps.api.main import create_app
from apps.api.storage import storage_client

pytestmark=pytest.mark.skipif(os.environ.get('FORM_TEST_LOCAL_SERVICES')!='1',reason='Requires local service opt-in')


def test_provider_concurrency_is_atomic_across_credentials():
    settings=Settings(conversion_provider='replicate',remote_conversion_enabled=True,conversion_target='test/never-submitted')
    assert settings.environment=='development' and urlparse(settings.sqlalchemy_url).hostname in ('127.0.0.1','localhost')
    assert urlparse(settings.storage_endpoint or '').hostname in ('127.0.0.1','localhost')
    app=create_app(settings);engine=app.state.engine;store=storage_client(settings)
    owner=uuid4().hex;token=uuid4().hex;workers=[uuid4().hex for _ in range(2)];secrets=[uuid4().hex for _ in workers];jobs=[];keys=[]
    try:
        with Session(engine) as session:
            session.add(Account(id=owner,email=owner+'@example.test',verified=True,password_hash=password_hash('local synthetic provider test')));session.flush()
            session.add(LoginSession(account_id=owner,token_hash=digest(token),expires_at=now()+timedelta(hours=1)))
            for identity,secret in zip(workers,secrets):session.add(WorkerCredential(id=identity,token_hash=digest(secret),provider='replicate',pipeline_version='sam-3d-body-v1',active=True))
            session.commit()
        with TestClient(app) as client:
            client.cookies.set(COOKIE,token);client.headers.update({'Origin':settings.public_url,'X-Form-Request':'1','X-CSRF-Token':csrf_token(token)})
            for _ in range(2):
                result=client.post('/api/conversions',json={'title':'Synthetic routing fixture','filename':'synthetic.bin','bytes':3,'start':0,'duration':2,'processing_provider':'replicate'})
                assert result.status_code==201,result.text
                identity=result.json()['id'];jobs.append(identity)
                with Session(engine) as session:keys.append(session.get(Conversion,identity).source_key)
                assert client.put('/api/conversions/'+identity+'/parts/1',content=b'cpu',headers={'Content-Type':'application/octet-stream'}).status_code==200
                assert client.post('/api/conversions/'+identity+'/complete',json={}).status_code==200
            barrier=Barrier(2)
            def claim(secret):
                with TestClient(app) as worker:
                    barrier.wait(timeout=10)
                    response=worker.post('/api/worker/claim',headers={'Authorization':'Bearer '+secret},json={})
                    assert response.status_code==200,response.text
                    return response.json()
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(claim,secrets))
            claimed=[result for result in results if result]
            assert len(claimed)==1 and claimed[0]['id'] in jobs
            with Session(engine) as session:
                record=session.get(Conversion,claimed[0]['id'])
                # A dispatcher disconnect must not free a potentially paid slot.
                record.lease_until=now()-timedelta(seconds=1);record.submission_state='prepared';session.commit()
            assert client.post('/api/worker/claim',headers={'Authorization':'Bearer '+secrets[0]},json={}).json() is None
    finally:
        for key in keys:store.delete_object(Bucket=settings.storage_bucket,Key=key)
        with engine.begin() as connection:
            connection.execute(delete(Conversion).where(Conversion.owner_id==owner))
            connection.execute(delete(WorkerCredential).where(WorkerCredential.id.in_(workers)))
            connection.execute(delete(LoginSession).where(LoginSession.account_id==owner))
            connection.execute(delete(Account).where(Account.id==owner))
        engine.dispose()
