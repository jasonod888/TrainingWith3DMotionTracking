from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, JSON, Integer, ForeignKey, Boolean, UniqueConstraint, Float
from datetime import datetime, timezone

class Base(DeclarativeBase):
    pass

class Lesson(Base):
    __tablename__ = 'lessons'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    version: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    published_revision_id: Mapped[str | None] = mapped_column(String(80))
    distribution: Mapped[str] = mapped_column(String(16), default='private', server_default='private')
    share_token_hash: Mapped[str | None] = mapped_column(String(64))
    share_generation: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')

class LessonRevision(Base):
    __tablename__ = 'lesson_revisions'
    __table_args__ = (UniqueConstraint('lesson_id', 'version', name='uq_lesson_revision_version'),)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    manifest: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer)

class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    platform_role: Mapped[str] = mapped_column(String(16), default='member', server_default='member')
    status: Mapped[str] = mapped_column(String(24), default='active', server_default='active')
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    mfa_counter: Mapped[int] = mapped_column(Integer, default=-1, server_default='-1')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class LoginSession(Base):
    __tablename__ = 'login_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    admin_verified_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pending_mfa_secret: Mapped[str | None] = mapped_column(String(64))

class AdminControl(Base):
    """Singleton write lock serializes role/status changes, including bootstrap."""
    __tablename__ = 'admin_control'
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    registration_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default='true')

class AdminAudit(Base):
    __tablename__ = 'admin_audit'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey('accounts.id'), index=True)
    action: Mapped[str] = mapped_column(String(80))
    target_id: Mapped[str] = mapped_column(String(80), index=True)
    reason: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AccountToken(Base):
    __tablename__ = 'account_tokens'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    purpose: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)

class AuthThrottle(Base):
    __tablename__ = 'auth_throttles'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class LessonAsset(Base):
    __tablename__ = 'lesson_assets'
    key: Mapped[str] = mapped_column(String(512), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    mime: Mapped[str] = mapped_column(String(128))
    bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))

class PracticeProgress(Base):
    __tablename__ = 'practice_progress'
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    revision_id: Mapped[str] = mapped_column(String(80))
    time: Mapped[float] = mapped_column(Float)
    speed: Mapped[float] = mapped_column(Float)
    mode: Mapped[str] = mapped_column(String(16))

class Conversion(Base):
    __tablename__ = 'conversions'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    provider: Mapped[str] = mapped_column(String(16),default='local',server_default='local',index=True)
    pipeline_version: Mapped[str] = mapped_column(String(80),default='sam-3d-body-v1',server_default='sam-3d-body-v1')
    provider_target: Mapped[str] = mapped_column(String(200),default='',server_default='')
    provider_request_id: Mapped[str | None] = mapped_column(String(200))
    submission_state: Mapped[str] = mapped_column(String(16),default='none',server_default='none')
    input_token_hash: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(255))
    source_bytes: Mapped[int] = mapped_column(Integer)
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    source_key: Mapped[str] = mapped_column(String(512))
    upload_id: Mapped[str | None] = mapped_column(String(512))
    parts: Mapped[dict] = mapped_column(JSON, default=dict)
    start: Mapped[float] = mapped_column(Float)
    duration: Mapped[float] = mapped_column(Float)
    state: Mapped[str] = mapped_column(String(32), default='uploading', index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    attempt_token: Mapped[str | None] = mapped_column(String(80))
    worker_id: Mapped[str | None] = mapped_column(String(80))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    frames: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(40))
    lesson_id: Mapped[str | None] = mapped_column(String(80))
    target_lesson_id: Mapped[str | None] = mapped_column(String(80), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class WorkerCredential(Base):
    __tablename__ = 'worker_credentials'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    provider: Mapped[str] = mapped_column(String(16),default='local',server_default='local')
    pipeline_version: Mapped[str] = mapped_column(String(80),default='sam-3d-body-v1',server_default='sam-3d-body-v1')
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    silhouettes: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class LessonGrant(Base):
    __tablename__ = 'lesson_grants'
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'),primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'),primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    generation: Mapped[int] = mapped_column(Integer,default=0)
    revoked: Mapped[bool] = mapped_column(Boolean,default=False)
    invitation_id: Mapped[str | None] = mapped_column(String(80))
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class LessonInvitation(Base):
    __tablename__ = 'lesson_invitations'
    id: Mapped[str] = mapped_column(String(80),primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'),index=True)
    email: Mapped[str] = mapped_column(String(254))
    token_hash: Mapped[str] = mapped_column(String(64),unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean,default=False)
    accepted_account_id: Mapped[str | None] = mapped_column(String(80))

class LessonReport(Base):
    __tablename__ = 'lesson_reports'
    __table_args__=(UniqueConstraint('lesson_id','account_id',name='uq_lesson_reporter'),)
    id: Mapped[str] = mapped_column(String(80),primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'))
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    reason: Mapped[str] = mapped_column(String(500))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))

