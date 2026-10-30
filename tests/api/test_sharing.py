from datetime import timedelta
from urllib.parse import urlparse,parse_qs
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_accounts import system,imported,register,login
from apps.api.auth import now
from apps.api.database import Lesson,LessonInvitation,LessonGrant,LessonReport


def learner(app,mail,email='student@example.test'):
    client=TestClient(app);client.headers.update({'Origin':'http://testserver','X-Form-Request':'1'});register(client,mail,email);login(client,email);return client


def publish(client,lesson,mode='invite',**extra):
    return client.post(f'/api/lessons/{lesson.lesson_id}/publish',json={'revision_id':lesson.revision_id,'mode':mode,'reviewed':True,'rights_acknowledged':True,**extra})


def invite(client,mail,path,email='student@example.test'):
    result=client.post(path+'/invitations',json={'email':email});assert result.status_code==201,result.text
    token=next(t for e,p,t in reversed(mail) if e==email and p=='invite')
    return result.json()['id'],token


def test_invited_student_uses_published_snapshot_and_cannot_edit(system):
    lesson=imported(system);owner,app,_,mail,_=system;path=f'/api/lessons/{lesson.lesson_id}'
    student=learner(app,mail)
    assert owner.post(path+'/publish',json={'revision_id':lesson.revision_id,'mode':'invite','reviewed':False,'rights_acknowledged':True}).status_code==422
    assert publish(owner,lesson).status_code==200
    invitation,token=invite(owner,mail,path)
    assert student.get(path).status_code==404
    accepted=student.post('/api/shares/accept',json={'invite':token});assert accepted.status_code==200,accepted.text
    assert student.get(path+'/assets/synthetic.glb').status_code==200
    assert student.get('/api/shared-lessons').json()[0]['revision_id']==lesson.revision_id
    assert student.get('/api/lessons').json()==[]
    assert student.get(path+'/sharing').status_code==404
    assert student.post(path+'/publish',json={'revision_id':lesson.revision_id,'mode':'invite','reviewed':True,'rights_acknowledged':True}).status_code==404
    edits={'base_revision_id':lesson.revision_id,'title':'Private new draft','sections':[s.model_dump() for s in lesson.section_set.sections]}
    assert student.put(path+'/sections',json=edits).status_code==404
    newer=owner.put(path+'/sections',json=edits).json()
    assert student.get(path).json()['revision_id']==lesson.revision_id
    position={'revision_id':lesson.revision_id,'time':1,'speed':.5,'mode':'sections'}
    assert student.put(path+'/progress',json=position).status_code==200
    assert owner.get(path+'/sharing').json()['summary']['recently_practised']==1
    assert publish(owner,lesson).status_code==409
    assert owner.post(path+'/publish',json={'revision_id':newer['revision_id'],'mode':'invite','reviewed':True,'rights_acknowledged':True}).status_code==200
    assert student.get(path).json()['revision_id']==newer['revision_id']
    assert student.get(path+'/progress').json() is None
    assert student.put(path+'/progress',json=position).status_code==409
    assert owner.post(path+'/unpublish',json={}).status_code==200
    assert student.get(path).status_code==404
    assert student.get(path+'/assets/synthetic.glb').status_code==404
    assert student.get('/api/shared-lessons').json()==[]


def test_invitation_email_expiry_revoke_and_replacement(system):
    lesson=imported(system);owner,app,_,mail,_=system;path=f'/api/lessons/{lesson.lesson_id}';publish(owner,lesson)
    student=learner(app,mail);wrong=learner(app,mail,'wrong@example.test')
    invitation,token=invite(owner,mail,path)
    assert wrong.post('/api/shares/accept',json={'invite':token}).status_code==403
    assert wrong.post('/api/shares/inspect',json={'invite':token}).status_code==403
    assert owner.post(path+'/invitations',json={'email':'student@example.test'}).status_code==409
    assert owner.request('DELETE',path+'/invitations/'+invitation,json={}).status_code==200
    assert student.post('/api/shares/accept',json={'invite':token}).status_code==404
    invitation,token=invite(owner,mail,path)
    assert student.post('/api/shares/accept',json={'invite':token}).status_code==200
    account_id=student.get('/api/auth/session').json()['account']['id']
    owner.request('DELETE',path+'/students/'+account_id,json={})
    assert student.get(path).status_code==404
    assert student.post('/api/shares/accept',json={'invite':token}).status_code==404
    new_id,new_token=invite(owner,mail,path)
    assert student.post('/api/shares/accept',json={'invite':new_token}).status_code==200
    assert student.post('/api/shares/accept',json={'invite':token}).status_code==404
    assert student.post('/api/shares/inspect',json={'invite':token}).status_code==404
    owner.request('DELETE',path+'/invitations/'+new_id,json={})
    assert student.get(path+'/assets/synthetic.glb').status_code==404
    expired_id,expired_token=invite(owner,mail,path,'wrong@example.test')
    with Session(app.state.engine) as session:session.get(LessonInvitation,expired_id).expires_at=now()-timedelta(seconds=1);session.commit()
    assert wrong.post('/api/shares/accept',json={'invite':expired_token}).status_code==404


def test_link_rotation_expiry_and_revoked_account_cannot_rejoin(system):
    lesson=imported(system);owner,app,_,mail,_=system;path=f'/api/lessons/{lesson.lesson_id}'
    student=learner(app,mail);second=learner(app,mail,'second@example.test')
    url=publish(owner,lesson,'link').json()['link'];key=parse_qs(urlparse(url).fragment)['key'][0]
    with Session(app.state.engine) as session:assert session.get(Lesson,lesson.lesson_id).share_token_hash!=key
    body={'lesson_id':lesson.lesson_id,'key':key}
    assert student.post('/api/shares/accept',json=body).status_code==200
    assert second.post('/api/shares/accept',json=body).status_code==200
    account_id=student.get('/api/auth/session').json()['account']['id'];owner.request('DELETE',path+'/students/'+account_id,json={})
    assert student.post('/api/shares/accept',json=body).status_code==404
    assert student.get(path).status_code==404
    new_url=publish(owner,lesson,'link',rotate_link=True).json()['link'];new_key=parse_qs(urlparse(new_url).fragment)['key'][0]
    assert new_key!=key
    assert second.get(path).status_code==404
    assert second.post('/api/shares/accept',json=body).status_code==404
    assert second.post('/api/shares/accept',json={'lesson_id':lesson.lesson_id,'key':new_key}).status_code==200
    with Session(app.state.engine) as session:session.get(Lesson,lesson.lesson_id).share_expires_at=now()-timedelta(seconds=1);session.commit()
    assert second.get(path+'/assets/synthetic.glb').status_code==404


def test_reports_and_operator_disablement_block_media(system):
    lesson=imported(system);owner,app,_,mail,_=system;path=f'/api/lessons/{lesson.lesson_id}';publish(owner,lesson)
    student=learner(app,mail);_,token=invite(owner,mail,path)
    student.post('/api/shares/accept',json={'invite':token})
    assert student.post(path+'/report',json={'reason':'Quality issue to review'}).status_code==202
    assert student.post(path+'/report',json={'reason':'Same report again'}).status_code==202
    with Session(app.state.engine) as session:
        assert len(session.scalars(select(LessonReport)).all())==1
        session.get(Lesson,lesson.lesson_id).disabled=True;session.commit()
    assert student.get(path).status_code==404
    assert owner.get(path).status_code==404
    assert student.get(path+'/assets/synthetic.glb').status_code==404
