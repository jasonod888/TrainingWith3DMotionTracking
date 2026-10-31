"""Publication is separate from draft edits; access is checked for every request."""
import hmac
import secrets
from datetime import timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from .auth import EmailInput, digest, now, send_account_mail
from . import auth
from .database import Account, Group, GroupCollection, GroupLesson, GroupMember, Lesson, LessonGrant, LessonInvitation, LessonPublication, LessonReport, LessonRevision, LessonTag
from .permissions import ensure_release, latest_acceptance, latest_revision, owned_lesson, readable_lesson, visible_manifest


class Publish(BaseModel):
    revision_id:str=Field(min_length=1,max_length=80)
    mode:Literal['invite','link']
    reviewed:Literal[True]
    rights_acknowledged:Literal[True]
    rotate_link:bool=False
    keep_current_release:bool=False


class IncomingShare(BaseModel):
    lesson_id:str|None=Field(default=None,max_length=80)
    key:str|None=Field(default=None,min_length=32,max_length=128)
    invite:str|None=Field(default=None,min_length=32,max_length=128)

    @model_validator(mode='after')
    def one_kind(self):
        if bool(self.invite)==bool(self.key) or (self.key and not self.lesson_id):raise ValueError('Use one invitation or lesson link.')
        return self


class ReportInput(BaseModel):
    reason:str=Field(min_length=3,max_length=500)


def future(value):
    return value and (value if value.tzinfo else value.replace(tzinfo=now().tzinfo))>now()


