"""MFA-gated platform operations. Metadata access does not imply private media access."""
import secrets
from datetime import timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from . import auth
from .admin_security import ADMIN_ROLES, account_view, audit, lock_admin_control
from .conversions import RUNNING
from .database import (Account, AccountToken, AdminAudit, AdminControl, Conversion, Group,
                       GroupMember, Lesson, LessonPublication, LessonReport, LoginSession, MimicPair)


class Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator('reason')
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 3:
            raise ValueError('Provide a reason.')
        return value.strip()


class AccountChange(Reason):
    platform_role: Literal['member', 'admin', 'super_admin'] | None = None
    status: Literal['active', 'suspended', 'deletion_pending'] | None = None


class AccountAction(Reason):
    action: Literal['revoke_sessions', 'send_verification', 'send_password_reset']


class JobAction(Reason):
    action: Literal['retry', 'cancel']


class GroupChange(Reason):
    archived: bool


class ReportAction(Reason):
    action: Literal['hide', 'restore', 'dismiss']


class SettingsChange(Reason):
    registration_enabled: bool


def job_view(job):
    return {'id': job.id, 'owner_id': job.owner_id, 'title': job.title, 'state': job.state,
            'provider': job.provider, 'attempts': job.attempts, 'error': job.error,
            'submission_state': job.submission_state, 'created_at': job.created_at,
            'retryable': job.state == 'failed' and job.attempts < 3 and
                job.error not in ('invalid_video', 'source_expired') and job.submission_state == 'none',
            'cancellable': job.state not in ('ready_for_review', 'cancelled')}


def revoke_sessions(session, account_id):
    session.execute(delete(LoginSession).where(LoginSession.account_id == account_id))
    session.execute(update(MimicPair).where(MimicPair.account_id == account_id).values(revoked=True))


