from typing import Literal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select,func
from sqlalchemy.orm import Session
from .database import MimicAttempt
from .permissions import readable_lesson

class AttemptInput(BaseModel):
    id:str=Field(pattern=r'^[a-f0-9-]{36}$')
    revision_id:str=Field(min_length=1,max_length=80)
    scoring_version:Literal['pose-v1']='pose-v1'
    start:float=Field(ge=0,allow_inf_nan=False)
    end:float=Field(gt=0,allow_inf_nan=False)
    score:float|None=Field(default=None,ge=0,le=100,allow_inf_nan=False)
    coverage:float=Field(ge=0,le=1,allow_inf_nan=False)
    cue:str=Field(max_length=160)
    section:str=Field(max_length=200)
    configuration:str=Field(max_length=120)

def install_mimic_attempts(app,identity,db):
    router=APIRouter(prefix='/api/lessons')
    @router.get('/{lesson_id}/attempts')
    def history(lesson_id:str,account=Depends(identity),session:Session=Depends(db)):
        readable_lesson(session,lesson_id,account.id)
        rows=session.scalars(select(MimicAttempt).where(MimicAttempt.lesson_id==lesson_id,MimicAttempt.account_id==account.id).order_by(MimicAttempt.created_at.desc()).limit(100)).all()
        return [{**row.summary,'date':row.created_at.isoformat()} for row in rows]
    @router.post('/{lesson_id}/attempts',status_code=201)
    def save(lesson_id:str,body:AttemptInput,account=Depends(identity),session:Session=Depends(db)):
        _,revision=readable_lesson(session,lesson_id,account.id)
        if revision.id!=body.revision_id:raise HTTPException(409,'Lesson changed. Reopen it before saving attempts.')
        if body.end<body.start or body.end>revision.manifest['duration']:raise HTTPException(422,'Attempt outside lesson.')
        existing=session.get(MimicAttempt,body.id)
        if existing:
            if existing.account_id!=account.id or existing.lesson_id!=lesson_id:raise HTTPException(409,'Attempt identifier unavailable.')
            return {'ok':True}
        count=session.scalar(select(func.count()).select_from(MimicAttempt).where(MimicAttempt.account_id==account.id))
        if count>=5000:raise HTTPException(409,'Practice history is full. New practice still works.')
        session.add(MimicAttempt(id=body.id,account_id=account.id,lesson_id=lesson_id,revision_id=body.revision_id,summary=body.model_dump()));session.commit();return {'ok':True}
    app.include_router(router)
