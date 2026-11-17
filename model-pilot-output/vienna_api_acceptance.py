"""API acceptance for the full Vienna recording with its captured-MIDI reference."""
import hashlib
import json
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.auth import COOKIE, csrf_token, digest
from apps.api.config import Settings
from apps.api.database import (Account, Base, LoginSession, PianoComparisonSource)
from apps.api.main import create_app

OUT = ROOT / 'model-pilot-output/vienna-api'
SOURCE = ROOT / '.local/commercial-piano-data/vienna-original-sample.wav'
REFERENCE = ROOT / 'model-pilot-output/vienna/reference.json'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    database = OUT / 'vienna.db'
    if database.exists():
        database.unlink()
    settings = Settings(
        database_url=f'sqlite:///{database.as_posix()}', public_url='http://testserver',
        demo_enabled=False, web_dist_dir=ROOT / 'apps/web/dist',
        piano_comparison_dir=OUT / 'comparisons')
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    raw = secrets.token_urlsafe(32)
    with Session(app.state.engine) as session:
        session.add(Account(id='acct-1', email='owner@example.test', password_hash='x',
                            verified=True, status='active'))
        session.add(LoginSession(token_hash=digest(raw), account_id='acct-1',
                                 expires_at=datetime.now(timezone.utc) + timedelta(hours=3)))
        session.add(PianoComparisonSource(
            id='vienna', owner_id='acct-1', label='Vienna Op.38 p01 (full)',
            path=str(SOURCE), sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            seconds=128.19927437641724, reference_path=str(REFERENCE)))
        session.commit()
    client = TestClient(app)
    client.cookies.set(COOKIE, raw)
    session_info = client.get('/api/auth/session').json()
    headers = {'X-CSRF-Token': session_info['csrf'], 'X-Form-Request': '1', 'Origin': 'http://testserver'}
    created = client.post('/api/piano-comparisons', headers=headers,
                          json={'source_id': 'vienna'})
    assert created.status_code == 200, created.text
    comparison = created.json()
    identifier = comparison['id']
    deadline = time.time() + 900
    while time.time() < deadline:
        state = client.get(f'/api/piano-comparisons/{identifier}').json()
        if state['status'] in ('partial', 'complete', 'failed', 'blocked'):
            break
        time.sleep(5)
    else:
        raise AssertionError('Vienna comparison did not finish')
    assert state['status'] == 'partial', state
    results = client.get(f'/api/piano-comparisons/{identifier}/results')
    assert results.status_code == 200, results.text
    payload = results.json()
    (OUT / 'results.json').write_text(json.dumps(payload, indent=2, sort_keys=True),
                                      encoding='utf-8')
    summary = {}
    for variant, model in payload['models'].items():
        attributes = model['attributes']
        correctness = attributes['note_correctness']
        summary[variant] = {
            'state': correctness['state'],
            'f1': correctness['value']['f1'],
            'missing': correctness['value']['missing'],
            'extra': correctness['value']['extra'],
            'mae_seconds': attributes['fine_timing']['value']['mae_seconds'],
            'velocity_state': attributes['velocity']['state'],
            'audio_state': attributes['audio']['state'],
        }
    with Session(app.state.engine) as session:
        session.expunge_all()
    print(json.dumps({'comparison': identifier, 'status': state['status'],
                      'summary': summary,
                      'blocked': [row['variant'] for row in payload['blocked']]}, indent=2))
    app.state.engine.dispose()


if __name__ == '__main__':
    main()


