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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class LoginSession(Base):
    __tablename__ = 'login_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

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

def make_engine(url):
    return create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 3} if url.startswith('postgresql') else {})

def database_ready(engine):
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
        connection.execute(text('SELECT id FROM lesson_revisions LIMIT 0'))
        connection.execute(text('SELECT a.id, s.token_hash, t.token_hash, l.version, l.archived, m.key, h.hits '
                                'FROM accounts a, login_sessions s, account_tokens t, lessons l, lesson_assets m, auth_throttles h LIMIT 0'))
        connection.execute(text('SELECT account_id, lesson_id, revision_id, time FROM practice_progress LIMIT 0'))
