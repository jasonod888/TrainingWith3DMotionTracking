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
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .auth import digest, now
from .contracts import LessonManifest
from .database import Account, Conversion, Lesson, LessonAsset, LessonRevision, WorkerCredential
from .storage import storage_client
from .processing import ENGINE_VERSION, PIPELINE_VERSION, Provider, processing_status

PART_SIZE=5*1024*1024
RUNNING=('validating','processing','exporting','verifying')
FILES={'reference.glb':'model/gltf-binary','reference.json':'application/json','preview.mp4':'video/mp4','thumbnail.jpg':'image/jpeg'}


class NewConversion(BaseModel):
    title:str=Field(max_length=200)
    filename:str=Field(min_length=1,max_length=255)
    bytes:int=Field(gt=0)
    start:float=Field(ge=0,allow_inf_nan=False)
    duration:float=Field(ge=.2,allow_inf_nan=False)
    processing_provider:Provider='local'
    lesson_id:str|None=Field(default=None,max_length=80)


class Heartbeat(BaseModel):
    stage:str=Field(pattern='^(validating|processing|exporting|verifying)$')
    frames:int=Field(ge=0,le=10000,default=0)


class Failure(BaseModel):
    category:str=Field(pattern='^(invalid_video|conversion_failed|worker_interrupted|infrastructure|provider_submission_unknown|provider_failed)$')


