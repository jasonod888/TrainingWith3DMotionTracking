"""Bounded database-backed signaling; no camera frames pass through these endpoints.

Both devices sign into the same account. A code requests a receiver; the capture
device explicitly approves it. All reads recheck lesson access and revision.
"""
from datetime import timedelta, timezone
from uuid import uuid4
import hmac
import secrets
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from .auth import now, digest
from .database import MimicPair, Lesson
from .permissions import readable_lesson, visible_manifest

class Create(BaseModel):
    lesson_id:str=Field(min_length=1,max_length=80)
    revision_id:str=Field(min_length=1,max_length=80)
class Claim(BaseModel):
    code:str=Field(pattern=r'^[A-Fa-f0-9]{12}$')
class Guide(BaseModel):
    """Normalised source-space box. The receiver maps it through its own fit."""
    left:float=Field(ge=0,le=1,allow_inf_nan=False)
    top:float=Field(ge=0,le=1,allow_inf_nan=False)
    right:float=Field(ge=0,le=1,allow_inf_nan=False)
    bottom:float=Field(ge=0,le=1,allow_inf_nan=False)
class Snapshot(BaseModel):
    epoch:Literal[1]=1
    sequence:int=Field(ge=1)
    time:float=Field(ge=0,allow_inf_nan=False)
    speed:Literal[.25,.5,.75,1]=1
    playing:bool=False
    phase:Literal['paused','countdown','playing','rest']='paused'
    remaining:float=Field(default=0,ge=0,le=60,allow_inf_nan=False)
    index:int=Field(ge=-1,le=1000)
    end:float=Field(ge=0,allow_inf_nan=False)
    ack:int=Field(default=0,ge=0)
    angle:float=Field(default=0,ge=-3.15,le=3.15,allow_inf_nan=False)
    model_mirror:bool=False
    camera_mirror:bool=False
    # Optional presentation fields. Older capture devices omit them entirely, so
    # every one has a safe default; values that are present are strictly bounded.
    source_generation:int=Field(default=0,ge=0,le=2147483647)
    camera_status:Literal['off','starting','live','interrupted','failed']='off'
    camera_facing:Literal['front','rear','unknown']='unknown'
    lens_status:Literal['wide-confirmed','wide-requested-unverified','standard','unknown']='unknown'
    source_width:int=Field(default=0,ge=0,le=16384)
    source_height:int=Field(default=0,ge=0,le=16384)
    setup_phase:Literal['prepare','starting','positioning','measuring','ready','handoff','help','error','cancelled']|None=None
    setup_hint_code:str|None=Field(default=None,max_length=40)
    setup_progress:float=Field(default=0,ge=0,le=1,allow_inf_nan=False)
    guide:Guide|None=None
class Control(BaseModel):
    id:str=Field(pattern=r'^[a-f0-9-]{36}$')
    sequence:int=Field(ge=1)
    epoch:Literal[1]=1
    action:Literal['resume','pause','next','back','again','slower','faster','loop']
class Signal(BaseModel):
    description:str=Field(max_length=32000)
    # Associates an offer, its answer and any replacement with one negotiation.
    generation:int=Field(default=0,ge=0,le=2147483647)

def aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

