"""Seed the private UI test environment with labelled piano/guitar lessons."""
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.config import ROOT, Settings
from apps.api.database import Account, Lesson, LessonAcceptance, LessonGrant, make_engine
from apps.api.lessons import import_music_fixture
from apps.api.main import create_app

OWNER = ('owner@ui.test', 'PianoDemo2026!')
LEARNER = ('learner@ui.test', 'PianoLearner2026!')
ASSETS = ROOT / '.local' / 'ui-test-demo'
ASSETS.mkdir(parents=True, exist_ok=True)


def media(name: str, colour: str, duration: int = 8) -> Path:
    path = ASSETS / f'{name}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                    f'color=c={colour}:s=640x360:r=30:d={duration}', '-f', 'lavfi',
                    '-i', f'sine=frequency=440:sample_rate=48000:duration={duration}',
                    '-t', str(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                    '-y', str(path)], check=True)
    return path


def reference(subject: str, duration: int = 8):
    if subject == 'piano':
        events = [
            {'id': 'p1', 'onset': 1.0, 'duration': 0.6, 'pitch': 60, 'optional': False},
            {'id': 'p2', 'onset': 2.0, 'duration': 0.6, 'pitch': 64, 'optional': False},
            {'id': 'p3', 'onset': 3.0, 'duration': 0.6, 'pitch': 67, 'optional': False},
            {'id': 'p4', 'onset': 4.0, 'duration': 0.9, 'pitch': 72, 'optional': False},
        ]
        chords = []
    else:
        events = [
            {'id': 'g1', 'onset': 1.0, 'duration': 0.8, 'pitch': 40, 'optional': False, 'string': 6, 'fret': 0},
            {'id': 'g2', 'onset': 2.0, 'duration': 0.8, 'pitch': 45, 'optional': False, 'string': 5, 'fret': 0},
            {'id': 'g3', 'onset': 3.0, 'duration': 0.8, 'pitch': 50, 'optional': False, 'string': 4, 'fret': 0},
            {'id': 'g4', 'onset': 4.0, 'duration': 0.8, 'pitch': 55, 'optional': False, 'string': 3, 'fret': 0},
        ]
        chords = [
            {'id': 'c-major', 'name': 'C', 'start': 1.0, 'frets': [-1, 3, 2, 0, 1, 0], 'position': 1},
            {'id': 'g-major', 'name': 'G', 'start': 4.0, 'frets': [3, 2, 0, 0, 0, 3], 'position': 1},
        ]
    return {
        'reference_version': 1, 'subject': subject,
        'instrument': {'instrument': subject, 'handedness': 'right', 'tuning': 'standard', 'capo': 0},
        'duration': duration, 'events': events,
        'spans': [{'start': 0, 'end': duration, 'kind': 'playing'}],
        'guitar_chords': chords,
        'review': {'reviewer_id': 'demo-seed', 'reviewed_at': '2026-11-10T12:00:00+00:00',
                   'draft_id': f'{subject}-demo-draft', 'source_reference_sha256': 'a' * 64},
    }


def manifest(subject, title, video: Path, ref: bytes, ref_sha: str, duration=8):
    base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
    video_bytes = video.stat().st_size
    video_sha = hashlib.sha256(video.read_bytes()).hexdigest()
    base.update({
        'lesson_id': f'{subject}-demo', 'revision_id': f'{subject}-demo-v1', 'title': title,
        'subject': subject, 'duration': duration,
        'instrument': {'instrument': subject, 'handedness': 'right', 'tuning': 'standard', 'capo': 0},
        'section_set': {'id': 'demo-sections', 'revision': 1, 'duration': duration,
                        'sections': [{'id': 'phrase', 'label': 'Phrase', 'start': 0, 'end': 4},
                                     {'id': 'practice', 'label': 'Practice', 'start': 4, 'end': duration}]},
        'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': len(ref), 'sha256': ref_sha},
        'source_video': {'key': 'demo.mp4', 'mime': 'video/mp4', 'bytes': video_bytes, 'sha256': video_sha},
        'reference_reviewed': True,
        'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                       'input_modes': ['none'], 'dimensions': []},
        'warnings': ['Demo content for private UI testing.'],
    })
    return base


def account(session: Session, email: str, password: str) -> Account:
    from apps.api.auth import password_hash
    value = session.query(Account).filter_by(email=email).one_or_none()
    if value is None:
        value = Account(id=os.urandom(16).hex(), email=email, password_hash=password_hash(password),
                        verified=True, platform_role='member', status='active')
        session.add(value)
        session.commit()
    value.verified = True
    session.commit()
    return value


def login(client: TestClient, email: str, password: str):
    client.headers.update({'Origin': 'http://127.0.0.1:5173', 'X-Form-Request': '1'})
    response = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf']
    client.headers.update({'Origin': 'http://127.0.0.1:5173', 'X-Form-Request': '1'})


settings = Settings(
    database_url=os.environ['DATABASE_URL'], storage_endpoint='http://localhost:9000',
    storage_bucket='form', storage_access_key='form-local', storage_secret_key='local-development-only',
    public_url='http://127.0.0.1:5173', demo_enabled=False, _env_file=None)
app = create_app(settings)
engine = make_engine(settings.sqlalchemy_url)
with Session(engine) as session:
    account(session, *OWNER)
    learner = account(session, *LEARNER)
    learner_id = learner.id

with TestClient(app) as client:
    login(client, *OWNER)
    owner_id = client.get('/api/auth/session').json()['account']['id']
    created = []
    for subject, title, colour in (
            ('piano', 'Piano demo — notes, player and authoring', '0x111827'),
            ('guitar', 'Guitar demo — neck, chords and authoring', '0x1f2937')):
        ref = json.dumps(reference(subject), separators=(',', ':')).encode()
        ref_sha = hashlib.sha256(ref).hexdigest()
        movie = media(subject, colour)
        folder = ASSETS / subject
        folder.mkdir(exist_ok=True)
        (folder / 'reference.json').write_bytes(ref)
        (folder / 'demo.mp4').write_bytes(movie.read_bytes())
        (folder / 'manifest.json').write_text(json.dumps(manifest(subject, title, movie, ref, ref_sha)),
                                              encoding='utf-8')
        imported = import_music_fixture(engine, settings, owner_id, folder / 'manifest.json', folder)
        with Session(engine) as session:
            session.add(LessonAcceptance(id=os.urandom(16).hex(), lesson_id=imported.lesson_id,
                                         revision_id=imported.revision_id, account_id=owner_id,
                                         warnings=[], source='music-review'))
            session.commit()
        published = client.post(f"/api/lessons/{imported.lesson_id}/publish", json={
            'revision_id': imported.revision_id, 'mode': 'invite', 'reviewed': True,
            'rights_acknowledged': True})
        assert published.status_code == 200, published.text
        with Session(engine) as session:
            lesson = session.get(Lesson, imported.lesson_id)
            session.merge(LessonGrant(lesson_id=lesson.id, account_id=learner_id, source='invitation',
                                      generation=lesson.share_generation, revoked=False,
                                      accepted_at=datetime.now(timezone.utc)))
            session.commit()
        created.append((subject, imported.lesson_id, title))
    print(json.dumps({'owner': OWNER[0], 'learner': LEARNER[0],
                      'lessons': [{'subject': s, 'id': i, 'title': t} for s, i, t in created]}, indent=2))
