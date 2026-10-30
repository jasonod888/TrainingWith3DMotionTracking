"""No external provider calls or paid resources: test real routes and simulated transports."""
import json
from datetime import timedelta
from unittest.mock import Mock
from uuid import uuid4
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session
from test_accounts import system
from test_conversions import conversion,uploaded
from apps.api.auth import digest,now
from apps.api.config import ROOT,Settings
from apps.api.database import Conversion,WorkerCredential
from apps.api.processing import ENGINE_VERSION,PIPELINE_VERSION
from apps.api.provider_adapters import adapter,ProviderResult,validate_output_url
from scripts.saas_provider_worker import RemoteWorker


def remote_route(system,provider='replicate'):
    settings=system[2];settings.conversion_provider=provider;settings.remote_conversion_enabled=True;settings.conversion_target='our-account/verified-pipeline'


def credential(app,provider='replicate',pipeline=PIPELINE_VERSION):
    token=uuid4().hex
    with Session(app.state.engine) as session:
        record=WorkerCredential(id=uuid4().hex,token_hash=digest(token),provider=provider,pipeline_version=pipeline,active=True)
        session.add(record);session.commit()
    return {'Authorization':'Bearer '+token}


def test_disabled_unconfigured_and_stale_selection_cannot_upload(conversion):
    client,_,store,_,system=conversion;settings=system[2]
    body={'title':'Test','filename':'test.mp4','bytes':3,'start':0,'duration':2}
    for provider in ('disabled','replicate','fal'):
        settings.conversion_provider=provider
        assert not client.get('/api/conversions/limits').json()['processing']['available']
        assert client.post('/api/conversions',json=body).status_code==503
    remote_route(system)
    assert client.post('/api/conversions',json=body).status_code==409
    assert not store.uploads
    with pytest.raises(ValidationError):Settings(conversion_provider='anything',_env_file=None)
    with pytest.raises(ValidationError):Settings(conversion_target='https://other.invalid/path',_env_file=None)


def test_job_pinning_and_worker_provider_pipeline_isolation(conversion):
    client,app,_,local,system=conversion
    old,path=uploaded(client);remote_route(system)
    new,_=uploaded(client,provider='replicate')
    assert client.get(path).json()['provider']=='local'
    assert client.post('/api/worker/claim',headers=local,json={}).json()['id']==old['id']
    assert client.post('/api/worker/claim',headers=credential(app,'fal'),json={}).json() is None
    assert client.post('/api/worker/claim',headers=credential(app,pipeline='future'),json={}).json() is None
    remote=credential(app)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    assert claim['id']==new['id'] and claim['provider_target']=='our-account/verified-pipeline'
    system[2].conversion_provider='disabled'
    rows=client.get('/api/conversions').json()['jobs']
    assert all(row['processor_online'] for row in rows)
    headers={**local,'X-Job-Lease':claim['attempt_token']}
    assert client.get('/api/worker/jobs/'+new['id']+'/source',headers=headers).status_code==409


def test_remote_receipt_recovery_and_scoped_input(conversion):
    client,app,_,_,system=conversion;remote_route(system)
    job,path=uploaded(client,provider='replicate');remote=credential(app)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    headers={**remote,'X-Job-Lease':claim['attempt_token']};base='/api/worker/jobs/'+job['id']
    source=client.post(base+'/submission/start',headers=headers,json={}).json()['source_url']
    assert client.get(source).content==b'synthetic source bytes'
    assert client.get(source+'wrong').status_code==404
    assert client.post(base+'/submission/start',headers=headers,json={}).status_code==409
    for identity,code in (('known-request',200),('known-request',200),('different-request',409)):
        assert client.post(base+'/submission/record',headers=headers,json={'request_id':identity}).status_code==code
    with Session(app.state.engine) as session:
        session.get(Conversion,job['id']).lease_until=now()-timedelta(seconds=1);session.commit()
    assert client.get(source).status_code==404
    recovered=client.post('/api/worker/claim',headers=remote,json={}).json()
    assert recovered['provider_request_id']=='known-request' and recovered['attempt_token']!=claim['attempt_token']
    assert client.get(source).status_code==200
    assert client.post(path+'/cancel',json={}).status_code==200
    assert client.get(source).status_code==404


def test_uncertain_paid_submission_blocks_retry_and_new_paid_work(conversion):
    client,app,_,_,system=conversion;remote_route(system)
    job,path=uploaded(client,provider='replicate');remote=credential(app)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    base='/api/worker/jobs/'+job['id'];headers={**remote,'X-Job-Lease':claim['attempt_token']}
    assert client.post(base+'/submission/start',headers=headers,json={}).status_code==200
    with Session(app.state.engine) as session:
        session.get(Conversion,job['id']).lease_until=now()-timedelta(seconds=1);session.commit()
    assert client.post('/api/worker/claim',headers=remote,json={}).json() is None

    result=client.get(path).json()
    assert result['error']=='provider_submission_unknown' and not result['retryable']
    assert client.post(path+'/retry',json={}).status_code==409
    uploaded(client,provider='replicate')
    assert client.post('/api/worker/claim',headers=remote,json={}).json() is None