def install_sharing(app,settings,identity,db):
    router=APIRouter(prefix='/api')

    @router.get('/shared-lessons')
    def shared_library(account=Depends(identity),session:Session=Depends(db)):
        grants=session.scalars(select(LessonGrant).where(LessonGrant.account_id==account.id,LessonGrant.revoked.is_(False)).order_by(LessonGrant.accepted_at.desc()).limit(200)).all()
        values=[];seen=set()
        for grant in grants:
            try:
                lesson,revision=readable_lesson(session,grant.lesson_id,account.id)
                if lesson.owner_id!=account.id and lesson.id not in seen:
                    seen.add(lesson.id);values.append(visible_manifest(session,lesson,revision,account.id))
            except HTTPException:continue
        group_ids=session.scalars(select(GroupLesson.lesson_id).join(
            GroupMember,GroupMember.group_id==GroupLesson.group_id).join(
            Group,Group.id==GroupLesson.group_id).where(
            GroupMember.account_id==account.id,Group.archived.is_(False)).limit(200)).all()
        group_ids += session.scalars(select(GroupCollection.lesson_id).join(GroupMember,GroupMember.group_id==GroupCollection.group_id).join(Group,Group.id==GroupCollection.group_id).where(GroupMember.account_id==account.id,Group.archived.is_(False)).limit(200)).all()
        for lesson_id in group_ids:
            if lesson_id in seen:continue
            try:
                lesson,revision=readable_lesson(session,lesson_id,account.id)
                if lesson.owner_id!=account.id:
                    seen.add(lesson.id);values.append(visible_manifest(session,lesson,revision,account.id))
            except HTTPException:continue
        return values

    @router.get('/lessons/{lesson_id}/sharing')
    def settings_view(lesson_id:str,account=Depends(identity),session:Session=Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id)
        grants=session.execute(select(LessonGrant,Account.email).join(Account,Account.id==LessonGrant.account_id).where(LessonGrant.lesson_id==lesson_id)).all()
        students=[]
        for grant,email in grants:
            allowed=True
            try:readable_lesson(session,lesson_id,grant.account_id)
            except HTTPException:allowed=False
            students.append({'id':grant.account_id,'email':email,'active':allowed,'revoked':grant.revoked,'source':grant.source,'last_active_at':grant.last_active_at})
        invitations=session.scalars(select(LessonInvitation).where(LessonInvitation.lesson_id==lesson_id,LessonInvitation.revoked.is_(False),LessonInvitation.accepted_account_id.is_(None),LessonInvitation.expires_at>now())).all()
        acceptance=latest_acceptance(session,lesson_id)
        publication=session.get(LessonPublication,lesson_id)
        tags=list(session.scalars(select(LessonTag.tag).where(LessonTag.lesson_id==lesson_id).order_by(LessonTag.tag)).all())
        groups=0
        try:
            from .groups import group_count
            groups=group_count(session,lesson_id)
        except ImportError:
            pass
        return {'mode':lesson.distribution,'published_revision_id':lesson.published_revision_id,'draft_revision_id':latest_revision(session,lesson).id,
                'accepted_revision_id':acceptance.revision_id if acceptance else None,
                'public_listed':bool(publication and publication.listed),'groups':int(groups),
                'public_listing':({'title':publication.title,'creator_name':publication.creator_name,
                    'description':publication.description,'tags':tags} if publication and publication.listed else None),
                'link_active':bool(lesson.share_token_hash and future(lesson.share_expires_at) and lesson.distribution=='link'),
                'link_expires_at':lesson.share_expires_at,'students':students,'invitations':[{'id':i.id,'email':i.email,'expires_at':i.expires_at} for i in invitations],
                'summary':{'accepted':len(students),'active':sum(s['active'] for s in students),'recently_practised':sum(bool(g.last_active_at and (g.last_active_at if g.last_active_at.tzinfo else g.last_active_at.replace(tzinfo=now().tzinfo))>now()-timedelta(days=30)) for g,_ in grants)}}

    @router.post('/lessons/{lesson_id}/publish')
    def publish(lesson_id:str,body:Publish,account=Depends(identity),session:Session=Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id,True)
        revision=latest_revision(session,lesson)
        if revision.id!=body.revision_id:
            revision=session.get(LessonRevision,body.revision_id) if body.keep_current_release and body.revision_id==lesson.published_revision_id else None
            if not revision or revision.lesson_id!=lesson.id:raise HTTPException(409,'The move has newer edits. Reopen it before sharing.')
        # Legacy publishers had no explicit acceptance step; record one so every release is accepted.
        ensure_release(session,lesson,revision,account.id,source='publish')
        link=None
        if body.mode=='link' and (body.rotate_link or lesson.distribution!='link' or not lesson.share_token_hash or not future(lesson.share_expires_at)):
            raw=secrets.token_urlsafe(32);lesson.share_token_hash=digest(raw);lesson.share_generation+=1;lesson.share_expires_at=now()+timedelta(days=30)
            link=f'{settings.public_url.rstrip("/")}/#lesson={lesson_id}&key={raw}'
        elif body.mode!='link':
            lesson.share_token_hash=None;lesson.share_expires_at=None;lesson.share_generation+=1
        lesson.distribution=body.mode;lesson.published_revision_id=revision.id;session.commit()
        return {'published_revision_id':revision.id,'link':link}

    @router.post('/lessons/{lesson_id}/unpublish')
    def unpublish(lesson_id:str,account=Depends(identity),session:Session=Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id,True);lesson.published_revision_id=None;lesson.distribution='private';lesson.share_token_hash=None;lesson.share_expires_at=None;lesson.share_generation+=1
        publication=session.get(LessonPublication,lesson_id)
        if publication:publication.listed=False;publication.withdrawn_at=now()
        session.commit()
        return {'message':'This move is private again.'}

    @router.post('/lessons/{lesson_id}/invitations',status_code=201)
    def invite(lesson_id:str,body:EmailInput,account=Depends(identity),session:Session=Depends(db)):
        lesson=owned_lesson(session,lesson_id,account.id,True)
        if not lesson.published_revision_id:raise HTTPException(409,'Publish your reviewed lesson first.')
        pending=session.scalars(select(LessonInvitation).where(LessonInvitation.lesson_id==lesson_id,LessonInvitation.revoked.is_(False),LessonInvitation.expires_at>now())).all()
        if len(pending)>=100:raise HTTPException(409,'This lesson has reached its current invitation limit.')
        if any(i.email==body.email and i.accepted_account_id is None for i in pending):raise HTTPException(409,'An invitation is already pending for this email. Revoke it to send a new one.')
        raw=secrets.token_urlsafe(32);invitation=LessonInvitation(id=uuid4().hex,lesson_id=lesson_id,email=body.email,token_hash=digest(raw),expires_at=now()+timedelta(days=7),revoked=False)
        session.add(invitation)
        # Send only after the record is durable; failure leaves a visible invitation that can be revoked/reissued.
        session.commit()
        try:
            auth.send_account_mail(settings,body.email,'invite',raw)
        except Exception:
            invitation.revoked=True
            session.commit()
            raise HTTPException(503,'Invitation could not be sent. Please try again.')
        return {'id':invitation.id,'email':invitation.email}

    @router.delete('/lessons/{lesson_id}/invitations/{invitation_id}')
    def revoke_invitation(lesson_id:str,invitation_id:str,account=Depends(identity),session:Session=Depends(db)):
        owned_lesson(session,lesson_id,account.id,True)
        invitation=session.get(LessonInvitation,invitation_id)
        if not invitation or invitation.lesson_id!=lesson_id:raise HTTPException(404)
        invitation.revoked=True
        if invitation.accepted_account_id:
            grant=session.get(LessonGrant,(lesson_id,invitation.accepted_account_id))
            if grant and grant.invitation_id==invitation_id:grant.revoked=True
        session.commit();return {'revoked':True}

    @router.delete('/lessons/{lesson_id}/students/{account_id}')
    def revoke_student(lesson_id:str,account_id:str,account=Depends(identity),session:Session=Depends(db)):
        owned_lesson(session,lesson_id,account.id,True)
        grant=session.get(LessonGrant,(lesson_id,account_id))
        if not grant:raise HTTPException(404)
        grant.revoked=True;session.commit();return {'revoked':True}

    def incoming(session,body,account,lock=False):
        invitation=None
        if body.invite:
            invitation=session.scalar(select(LessonInvitation).where(LessonInvitation.token_hash==digest(body.invite)))
            if not invitation:raise HTTPException(404,'Invitation unavailable.')
            lesson_id=invitation.lesson_id
        else:lesson_id=body.lesson_id
        query=select(Lesson).where(Lesson.id==lesson_id,Lesson.archived.is_(False),Lesson.disabled.is_(False))
        lesson=session.scalar(query.with_for_update() if lock else query)
        if not lesson or not lesson.published_revision_id or lesson.distribution=='private':raise HTTPException(404,'Shared lesson unavailable.')
        if invitation:
            session.refresh(invitation)
            if invitation.revoked or not future(invitation.expires_at):raise HTTPException(404,'Invitation expired or revoked.')
            if invitation.email!=account.email:raise HTTPException(403,'Sign in with the email address that received this invitation.')
            if invitation.accepted_account_id and invitation.accepted_account_id!=account.id:raise HTTPException(403,'Invitation already accepted.')
            if invitation.accepted_account_id:
                grant=session.get(LessonGrant,(lesson.id,account.id))
                if not grant or grant.revoked or grant.invitation_id!=invitation.id:raise HTTPException(404,'This invitation no longer grants access.')
        elif lesson.distribution!='link' or not lesson.share_token_hash or not future(lesson.share_expires_at) or not hmac.compare_digest(lesson.share_token_hash,digest(body.key)):
            raise HTTPException(404,'Link expired or revoked.')
        else:
            grant=session.get(LessonGrant,(lesson.id,account.id))
            if grant and grant.revoked:raise HTTPException(404,'Your access was revoked.')
        return lesson,invitation

    @router.post('/shares/inspect')
    def inspect(body:IncomingShare,account=Depends(identity),session:Session=Depends(db)):
        lesson,_=incoming(session,body,account)
        revision=session.get(LessonRevision,lesson.published_revision_id)
        return {'title':revision.manifest['title'],'sections':len(revision.manifest['section_set']['sections']),'duration':revision.manifest['duration']}

    @router.post('/shares/accept')
    def accept(body:IncomingShare,account=Depends(identity),session:Session=Depends(db)):
        lesson,invitation=incoming(session,body,account,True)
        if lesson.owner_id==account.id:return latest_revision(session,lesson).manifest
        grant=session.get(LessonGrant,(lesson.id,account.id))
        if invitation:
            if invitation.accepted_account_id and (not grant or grant.revoked or grant.invitation_id!=invitation.id):raise HTTPException(404,'Access was revoked or this invitation was replaced. Ask for a new invitation.')
            if not grant:grant=LessonGrant(lesson_id=lesson.id,account_id=account.id,source='invite');session.add(grant)
            grant.source='invite';grant.revoked=False;grant.invitation_id=invitation.id;invitation.accepted_account_id=account.id
        else:
            if grant and grant.revoked:raise HTTPException(404,'Your access was revoked. Ask the instructor for an invitation.')
            if not grant:grant=LessonGrant(lesson_id=lesson.id,account_id=account.id,source='link',generation=lesson.share_generation,revoked=False);session.add(grant)
            elif grant.source=='link':grant.generation=lesson.share_generation
        session.commit()
        return readable_lesson(session,lesson.id,account.id)[1].manifest

    @router.post('/lessons/{lesson_id}/report',status_code=202)
    def report(lesson_id:str,body:ReportInput,account=Depends(identity),session:Session=Depends(db)):
        if len(body.reason.strip())<3:raise HTTPException(422,'Please describe the issue.')
        readable_lesson(session,lesson_id,account.id)
        session.scalar(select(Account).where(Account.id==account.id).with_for_update())
        existing=session.scalar(select(LessonReport).where(LessonReport.lesson_id==lesson_id,LessonReport.account_id==account.id))
        if not existing:session.add(LessonReport(id=uuid4().hex,lesson_id=lesson_id,account_id=account.id,reason=body.reason.strip()));session.commit()
        return {'message':'Report received. Thank you.'}

    app.include_router(router)
