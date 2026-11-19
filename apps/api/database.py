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
    # Subject metadata is mutable lesson metadata, not part of the frozen v1 manifest.
    # Immutable revision snapshots below record what a release was published as.
    subject: Mapped[str] = mapped_column(String(32), default='movement_other', server_default='movement_other', index=True)
    experience_family: Mapped[str] = mapped_column(String(16), default='body', server_default='body')
    instrument: Mapped[str | None] = mapped_column(String(16))
    # Product experience identity (full_body/piano/guitar). Nullable for legacy
    # rows; readers resolve through the deterministic subject adapter and never
    # guess an unknown Act. Metadata only: the revision manifest is untouched.
    act_id: Mapped[str | None] = mapped_column(String(16))
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
    # Snapshot of the subject projection at this revision. Null means the revision
    # predates subjects; readers fall back to the lesson row.
    subject: Mapped[str | None] = mapped_column(String(32))
    experience_family: Mapped[str | None] = mapped_column(String(16))
    instrument: Mapped[str | None] = mapped_column(String(16))
    # Act identity frozen with this revision, so a later relabel cannot change
    # what an existing release was published as.
    act_id: Mapped[str | None] = mapped_column(String(16))

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

class PracticePlanProgress(Base):
    """Plan-scoped resume state shared by every Act.

    The legacy ``practice_progress`` row stays body-only; this additive table is
    scoped by (account, lesson, revision, plan) so a changed plan cannot be handed
    another plan's position.
    """
    __tablename__ = 'practice_plan_progress'
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    revision_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    unit_id: Mapped[str | None] = mapped_column(String(120))
    time: Mapped[float] = mapped_column(Float, default=0.0)
    speed: Mapped[float] = mapped_column(Float, default=1.0)
    mode: Mapped[str] = mapped_column(String(16), default='sections')
    loop: Mapped[bool] = mapped_column(Boolean, default=False)
    repetitions: Mapped[int] = mapped_column(Integer, default=0)
    countdown_seconds: Mapped[int] = mapped_column(Integer, default=0)
    rest_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PracticeAttempt(Base):
    """Neutral attempt envelope. Act-specific detail stays in ``report``."""
    __tablename__ = 'practice_attempts'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    revision_id: Mapped[str] = mapped_column(String(80), index=True)
    act_id: Mapped[str] = mapped_column(String(16))
    mode: Mapped[str] = mapped_column(String(16))
    plan_id: Mapped[str] = mapped_column(String(160))
    unit_id: Mapped[str | None] = mapped_column(String(120))
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24))
    assessment_adapter: Mapped[str | None] = mapped_column(String(80))
    rubric_version: Mapped[str | None] = mapped_column(String(80))
    report: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


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
    # Subject routing and client-reported preparation provenance. Provenance is
    # diagnostics only; the uploaded clip timeline is authoritative.
    subject: Mapped[str] = mapped_column(String(32), default='movement_other', server_default='movement_other')
    instrument: Mapped[str | None] = mapped_column(String(16))
    preparation: Mapped[dict] = mapped_column(JSON, default=dict)
    media_findings: Mapped[dict] = mapped_column(JSON, default=dict)
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
    # Explicit public representation allowlist chosen at release time.
    roles: Mapped[list | None] = mapped_column(JSON)
    rights_acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class LessonTag(Base):
    __tablename__ = 'lesson_tags'
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    tag: Mapped[str] = mapped_column(String(40), primary_key=True, index=True)

class LessonLike(Base):
    """One idempotent like per account and stable lesson identity."""
    __tablename__ = 'lesson_likes'
    __table_args__ = (UniqueConstraint('lesson_id', 'account_id', name='uq_lesson_like'),)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

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


class MusicDraft(Base):
    """Owner-scoped unreviewed transcription proposal for one conversion attempt."""
    __tablename__ = 'music_drafts'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    subject: Mapped[str] = mapped_column(String(16))
    instrument: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default='draft', server_default='draft')
    document: Mapped[dict] = mapped_column(JSON)
    # Automatic qualified corrections live beside the immutable baseline document.
    # The baseline is never rewritten; correction history is retained for rollback.
    working_document: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    correction_history: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Versioned playback settings (sync offset) and the raw-model completion receipt.
    playback: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_model: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    correction_operations: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class MusicRevisionEdit(Base):
    """Explicit owner edit of a reviewed music revision; never changes the shared pointer."""
    __tablename__ = 'music_revision_edits'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    base_revision_id: Mapped[str] = mapped_column(ForeignKey('lesson_revisions.id'), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey('lesson_revisions.id'), unique=True, index=True)
    editor_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MusicReview(Base):
    __tablename__ = 'music_reviews'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    draft_id: Mapped[str] = mapped_column(ForeignKey('music_drafts.id'), unique=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey('lesson_revisions.id'), unique=True)
    reviewer_id: Mapped[str] = mapped_column(String(80))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    document: Mapped[dict] = mapped_column(JSON)


