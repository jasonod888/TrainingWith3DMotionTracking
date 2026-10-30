import hashlib
import io
import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from sqlalchemy import select,update
from sqlalchemy.orm import Session
from test_accounts import system,register,login,FakeStorage
from apps.api.auth import digest,now
from apps.api.config import ROOT
from apps.api.database import Conversion,Lesson,LessonRevision,WorkerCredential


class MultipartStore(FakeStorage):
    def __init__(self):super().__init__();self.uploads={};self.metadata={}
    def create_multipart_upload(self,**kw):
        key=uuid4().hex;self.uploads[key]={};return {'UploadId':key}
    def upload_part(self,UploadId,PartNumber,Body,**kw):
        self.uploads[UploadId][PartNumber]=bytes(Body);return {'ETag':hashlib.md5(Body).hexdigest()}
    def complete_multipart_upload(self,UploadId,Key,**kw):
        self.objects[Key]=b''.join(v for _,v in sorted(self.uploads.pop(UploadId).items()))
    def head_object(self,Key,**kw):
        if Key not in self.objects:raise ClientError({'Error':{'Code':'404'},'ResponseMetadata':{'HTTPStatusCode':404}},'HeadObject')
        return {'ContentLength':len(self.objects[Key]),'Metadata':self.metadata.get(Key,{})}
    def get_object(self,Key,Range=None,**kw):
        data=self.objects[Key]
        if Range:data=data[:12]
        class Stream(io.BytesIO):
            def iter_chunks(self,chunk_size):
                while chunk:=self.read(chunk_size):yield chunk
        return {'Body':Stream(data),'ContentLength':len(data)}
    def upload_fileobj(self,file,bucket,key,ExtraArgs):
        self.objects[key]=file.read();self.metadata[key]=ExtraArgs['Metadata']
    def copy_object(self,Key,CopySource,**kw):
        self.objects[Key]=self.objects[CopySource['Key']];self.metadata[Key]=self.metadata.get(CopySource['Key'],{})
    def abort_multipart_upload(self,UploadId,**kw):self.uploads.pop(UploadId,None)


@pytest.fixture
def conversion(system):
    client,app,settings,mail,_=system
    register(client,mail);login(client)
    store=MultipartStore();token='conversion-test-worker'
    with Session(app.state.engine) as session:
        credential=WorkerCredential(id=uuid4().hex,token_hash=digest(token),active=True);session.add(credential);session.commit()
    with patch('apps.api.conversions.storage_client',return_value=store):yield client,app,store,{'Authorization':'Bearer '+token},system


def uploaded(client,data=b'synthetic source bytes',provider='local'):
    result=client.post('/api/conversions',json={'title':'New lesson','filename':'demo.mp4','bytes':len(data),'start':0,'duration':2,'processing_provider':provider})
    assert result.status_code==201,result.text
    job=result.json();path='/api/conversions/'+job['id']
    result=client.put(path+'/parts/1',content=data,headers={'Content-Type':'application/octet-stream'})
    assert result.status_code==200,result.text
    assert client.post(path+'/complete',json={}).status_code==200
    return job,path


def test_upload_completion_and_ownership(conversion):
    client,app,store,_,system=conversion
    job,path=uploaded(client)
    assert client.get(path).json()['state']=='queued'
    assert client.post(path+'/complete',json={}).status_code==200
    with Session(app.state.engine) as session:assert session.get(Conversion,job['id']).source_sha256==hashlib.sha256(b'synthetic source bytes').hexdigest()
    with TestClient(app) as other:
        other.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
        register(other,system[3],'other@example.test');login(other,'other@example.test')
        assert other.get(path).status_code==404
        assert other.post(path+'/cancel',json={}).status_code==404
        assert other.put(path+'/parts/1',content=b'x',headers={'Content-Type':'application/octet-stream'}).status_code==404