def test_cancelled_paid_work_holds_slot_until_terminal_confirmation(conversion):
    client,app,_,_,system=conversion;remote_route(system)
    job,path=uploaded(client,provider='replicate');remote=credential(app)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    headers={**remote,'X-Job-Lease':claim['attempt_token']};base='/api/worker/jobs/'+job['id']
    client.post(base+'/submission/start',headers=headers,json={})
    client.post(base+'/submission/record',headers=headers,json={'request_id':'paid-job'})
    assert client.post(path+'/cancel',json={}).status_code==200
    uploaded(client,provider='replicate')
    assert client.post('/api/worker/claim',headers=remote,json={}).json() is None
    assert client.post(base+'/submission/closed',headers=headers,json={'request_id':'wrong'}).status_code==409
    assert client.post(base+'/submission/closed',headers=headers,json={'request_id':'paid-job'}).status_code==200
    assert client.post('/api/worker/claim',headers=remote,json={}).json() is not None


def test_queued_existing_paid_request_keeps_its_slot(conversion):
    client,app,_,_,system=conversion;remote_route(system)
    uploaded(client,provider='replicate')  # Older unsubmitted job must wait.
    existing,_=uploaded(client,provider='replicate')
    with Session(app.state.engine) as session:
        job=session.get(Conversion,existing['id']);job.provider_request_id='existing-paid';job.submission_state='submitted';session.commit()
    claim=client.post('/api/worker/claim',headers=credential(app),json={}).json()
    assert claim['id']==existing['id'] and claim['provider_request_id']=='existing-paid'


@pytest.mark.parametrize('provider',('replicate','fal'))
def test_provider_http_adapters_and_no_submit_retry(provider):
    requests=[]
    def respond(request):
        requests.append(request)
        if request.method=='POST' and not request.url.path.endswith('/cancel'):
            return httpx.Response(200,json={'id':'paid-id','request_id':'paid-id'})
        if request.url.path.endswith('/status'):return httpx.Response(200,json={'status':'COMPLETED'})
        if request.url.path.endswith('/cancel'):return httpx.Response(200,json={})
        output={'pipeline_version':PIPELINE_VERSION}
        return httpx.Response(200,json={'status':'succeeded','output':output} if provider=='replicate' else output)
    transport=adapter(provider,'test-secret',httpx.Client(transport=httpx.MockTransport(respond)))
    assert transport.submit('our/pipeline',{'video_url':'https://example.test/input'})=='paid-id'
    assert transport.poll('our/pipeline','paid-id').output=={'pipeline_version':PIPELINE_VERSION}
    transport.cancel('our/pipeline','paid-id')
    assert all(request.headers['Authorization']==('Bearer ' if provider=='replicate' else 'Key ')+'test-secret' for request in requests)
    failing=Mock();failing.post.side_effect=httpx.ReadTimeout('Unknown submission outcome')
    with pytest.raises(httpx.ReadTimeout):adapter(provider,'test',failing).submit('our/pipeline',{})
    assert failing.post.call_count==1
    for url in ('http://127.0.0.1/output','https://api.replicate.com/secret','https://fal.media.evil.test/a','https://user@fal.media/a'):
        with pytest.raises(ValueError):validate_output_url(url,provider)


@pytest.mark.parametrize('provider',('replicate','fal'))
@pytest.mark.parametrize('resume',(False,True))
def test_dispatcher_full_conversion_and_recovery(conversion,provider,resume):
    client,app,_,_,system=conversion;remote_route(system,provider)
    system[2].public_url='https://app.example.test'
    job,path=uploaded(client,provider=provider);remote=credential(app,provider)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    headers={**remote,'X-Job-Lease':claim['attempt_token']};base='/api/worker/jobs/'+job['id']
    if resume:
        client.post(base+'/submission/start',headers=headers,json={})
        client.post(base+'/submission/record',headers=headers,json={'request_id':'already-paid'})
        with Session(app.state.engine) as session:
            session.get(Conversion,job['id']).lease_until=now()-timedelta(seconds=1);session.commit()
        claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
    manifest.update(engine='sam-3d-body',engine_version=ENGINE_VERSION)
    manifest['section_set']['sections']=[{'id':'whole','label':'Full movement','start':0,'end':2}]
    domain='replicate.delivery' if provider=='replicate' else 'fal.media'
    names=['reference.glb','reference.json','preview.mp4','thumbnail.jpg']
    output={'pipeline_version':PIPELINE_VERSION,'manifest':manifest,'files':{n:f'https://{domain}/{n}' for n in names}}
    transport=Mock();transport.submit.return_value='new-paid-request';transport.poll.return_value=ProviderResult('succeeded',output)
    def download(request):
        assert 'Authorization' not in request.headers
        return httpx.Response(200,content=(ROOT/'packages/lesson-schema/synthetic.glb').read_bytes() if request.url.path.endswith('.glb') else b'synthetic output')
    with TestClient(app,headers=remote) as worker_api:
        worker=RemoteWorker('https://app.example.test','unused',provider,'unused',api=worker_api,transport=transport,downloads=httpx.Client(transport=httpx.MockTransport(download)))
        worker.run(claim,poll_seconds=0)
    assert transport.submit.call_count==(0 if resume else 1)
    assert client.get(path).json()['state']=='ready_for_review'


def test_remote_submit_timeout_cannot_be_retried(conversion):
    client,app,_,_,system=conversion;remote_route(system);system[2].public_url='https://app.example.test'
    job,path=uploaded(client,provider='replicate');remote=credential(app)
    claim=client.post('/api/worker/claim',headers=remote,json={}).json()
    transport=Mock();transport.submit.side_effect=httpx.ReadTimeout('Unknown outcome')
    with TestClient(app,headers=remote) as worker_api:
        RemoteWorker('https://app.example.test','unused','replicate','unused',api=worker_api,transport=transport).run(claim,poll_seconds=0)
    assert transport.submit.call_count==1
    assert client.get(path).json()['error']=='provider_submission_unknown'
    assert client.post(path+'/retry',json={}).status_code==409