def install_mimic_pairing(app,settings,identity,db):
    router=APIRouter(prefix='/api/mimic-pairs')
    def get(session,id,account,token,role=None):
        row=session.scalar(select(MimicPair).where(MimicPair.id==id).with_for_update())
        if not row or row.account_id!=account.id or row.revoked or aware(row.expires_at)<=now():raise HTTPException(404,'Pairing expired. Connect again.')
        _,revision=readable_lesson(session,row.lesson_id,account.id,row.revision_id)
        if revision.id!=row.revision_id:raise HTTPException(409,'Lesson changed. Open the new lesson and connect again.')
        hashed=digest(token or '')
        actual='capture' if hmac.compare_digest(hashed,row.capture_hash) else 'receiver' if row.receiver_hash and hmac.compare_digest(hashed,row.receiver_hash) else None
        if not actual or role and actual!=role:raise HTTPException(403,'This device cannot perform that action.')
        return row,actual,revision

    @router.post('',status_code=201)
    def create(body:Create,account=Depends(identity),session:Session=Depends(db)):
        _,revision=readable_lesson(session,body.lesson_id,account.id,body.revision_id)
        if revision.id!=body.revision_id:raise HTTPException(409,'Reopen the current lesson before connecting.')
        session.execute(delete(MimicPair).where(MimicPair.expires_at<now()))
        active=session.scalars(select(MimicPair).where(MimicPair.account_id==account.id,MimicPair.revoked.is_(False))).all()
        if len(active)>=4:raise HTTPException(429,'Disconnect an existing screen first.')
        code=secrets.token_hex(6).upper();token=secrets.token_urlsafe(32)
        row=MimicPair(id=uuid4().hex,account_id=account.id,lesson_id=body.lesson_id,revision_id=body.revision_id,code_hash=digest(code),capture_hash=digest(token),expires_at=now()+timedelta(minutes=10))
        session.add(row);session.commit()
        return {'id':row.id,'token':token,'code':code}

    @router.post('/claim')
    def claim(body:Claim,account=Depends(identity),session:Session=Depends(db)):
        row=session.scalar(select(MimicPair).where(MimicPair.code_hash==digest(body.code.upper()),MimicPair.account_id==account.id).with_for_update())
        if not row or row.revoked or row.receiver_hash or aware(row.expires_at)<=now():raise HTTPException(404,'Code unavailable. Check the capture device.')
        _,revision=readable_lesson(session,row.lesson_id,account.id,row.revision_id)
        if revision.id!=row.revision_id:raise HTTPException(409,'Lesson changed.')
        token=secrets.token_urlsafe(32);row.receiver_hash=digest(token);row.receiver_seen=now();session.commit()
        return {'id':row.id,'token':token}

    @router.get('/{id}')
    def status(id:str,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,role,revision=get(session,id,account,x_mimic_token)
        if role=='receiver':row.receiver_seen=now();session.commit()
        return {'approved':row.approved,'pending':bool(row.receiver_hash),'receiver_online':bool(row.receiver_seen and (now()-aware(row.receiver_seen)).total_seconds()<5),
                'sequence':row.sequence,'snapshot':row.snapshot if row.approved else {},'commands':row.commands if role=='capture' and row.approved else [],
                'manifest':visible_manifest(session,session.get(Lesson,row.lesson_id),revision,account.id) if role=='receiver' and row.approved else None,'signal':row.signals.get('receiver' if role=='capture' else 'capture') if row.approved else None,
                'signal_generation':int(row.signals.get('capture_generation',0) or 0),'answer_generation':int(row.signals.get('answer_generation',0) or 0),'server_time':now().timestamp()*1000}

    @router.post('/{id}/approve')
    def approve(id:str,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,_,_=get(session,id,account,x_mimic_token,'capture')
        if not row.receiver_hash:raise HTTPException(409,'No screen is waiting.')
        row.approved=True;row.expires_at=now()+timedelta(hours=2);session.commit();return {'ok':True}

    @router.put('/{id}/state')
    def state(id:str,body:Snapshot,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,_,revision=get(session,id,account,x_mimic_token,'capture')
        if body.time>revision.manifest['duration'] or body.end>revision.manifest['duration']:raise HTTPException(422,'Position outside lesson.')
        if body.sequence<=row.sequence:raise HTTPException(409,'Stale state.')
        row.sequence=body.sequence;row.snapshot={**body.model_dump(),'server_time':now().timestamp()*1000};row.commands=[c for c in row.commands if c['sequence']>body.ack];session.commit();return {'ok':True}

    @router.post('/{id}/commands')
    def command(id:str,body:Control,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,_,_=get(session,id,account,x_mimic_token,'receiver')
        if not row.approved:raise HTTPException(403,'Approve this screen on the capture device.')
        # Keep IDs until their state acknowledgement; clients never retry an acknowledged command.
        previous=row.signals.get('command_sequence',0)
        if body.sequence<=previous:return {'ok':True}
        if body.sequence!=previous+1:raise HTTPException(409,'Send commands in order.')
        if len(row.commands)>=16:raise HTTPException(429,'Wait for the capture device.')
        seq=max([c['sequence'] for c in row.commands]+[row.sequence])+1
        row.commands=[*row.commands,{**body.model_dump(),'sequence':seq,'at':now().timestamp()*1000}];row.signals={**row.signals,'command_sequence':body.sequence};session.commit();return {'ok':True}

    @router.put('/{id}/signal')
    def signal(id:str,body:Signal,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,role,_=get(session,id,account,x_mimic_token)
        if not row.approved:raise HTTPException(403,'Approve this screen first.')
        stored=row.signals or {}
        if role=='capture':
            # A new offer supersedes any answer that was waiting for an older one.
            current=int(stored.get('capture_generation',0) or 0)
            if body.generation and body.generation<current:raise HTTPException(409,'An older connection offer was rejected.')
            generation=body.generation or current
            row.signals={**stored,'capture':body.description,'capture_generation':generation,'receiver':'','answer_generation':0}
        else:
            offer=int(stored.get('capture_generation',0) or 0)
            if body.generation and body.generation!=offer:raise HTTPException(409,'This answer belongs to an older connection offer.')
            row.signals={**stored,'receiver':body.description,'answer_generation':body.generation or offer}
        session.commit();return {'ok':True}

    @router.delete('/{id}')
    def revoke(id:str,x_mimic_token:str=Header(default=''),account=Depends(identity),session:Session=Depends(db)):
        row,_,_=get(session,id,account,x_mimic_token);row.revoked=True;row.commands=[];row.signals={};row.snapshot={};session.commit();return {'ok':True}
    app.include_router(router)
