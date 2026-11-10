"""PostgreSQL concurrency/retry check for reviewed-music edits.

Requires a disposable PostgreSQL database already migrated to head and the
`form-edit-concurrency` seed lesson. Never targets a shared deployment.
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session
from unittest.mock import patch

from apps.api.auth import COOKIE, csrf_token, digest, now
from apps.api.config import Settings
from apps.api.database import (Account, Lesson, LessonAcceptance, LessonRevision, LoginSession,
                               MusicRevisionEdit, make_engine)
from apps.api.main import create_app


class Store:
    def __init__(self):
        self.objects = {}

    def get_object(self, Bucket, Key):
        data = self.objects[Key]
        body = io.BytesIO(data)
        class Stream:
            def iter_chunks(self, chunk_size):
                while chunk := body.read(chunk_size):
                    yield chunk
            def close(self):
                body.close()
        return {'Body': Stream(), 'ContentLength': len(data)}

    def upload_fileobj(self, fileobj, Bucket, Key, ExtraArgs=None):
        self.objects[Key] = fileobj.read()

    def head_object(self, Bucket, Key):
        return {'ContentLength': len(self.objects[Key])}


def reference_document():
    return {'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 2,
            'events': [{'id': 'a', 'onset': 0.5, 'duration': 0.3, 'pitch': 60, 'velocity': 0.7,
                        'confidence': 0.9, 'optional': False}],
            'spans': [{'start': 0, 'end': 2, 'kind': 'playing'}],
            'provenance': {'adapter': 'fixture', 'engine': 'fixture', 'model': None, 'model_version': 'fixture-v1',
                           'code_version': 'fixture-v1', 'audio_sha256': 'a' * 64},
            'review': {'reviewer_id': 'pg-owner', 'reviewed_at': '2026-11-10T00:00:00+00:00',
                       'draft_id': 'base', 'source_reference_sha256': 'b' * 64}}


def payload(title):
    return {'base_revision_id': 'pg-edit-base', 'title': title,
            'events': [{'id': 'a', 'onset': 0.5, 'duration': 0.3, 'pitch': 62, 'velocity': 0.7,
                        'confidence': 0.9, 'optional': False}],
            'spans': [{'start': 0, 'end': 2, 'kind': 'playing'}],
            'sections': [{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 2}],
            'assessment': {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                           'rubric_version': 'music-watch-v1'},
            'confirm_reviewed': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    engine = make_engine(args.url)
    store = Store()
    raw = json.dumps(reference_document(), separators=(',', ':')).encode()
    store.objects['lessons/pg-edit-lesson/reference.json'] = raw
    settings = Settings(database_url=args.url, public_url='http://testserver', demo_enabled=False,
                        web_dist_dir='/tmp/no-web', _env_file=None)
    app = create_app(settings)
    with Session(engine) as session:
        session.execute(delete(MusicRevisionEdit))
        session.execute(delete(LessonAcceptance).where(LessonAcceptance.lesson_id == 'pg-edit-lesson'))
        session.execute(delete(LessonRevision).where(LessonRevision.lesson_id == 'pg-edit-lesson'))
        session.execute(delete(Lesson).where(Lesson.id == 'pg-edit-lesson'))
        session.execute(delete(LoginSession).where(LoginSession.account_id == 'pg-owner'))
        session.execute(delete(Account).where(Account.id == 'pg-owner'))
        session.add(Account(id='pg-owner', email='pg-owner@example.test', password_hash='x', verified=True))
        session.add(LoginSession(token_hash=digest('pg-token'), account_id='pg-owner', expires_at=now() + timedelta(hours=1)))
        session.add(Lesson(id='pg-edit-lesson', owner_id='pg-owner', title='PG edit', subject='piano',
                           experience_family='music', instrument='piano'))
        manifest = {'schema_version': 2, 'experience_family': 'music', 'lesson_id': 'pg-edit-lesson',
                    'revision_id': 'pg-edit-base', 'title': 'PG edit', 'subject': 'piano', 'duration': 2,
                    'instrument': {'instrument': 'piano'},
                    'section_set': {'id': 's', 'revision': 1, 'duration': 2,
                                    'sections': [{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 2}]},
                    'reference': {'key': 'lessons/pg-edit-lesson/reference.json', 'mime': 'application/json',
                                  'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()},
                    'reference_reviewed': True,
                    'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                                   'input_modes': ['none'], 'dimensions': []},
                    'warnings': []}
        session.add(LessonRevision(id='pg-edit-base', lesson_id='pg-edit-lesson', version=1, manifest=manifest,
                                   subject='piano', experience_family='music', instrument='piano'))
        session.flush()
        session.add(LessonAcceptance(id='pg-accept', lesson_id='pg-edit-lesson', revision_id='pg-edit-base',
                                     account_id='pg-owner', warnings=[], source='music-review',
                                     accepted_at=now()))
        session.commit()

    clients = [TestClient(app), TestClient(app)]
    for client in clients:
        client.cookies.set(COOKIE, 'pg-token')
    headers = {'Origin': 'http://testserver', 'X-Form-Request': '1',
               'X-CSRF-Token': csrf_token('pg-token'), 'X-Lesson-Formats': '1,2'}
    with patch('apps.api.music_edit.storage_client', return_value=store):
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda pair: pair[0].post(
                '/api/lessons/pg-edit-lesson/music-revision', json=payload(pair[1]), headers=headers),
                [(clients[0], 'First winner'), (clients[1], 'Second winner')]))
        statuses = sorted(response.status_code for response in responses)
        assert statuses == [200, 409], [(response.status_code, response.text) for response in responses]
        winner = next(response for response in responses if response.status_code == 200)
        revision_id = winner.json()['revision_id']
        again = clients[0].post('/api/lessons/pg-edit-lesson/music-revision', json=payload(
            'First winner' if winner.json()['title'] == 'First winner' else 'Second winner'), headers=headers)
        assert again.status_code == 200 and again.json()['revision_id'] == revision_id
    with Session(engine) as session:
        assert session.query(MusicRevisionEdit).count() == 1
        assert session.get(Lesson, 'pg-edit-lesson').published_revision_id is None
    print(json.dumps({'status': 'passed', 'statuses': statuses, 'revision_id': revision_id,
                      'edits': 1, 'shared_release': None}))


if __name__ == '__main__':
    main()
