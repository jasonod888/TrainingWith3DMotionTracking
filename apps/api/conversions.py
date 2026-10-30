"""Owner-scoped multipart upload and capability-scoped, leased conversion worker API."""
import hashlib
import hmac
import math
import secrets
import struct
import tempfile
from datetime import timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .auth import digest, now
from .contracts import LessonManifest
from .database import Account, Conversion, Lesson, LessonAsset, LessonRevision, WorkerCredential
from .storage import storage_client

PART_SIZE=5*1024*1024
RUNNING=('validating','processing','exporting','verifying')
FILES={'reference.glb':'model/gltf-binary','reference.json':'application/json','preview.mp4':'video/mp4','thumbnail.jpg':'image/jpeg'}


class NewConversion(BaseModel):
    title:str=Field(min_length=1,max_length=200)
    filename:str=Field(min_length=1,max_length=255)
    bytes:int=Field(gt=0)
    start:float=Field(ge=0,allow_inf_nan=False)
    duration:float=Field(ge=.2,allow_inf_nan=False)


class Heartbeat(BaseModel):
    stage:str=Field(pattern='^(validating|processing|exporting|verifying)$')
    frames:int=Field(ge=0,le=10000,default=0)


class Failure(BaseModel):
    category:str=Field(pattern='^(invalid_video|conversion_failed|worker_interrupted|infrastructure)$')


def stamp(value):
    return value if value.tzinfo else value.replace(tzinfo=now().tzinfo)


