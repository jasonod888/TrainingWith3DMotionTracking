"""Owner-scoped multipart upload and capability-scoped, leased conversion worker API."""
import hashlib
import hmac
import math
import secrets
import struct
import tempfile
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .auth import digest, now
from .contracts import Asset, LessonManifest, MusicDraftDocument, MusicLessonManifest
from .database import Account, Conversion, Lesson, LessonAsset, LessonRevision, MusicDraft, WorkerCredential
from .storage import storage_client
from botocore.exceptions import ClientError
from .processing import ENGINE_VERSION, PIPELINE_VERSION, Provider, processing_status
from .media_probe import MediaProbeError, probe_audio_media
from . import processing_routes, subjects

PART_SIZE=5*1024*1024
RUNNING=('validating','processing','exporting','verifying')
# The four assets named by the lesson manifest, in manifest field order.
MANIFEST_ASSETS=('reference.glb','reference.json','preview.mp4','thumbnail.jpg')
# Avatar derivatives are presentation-only: they are stored beside the lesson and served by
# the lesson asset route, but they never enter the immutable lesson manifest.
DERIVATIVE_ASSETS=('avatar-male.glb','avatar-female.glb','avatar-report.json')
FILES={**{name:mime for name,mime in (
        ('reference.glb','model/gltf-binary'),('reference.json','application/json'),
        ('preview.mp4','video/mp4'),('thumbnail.jpg','image/jpeg'),('instructor.mp4','video/mp4'),
        ('instructor-alpha.webm','video/webm'),('source.mp4','video/mp4'),('waveform.json','application/json'),
        ('midi.mid','audio/midi'),('poster.png','image/png'),('analysis.zip','application/zip'))},
    'avatar-male.glb':'model/gltf-binary','avatar-female.glb':'model/gltf-binary',
    'avatar-report.json':'application/json'}

# Asset role to upload name, per completion contract. Declared once here and used by
# completion, delivery and cleanup instead of scattered filename allowlists.
MUSIC_ROLES=(('reference','reference.json'),('source_video','source.mp4'),('preview_video','preview.mp4'),
             ('waveform','waveform.json'),('midi_export','midi.mid'),('public_poster','poster.png'),
             ('analysis','analysis.zip'))


class Preparation(BaseModel):
    """Client-reported provenance. Diagnostics only; never used for timing."""
    preparation_version:str=Field(default='music-clip-v1',max_length=40)
    selection_start:float|None=Field(default=None,ge=0,allow_inf_nan=False)
    selection_end:float|None=Field(default=None,gt=0,allow_inf_nan=False)


class Derivatives(BaseModel):
    male:Asset
    female:Asset
    report:Asset


class NewConversion(BaseModel):
    title:str=Field(max_length=200)
    filename:str=Field(min_length=1,max_length=255)
    bytes:int=Field(gt=0)
    start:float=Field(ge=0,allow_inf_nan=False)
    duration:float=Field(ge=.2,allow_inf_nan=False)
    processing_provider:Provider='local'
    lesson_id:str|None=Field(default=None,max_length=80)
    # Absent means the legacy movement default, so older clients keep working.
    subject:str|None=Field(default=None,max_length=32)
    instrument:str|None=Field(default=None,max_length=16)
    preparation:Preparation|None=None


class Heartbeat(BaseModel):
    stage:str=Field(pattern='^(validating|processing|exporting|verifying)$')
    frames:int=Field(ge=0,le=10000,default=0)