def test_part_limits_missing_parts_and_cancel(conversion):
    client,_,store,_,_=conversion
    job=client.post('/api/conversions',json={'title':'Resume','filename':'anything','bytes':5*1024*1024+3,'start':0,'duration':2}).json();path='/api/conversions/'+job['id']
    assert client.put(path+'/parts/1',content=b'bad',headers={'Content-Type':'application/octet-stream'}).status_code==422
    data=b'x'*(5*1024*1024)
    assert client.put(path+'/parts/1',content=data,headers={'Content-Type':'application/octet-stream'}).status_code==200
    assert client.get(path).json()['parts']['1']['sha256']==hashlib.sha256(data).hexdigest()
    assert client.post(path+'/complete',json={}).status_code==409
    assert client.post(path+'/cancel',json={}).json()['state']=='cancelled'
    assert not store.uploads
    assert client.put(path+'/parts/2',content=b'end',headers={'Content-Type':'application/octet-stream'}).status_code==409


def test_expired_lease_cancellation_and_credential_revocation(conversion):
    client,app,_,headers,_=conversion
    job,path=uploaded(client)
    first=client.post('/api/worker/claim',headers=headers,json={}).json()
    with Session(app.state.engine) as session:
        session.get(Conversion,job['id']).lease_until=now()-timedelta(seconds=1);session.commit()
    second=client.post('/api/worker/claim',headers=headers,json={}).json()
    assert second['attempt_token']!=first['attempt_token']
    old={**headers,'X-Job-Lease':first['attempt_token']};current={**headers,'X-Job-Lease':second['attempt_token']}
    base='/api/worker/jobs/'+job['id']
    assert client.get(base+'/source',headers=old).status_code==409
    assert client.get(base+'/source',headers=current).status_code==200
    assert client.post(path+'/cancel',json={}).status_code==200
    assert client.post(base+'/heartbeat',headers=current,json={'stage':'validating'}).status_code==409
    with Session(app.state.engine) as session:session.scalar(select(WorkerCredential)).active=False;session.commit()
    assert client.post('/api/worker/claim',headers=headers,json={}).status_code==401
    assert client.post('/api/worker/claim',json={}).status_code==401


def test_verified_finalisation_is_idempotent_and_stale_attempt_cannot_publish(conversion):
    client,app,store,headers,_=conversion
    job,path=uploaded(client);claim=client.post('/api/worker/claim',headers=headers,json={}).json()
    headers={**headers,'X-Job-Lease':claim['attempt_token']};base='/api/worker/jobs/'+job['id']
    for stage in ('processing','exporting','verifying'):
        assert client.post(base+'/heartbeat',headers=headers,json={'stage':stage}).status_code==200
    manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
    from apps.api.processing import ENGINE_VERSION
    manifest['engine']='sam-3d-body';manifest['engine_version']=ENGINE_VERSION;manifest['section_set']['sections']=[{'id':'whole','label':'Full movement','start':0,'end':2}]
    for field,name,data in [('animation','reference.glb',(ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()),('landmarks','reference.json',b'{}'),('source_video','preview.mp4',b'preview'),('thumbnail','thumbnail.jpg',b'image')]:
        result=client.put(base+'/files/'+name,headers=headers,content=data)
        assert result.status_code==200,result.text
        manifest[field]=result.json()
    bad=json.loads(json.dumps(manifest));bad['animation']['key']='other/file.glb'
    assert client.post(base+'/finish',headers=headers,json=bad).status_code==422
    result=client.post(base+'/finish',headers=headers,json=manifest)
    assert result.status_code==200,result.text
    assert client.post(base+'/finish',headers=headers,json=manifest).json()==result.json()
    lesson=client.get('/api/lessons/'+result.json()['lesson_id']).json()
    assert len(lesson['section_set']['sections'])==1
    assert client.post(base+'/heartbeat',headers=headers,json={'stage':'verifying'}).status_code==409
    with Session(app.state.engine) as session:assert len(session.scalars(select(LessonRevision)).all())==1