class SubmissionReceipt(BaseModel):
    request_id:str=Field(min_length=1,max_length=200,pattern=r'^[A-Za-z0-9_-]+$')


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
                'target_lesson_id':job.target_lesson_id,
                'parts':job.parts if job.state=='uploading' else {},'part_size':PART_SIZE,
                'provider':job.provider,'pipeline_version':job.pipeline_version,
                'retryable':job.state=='failed' and job.attempts<3 and job.error not in ('invalid_video','source_expired') and job.submission_state=='none'}

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
        worker_record=session.get(WorkerCredential,credential)
        if job.provider!=worker_record.provider or job.pipeline_version!=worker_record.pipeline_version:
            raise HTTPException(409,'Worker processing route does not match this job.')
        return job

    @router.get('/limits')
    def limits(account=Depends(identity)):
        return {'max_bytes':settings.max_upload_bytes,'max_seconds':settings.max_conversion_seconds,'max_active':settings.max_active_conversions,'part_size':PART_SIZE,'processing':processing_status(settings)}

    @router.get('')
    def listing(account=Depends(identity),session:Session=Depends(db)):
        online_routes=set(session.execute(select(WorkerCredential.provider,WorkerCredential.pipeline_version).where(WorkerCredential.active.is_(True),WorkerCredential.last_seen>now()-timedelta(seconds=90))).all())
        jobs=session.scalars(select(Conversion).where(Conversion.owner_id==account.id).order_by(Conversion.created_at.desc()).limit(100)).all()
        return {'worker_online':(settings.conversion_provider,PIPELINE_VERSION) in online_routes,
                'processing':processing_status(settings),
                'jobs':[{**summary(j),'processor_online':(j.provider,j.pipeline_version) in online_routes} for j in jobs]}

    @router.post('',status_code=201)
    def create(body:NewConversion,account=Depends(identity),session:Session=Depends(db)):
        route=processing_status(settings)
        if not route['available']:raise HTTPException(503,'Video processing is temporarily unavailable. Please try later.')
        if body.processing_provider!=route['provider']:raise HTTPException(409,'The video processor changed. Reopen Create before uploading.')
        if body.bytes>settings.max_upload_bytes or body.duration>settings.max_conversion_seconds or body.start!=0:
            raise HTTPException(422,'Choose a video within the displayed size and time limits.')
        session.scalar(select(Account).where(Account.id==account.id).with_for_update())
        active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.owner_id==account.id,Conversion.state.not_in(('failed','cancelled','ready_for_review'))))
        usage=session.scalar(select(func.coalesce(func.sum(Conversion.source_bytes),0)).where(Conversion.owner_id==account.id,Conversion.state.not_in(('cancelled','ready_for_review'))))
        assets=session.scalar(select(func.coalesce(func.sum(LessonAsset.bytes),0)).join(Lesson).where(Lesson.owner_id==account.id))
        if active>=settings.max_active_conversions or usage+assets+body.bytes>settings.max_account_storage_bytes:
            raise HTTPException(409,'Your current processing or storage limit is reached. Finish or remove a video first.')
        title=body.title.strip() or 'Untitled move'
        if len(title)>200:raise HTTPException(422,'Use a shorter name for this move.')
        target=None
        if body.lesson_id:
            target=session.scalar(select(Lesson).where(Lesson.id==body.lesson_id,Lesson.owner_id==account.id,
                Lesson.archived.is_(False),Lesson.disabled.is_(False)))
            if not target:raise HTTPException(404,'Move unavailable.')
            replacing=session.scalar(select(func.count()).select_from(Conversion).where(
                Conversion.target_lesson_id==target.id,Conversion.state.not_in(('failed','cancelled','ready_for_review'))))
            if replacing:raise HTTPException(409,'This move already has a replacement in progress.')
        key=f'uploads/{account.id}/{uuid4().hex}/source'
        store=storage_client(settings)
        upload=store.create_multipart_upload(Bucket=settings.storage_bucket,Key=key,ContentType='application/octet-stream')['UploadId']
        job=Conversion(id=uuid4().hex,owner_id=account.id,title=title if not target else target.title,filename=body.filename,source_bytes=body.bytes,source_key=key,
                       upload_id=upload,start=body.start,duration=body.duration,state='uploading',parts={},target_lesson_id=target.id if target else None,
                       provider=route['provider'],pipeline_version=PIPELINE_VERSION,provider_target=settings.conversion_target if route['external_processing'] else '')
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
        if job.provider!='local' and job.submission_state in ('prepared','submitted'):job.submission_state='unknown'
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
        if job.state!='failed' or job.error in ('invalid_video','source_expired') or job.attempts>=3 or job.submission_state!='none':raise HTTPException(409,'This conversion cannot be safely retried. Please contact support before submitting another video.')
        active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.owner_id==account.id,Conversion.state.in_(('queued',*RUNNING))))
        if active>=settings.max_active_conversions:raise HTTPException(409,'Wait for your other conversions to finish.')
        job.state='queued';job.error=None;job.lease_until=None;session.commit();return summary(job)

    @worker.post('/claim')
    def claim(credential=Depends(worker_identity),session:Session=Depends(db)):
        worker_record=session.scalar(select(WorkerCredential).where(WorkerCredential.id==credential).with_for_update())
        worker_record.last_seen=now()
        if worker_record.provider!='local' and session.bind.dialect.name=='postgresql':
            session.execute(text('SELECT pg_advisory_xact_lock(:key)'),{'key':71001 if worker_record.provider=='replicate' else 71002})
        current=session.scalar(select(Conversion).where(Conversion.worker_id==credential,Conversion.state.in_(RUNNING),Conversion.lease_until>now()))
        if current:session.commit();return None
        # Expired leases can still represent chargeable remote work. Keep their slots
        # reserved until reconciled; ambiguous submissions require operator resolution.
        remote_active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.provider==worker_record.provider,
            or_(Conversion.state.in_(RUNNING),Conversion.submission_state.in_(('prepared','unknown')),
                (Conversion.submission_state=='submitted')&(Conversion.state=='queued'))))
        jobs=session.scalars(select(Conversion).where(Conversion.provider==worker_record.provider,Conversion.pipeline_version==worker_record.pipeline_version,or_(Conversion.state=='queued',
            (Conversion.state.in_(RUNNING))&(Conversion.lease_until<now()))).order_by(Conversion.created_at).with_for_update(skip_locked=True).limit(10)).all()
        selected=None
        for job in jobs:
            if job.submission_state=='prepared':
                job.state='failed';job.error='provider_submission_unknown';job.submission_state='unknown';continue
            if worker_record.provider!='local' and not job.provider_request_id and remote_active>=settings.remote_conversion_concurrency:continue
            if job.attempts>=3:
                job.state='failed';job.error='worker_interrupted'
                if job.provider_request_id:job.submission_state='unknown'
                continue
            selected=job;break
        if not selected:session.commit();return None
        job=selected;job.attempts+=1;job.worker_id=credential;job.attempt_token=secrets.token_hex(24);job.lease_until=now()+timedelta(seconds=settings.worker_lease_seconds);job.state='validating';job.frames=0;job.error=None
        session.commit()
        return {'id':job.id,'title':job.title,'bytes':job.source_bytes,'sha256':job.source_sha256,'start':job.start,'duration':job.duration,'attempt_token':job.attempt_token,
                'provider':job.provider,'pipeline_version':job.pipeline_version,'provider_target':job.provider_target,
                'provider_request_id':job.provider_request_id,'submission_state':job.submission_state,'stage':job.state}

    @worker.post('/jobs/{job_id}/submission/start')
    def prepare_submission(job_id:str,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        if job.provider=='local' or job.submission_state!='none':raise HTTPException(409,'Submission already started or is not external.')
        raw=secrets.token_urlsafe(32);job.input_token_hash=digest(raw);job.submission_state='prepared';session.commit()
        return {'source_url':f'{settings.public_url.rstrip("/")}/api/worker/input/{job.id}/{raw}'}

    @worker.post('/jobs/{job_id}/submission/record')
    def record_submission(job_id:str,body:SubmissionReceipt,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        if job.provider=='local' or job.submission_state not in ('prepared','submitted'):raise HTTPException(409,'Submission was not prepared.')
        if job.provider_request_id and job.provider_request_id!=body.request_id:raise HTTPException(409,'A different request is already recorded.')
        job.provider_request_id=body.request_id;job.submission_state='submitted';session.commit();return {'recorded':True}

    @worker.get('/input/{job_id}/{key}',include_in_schema=False)
    def provider_input(job_id:str,key:str,session:Session=Depends(db)):
        job=session.get(Conversion,job_id)
        if not job or len(key)>128 or not job.input_token_hash or not hmac.compare_digest(job.input_token_hash,digest(key)):
            raise HTTPException(404)
        credential=session.get(WorkerCredential,job.worker_id)
        if job.state not in RUNNING or not job.lease_until or stamp(job.lease_until)<=now() or not credential or not credential.active:raise HTTPException(404)
        obj=storage_client(settings).get_object(Bucket=settings.storage_bucket,Key=job.source_key)
        def stream():
            try:yield from obj['Body'].iter_chunks(chunk_size=1024*1024)
            finally:obj['Body'].close()
        return StreamingResponse(stream(),media_type='application/octet-stream',headers={'Content-Length':str(job.source_bytes),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})

    @worker.post('/jobs/{job_id}/submission/closed')
    def close_submission(job_id:str,body:SubmissionReceipt,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        if not job or job.provider=='local' or job.worker_id!=credential or not hmac.compare_digest(job.attempt_token or '',request.headers.get('x-job-lease','')):
            raise HTTPException(409,'Worker attempt is no longer valid.')
        if job.state not in ('failed','cancelled') or job.provider_request_id!=body.request_id:raise HTTPException(409,'Submission cannot be closed.')
        job.submission_state='resolved';session.commit();return {'closed':True}

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
                if total>160*1024*1024:raise HTTPException(413,'Output exceeded its limit.')
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
        if job.state!='verifying' or body.engine!='sam-3d-body' or body.engine_version!=ENGINE_VERSION or body.duration>job.duration+.1 or body.source_start!=0 or body.section_set.revision!=1 or len(body.section_set.sections)!=1:
            raise HTTPException(422,'Invalid converted lesson.')
        if job.provider!='local' and job.submission_state!='submitted':raise HTTPException(409,'Missing provider submission receipt.')
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
        lesson_id=job.target_lesson_id or job.id;revision_id=uuid4().hex
        target=None
        if job.target_lesson_id:
            target=session.scalar(select(Lesson).where(Lesson.id==job.target_lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.archived.is_(False),Lesson.disabled.is_(False)).with_for_update())
            if not target:raise HTTPException(409,'This move is no longer available for replacement.')
            version=target.version+1
        else:
            version=1
        for asset,name in zip(assets,FILES):
            file_name=f'{revision_id}-{name}' if target else name
            key=f'lessons/{lesson_id}/{file_name}'
            store.copy_object(Bucket=settings.storage_bucket,Key=key,CopySource={'Bucket':settings.storage_bucket,'Key':asset.key})
            asset.key=key
        body.lesson_id=lesson_id;body.revision_id=revision_id;body.title=target.title if target else job.title
        if target:
            changed=session.execute(update(Lesson).where(Lesson.id==lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.version==target.version).values(version=version,title=target.title))
            if changed.rowcount!=1:raise HTTPException(409,'This move changed while the clip was being replaced. Reopen it and try again.')
        else:
            session.add(Lesson(id=lesson_id,owner_id=job.owner_id,title=job.title));session.flush()
        session.add(LessonRevision(id=revision_id,lesson_id=lesson_id,version=version,manifest=body.model_dump()))
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
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        if job.submission_state=='prepared' or (job.provider!='local' and body.category=='infrastructure' and job.submission_state=='submitted'):job.submission_state='unknown'
        job.state='failed';job.error=body.category;job.lease_until=None;session.commit();return {'saved':True}

    app.include_router(router);app.include_router(worker)