class MusicVerificationDecision(Base):
    """Owner decision on one verification finding for an unreviewed draft.

    Decisions are audit records: the draft document stays the immutable baseline and
    the working proposal is reconstructed from the stored edit snapshots, so it survives
    analysis-archive expiry.
    """
    __tablename__ = 'music_verification_decisions'
    __table_args__ = (UniqueConstraint('draft_id', 'finding_id', name='uq_music_verification_decision'),)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    draft_id: Mapped[str] = mapped_column(ForeignKey('music_drafts.id'), index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    finding_id: Mapped[str] = mapped_column(String(40))
    decision: Mapped[str] = mapped_column(String(16))
    proposal_sha256: Mapped[str] = mapped_column(String(64))
    reviewer_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    document: Mapped[dict] = mapped_column(JSON)


class MusicPracticeAttempt(Base):
    """Opt-in aggregate, unscored music history; never raw performance data."""
    __tablename__ = 'music_practice_attempts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey('lesson_revisions.id'))
    summary: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PianoComparisonSource(Base):
    """A server-registered master audio file that a comparison may score.

    Registration is a developer/owner action outside the browser; the API accepts only
    this id, never a filesystem path.
    """
    __tablename__ = 'piano_comparison_sources'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    lesson_id: Mapped[str | None] = mapped_column(String(80), index=True)
    label: Mapped[str] = mapped_column(String(200))
    path: Mapped[str] = mapped_column(String(1024))
    sha256: Mapped[str] = mapped_column(String(64))
    seconds: Mapped[float] = mapped_column(Float)
    reference_path: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PianoComparison(Base):
    __tablename__ = 'piano_comparisons'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('piano_comparison_sources.id'), index=True)
    lesson_id: Mapped[str | None] = mapped_column(String(80), index=True)
    interval_start: Mapped[float] = mapped_column(Float)
    interval_end: Mapped[float] = mapped_column(Float)
    variants: Mapped[list] = mapped_column(JSON)
    registry_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default='queued', server_default='queued')
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PianoModelRun(Base):
    __tablename__ = 'piano_model_runs'
    __table_args__ = (UniqueConstraint('comparison_id', 'variant', name='uq_piano_run_variant'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    comparison_id: Mapped[str] = mapped_column(ForeignKey('piano_comparisons.id'), index=True)
    variant: Mapped[str] = mapped_column(String(64))
    family: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default='queued', server_default='queued')
    attempt: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    lease_token: Mapped[str | None] = mapped_column(String(36))
    run_dir: Mapped[str | None] = mapped_column(String(1024))
    receipt: Mapped[dict | None] = mapped_column(JSON)
    blocked_reasons: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


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
        connection.execute(text('SELECT a.id, s.token_hash, t.token_hash, l.version, l.archived, m.key, h.hits '
                                'FROM accounts a, login_sessions s, account_tokens t, lessons l, lesson_assets m, auth_throttles h LIMIT 0'))
        connection.execute(text('SELECT account_id, lesson_id, revision_id, time FROM practice_progress LIMIT 0'))
        connection.execute(text('SELECT account_id, lesson_id, revision_id, plan_id, time FROM practice_plan_progress LIMIT 0'))
        connection.execute(text('SELECT id, account_id, lesson_id, revision_id, act_id, mode, plan_id, status FROM practice_attempts LIMIT 0'))
        connection.execute(text('SELECT id, owner_id, title, subject, experience_family, instrument, act_id FROM lessons LIMIT 0'))
        connection.execute(text('SELECT id, lesson_id, version, subject, experience_family, instrument, act_id FROM lesson_revisions LIMIT 0'))
        connection.execute(text('SELECT id, state, lease_until, provider, pipeline_version, submission_state, target_lesson_id, subject, instrument, preparation, media_findings FROM conversions LIMIT 0'))
        connection.execute(text('SELECT id, provider, pipeline_version, silhouettes FROM worker_credentials LIMIT 0'))
        connection.execute(text('SELECT l.published_revision_id, g.account_id, i.token_hash, r.id '
                                'FROM lessons l, lesson_grants g, lesson_invitations i, lesson_reports r LIMIT 0'))
        connection.execute(text('SELECT id, account_id, revision_id, sequence FROM mimic_pairs LIMIT 0'))
        connection.execute(text('SELECT id, account_id, revision_id FROM mimic_attempts LIMIT 0'))
        connection.execute(text('SELECT lesson_id, revision_id, account_id FROM lesson_acceptances LIMIT 0'))
        connection.execute(text('SELECT lesson_id, listed, revision_id, roles FROM lesson_publications LIMIT 0'))
        connection.execute(text('SELECT lesson_id, tag FROM lesson_tags LIMIT 0'))
        connection.execute(text('SELECT lesson_id, account_id FROM lesson_likes LIMIT 0'))
        connection.execute(text('SELECT id, owner_id, name, contribution_policy FROM groups LIMIT 0'))
        connection.execute(text('SELECT group_id, account_id, role FROM group_members LIMIT 0'))
        connection.execute(text('SELECT id, group_id, email FROM group_invitations LIMIT 0'))
        connection.execute(text('SELECT group_id, lesson_id FROM group_lessons LIMIT 0'))
        connection.execute(text('SELECT group_id, lesson_id FROM group_public_moves LIMIT 0'))
        connection.execute(text('SELECT id, job_id, lesson_id, owner_id, subject, instrument, status, document, working_document, correction_history FROM music_drafts LIMIT 0'))
        connection.execute(text('SELECT id, lesson_id, base_revision_id, revision_id, editor_id, document FROM music_revision_edits LIMIT 0'))
        connection.execute(text('SELECT id, draft_id, lesson_id, revision_id, reviewer_id, reviewed_at, document FROM music_reviews LIMIT 0'))
        connection.execute(text('SELECT id, account_id, lesson_id, revision_id, summary FROM music_practice_attempts LIMIT 0'))
        connection.execute(text('SELECT id, owner_id, lesson_id, label, path, sha256, seconds FROM piano_comparison_sources LIMIT 0'))
        connection.execute(text('SELECT id, owner_id, source_id, status, cancel_requested FROM piano_comparisons LIMIT 0'))
        connection.execute(text('SELECT id, comparison_id, variant, status, attempt FROM piano_model_runs LIMIT 0'))
