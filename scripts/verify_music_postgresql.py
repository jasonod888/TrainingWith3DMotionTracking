"""Real PostgreSQL history races and backup recovery, confined to our disposable container.

Requires a cached postgres:16-alpine image; never pulls, mounts volumes, or accepts a
database URL. Synthetic reviewed metadata/session fixtures only; no model or device test.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.orm import Session
from apps.api.auth import COOKIE, csrf_token, digest, now
from apps.api.config import Settings
from apps.api.database import Account, Lesson, LessonRevision, LoginSession, MusicPracticeAttempt, database_ready
from apps.api.main import create_app
from apps.api.music_attempts import MAX_SUMMARIES, MusicAttemptInput


def command(args, **kwargs):
    completed = subprocess.run(args, capture_output=True, text=True, timeout=60, **kwargs)
    if completed.returncode:
        raise RuntimeError(f'{Path(args[0]).name} command failed: {completed.stderr[-2000:]}')
    return completed.stdout.strip()


def payload(fixture, attempt_id=None, alignment='none'):
    return MusicAttemptInput.model_validate({
        'summary_version': 1, 'status': 'complete', 'id': attempt_id or str(uuid4()), 'save_requested': True,
        'revision_id': fixture['revision_id'], 'reference_sha256': 'a' * 64, 'rubric_version': 'piano-midi-v1',
        'section_id': 'all', 'start': 0, 'end': 8, 'speed': 1, 'run': 0, 'assessment': 'unscored',
        'alignment': alignment, 'note_window': {'total': 5, 'eligible': 4, 'matched': 2, 'missing': 1, 'extra': 1},
    }).model_dump(mode='json')


def seed(engine):
    fixtures = []
    template = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
    with Session(engine) as session:
        for index in range(4):
            account_id, lesson_id, revision_id, token = uuid4().hex, uuid4().hex, uuid4().hex, secrets.token_urlsafe(32)
            session.add(Account(id=account_id, email=f'pg-{index}@example.test', password_hash='unused-session-fixture', verified=True))
            session.flush()
            session.add(LoginSession(token_hash=digest(token), account_id=account_id, expires_at=now()+timedelta(hours=1)))
            session.add(Lesson(id=lesson_id, owner_id=account_id, title='Synthetic PostgreSQL test',
                               subject='piano', experience_family='music', instrument='piano'))
            session.flush()
            manifest = {**template, 'lesson_id': lesson_id, 'revision_id': revision_id,
                'title': 'Synthetic PostgreSQL test',
                'assessment': {'assessment': 'notes', 'input_modes': ['midi'], 'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}}
            session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=1, manifest=manifest,
                                      subject='piano', experience_family='music', instrument='piano'))
            fixtures.append({'account_id': account_id, 'lesson_id': lesson_id, 'revision_id': revision_id, 'token': token})
        session.flush()
        fixture = fixtures[0]
        for _ in range(MAX_SUMMARIES-1):
            body = payload(fixture)
            session.add(MusicPracticeAttempt(id=body['id'], account_id=fixture['account_id'], lesson_id=fixture['lesson_id'],
                revision_id=fixture['revision_id'], summary=body, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)))
        session.commit()
    return fixtures


def headers(fixture):
    return {'Origin': 'http://testserver', 'X-Form-Request': '1', 'Content-Type': 'application/json',
            'Cookie': f"{COOKIE}={fixture['token']}", 'X-CSRF-Token': csrf_token(fixture['token'])}


def snapshot(engine):
    with Session(engine) as session:
        attempts = session.scalars(select(MusicPracticeAttempt).order_by(MusicPracticeAttempt.id)).all()
        revisions = session.scalars(select(LessonRevision).order_by(LessonRevision.id)).all()
        stable = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return {'version': session.scalar(text('SELECT version_num FROM alembic_version')),
            'accounts': session.scalar(select(func.count()).select_from(Account)),
            'lessons': session.scalar(select(func.count()).select_from(Lesson)),
            'revisions': len(revisions), 'attempts': len(attempts),
            'manifest_sha256': stable([[row.id, row.manifest] for row in revisions]),
            'summary_sha256': stable([[row.id, row.account_id, row.lesson_id, row.revision_id, row.summary, row.created_at.isoformat()] for row in attempts])}


def exercise(app, fixtures):
    engine = app.state.engine
    control = {'lock': None, 'insert': None, 'locks_seen': [], 'inserts_seen': []}

    def synchronize(_connection, _cursor, statement, _parameters, _context, _many):
        if control['lock'] and 'FOR UPDATE' in statement and 'FROM accounts' in statement:
            control['locks_seen'].append(1)
            control['lock'].wait(timeout=12)
        if control['insert'] and 'INSERT INTO music_practice_attempts' in statement:
            control['inserts_seen'].append(1)
            control['insert'].wait(timeout=12)

    event.listen(engine, 'before_cursor_execute', synchronize)

    def count(fixture):
        with Session(engine) as session:
            return session.scalar(select(func.count()).select_from(MusicPracticeAttempt).where(MusicPracticeAttempt.account_id == fixture['account_id']))

    try:
        with TestClient(app) as client:
            def post(fixture, body):
                return client.post(f"/api/lessons/{fixture['lesson_id']}/music-attempts", json=body, headers=headers(fixture))

            def race(requests, force_insert=False):
                control.update(lock=threading.Barrier(len(requests)), insert=threading.Barrier(len(requests)) if force_insert else None,
                               locks_seen=[], inserts_seen=[])
                try:
                    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
                        futures = [pool.submit(post, fixture, body) for fixture, body in requests]
                        results = [future.result(timeout=30) for future in futures]
                    assert len(control['locks_seen']) == len(requests)
                    if force_insert:
                        assert len(control['inserts_seen']) == len(requests)
                    return results
                finally:
                    control['lock'] = control['insert'] = None

            near, retries, left, right = fixtures
            bodies = [payload(near) for _ in range(4)]
            results = race([(near, body) for body in bodies])
            assert sorted(result.status_code for result in results) == [201, 409, 409, 409]
            assert count(near) == MAX_SUMMARIES
            winner = bodies[next(index for index, result in enumerate(results) if result.status_code == 201)]
            assert post(near, winner).status_code == 201  # Exact retry succeeds even at quota.
            assert post(near, payload(near)).status_code == 409
            quota_report = {'start': MAX_SUMMARIES-1, 'requests': 4, 'statuses': sorted(result.status_code for result in results), 'final': count(near), 'retry_at_quota': 201}

            identical = payload(retries)
            results = race([(retries, identical)] * 4)
            assert [result.status_code for result in results] == [201]*4
            assert count(retries) == 1
            conflict = payload(retries)
            results = race([(retries, conflict), (retries, {**conflict, 'alignment': 'visual-estimate'})])
            assert sorted(result.status_code for result in results) == [201, 409]
            assert count(retries) == 2

            collision_id = str(uuid4())
            results = race([(left, payload(left, collision_id)), (right, payload(right, collision_id))], force_insert=True)
            assert sorted(result.status_code for result in results) == [201, 409]
            assert count(left)+count(right) == 1

            # Keyset continuation does not require the boundary row to remain present.
            with Session(engine) as session:
                expected = list(session.scalars(select(MusicPracticeAttempt.id).where(MusicPracticeAttempt.account_id == near['account_id'])
                    .order_by(MusicPracticeAttempt.created_at.desc(), MusicPracticeAttempt.id.desc()).limit(40)))
            first = client.get('/api/music-attempts?limit=20', headers=headers(near)).json()
            assert [item['id'] for item in first['items']] == expected[:20]
            boundary = first['items'][-1]
            assert client.delete(f"/api/lessons/{near['lesson_id']}/music-attempts/{boundary['id']}", headers=headers(near)).status_code == 200
            second = client.get('/api/music-attempts', params={'limit': 20, 'cursor': first['next_cursor']}, headers=headers(near)).json()
            assert [item['id'] for item in second['items']] == expected[20:]
            return {'quota_race': quota_report, 'identical_retries': {'requests': 4, 'statuses': [201]*4, 'rows': 1},
                'changed_payload_race': {'statuses': [201, 409], 'rows_added': 1},
                'cross_account_insert_collision': {'statuses': [201, 409], 'rows_added': 1, 'forced_concurrent_inserts': True},
                'cursor_after_boundary_deletion': 'passed', 'http_auth': 'real synthetic sessions, CSRF and origin checks; no dependency overrides'}
    finally:
        event.remove(engine, 'before_cursor_execute', synchronize)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'test-results/music-postgresql-concurrency.json')
    args = parser.parse_args()
    name = 'form-music-verify-' + uuid4().hex[:12]
    password = secrets.token_hex(20)
    container = None
    engine = recovered = None
    report = {'status': 'failed', 'image': 'postgres:16-alpine', 'scope': 'disposable synthetic PostgreSQL/API/backup tests; no production, hardware or model qualification'}
    started = time.monotonic()
    try:
        report.update(executed_at=datetime.now(timezone.utc).isoformat(),
            app_commit=command(['git', 'rev-parse', 'HEAD'], cwd=ROOT),
            harness_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            image_id=command(['docker', 'image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']))
        container = command(['docker', 'run', '--pull=never', '--rm', '-d', '--name', name, '--label', f'form.music-verification={name}',
            '-e', f'POSTGRES_PASSWORD={password}', '-e', 'POSTGRES_DB=form_verify', '-p', '127.0.0.1::5432',
            'postgres:16-alpine', 'postgres', '-c', 'statement_timeout=15000', '-c', 'lock_timeout=10000'])
        assert len(container) == 64 and all(char in '0123456789abcdef' for char in container)
        address = command(['docker', 'port', container, '5432/tcp'])
        assert address.startswith('127.0.0.1:')
        url = f'postgresql+psycopg://postgres:{password}@{address}/form_verify'
        engine = create_engine(url, connect_args={'connect_timeout': 2})
        deadline = time.monotonic()+30
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text('SELECT 1'))
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Disposable PostgreSQL did not become ready.') from None
                time.sleep(.3)
        env = {**os.environ, 'DATABASE_URL': url}
        migrate = lambda *arguments: command([sys.executable, '-m', 'alembic', *arguments], cwd=ROOT, env=env)
        migrate('upgrade', 'head')
        database_ready(engine)
        fixtures = seed(engine)
        with tempfile.TemporaryDirectory(prefix='form-music-web-') as directory:
            settings = Settings(database_url=url, public_url='http://testserver', web_dist_dir=Path(directory)/'absent',
                music_history_enabled=True, music_piano_conversion_provider='disabled', music_guitar_conversion_provider='disabled', _env_file=None)
            app = create_app(settings)
            report['races'] = exercise(app, fixtures)
        before = snapshot(engine)
        # pg_dump covers the full disposable database; recovery is into a new empty DB.
        command(['docker', 'exec', container, 'pg_dump', '-U', 'postgres', '-d', 'form_verify', '-Fc', '-f', '/tmp/music-history.dump'])
        migrate('downgrade', '0019')
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT to_regclass('public.music_practice_attempts')")) is None
        migrate('upgrade', 'head')
        after = snapshot(engine)
        assert after['attempts'] == 0 and after['manifest_sha256'] == before['manifest_sha256']
        assert (after['accounts'], after['lessons'], after['revisions']) == (before['accounts'], before['lessons'], before['revisions'])
        command(['docker', 'exec', container, 'createdb', '-U', 'postgres', 'form_recovered'])
        command(['docker', 'exec', container, 'pg_restore', '--no-owner', '-U', 'postgres', '-d', 'form_recovered', '/tmp/music-history.dump'])
        recovered = create_engine(url.rsplit('/', 1)[0]+'/form_recovered', connect_args={'connect_timeout': 2})
        database_ready(recovered)
        assert snapshot(recovered) == before
        report.update(status='passed', snapshot_before_downgrade=before,
            recovery={'downgrade_scope': '0020 -> 0019 only', 'expected_history_loss_on_downgrade': True,
                      'upgrade_back_to_0020_empty_history': True, 'full_pg_dump_restore_into_empty_database': 'exact snapshot match'},
            server_version=command(['docker', 'exec', container, 'psql', '-U', 'postgres', '-d', 'form_verify', '-Atc', 'SHOW server_version']))
    except Exception as exc:
        report['error'] = f'{type(exc).__name__}: {exc}'.replace(password, '<redacted>')
        report['traceback'] = traceback.format_exc().replace(password, '<redacted>')
    finally:
        for connection in (engine, recovered):
            if connection is not None:
                connection.dispose()
        if container is not None:
            try:
                label = command(['docker', 'inspect', '--format', '{{index .Config.Labels "form.music-verification"}}', container])
                if label != name:
                    raise RuntimeError('Refusing cleanup: verification container label differs.')
                command(['docker', 'rm', '-f', container])
                report['container_removed'] = True
            except Exception as exc:
                report['status'] = 'failed'
                report['cleanup_error'] = str(exc).replace(password, '<redacted>')
        report['elapsed_seconds'] = round(time.monotonic()-started, 2)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
