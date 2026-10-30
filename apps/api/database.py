from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, JSON, Integer, ForeignKey
from datetime import datetime, timezone

class Base(DeclarativeBase):
    pass

class Lesson(Base):
    __tablename__ = 'lessons'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(80), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class LessonRevision(Base):
    __tablename__ = 'lesson_revisions'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey('lessons.id'), index=True)
    manifest: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer)

def make_engine(url):
    return create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 3} if url.startswith('postgresql') else {})

def database_ready(engine):
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
        connection.execute(text('SELECT id FROM lesson_revisions LIMIT 0'))