def install_admin(app, settings, identity, db):
    router = APIRouter(prefix='/api/admin')

    def administrator(request: Request, account=Depends(identity), session: Session = Depends(db)):
        if request.method not in ('GET', 'HEAD'):
            lock_admin_control(session)
            session.refresh(account)
        if account.platform_role not in ADMIN_ROLES or account.status != 'active':
            raise HTTPException(403, 'Administrative access required.')
        login = session.get(LoginSession, auth.digest(request.cookies[auth.COOKIE]), populate_existing=True)
        until = login.admin_verified_until if login else None
        if not until or (until if until.tzinfo else until.replace(tzinfo=timezone.utc)) <= auth.now():
            raise HTTPException(403, 'Verify your authenticator to open administration.')
        return account

    def super_admin(actor):
        if actor.platform_role != 'super_admin':
            raise HTTPException(403, 'Super Admin access required.')

    def target_account(session, account_id, actor):
        target = session.get(Account, account_id, populate_existing=True)
        if not target:
            raise HTTPException(404, 'Account unavailable.')
        if actor.platform_role != 'super_admin' and target.platform_role != 'member':
            raise HTTPException(403, 'Only a Super Admin can manage administrative accounts.')
        return target

    @router.get('/overview')
    def overview(actor=Depends(administrator), session: Session = Depends(db)):
        def count(model, *where):
            return session.scalar(select(func.count()).select_from(model).where(*where)) or 0
        states = dict(session.execute(select(Conversion.state, func.count()).group_by(Conversion.state)).all())
        return {'accounts': count(Account), 'verified_accounts': count(Account, Account.verified.is_(True)),
                'active_accounts': count(Account, Account.status == 'active', Account.verified.is_(True)),
                'suspended_accounts': count(Account, Account.status == 'suspended'),
                'moves': count(Lesson, Lesson.archived.is_(False)), 'groups': count(Group, Group.archived.is_(False)),
                'open_reports': count(LessonReport, LessonReport.resolved_at.is_(None)), 'processing': states}

    @router.get('/accounts')
    def accounts(q: str = '', offset: int = 0, limit: int = 25, actor=Depends(administrator), session: Session = Depends(db)):
        statement = select(Account)
        if q.strip():
            statement = statement.where(or_(Account.email.icontains(q.strip()[:254], autoescape=True), Account.id == q.strip()))
        total = session.scalar(select(func.count()).select_from(statement.subquery()))
        rows = session.scalars(statement.order_by(Account.created_at.desc(), Account.id)
                               .offset(max(0, offset)).limit(max(1, min(limit, 100))))
        return {'accounts': [account_view(row) for row in rows], 'total': total}

    @router.get('/accounts/{account_id}')
    def account_detail(account_id: str, actor=Depends(administrator), session: Session = Depends(db)):
        account = session.get(Account, account_id)
        if not account:
            raise HTTPException(404, 'Account unavailable.')
        # Bounded metadata only. Practice history, scores and source media remain private.
        moves = session.scalars(select(Lesson).where(Lesson.owner_id == account_id).order_by(Lesson.created_at.desc()).limit(100))
        groups = session.execute(select(Group, GroupMember.role).join(GroupMember, GroupMember.group_id == Group.id)
                                 .where(GroupMember.account_id == account_id).order_by(Group.created_at.desc()).limit(100))
        jobs = session.scalars(select(Conversion).where(Conversion.owner_id == account_id).order_by(Conversion.created_at.desc()).limit(100))
        logs = select(AdminAudit).where(AdminAudit.target_id == account_id)
        if actor.platform_role != 'super_admin':
            logs = logs.where(AdminAudit.actor_id == actor.id)
        return {'account': account_view(account),
                'moves': [{'id': m.id, 'title': m.title, 'archived': m.archived} for m in moves],
                'groups': [{'id': g.id, 'name': g.name, 'role': role, 'archived': g.archived} for g, role in groups],
                'jobs': [job_view(j) for j in jobs],
                'activity': [audit_view(a) for a in session.scalars(logs.order_by(AdminAudit.created_at.desc()).limit(100))]}

    @router.patch('/accounts/{account_id}')
    def change_account(account_id: str, body: AccountChange, actor=Depends(administrator), session: Session = Depends(db)):
        if body.platform_role is None and body.status is None:
            raise HTTPException(422, 'Choose a role or status to change.')
        if body.platform_role is not None:
            super_admin(actor)
        target = target_account(session, account_id, actor)
        role = body.platform_role or target.platform_role
        status = body.status or target.status
        if role in ADMIN_ROLES and (not target.verified or status != 'active') and role != target.platform_role:
            raise HTTPException(409, 'Administrative roles require an active, verified account.')
        if target.platform_role == 'super_admin' and target.status == 'active' and (role != 'super_admin' or status != 'active'):
            others = session.scalar(select(func.count()).select_from(Account).where(
                Account.id != target.id, Account.platform_role == 'super_admin', Account.status == 'active', Account.verified.is_(True)))
            if not others:
                raise HTTPException(409, 'Keep at least one active Super Admin.')
        before = {'platform_role': target.platform_role, 'status': target.status}
        target.platform_role = role
        target.status = status
        if status == 'deletion_pending' and not target.deletion_requested_at:
            target.deletion_requested_at = auth.now()
        elif status != 'deletion_pending':
            target.deletion_requested_at = None
        revoke_sessions(session, target.id)
        session.execute(update(AccountToken).where(AccountToken.account_id == target.id).values(used=True))
        audit(session, actor.id, 'account.update', target.id, body.reason,
              before=before, after={'platform_role': role, 'status': status})
        session.commit()
        return account_view(target)

    @router.post('/accounts/{account_id}/actions')
    def account_action(account_id: str, body: AccountAction, actor=Depends(administrator), session: Session = Depends(db)):
        target = target_account(session, account_id, actor)
        if body.action == 'revoke_sessions':
            revoke_sessions(session, target.id)
        else:
            purpose = 'verify' if body.action == 'send_verification' else 'reset'
            if (purpose == 'verify' and target.verified) or (purpose == 'reset' and not target.verified) or target.status != 'active':
                raise HTTPException(409, 'This email action is unavailable for this account.')
            recent = session.scalar(select(AdminAudit.id).where(AdminAudit.target_id == target.id,
                AdminAudit.action == f'account.{body.action}', AdminAudit.created_at > auth.now() - timedelta(minutes=15)).limit(1))
            if recent:
                raise HTTPException(429, 'This email was recently requested. Try again in 15 minutes.')
            token = secrets.token_urlsafe(32)
            session.execute(update(AccountToken).where(AccountToken.account_id == target.id, AccountToken.purpose == purpose).values(used=True))
            session.add(AccountToken(token_hash=auth.digest(token), account_id=target.id, purpose=purpose,
                                     expires_at=auth.now() + timedelta(minutes=30), used=False))
            try:
                auth.send_account_mail(settings, target.email, purpose, token)
            except Exception as exc:
                raise HTTPException(503, 'Email is unavailable. Try again shortly.') from exc
        audit(session, actor.id, f'account.{body.action}', target.id, body.reason)
        session.commit()
        return {'message': 'Action completed.'}

    @router.get('/jobs')
    def jobs(offset: int = 0, limit: int = 25, actor=Depends(administrator), session: Session = Depends(db)):
        rows = session.scalars(select(Conversion).order_by(Conversion.created_at.desc(), Conversion.id)
                               .offset(max(0, offset)).limit(max(1, min(limit, 100))))
        return {'jobs': [job_view(row) for row in rows], 'total': session.scalar(select(func.count()).select_from(Conversion))}

    @router.post('/jobs/{job_id}/actions')
    def job_action(job_id: str, body: JobAction, actor=Depends(administrator), session: Session = Depends(db)):
        owner_id = session.scalar(select(Conversion.owner_id).where(Conversion.id == job_id))
        owner = session.scalar(select(Account).where(Account.id == owner_id).with_for_update())
        job = session.scalar(select(Conversion).where(Conversion.id == job_id).with_for_update())
        if not job:
            raise HTTPException(404, 'Processing job unavailable.')
        before = job.state
        if body.action == 'retry':
            if not job_view(job)['retryable'] or not owner or owner.status != 'active':
                raise HTTPException(409, 'This job cannot be safely retried.')
            active = session.scalar(select(func.count()).select_from(Conversion).where(
                Conversion.owner_id == job.owner_id, Conversion.state.in_(('queued', *RUNNING))))
            if active >= settings.max_active_conversions:
                raise HTTPException(409, 'This account has reached its active processing limit.')
            job.state = 'queued'
            job.error = None
        else:
            if not job_view(job)['cancellable']:
                raise HTTPException(409, 'This job is already completed or cancelled.')
            if job.provider != 'local' and job.submission_state in ('prepared', 'submitted'):
                job.submission_state = 'unknown'
            job.state = 'cancelled'
            job.attempt_token = None
        job.lease_until = None
        audit(session, actor.id, f'job.{body.action}', job.id, body.reason, before=before, after=job.state)
        session.commit()
        return job_view(job)

    @router.get('/groups')
    def groups(q: str = '', offset: int = 0, limit: int = 25, actor=Depends(administrator), session: Session = Depends(db)):
        statement = select(Group)
        if q.strip():
            statement = statement.where(Group.name.icontains(q.strip()[:80], autoescape=True))
        total = session.scalar(select(func.count()).select_from(statement.subquery()))
        rows = session.scalars(statement.order_by(Group.created_at.desc(), Group.id)
                               .offset(max(0, offset)).limit(max(1, min(limit, 100))))
        return {'groups': [{'id': g.id, 'name': g.name, 'owner_id': g.owner_id, 'archived': g.archived,
                           'members': session.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == g.id))} for g in rows], 'total': total}

    @router.patch('/groups/{group_id}')
    def change_group(group_id: str, body: GroupChange, actor=Depends(administrator), session: Session = Depends(db)):
        group = session.scalar(select(Group).where(Group.id == group_id).with_for_update())
        if not group:
            raise HTTPException(404, 'Group unavailable.')
        before = group.archived
        group.archived = body.archived
        audit(session, actor.id, 'group.update', group.id, body.reason, before=before, archived=group.archived)
        session.commit()
        return {'archived': group.archived}

    @router.get('/reports')
    def reports(offset: int = 0, limit: int = 25, actor=Depends(administrator), session: Session = Depends(db)):
        rows = session.execute(select(LessonReport, Lesson.title, LessonPublication.moderation_hidden)
            .join(Lesson, Lesson.id == LessonReport.lesson_id).outerjoin(LessonPublication, LessonPublication.lesson_id == LessonReport.lesson_id)
            .order_by(LessonReport.created_at.desc(), LessonReport.id).offset(max(0, offset)).limit(max(1, min(limit, 100))))
        return {'reports': [{'id': r.id, 'lesson_id': r.lesson_id, 'reporter_id': r.account_id,
                 'title': title, 'reason': r.reason, 'created_at': r.created_at, 'resolved_at': r.resolved_at,
                 'hidden': bool(hidden), 'has_publication': hidden is not None} for r, title, hidden in rows],
                'total': session.scalar(select(func.count()).select_from(LessonReport))}

    @router.post('/reports/{report_id}/actions')
    def report_action(report_id: str, body: ReportAction, actor=Depends(administrator), session: Session = Depends(db)):
        report = session.get(LessonReport, report_id)
        if not report:
            raise HTTPException(404, 'Report unavailable.')
        if body.action != 'dismiss':
            publication = session.scalar(select(LessonPublication).where(LessonPublication.lesson_id == report.lesson_id).with_for_update())
            if not publication:
                raise HTTPException(409, 'This move has no public listing to moderate.')
            publication.moderation_hidden = body.action == 'hide'
        report.resolved_at = auth.now()
        audit(session, actor.id, f'report.{body.action}', report.lesson_id, body.reason, report_id=report.id)
        session.commit()
        return {'message': 'Report updated.'}

    @router.get('/audit')
    def activity(offset: int = 0, limit: int = 25, actor=Depends(administrator), session: Session = Depends(db)):
        statement = select(AdminAudit)
        if actor.platform_role != 'super_admin':
            statement = statement.where(AdminAudit.actor_id == actor.id)
        total = session.scalar(select(func.count()).select_from(statement.subquery()))
        rows = session.scalars(statement.order_by(AdminAudit.created_at.desc(), AdminAudit.id)
                               .offset(max(0, offset)).limit(max(1, min(limit, 100))))
        return {'activity': [audit_view(row) for row in rows], 'total': total}

    @router.get('/settings')
    def platform_settings(actor=Depends(administrator), session: Session = Depends(db)):
        super_admin(actor)
        control = session.get(AdminControl, 'platform')
        return {'registration_enabled': control.registration_enabled if control else True}

    @router.patch('/settings')
    def change_settings(body: SettingsChange, actor=Depends(administrator), session: Session = Depends(db)):
        super_admin(actor)
        control = session.get(AdminControl, 'platform')
        before = control.registration_enabled
        control.registration_enabled = body.registration_enabled
        audit(session, actor.id, 'settings.update', 'platform', body.reason,
              before={'registration_enabled': before}, after={'registration_enabled': body.registration_enabled})
        session.commit()
        return {'registration_enabled': control.registration_enabled}

    app.include_router(router)


def audit_view(row):
    return {'id': row.id, 'actor_id': row.actor_id, 'action': row.action, 'target_id': row.target_id,
            'reason': row.reason, 'details': row.details, 'created_at': row.created_at}