class Failure(BaseModel):
    category:str=Field(pattern='^(invalid_video|invalid_audio|conversion_failed|worker_interrupted|infrastructure|provider_submission_unknown|provider_failed)$')


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
                'subject':job.subject,'instrument':job.instrument,
                'preparation':job.preparation or {},
                'target_lesson_id':job.target_lesson_id,
                'parts':job.parts if job.state=='uploading' else {},'part_size':PART_SIZE,
                'provider':job.provider,'pipeline_version':job.pipeline_version,
                'media_findings':job.media_findings or {},
                'retryable':job.state=='failed' and job.attempts<3 and job.error not in ('invalid_video','invalid_audio','source_expired') and job.submission_state=='none'}

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
    def limits(account=Depends(identity),session:Session=Depends(db)):
        online_routes=set(session.execute(select(WorkerCredential.provider,WorkerCredential.pipeline_version).where(WorkerCredential.active.is_(True),WorkerCredential.last_seen>now()-timedelta(seconds=90))).all())
        return {'max_bytes':settings.max_upload_bytes,'max_seconds':settings.max_conversion_seconds,'max_active':settings.max_active_conversions,'part_size':PART_SIZE,
                'processing':processing_status(settings),
                'routes':processing_routes.status(settings,online_routes),
                'capabilities':processing_routes.capability_flags(settings,online_routes),
                'subjects':subjects.catalogue()}

    @router.get('')
    def listing(account=Depends(identity),session:Session=Depends(db)):
        online_routes=set(session.execute(select(WorkerCredential.provider,WorkerCredential.pipeline_version).where(WorkerCredential.active.is_(True),WorkerCredential.last_seen>now()-timedelta(seconds=90))).all())
        jobs=session.scalars(select(Conversion).where(Conversion.owner_id==account.id).order_by(Conversion.created_at.desc()).limit(100)).all()
        return {'worker_online':(settings.conversion_provider,PIPELINE_VERSION) in online_routes,
                'processing':processing_status(settings),
                'capabilities':processing_routes.capability_flags(settings,online_routes),
                'routes':processing_routes.status(settings,online_routes),
                'jobs':[{**summary(j),'processor_online':(j.provider,j.pipeline_version) in online_routes} for j in jobs]}

    @router.post('',status_code=201)
    def create(body:NewConversion,account=Depends(identity),session:Session=Depends(db)):
        try:
            selected_subject,family,selected_instrument=subjects.validate_selection(body.subject,body.instrument)
            route=processing_routes.route_for(selected_subject,selected_instrument)
        except subjects.SubjectError as exc:
            raise HTTPException(422,str(exc)) from exc
        if not processing_routes.available(route,settings):
            if family=='body':raise HTTPException(503,'Video processing is temporarily unavailable. Please try later.')
            raise HTTPException(503,'Music processing is not available yet. The lesson can still be watched.')
        provider=processing_routes.provider_for(route,settings)
        if family=='body':
            # Preserve the existing stale-tab guard for the movement processor.
            current=processing_status(settings)
            if body.processing_provider!=current['provider']:raise HTTPException(409,'The video processor changed. Reopen Create before uploading.')
        if body.bytes>settings.max_upload_bytes or body.duration>settings.max_conversion_seconds or body.start!=0:
            raise HTTPException(422,'Choose a video within the displayed size and time limits.')
        session.scalar(select(Account).where(Account.id==account.id).with_for_update())
        active=session.scalar(select(func.count()).select_from(Conversion).where(Conversion.owner_id==account.id,Conversion.state.not_in(('failed','cancelled','ready_for_review'))))
        usage=session.scalar(select(func.coalesce(func.sum(Conversion.source_bytes),0)).where(Conversion.owner_id==account.id,Conversion.state.not_in(('cancelled','ready_for_review'))))
        assets=session.scalar(select(func.coalesce(func.sum(LessonAsset.bytes),0)).join(Lesson).where(Lesson.owner_id==account.id))
        if active>=settings.max_active_conversions or usage+assets+body.bytes>settings.max_account_storage_bytes:
            raise HTTPException(409,'Your current processing or storage limit is reached. Finish or remove a video first.')
        title=body.title.strip() or ('Untitled lesson' if family=='music' else 'Untitled move')
        if len(title)>200:raise HTTPException(422,'Use a shorter name for this move.')
        target=None
        if body.lesson_id:
            target=session.scalar(select(Lesson).where(Lesson.id==body.lesson_id,Lesson.owner_id==account.id,
                Lesson.archived.is_(False),Lesson.disabled.is_(False)))
            if not target:raise HTTPException(404,'Move unavailable.')
            if (target.experience_family or 'body')!=family:
                raise HTTPException(409,'A replacement must be the same kind of lesson as the one it replaces.')
            if family=='music' and (target.instrument or target.subject)!=selected_instrument:
                raise HTTPException(409,'Use a new lesson for a different instrument.')
            replacing=session.scalar(select(func.count()).select_from(Conversion).where(
                Conversion.target_lesson_id==target.id,Conversion.state.not_in(('failed','cancelled','ready_for_review'))))
            if replacing:raise HTTPException(409,'This move already has a replacement in progress.')
        key=f'uploads/{account.id}/{uuid4().hex}/source'
        store=storage_client(settings)
        upload=store.create_multipart_upload(Bucket=settings.storage_bucket,Key=key,ContentType='application/octet-stream')['UploadId']
        external=provider in ('replicate','fal')
        job=Conversion(id=uuid4().hex,owner_id=account.id,title=title if not target else target.title,filename=body.filename,source_bytes=body.bytes,source_key=key,
                       upload_id=upload,start=body.start,duration=body.duration,state='uploading',parts={},target_lesson_id=target.id if target else None,
                       subject=selected_subject,instrument=selected_instrument,
                       preparation=body.preparation.model_dump() if body.preparation else {},
                       provider=provider,pipeline_version=route.pipeline_version,
                       provider_target=getattr(settings,route.target_setting,'') if external else '')
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
        music_route=processing_routes.route_for_pipeline(job.pipeline_version)
        music=bool(music_route and music_route.completion=='music-v2')
        temp=None
        if music:
            settings.upload_temp_dir.mkdir(parents=True,exist_ok=True)
            temp=tempfile.NamedTemporaryFile(dir=settings.upload_temp_dir,suffix='.upload',delete=False)
        obj=None;checksum=hashlib.sha256()
        try:
            obj=store.get_object(Bucket=settings.storage_bucket,Key=job.source_key)
            for chunk in obj['Body'].iter_chunks(chunk_size=1024*1024):
                checksum.update(chunk)
                if temp:temp.write(chunk)
        except BaseException:
            if temp:
                temp.close();Path(temp.name).unlink(missing_ok=True)
            raise
        finally:
            if obj:obj['Body'].close()
            if temp:temp.close()
        job.source_sha256=checksum.hexdigest();job.upload_id=None
        if temp is not None:
            path=Path(temp.name)
            try:
                try:findings=probe_audio_media(path)
                except MediaProbeError as exc:findings={'audio':False,'findings':['unreadable_media'],'error':str(exc)}
            finally:path.unlink(missing_ok=True)
            job.media_findings=findings
            if findings.get('duration') is not None and abs(findings['duration']-job.duration)>.15:
                findings.setdefault('findings',[]).append('duration_mismatch')
            if not findings.get('audio') or not findings.get('video') or 'duration_mismatch' in findings.get('findings',[]):
                job.state='failed';job.error='invalid_audio';session.commit()
                try:store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
                except Exception:pass
                return summary(job)
        job.state='queued';session.commit()
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
        if job.state!='failed' or job.error in ('invalid_video','invalid_audio','source_expired') or job.attempts>=3 or job.submission_state!='none':raise HTTPException(409,'This conversion cannot be safely retried. Please contact support before submitting another video.')
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
                'subject':job.subject,'instrument':job.instrument,'experience_family':processing_routes.route_for_pipeline(job.pipeline_version).family,
                'allowed_outputs':{name:FILES[name] for name in processing_routes.route_for_pipeline(job.pipeline_version).work_assets},
                'output_roles':{role:{'name':name,'mime':FILES[name]} for role,name in MUSIC_ROLES} if job.instrument else {},
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
                    route=processing_routes.route_for_pipeline(job.pipeline_version)
                    allowed=(*route.work_assets,*(DERIVATIVE_ASSETS if route.family=='body' else ())) if route else ()
                    if name not in allowed:raise HTTPException(422,'Output does not belong to this processing route.')
                    key=f'attempts/{job.id}/{job.attempt_token}/{name}'
                    storage_client(settings).upload_fileobj(file,settings.storage_bucket,key,ExtraArgs={'ContentType':FILES[name],'Metadata':{'sha256':checksum.hexdigest()}})
                    return {'key':key,'mime':FILES[name],'bytes':total,'sha256':checksum.hexdigest()}
            return await run_in_threadpool(upload)

    def finish_music(job,manifest,token,session):
        """Completion for a music route: typed separately from the body contract."""
        if job.state!='verifying':raise HTTPException(422,'Invalid converted lesson.')
        if job.provider!='local' and job.submission_state!='submitted':raise HTTPException(409,'Missing provider submission receipt.')
        # The manifest must describe the work the server requested, not whatever the
        # worker chose: a piano job cannot publish a guitar reference, and a clip cannot
        # become longer than the source it was prepared from.
        if manifest.subject!=job.subject:
            raise HTTPException(422,'Converted instrument does not match the requested subject.')
        if manifest.instrument.instrument!=(job.instrument or manifest.subject):
            raise HTTPException(422,'Converted instrument does not match the requested instrument.')
        if abs(manifest.duration-job.duration)>.15:
            raise HTTPException(422,'Converted lesson duration does not match the uploaded clip.')
        store=storage_client(settings)
        assets=[]
        for role,name in MUSIC_ROLES:
            if role=='analysis':
                continue
            asset=getattr(manifest,role)
            if asset is None:
                if role=='reference':raise HTTPException(422,'Conversion outputs are incomplete.')
                continue
            expected=f'attempts/{job.id}/{token}/{name}'
            if asset.key!=expected or asset.mime!=FILES[name]:raise HTTPException(422,'Output is outside this processing attempt.')
            head=store.head_object(Bucket=settings.storage_bucket,Key=expected)
            if head['ContentLength']!=asset.bytes or head.get('Metadata',{}).get('sha256')!=asset.sha256:
                raise HTTPException(422,'Output checksum/size mismatch.')
            assets.append((asset,name))
        lesson_id=job.target_lesson_id or job.id;revision_id=uuid4().hex
        target=None
        if job.target_lesson_id:
            target=session.scalar(select(Lesson).where(Lesson.id==job.target_lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.archived.is_(False),Lesson.disabled.is_(False)).with_for_update())
            if not target:raise HTTPException(409,'This lesson is no longer available for replacement.')
            if (target.experience_family or 'body')!='music':raise HTTPException(409,'A replacement must be the same kind of lesson.')
            version=target.version+1
        else:
            version=1
        for asset,name in assets:
            file_name=f'{revision_id}-{name}' if target else name
            key=f'lessons/{lesson_id}/{file_name}'
            store.copy_object(Bucket=settings.storage_bucket,Key=key,CopySource={'Bucket':settings.storage_bucket,'Key':asset.key})
            asset.key=key
        manifest.lesson_id=lesson_id;manifest.revision_id=revision_id
        manifest.title=target.title if target else job.title
        manifest.section_set.id=uuid4().hex;manifest.section_set.revision=1
        projection={'subject':manifest.subject,'experience_family':'music','instrument':manifest.instrument.instrument}
        if target:
            changed=session.execute(update(Lesson).where(Lesson.id==lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.version==target.version).values(version=version,title=target.title))
            if changed.rowcount!=1:raise HTTPException(409,'This lesson changed while the clip was being replaced. Reopen it and try again.')
        else:
            session.add(Lesson(id=lesson_id,owner_id=job.owner_id,title=job.title,version=1,**projection));session.flush()
        session.add(LessonRevision(id=revision_id,lesson_id=lesson_id,version=version,manifest=manifest.model_dump(),**projection))
        for asset,_ in assets:session.add(LessonAsset(lesson_id=lesson_id,**asset.model_dump()))
        job.lesson_id=lesson_id;job.state='ready_for_review';job.lease_until=None;session.commit()
        try:
            store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
            for _,name in assets:store.delete_object(Bucket=settings.storage_bucket,Key=f'attempts/{job.id}/{token}/{name}')
        except Exception:
            import logging
            logging.getLogger('form').warning('Music conversion cleanup pending for job %s',job.id)
        return {'lesson_id':lesson_id}


    @worker.post('/jobs/{job_id}/draft')
    def draft(job_id:str,body:MusicDraftDocument,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        """Accept an unreviewed transcription proposal. It never creates a manifest."""
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        token=request.headers.get('x-job-lease','')
        existing=session.scalar(select(MusicDraft).where(MusicDraft.job_id==job_id)) if job else None
        if existing and job and job.lesson_id:
            if job.worker_id!=credential or not hmac.compare_digest(job.attempt_token or '',token):
                raise HTTPException(409,'Worker attempt is no longer valid.')
            return {'lesson_id':job.lesson_id,'draft':True}
        job=leased(session,job_id,credential,token)
        route=processing_routes.route_for_pipeline(job.pipeline_version)
        if route is None or route.completion!='music-v2':raise HTTPException(422,'Unknown processing route.')
        if job.state!='verifying':raise HTTPException(422,'Draft is not ready for verification.')
        if job.provider!='local' and job.submission_state!='submitted':raise HTTPException(409,'Missing provider submission receipt.')
        if settings.music_require_run_profile:
            allowed = {value.strip() for value in settings.music_allowed_run_profiles.split(',') if value.strip()}
            if body.provenance.profile_sha256 not in allowed or body.provenance.engine == 'fixture':
                raise HTTPException(422,'This worker must present an approved non-fixture run profile.')
        if body.subject!=job.subject or body.instrument.instrument!=(job.instrument or job.subject):
            raise HTTPException(422,'Draft instrument does not match the requested subject.')
        if abs(body.duration-job.duration)>.15:raise HTTPException(422,'Draft duration does not match the uploaded clip.')
        expected=f'attempts/{job.id}/{token}/reference.json'
        if body.reference.key!=expected or body.reference.mime!='application/json':
            raise HTTPException(422,'Draft reference is outside this processing attempt.')
        store=storage_client(settings)
        head=store.head_object(Bucket=settings.storage_bucket,Key=expected)
        if head['ContentLength']!=body.reference.bytes or head.get('Metadata',{}).get('sha256')!=body.reference.sha256:
            raise HTTPException(422,'Draft reference checksum/size mismatch.')
        lesson_id=job.target_lesson_id or job.id
        if job.target_lesson_id:
            target=session.scalar(select(Lesson).where(Lesson.id==job.target_lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.archived.is_(False),Lesson.disabled.is_(False)).with_for_update())
            if not target or (target.experience_family or 'body')!='music':
                raise HTTPException(409,'This lesson is not available for a music replacement.')
            if (target.instrument or target.subject)!=body.instrument.instrument:
                raise HTTPException(409,'Use a new lesson for a different instrument.')
        else:
            session.add(Lesson(id=lesson_id,owner_id=job.owner_id,title=job.title,version=1,
                               subject=job.subject,experience_family='music',instrument=job.instrument));session.flush()
        draft_id=uuid4().hex
        key=f'lessons/{lesson_id}/{draft_id}-draft-reference.json'
        store.copy_object(Bucket=settings.storage_bucket,Key=key,
                          CopySource={'Bucket':settings.storage_bucket,'Key':expected})
        body.reference.key=key
        session.add(LessonAsset(lesson_id=lesson_id,**body.reference.model_dump()))
        if body.analysis:
            expected_analysis=f'attempts/{job.id}/{token}/analysis.zip'
            if body.analysis.key!=expected_analysis or body.analysis.mime!='application/zip':
                raise HTTPException(422,'Analysis artifact is outside this processing attempt.')
            try:
                analysis_head=store.head_object(Bucket=settings.storage_bucket,Key=expected_analysis)
            except ClientError as exc:
                raise HTTPException(422,'Analysis artifact is missing.') from exc
            if analysis_head['ContentLength']!=body.analysis.bytes or analysis_head.get('Metadata',{}).get('sha256')!=body.analysis.sha256:
                raise HTTPException(422,'Analysis artifact checksum/size mismatch.')
            analysis_key=f'lessons/{lesson_id}/{draft_id}-analysis.zip'
            store.copy_object(Bucket=settings.storage_bucket,Key=analysis_key,
                              CopySource={'Bucket':settings.storage_bucket,'Key':expected_analysis})
            body.analysis.key=analysis_key
            session.add(LessonAsset(lesson_id=lesson_id,**body.analysis.model_dump()))
        # Preserve private instructor media before upload/attempt retention removes it.
        webm='webm' in ((job.media_findings or {}).get('container') or '') or job.filename.lower().endswith('.webm')
        source_key=f'lessons/{lesson_id}/{draft_id}-source.'+('webm' if webm else 'mp4')
        store.copy_object(Bucket=settings.storage_bucket,Key=source_key,
                          CopySource={'Bucket':settings.storage_bucket,'Key':job.source_key})
        body.source_video=Asset(key=source_key,mime='video/webm' if webm else 'video/mp4',
                                bytes=job.source_bytes,sha256=job.source_sha256)
        session.add(LessonAsset(lesson_id=lesson_id,**body.source_video.model_dump()))
        session.add(MusicDraft(id=draft_id,job_id=job.id,lesson_id=lesson_id,owner_id=job.owner_id,
                               subject=body.subject,instrument=body.instrument.instrument,status='draft',
                               document=body.model_dump(),created_at=now()))
        job.lesson_id=lesson_id;job.state='ready_for_review';job.lease_until=None;session.commit()
        try:
            store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
            store.delete_object(Bucket=settings.storage_bucket,Key=expected)
            if body.analysis: store.delete_object(Bucket=settings.storage_bucket,Key=f'attempts/{job.id}/{token}/analysis.zip')
        except Exception:
            import logging
            logging.getLogger('form').warning('Music draft cleanup pending for job %s',job.id)
        return {'lesson_id':lesson_id,'draft':True}

    @worker.post('/jobs/{job_id}/finish')
    def finish(job_id:str,request:Request,payload:dict=Body(...),credential=Depends(worker_identity),session:Session=Depends(db)):
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        token=request.headers.get('x-job-lease','')
        if job and job.state=='ready_for_review' and job.worker_id==credential and hmac.compare_digest(job.attempt_token or '',token):return {'lesson_id':job.lesson_id}
        job=leased(session,job_id,credential,token)
        route=processing_routes.route_for_pipeline(job.pipeline_version)
        if route is None:raise HTTPException(422,'Unknown processing route.')
        try:
            if route.completion=='music-v2':
                if settings.music_require_run_profile:
                    raise HTTPException(422,'Profiled music must use the unreviewed draft handoff.')
                return finish_music(job,MusicLessonManifest.model_validate(payload),token,session)
            body=LessonManifest.model_validate(payload)
        except ValidationError as exc:
            raise HTTPException(422,'Invalid converted lesson.') from exc
        if body.presentation:
            raise HTTPException(422,'Presentation assets must be verified through the derivative route.')
        if job.state!='verifying' or body.engine!='sam-3d-body' or body.engine_version!=ENGINE_VERSION or body.duration>job.duration+.1 or body.source_start!=0 or body.section_set.revision!=1 or len(body.section_set.sections)!=1:
            raise HTTPException(422,'Invalid converted lesson.')
        if job.provider!='local' and job.submission_state!='submitted':raise HTTPException(409,'Missing provider submission receipt.')
        store=storage_client(settings)
        assets=[body.animation,body.landmarks,body.source_video,body.thumbnail]
        if any(a is None for a in assets):raise HTTPException(422,'Conversion outputs are incomplete.')
        asset_names=list(MANIFEST_ASSETS)
        if body.focused_video:
            assets.append(body.focused_video);asset_names.append('instructor.mp4')
        if body.focused_video_alpha:
            assets.append(body.focused_video_alpha);asset_names.append('instructor-alpha.webm')
        for asset,name in zip(assets,asset_names):
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
        for asset,name in zip(assets,asset_names):
            file_name=f'{revision_id}-{name}' if target else name
            key=f'lessons/{lesson_id}/{file_name}'
            store.copy_object(Bucket=settings.storage_bucket,Key=key,CopySource={'Bucket':settings.storage_bucket,'Key':asset.key})
            asset.key=key
        body.lesson_id=lesson_id;body.revision_id=revision_id;body.title=target.title if target else job.title
        # The subject the instructor chose travels with the job, so completion must not
        # reset a taekwondo or boxing lesson to the movement default.
        projection={'subject':job.subject or subjects.DEFAULT_SUBJECT,'experience_family':'body','instrument':None}
        if target:
            changed=session.execute(update(Lesson).where(Lesson.id==lesson_id,Lesson.owner_id==job.owner_id,
                Lesson.version==target.version).values(version=version,title=target.title))
            if changed.rowcount!=1:raise HTTPException(409,'This move changed while the clip was being replaced. Reopen it and try again.')
        else:
            session.add(Lesson(id=lesson_id,owner_id=job.owner_id,title=job.title,version=1,**projection));session.flush()
        session.add(LessonRevision(id=revision_id,lesson_id=lesson_id,version=version,manifest=body.model_dump(),**projection))
        for asset in assets:session.add(LessonAsset(lesson_id=lesson_id,**asset.model_dump()))
        job.lesson_id=lesson_id;job.state='ready_for_review';job.lease_until=None;session.commit()
        try:
            store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
            # Only the manifest assets are consumed here; avatar derivatives were uploaded
            # before finish and are collected by /derivatives afterwards.
            for name in asset_names:store.delete_object(Bucket=settings.storage_bucket,Key=f'attempts/{job.id}/{token}/{name}')
        except Exception:
            # Publication is already durable; retention cleanup can retry these private objects.
            import logging
            logging.getLogger('form').warning('Conversion cleanup pending for job %s',job.id)
        return {'lesson_id':lesson_id}

    @worker.post('/jobs/{job_id}/derivatives')
    def derivatives(job_id:str,body:Derivatives,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        """Store the avatar clips produced for a finished conversion.

        Called after `/finish` returns the lesson id. The lease has already been released at
        that point, so this endpoint checks the worker identity and attempt token itself. A
        derivative failure must never invalidate the canonical lesson, which is why it is a
        separate call the worker may skip.
        """
        token=request.headers.get('x-job-lease','')
        job=session.scalar(select(Conversion).where(Conversion.id==job_id).with_for_update())
        if not job or job.worker_id!=credential or not job.attempt_token or not hmac.compare_digest(job.attempt_token,token or ''):
            raise HTTPException(409,'Worker lease is no longer valid.')
        if not job.lesson_id:raise HTTPException(409,'Conversion is not finished.')
        store=storage_client(settings)
        assets={'avatar-male.glb':body.male,'avatar-female.glb':body.female,'avatar-report.json':body.report}
        for name,asset in assets.items():
            expected=f'attempts/{job.id}/{token}/{name}'
            if asset.key!=expected or asset.mime!=FILES[name]:
                raise HTTPException(422,'Derivative is outside this processing attempt.')
            head=store.head_object(Bucket=settings.storage_bucket,Key=expected)
            if head['ContentLength']!=asset.bytes or head.get('Metadata',{}).get('sha256')!=asset.sha256:
                raise HTTPException(422,'Derivative checksum/size mismatch.')
        stored=[]
        for name,asset in assets.items():
            key=f'lessons/{job.lesson_id}/{name}'
            store.copy_object(Bucket=settings.storage_bucket,Key=key,
                CopySource={'Bucket':settings.storage_bucket,'Key':asset.key})
            # Replacing a revision replaces its derivatives too: keep one row per key.
            session.execute(delete(LessonAsset).where(LessonAsset.key==key,LessonAsset.lesson_id==job.lesson_id))
            session.add(LessonAsset(lesson_id=job.lesson_id,key=key,mime=asset.mime,bytes=asset.bytes,sha256=asset.sha256))
            stored.append(key)
        session.commit()
        # Attempt copies are left for the existing retention cleanup: deleting them here would
        # make a repeated publish fail its checksum check.
        return {'stored':stored}

    @worker.post('/jobs/{job_id}/fail')
    def fail(job_id:str,body:Failure,request:Request,credential=Depends(worker_identity),session:Session=Depends(db)):
        job=leased(session,job_id,credential,request.headers.get('x-job-lease'))
        if job.submission_state=='prepared' or (job.provider!='local' and body.category=='infrastructure' and job.submission_state=='submitted'):job.submission_state='unknown'
        job.state='failed';job.error=body.category;job.lease_until=None;session.commit();return {'saved':True}

    app.include_router(router);app.include_router(worker)