class LessonAcceptance(Base):
    """One acceptance of one immutable revision by the move owner."""
    __tablename__ = 'lesson_acceptances'
    __table_args__ = (UniqueConstraint('lesson_id', 'revision_id', name='uq_lesson_acceptance_revision'),)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    revision_id: Mapped[str] = mapped_column(String(80))
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(16), default='owner')
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class LessonPublication(Base):
    """Public listing metadata for the accepted shared release."""
    __tablename__ = 'lesson_publications'
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    revision_id: Mapped[str | None] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200), default='')
    description: Mapped[str] = mapped_column(String(500), default='')
    creator_name: Mapped[str] = mapped_column(String(80), default='')
    listed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    moderation_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    rights_acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class LessonTag(Base):
    __tablename__ = 'lesson_tags'
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    tag: Mapped[str] = mapped_column(String(40), primary_key=True, index=True)

class Group(Base):
    __tablename__ = 'groups'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(500), default='')
    image_key: Mapped[str | None] = mapped_column(String(512))
    contribution_policy: Mapped[str] = mapped_column(String(16), default='members', server_default='members')
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GroupMember(Base):
    __tablename__ = 'group_members'
    group_id: Mapped[str] = mapped_column(ForeignKey('groups.id'), primary_key=True, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default='member')
    invited_by: Mapped[str | None] = mapped_column(String(80))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GroupInvitation(Base):
    __tablename__ = 'group_invitations'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    group_id: Mapped[str] = mapped_column(ForeignKey('groups.id'), index=True)
    email: Mapped[str] = mapped_column(String(254))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    role: Mapped[str] = mapped_column(String(16), default='member')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    accepted_account_id: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GroupLesson(Base):
    __tablename__ = 'group_lessons'
    group_id: Mapped[str] = mapped_column(ForeignKey('groups.id'), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    added_by: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GroupCollection(Base):
    """Presentation of a public move, never a permission grant."""
    __tablename__ = 'group_public_moves'
    group_id: Mapped[str] = mapped_column(ForeignKey('groups.id'), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    added_by: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class MimicAttempt(Base):
    __tablename__='mimic_attempts'
    id: Mapped[str]=mapped_column(String(80),primary_key=True)
    account_id: Mapped[str]=mapped_column(ForeignKey('accounts.id'),index=True)
    lesson_id: Mapped[str]=mapped_column(ForeignKey('lessons.id'),index=True)
    revision_id: Mapped[str]=mapped_column(String(80))
    summary: Mapped[dict]=mapped_column(JSON)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=lambda:datetime.now(timezone.utc))

class MimicPair(Base):
    __tablename__ = 'mimic_pairs'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'))
    revision_id: Mapped[str] = mapped_column(String(80))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    capture_hash: Mapped[str] = mapped_column(String(64))
    receiver_hash: Mapped[str | None] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    commands: Mapped[list] = mapped_column(JSON, default=list)
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    receiver_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

def make_engine(url):
    return create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 3} if url.startswith('postgresql') else {})

def database_ready(engine):
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
        connection.execute(text('SELECT platform_role, status, mfa_secret, mfa_counter FROM accounts LIMIT 0'))
        connection.execute(text('SELECT admin_verified_until, pending_mfa_secret FROM login_sessions LIMIT 0'))
        connection.execute(text('SELECT id, registration_enabled FROM admin_control LIMIT 0'))
        connection.execute(text('SELECT id, actor_id, action FROM admin_audit LIMIT 0'))
        connection.execute(text('SELECT moderation_hidden FROM lesson_publications LIMIT 0'))
        connection.execute(text('SELECT resolved_at FROM lesson_reports LIMIT 0'))
        connection.execute(text('SELECT id FROM lesson_revisions LIMIT 0'))
        connection.execute(text('SELECT a.id, s.token_hash, t.token_hash, l.version, l.archived, m.key, h.hits '
                                'FROM accounts a, login_sessions s, account_tokens t, lessons l, lesson_assets m, auth_throttles h LIMIT 0'))
        connection.execute(text('SELECT account_id, lesson_id, revision_id, time FROM practice_progress LIMIT 0'))
        connection.execute(text('SELECT id, state, lease_until, provider, pipeline_version, submission_state, target_lesson_id FROM conversions LIMIT 0'))
        connection.execute(text('SELECT id, provider, pipeline_version FROM worker_credentials LIMIT 0'))
        connection.execute(text('SELECT l.published_revision_id, g.account_id, i.token_hash, r.id '
                                'FROM lessons l, lesson_grants g, lesson_invitations i, lesson_reports r LIMIT 0'))
        connection.execute(text('SELECT id, account_id, revision_id, sequence FROM mimic_pairs LIMIT 0'))
        connection.execute(text('SELECT id, account_id, revision_id FROM mimic_attempts LIMIT 0'))
        connection.execute(text('SELECT lesson_id, revision_id, account_id FROM lesson_acceptances LIMIT 0'))
        connection.execute(text('SELECT lesson_id, listed, revision_id FROM lesson_publications LIMIT 0'))
        connection.execute(text('SELECT lesson_id, tag FROM lesson_tags LIMIT 0'))
        connection.execute(text('SELECT id, owner_id, name, contribution_policy FROM groups LIMIT 0'))
        connection.execute(text('SELECT group_id, account_id, role FROM group_members LIMIT 0'))
        connection.execute(text('SELECT id, group_id, email FROM group_invitations LIMIT 0'))
        connection.execute(text('SELECT group_id, lesson_id FROM group_lessons LIMIT 0'))
        connection.execute(text('SELECT group_id, lesson_id FROM group_public_moves LIMIT 0'))
