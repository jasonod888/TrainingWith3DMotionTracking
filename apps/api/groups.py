"""Small asynchronous groups: named membership and a shared collection of accepted moves."""
import secrets
from datetime import timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import auth
from .auth import digest, now
from .database import Account, Group, GroupCollection, GroupInvitation, GroupLesson, GroupMember, Lesson, LessonRevision
from .permissions import accepted, latest_revision, owned_lesson, public_lesson, public_manifest


class GroupInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=500)


class GroupUpdate(BaseModel):
    contribution_policy: str | None = Field(default=None, pattern='^(members|managers)$')
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class GroupInvite(BaseModel):
    email: str = Field(max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    role: str = Field(default='member', pattern='^(member|admin)$')

    @field_validator('email')
    @classmethod
    def normalise(cls, value):
        return value.lower()


class GroupToken(BaseModel):
    invite: str = Field(min_length=32, max_length=128)


class GroupTransfer(BaseModel):
    account_id: str = Field(min_length=1, max_length=80)


class GroupMove(BaseModel):
    access_kind: str = Field(default='grant', pattern='^(grant|collection)$')
    lesson_id: str = Field(min_length=1, max_length=80)


def group_access(session, lesson, account_id):
    if not account_id or not lesson.published_revision_id:
        return False
    return session.scalar(select(GroupMember.account_id).join(
        GroupLesson, GroupLesson.group_id == GroupMember.group_id).join(
        Group, Group.id == GroupMember.group_id).where(
        GroupMember.account_id == account_id, GroupLesson.lesson_id == lesson.id,
        Group.archived.is_(False)).limit(1)) is not None


def group_count(session, lesson_id):
    return session.scalar(select(func.count()).select_from(GroupLesson).join(
        Group, Group.id == GroupLesson.group_id).where(
        GroupLesson.lesson_id == lesson_id, Group.archived.is_(False))) or 0


def future(value):
    if not value:
        return False
    return (value if value.tzinfo else value.replace(tzinfo=now().tzinfo)) > now()


def install_groups(app, settings, identity, optional_identity, db):
    router = APIRouter(prefix='/api/groups')

    def membership(session, group_id, account_id):
        return session.get(GroupMember, (group_id, account_id))

    def member_group(session, group_id, account_id):
        group = session.scalar(select(Group).where(Group.id == group_id, Group.archived.is_(False)))
        if not group:
            raise HTTPException(404, 'Group unavailable.')
        record = membership(session, group_id, account_id)
        if not record:
            raise HTTPException(404, 'Group unavailable.')
        return group, record

    def manager_group(session, group_id, account_id):
        group, record = member_group(session, group_id, account_id)
        if record.role not in ('owner', 'admin'):
            raise HTTPException(403, 'Only the group owner or an admin can do this.')
        return group, record

    def summary(session, group, role):
        members = session.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id)) or 0
        private_ids = set(session.scalars(select(GroupLesson.lesson_id).where(GroupLesson.group_id == group.id)))
        public_ids = set(session.scalars(select(GroupCollection.lesson_id).where(GroupCollection.group_id == group.id)))
        moves = len(private_ids | public_ids)
        return {'id': group.id, 'name': group.name, 'description': group.description, 'role': role,
                'contribution_policy': group.contribution_policy, 'members': int(members), 'moves': int(moves)}

    @router.post('', status_code=201)
    def create(body: GroupInput, account=Depends(identity), session: Session = Depends(db)):
        name = body.name.strip()
        if not name:
            raise HTTPException(422, 'Give the group a name.')
        group = Group(id=uuid4().hex, owner_id=account.id, name=name, description=body.description.strip())
        session.add(group)
        session.add(GroupMember(group_id=group.id, account_id=account.id, role='owner'))
        session.commit()
        return summary(session, group, 'owner')

    @router.get('')
    def listing(account=Depends(identity), session: Session = Depends(db)):
        rows = session.execute(select(Group, GroupMember.role).join(
            GroupMember, GroupMember.group_id == Group.id).where(
            GroupMember.account_id == account.id, Group.archived.is_(False)).order_by(Group.created_at.desc())).all()
        return {'groups': [summary(session, group, role) for group, role in rows]}

    @router.get('/{group_id}')
    def detail(group_id: str, account=Depends(identity), session: Session = Depends(db)):
        group, record = member_group(session, group_id, account.id)
        members = session.execute(select(GroupMember, Account.email).join(
            Account, Account.id == GroupMember.account_id).where(GroupMember.group_id == group_id)
            .order_by(GroupMember.joined_at)).all()
        moves = []
        links = [(link, 'grant') for link in session.scalars(select(GroupLesson).where(GroupLesson.group_id == group_id).order_by(GroupLesson.created_at.desc()))]
        grant_ids = {link.lesson_id for link, _ in links}
        links += [(link, 'collection') for link in session.scalars(select(GroupCollection).where(GroupCollection.group_id == group_id).order_by(GroupCollection.created_at.desc())) if link.lesson_id not in grant_ids]
        for link, access_kind in links:
            lesson = session.get(Lesson, link.lesson_id)
            revision = session.get(LessonRevision, lesson.published_revision_id) if lesson and lesson.published_revision_id else None
            if not lesson or not revision or lesson.archived or lesson.disabled:
                continue
            title = lesson.title
            if access_kind == 'collection':
                try:
                    _, revision, publication = public_lesson(session, lesson.id)
                    title = publication.title
                except HTTPException:
                    continue
            moves.append({'lesson_id': lesson.id, 'title': title, 'revision_id': revision.id,
                          'access_kind': access_kind, 'can_remove': record.role in ('owner', 'admin') or link.added_by == account.id or lesson.owner_id == account.id,
                          'duration': revision.manifest['duration'], 'sections': len(revision.manifest['section_set']['sections'])})
        return {'id': group.id, 'name': group.name, 'description': group.description, 'role': record.role,
                'can_manage': record.role in ('owner', 'admin'), 'contribution_policy': group.contribution_policy,
                'members': [{'account_id': m.account_id, 'email': email, 'role': m.role, 'joined_at': m.joined_at.isoformat()} for m, email in members],
                'invitations': [{'id': i.id, 'email': i.email, 'role': i.role, 'expires_at': i.expires_at.isoformat()}
                    for i in session.scalars(select(GroupInvitation).where(
                        GroupInvitation.group_id == group_id, GroupInvitation.revoked.is_(False),
                        GroupInvitation.accepted_account_id.is_(None), GroupInvitation.expires_at > now()))]
                    if record.role in ('owner', 'admin') else [],
                'moves': moves}

    @router.patch('/{group_id}')
    def update(group_id: str, body: GroupUpdate, account=Depends(identity), session: Session = Depends(db)):
        group, _ = manager_group(session, group_id, account.id)
        if body.contribution_policy is not None:
            if group.owner_id != account.id:
                raise HTTPException(403, 'Only the owner can change who adds moves.')
            group.contribution_policy = body.contribution_policy
        if body.name is not None:
            name = body.name.strip()
            if not name:
                raise HTTPException(422, 'Give the group a name.')
            group.name = name
        if body.description is not None:
            group.description = body.description.strip()
        session.commit()
        return {'ok': True}

    @router.post('/{group_id}/invitations', status_code=201)
    def invite(group_id: str, body: GroupInvite, account=Depends(identity), session: Session = Depends(db)):
        group, _ = manager_group(session, group_id, account.id)
        email = body.email
        existing = session.scalar(select(Account).where(Account.email == email))
        if existing and membership(session, group_id, existing.id):
            raise HTTPException(409, 'That person is already in this group.')
        pending = session.scalars(select(GroupInvitation).where(
            GroupInvitation.group_id == group_id, GroupInvitation.revoked.is_(False),
            GroupInvitation.accepted_account_id.is_(None), GroupInvitation.expires_at > now())).all()
        if any(item.email == email for item in pending):
            raise HTTPException(409, 'An invitation is already pending for that email.')
        if len(pending) >= 100:
            raise HTTPException(409, 'This group has reached its invitation limit.')
        raw = secrets.token_urlsafe(32)
        invitation = GroupInvitation(id=uuid4().hex, group_id=group_id, email=email, token_hash=digest(raw),
                                      role=body.role, expires_at=now() + timedelta(days=7), revoked=False)
        session.add(invitation)
        session.commit()
        try:
            auth.send_account_mail(settings, email, 'group', raw)
        except Exception:
            invitation.revoked = True
            session.commit()
            raise HTTPException(503, 'Invitation could not be sent. Please try again.')
        return {'id': invitation.id, 'email': email}

    @router.delete('/{group_id}/invitations/{invitation_id}')
    def cancel_invitation(group_id: str, invitation_id: str, account=Depends(identity), session: Session = Depends(db)):
        manager_group(session, group_id, account.id)
        invitation = session.get(GroupInvitation, invitation_id)
        if not invitation or invitation.group_id != group_id:
            raise HTTPException(404)
        invitation.revoked = True
        session.commit()
        return {'revoked': True}

    @router.post('/inspect')
    def inspect(body: GroupToken, session: Session = Depends(db)):
        invitation = session.scalar(select(GroupInvitation).where(GroupInvitation.token_hash == digest(body.invite)))
        if not invitation or invitation.revoked or not future(invitation.expires_at):
            raise HTTPException(404, 'Invitation unavailable.')
        group = session.get(Group, invitation.group_id)
        if not group or group.archived:
            raise HTTPException(404, 'Invitation unavailable.')
        return {'name': group.name, 'description': group.description,
                'members': session.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id)) or 0}

    @router.post('/join')
    def join(body: GroupToken, account=Depends(identity), session: Session = Depends(db)):
        invitation = session.scalar(select(GroupInvitation).where(GroupInvitation.token_hash == digest(body.invite)).with_for_update())
        if not invitation or invitation.revoked or not future(invitation.expires_at):
            raise HTTPException(404, 'Invitation unavailable.')
        if invitation.email != account.email:
            raise HTTPException(403, 'Sign in with the email address that received this invitation.')
        if invitation.accepted_account_id and invitation.accepted_account_id != account.id:
            raise HTTPException(403, 'This invitation was already used.')
        group = session.get(Group, invitation.group_id)
        if not group or group.archived:
            raise HTTPException(404, 'Group unavailable.')
        record = membership(session, group.id, account.id)
        if not record and invitation.accepted_account_id:
            raise HTTPException(404, 'This invitation was already used. Ask for a new invitation.')
        if not record:
            record = GroupMember(group_id=group.id, account_id=account.id, role=invitation.role, invited_by=group.owner_id)
            session.add(record)
        invitation.accepted_account_id = account.id
        session.commit()
        return summary(session, group, record.role)

    @router.delete('/{group_id}/members/{account_id}')
    def remove_member(group_id: str, account_id: str, account=Depends(identity), session: Session = Depends(db)):
        group = session.scalar(select(Group).where(Group.id == group_id, Group.archived.is_(False)))
        if not group:
            raise HTTPException(404, 'Group unavailable.')
        if account_id == group.owner_id:
            raise HTTPException(409, 'Transfer the group before leaving it.')
        actor = membership(session, group_id, account.id)
        allowed = account.id == account_id or (actor and actor.role in ('owner', 'admin'))
        if not allowed:
            raise HTTPException(403, 'You cannot remove this member.')
        target = membership(session, group_id, account_id)
        if not target:
            raise HTTPException(404)
        for invitation in session.scalars(select(GroupInvitation).where(
                GroupInvitation.group_id == group_id, GroupInvitation.accepted_account_id == account_id)):
            invitation.revoked = True
        session.delete(target)
        session.commit()
        return {'removed': True}

    @router.post('/{group_id}/transfer')
    def transfer(group_id: str, body: GroupTransfer, account=Depends(identity), session: Session = Depends(db)):
        group = session.scalar(select(Group).where(Group.id == group_id, Group.archived.is_(False)).with_for_update())
        if not group or group.owner_id != account.id:
            raise HTTPException(404, 'Group unavailable.')
        target = membership(session, group_id, body.account_id)
        if not target:
            raise HTTPException(404, 'That person is not in this group.')
        if body.account_id == account.id:
            return {'ok': True}
        current = membership(session, group_id, account.id)
        target.role = 'owner'
        group.owner_id = body.account_id
        if current:
            current.role = 'admin'
        session.commit()
        return {'ok': True}

    @router.delete('/{group_id}')
    def archive(group_id: str, account=Depends(identity), session: Session = Depends(db)):
        group = session.scalar(select(Group).where(Group.id == group_id, Group.archived.is_(False)).with_for_update())
        if not group or group.owner_id != account.id:
            raise HTTPException(404, 'Group unavailable.')
        group.archived = True
        session.commit()
        return {'archived': True}

    @router.post('/{group_id}/lessons')
    def add_move(group_id: str, body: GroupMove, account=Depends(identity), session: Session = Depends(db)):
        group, member = member_group(session, group_id, account.id)
        if group.contribution_policy == 'managers' and member.role not in ('owner', 'admin'):
            raise HTTPException(403, 'Only group managers can add moves to this group.')
        if body.access_kind == 'collection':
            lesson, revision, _ = public_lesson(session, body.lesson_id)
        else:
            lesson = owned_lesson(session, body.lesson_id, account.id, True)
            revision = latest_revision(session, lesson)
            if not revision or not accepted(session, lesson.id, revision.id):
                raise HTTPException(409, 'Check this move before sharing it with a group.')
            # Adding another audience does not silently replace an existing release.
            if not lesson.published_revision_id:
                lesson.published_revision_id = revision.id
        association = GroupCollection if body.access_kind == 'collection' else GroupLesson
        if not session.get(association, (group_id, lesson.id)):
            session.add(association(group_id=group_id, lesson_id=lesson.id, added_by=account.id))
        session.commit()
        return {'added': True}

    @router.delete('/{group_id}/lessons/{lesson_id}')
    def remove_move(group_id: str, lesson_id: str, access_kind: str = 'grant', account=Depends(identity), session: Session = Depends(db)):
        group, actor = member_group(session, group_id, account.id)
        if access_kind not in ('grant', 'collection'):
            raise HTTPException(422, 'Choose a shared move or public collection item.')
        link = session.get(GroupCollection if access_kind == 'collection' else GroupLesson, (group_id, lesson_id))
        if not link:
            raise HTTPException(404)
        lesson = session.get(Lesson, lesson_id)
        if lesson.owner_id != account.id and link.added_by != account.id and actor.role not in ('owner', 'admin'):
            raise HTTPException(403, 'Only the move owner or a group manager can remove it.')
        session.delete(link)
        session.commit()
        return {'removed': True}

    app.include_router(router)