def install_conversions(app,engine,settings,identity,db):
    router=APIRouter(prefix='/api/conversions')
    worker=APIRouter(prefix='/api/worker')

    def owned(session,job_id,owner_id,lock=False):
        query=select(Conversion).where(Conversion.id==job_id,Conversion.owner_id==owner_id)
        job=session.scalar(query.with_for_update() if lock else query)
        if not job:raise HTTPException(404,'Conversion unavailable.')
        return job

    def summary(job):
        return {'id':job.id,'title':job.title,'filename':job.filename,'bytes':job.source_bytes,'start':job.start,'duration':job.duration,
                'state':job.state,'attempts':job.attempts,'frames':job.frames,'error':job.error,'lesson_id':job.lesson_id,
                'parts':job.parts if job.state=='uploading' else {},'part_size':PART_SIZE}

    def worker_identity(request:Request,session:Session=Depends(db)):
        value=request.headers.get('authorization','')
        if not value.startswith('Bearer ') or len(value)>150:raise HTTPException(401,'Worker authentication required.')
        credential=session.scalar(select(WorkerCredential).where(WorkerCredential.token_hash==digest(value[7:]),WorkerCredential.active.is_(True)))
        if not credential:raise HTTPException(401,'Worker credential revoked or unknown.')
        return credential.id

    def leased(session,job_id,credential,token):
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        if not job or job.worker_id!=credential or not job.attempt_token or not hmac.compare_digest(job.attempt_token,token or ''):
            raise HTTPException(409,'Worker lease is no longer valid.')
        if job.state not in RUNNING or not job.lease_until or stamp(job.lease_until)<=now():
            raise HTTPException(409,'Job cancelled, completed or lease expired.')
        return job

    @router.get('/limits')
    def limits(account=Depends(identity)):
        return {'max_bytes':settings.max_upload_bytes,'max_seconds':settings.max_conversion_seconds,'max_active':settings.max_active_conversions,'part_size':PART_SIZE}

    @router.get('')
    def listing(account=Depends(identity),session:Session=Depends(db)):
        online=session.scalar(select(WorkerCredential.id).where(WorkerCredential.active.is_(True),WorkerCredential.last_seen>now()-timedelta(seconds=90)).limit(1)) is not None
        jobs=session.scalars(select(Conversion).where(Conversion.owner_id==account.id).order_by(Conversion.created_at.desc()).limit(100)).all()
        return {'worker_online':online,'jobs':[summary(j) for j in jobs]}

    @router.post('',status_code=201)
    def create(body:NewConversion,account=Depends(identity),session:Session=Depends(db)):
        if body.bytes>settings.max_upload_bytes or body.duration>settings.max_conversion_seconds or body.start+body.duration>1800:
            raise HTTPException(422,'Choose a video within the displayed size and time limits.')
        session.scalar(select(Account).where(Account.id==account.id).with_for_update())
        active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.owner_id==account.id,Conversion.state.not_in(('failed','cancelled','ready_for_review'))))
        usage=session.scalar(select(func.coalesce(func.sum(Conversion.source_bytes),0)).where(Conversion.owner_id==account.id,Conversion.state.not_in(('cancelled','ready_for_review'))))
        assets=session.scalar(select(func.coalesce(func.sum(LessonAsset.bytes),0)).join(Lesson).where(Lesson.owner_id==account.id))
        if active>=settings.max_active_conversions or usage+assets+body.bytes>settings.max_account_storage_bytes:
            raise HTTPException(409,'Your current processing or storage limit is reached. Finish or remove a video first.')
        title=body.title.strip()
        if not title:raise HTTPException(422,'Give your lesson a name.')
        key=f'uploads/{account.id}/{uuid4().hex}/source'
        store=storage_client(settings)
        upload=store.create_multipart_upload(Bucket=settings.storage_bucket,Key=key,ContentType='application/octet-stream')['UploadId']
        job=Conversion(id=uuid4().hex,owner_id=account.id,title=title,filename=body.filename,source_bytes=body.bytes,source_key=key,
                       upload_id=upload,start=body.start,duration=body.duration,state='uploading',parts={})
        try:session.add(job);session.commit()
        except Exception:
            session.rollback();store.abort_multipart_upload(Bucket=settings.storage_bucket,Key=key,UploadId=upload);raise
        return summary(job)

    @router.get('/{job_id}')
    def detail(job_id:str,account=Depends(identity),session:Session=Depends(db)):
        return summary(owned(session,job_id,account.id))

    @router.put('/{job_id}/parts/{part}')
    async def upload_part(job_id:str,part:int,request:Request,account=Depends(identity)):
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>PART_SIZE:raise HTTPException(413,'Upload part is too large.')
        def save():
            with Session(engine) as session:
                job=owned(session,job_id,account.id,True)
                if job.state!='uploading':raise HTTPException(409,'This upload is no longer open.')
                count=math.ceil(job.source_bytes/PART_SIZE)
                expected=min(PART_SIZE,job.source_bytes-(part-1)*PART_SIZE)
                if part<1 or part>count or len(data)!=expected:raise HTTPException(422,'Upload part has the wrong size.')
                checksum=hashlib.sha256(data).hexdigest()
                result=storage_client(settings).upload_part(Bucket=settings.storage_bucket,Key=job.source_key,UploadId=job.upload_id,PartNumber=part,Body=bytes(data))
                parts=dict(job.parts);parts[str(part)]={'sha256':checksum,'etag':result['ETag'],'bytes':len(data)};job.parts=parts;session.commit()
                return parts[str(part)]
        return await run_in_threadpool(save)

    @router.post('/{job_id}/complete')
    def complete_upload(job_id:str,account=Depends(identity),session:Session=Depends(db)):
        job=owned(session,job_id,account.id,True)
        if job.state!='uploading':return summary(job)
        count=math.ceil(job.source_bytes/PART_SIZE)
        if sorted(int(n) for n in job.parts)!=list(range(1,count+1)):raise HTTPException(409,'Some video parts are still missing.')
        store=storage_client(settings)
        # A completed object may exist after a prior response/transaction was interrupted.
        try:head=store.head_object(Bucket=settings.storage_bucket,Key=job.source_key)
        except Exception:
            store.complete_multipart_upload(Bucket=settings.storage_bucket,Key=job.source_key,UploadId=job.upload_id,
                MultipartUpload={'Parts':[{'PartNumber':n,'ETag':job.parts[str(n)]['etag']} for n in range(1,count+1)]})
            head=store.head_object(Bucket=settings.storage_bucket,Key=job.source_key)
        if head['ContentLength']!=job.source_bytes:raise HTTPException(422,'The uploaded video size did not match.')
        obj=store.get_object(Bucket=settings.storage_bucket,Key=job.source_key);checksum=hashlib.sha256()
        try:
            for chunk in obj['Body'].iter_chunks(chunk_size=1024*1024):checksum.update(chunk)
        finally:obj['Body'].close()
        job.source_sha256=checksum.hexdigest();job.state='queued';job.upload_id=None;session.commit()
        return summary(job)

    @router.post('/{job_id}/cancel')
    def cancel(job_id:str,account=Depends(identity),session:Session=Depends(db)):
        job=owned(session,job_id,account.id,True)
        if job.state=='ready_for_review':raise HTTPException(409,'This lesson is already ready. Remove it from your library instead.')
        job.state='cancelled';job.lease_until=None;session.commit()
        store=storage_client(settings)
        if job.upload_id:
            try:store.abort_multipart_upload(Bucket=settings.storage_bucket,Key=job.source_key,UploadId=job.upload_id)
            except Exception:pass
        store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
        return summary(job)

    @router.post('/{job_id}/retry')
    def retry(job_id:str,account=Depends(identity),session:Session=Depends(db)):
        session.scalar(select(Account).where(Account.id==account.id).with_for_update())
        job=owned(session,job_id,account.id,True)
        if job.state!='failed' or job.error in ('invalid_video','source_expired') or job.attempts>=3:raise HTTPException(409,'Choose a new video instead of retrying this conversion.')
        active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.owner_id==account.id,Conversion.state.in_(('queued',*RUNNING))))
        if active>=settings.max_active_conversions:raise HTTPException(409,'Wait for your other conversions to finish.')
        job.state='queued';job.error=None;job.lease_until=None;session.commit();return summary(job)

    @worker.post('/claim')
    def claim(credential=Depends(worker_identity),session:Session=Depends(db)):
        session.scalar(select(WorkerCredential).where(WorkerCredential.id==credential).with_for_update()).last_seen=now()
        current=session.scalar(select(Conversion).where(Conversion.worker_id==credential,Conversion.state.in_(RUNNING),Conversion.lease_until>now()))
        if current:session.commit();return None
        jobs=session.scalars(select(Conversion).where(or_(Conversion.state=='queued',
            (Conversion.state.in_(RUNNING))&(Conversion.lease_until<now()))).order_by(Conversion.created_at).with_for_update(skip_locked=True).limit(10)).all()
        selected=None
        for job in jobs:
            if job.attempts>=3:job.state='failed';job.error='worker_interrupted';continue
            selected=job;break
        if not selected:session.commit();return None
        job=selected;job.attempts+=1;job.worker_id=credential;job.attempt_token=secrets.token_hex(24);job.lease_until=now()+timedelta(seconds=settings.worker_lease_seconds);job.state='validating';job.frames=0;job.error=None
        session.commit()
        return {'id':job.id,'title':job.title,'bytes':job.source_bytes,'sha256':job.source_sha256,'start':job.start,'duration':job.duration,'attempt_token':job.attempt_token}

    @worker.post('/jobs/{job_id}/heartbeat')
    def heartbeat(job_id:str,body:Heartbeat,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        if RUNNING.index(body.stage)<RUNNING.index(job.state) or RUNNING.index(body.stage)>RUNNING.index(job.state)+1:raise HTTPException(409,'Invalid processing stage.')
        job.state=body.stage;job.frames=max(job.frames,body.frames);job.lease_until=now()+timedelta(seconds=settings.worker_lease_seconds)
        session.get(WorkerCredential,credential).last_seen=now();session.commit();return {'continue':True}

    @worker.get('/jobs/{job_id}/source')
    def source(job_id:str,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        obj=storage_client(settings).get_object(Bucket=settings.storage_bucket,Key=job.source_key)
        def stream():
            try:yield from obj['Body'].iter_chunks(chunk_size=1024*1024)
            finally:obj['Body'].close()
        return StreamingResponse(stream(),media_type='application/octet-stream',headers={'Content-Length':str(job.source_bytes)})

    @worker.put('/jobs/{job_id}/files/{name}')
    async def output(job_id:str,name:str,request:Request,credential=Depends(worker_identity)):
        if name not in FILES:raise HTTPException(404)
        token=request.headers.get('x-job-lease')
        settings.upload_temp_dir.mkdir(parents=True,exist_ok=True)
        with tempfile.SpooledTemporaryFile(max_size=8*1024*1024,dir=settings.upload_temp_dir) as file:
            total=0;checksum=hashlib.sha256()
            async for chunk in request.stream():
                total+=len(chunk)
                if total>64*1024*1024:raise HTTPException(413,'Output exceeded its limit.')
                checksum.update(chunk);file.write(chunk)
            file.seek(0)
            def upload():
                with Session(engine) as session:
                    job=leased(session,job_id,credential,token)
                    if job.state!='verifying':raise HTTPException(409,'Output is not ready for verification.')
                    key=f'attempts/{job.id}/{job.attempt_token}/{name}'
                    storage_client(settings).upload_fileobj(file,settings.storage_bucket,key,ExtraArgs={'ContentType':FILES[name],'Metadata':{'sha256':checksum.hexdigest()}})
                    return {'key':key,'mime':FILES[name],'bytes':total,'sha256':checksum.hexdigest()}
            return await run_in_threadpool(upload)

    @worker.post('/jobs/{job_id}/finish')
    def finish(job_id:str,body:LessonManifest,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        token=request.headers.get('x-job-lease','')
        if job and job.state=='ready_for_review' and job.worker_id==credential and hmac.compare_digest(job.attempt_token or '',token):return {'lesson_id':job.lesson_id}
        job=leased(session,job_id,credential,token)
        if job.state!='verifying' or body.engine!='sam-3d-body' or body.duration>job.duration+.1 or body.source_start!=0 or body.section_set.revision!=1 or len(body.section_set.sections)!=1:
            raise HTTPException(422,'Invalid converted lesson.')
        store=storage_client(settings)
        assets=[body.animation,body.landmarks,body.source_video,body.thumbnail]
        if any(a is None for a in assets):raise HTTPException(422,'Conversion outputs are incomplete.')
        for asset,name in zip(assets,FILES):
            expected=f'attempts/{job.id}/{token}/{name}'
            if asset.key!=expected or asset.mime!=FILES[name]:raise HTTPException(422,'Output is outside this processing attempt.')
            head=store.head_object(Bucket=settings.storage_bucket,Key=expected)
            if head['ContentLength']!=asset.bytes or head.get('Metadata',{}).get('sha256')!=asset.sha256:raise HTTPException(422,'Output checksum/size mismatch.')
        obj=store.get_object(Bucket=settings.storage_bucket,Key=body.animation.key,Range='bytes=0-11')
        try:header=obj['Body'].read()
        finally:obj['Body'].close()
        if len(header)!=12 or struct.unpack('<4sII',header)!=(b'glTF',2,body.animation.bytes):raise HTTPException(422,'Invalid animation container.')
        lesson_id=job.id;revision_id=uuid4().hex
        for asset,name in zip(assets,FILES):
            key=f'lessons/{lesson_id}/{name}'
            store.copy_object(Bucket=settings.storage_bucket,Key=key,CopySource={'Bucket':settings.storage_bucket,'Key':asset.key})
            asset.key=key
        body.lesson_id=lesson_id;body.revision_id=revision_id;body.title=job.title
        session.add(Lesson(id=lesson_id,owner_id=job.owner_id,title=job.title));session.flush()
        session.add(LessonRevision(id=revision_id,lesson_id=lesson_id,version=1,manifest=body.model_dump()))
        for asset in assets:session.add(LessonAsset(lesson_id=lesson_id,**asset.model_dump()))
        job.lesson_id=lesson_id;job.state='ready_for_review';job.lease_until=None;session.commit()
        try:
            store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
            for name in FILES:store.delete_object(Bucket=settings.storage_bucket,Key=f'attempts/{job.id}/{token}/{name}')
        except Exception:
            # Publication is already durable; retention cleanup can retry these private objects.
            import logging
            logging.getLogger('form').warning('Conversion cleanup pending for job %s',job.id)
        return {'lesson_id':lesson_id}

    @worker.post('/jobs/{job_id}/fail')
    def fail(job_id:str,body:Failure,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'));job.state='failed';job.error=body.category;job.lease_until=None;session.commit();return {'saved':True}

    app.include_router(router);app.include_router(worker)
