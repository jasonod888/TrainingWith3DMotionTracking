"""Browser acceptance for the owner-only model comparison page.

Starts the real API against a temporary SQLite database, registers a session and the
owner's extracted audio, runs the three permitted adapters through the HTTP flow, and
drives the built page with Chromium. No model result is fabricated.
"""
import hashlib
import json
import secrets
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import uvicorn
from playwright.sync_api import sync_playwright
from sqlalchemy.orm import Session

from apps.api.auth import COOKIE, digest
from apps.api.config import Settings
from apps.api.database import (Account, Base, LoginSession, PianoComparisonSource,
                               make_engine)
from apps.api.main import create_app

BASE = 'http://127.0.0.1:8765'
SOURCE = ROOT / '.local/piano-correction-trial-20261112/source.wav'
OUT = ROOT / 'model-pilot-output/browser'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        database_url=f"sqlite:///{(OUT / 'acceptance.db').as_posix()}",
        public_url=BASE, demo_enabled=False,
        web_dist_dir=ROOT / 'apps/web/dist',
        piano_comparison_dir=OUT / 'comparisons')
    if (OUT / 'acceptance.db').exists():
        (OUT / 'acceptance.db').unlink()
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    raw = secrets.token_urlsafe(32)
    with Session(app.state.engine) as session:
        session.add(Account(id='acct-1', email='owner@example.test', password_hash='x',
                            verified=True, status='active'))
        session.add(LoginSession(token_hash=digest(raw), account_id='acct-1',
                                 expires_at=datetime.now(timezone.utc) + timedelta(hours=2)))
        session.add(PianoComparisonSource(
            id='src-1', owner_id='acct-1', label="Owner's lesson", path=str(SOURCE),
            sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(), seconds=15.616009,
            reference_path=None))
        session.commit()
    config = uvicorn.Config(app, host='127.0.0.1', port=8765, log_level='warning')
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(120):
        if server.started:
            break
        time.sleep(0.1)
    assert server.started, 'API did not start'
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1280, 'height': 900})
            context.add_cookies([{'name': COOKIE, 'value': raw, 'url': BASE}])
            page = context.new_page()
            page.goto(f'{BASE}/?page=music-comparison', wait_until='domcontentloaded')
            page.get_by_role('heading', name='Compare AI models').wait_for()
            page.get_by_role('button', name='Start comparison').click()
            page.wait_for_timeout(1500)
            # Three adapters run sequentially; wait for the first results.
            deadline = time.time() + 420
            while time.time() < deadline:
                body = page.inner_text('body')
                if 'Some models finished' in body or 'All requested models finished' in body:
                    break
                page.wait_for_timeout(2000)
            else:
                page.screenshot(path=str(OUT / 'timeout.png'), full_page=True)
                raise AssertionError('comparison did not finish in time')
            page.screenshot(path=str(OUT / 'comparison.png'), full_page=True)
            body = page.inner_text('body')
            assert 'blocked by licence' in body
            assert 'Kong' in body
            # Switching models swaps the single audio element and preserves position.
            audio = page.locator('audio')
            assert audio.count() == 1
            page.get_by_role('button', name='Kong', exact=True).click()
            page.wait_for_timeout(1200)
            state = page.evaluate("""() => {const a=document.querySelector('audio'); return {src:a.src, duration:a.duration, ready:a.readyState};}""")
            assert 'kong-piano' in state['src'], state
            assert state['duration'] > 1, state
            page.evaluate("document.querySelector('audio').currentTime = 5")
            page.get_by_role('button', name='native').click()
            page.wait_for_timeout(800)
            src = audio.get_attribute('src') or ''
            assert 'basic-pitch-native' in src, src
            current = page.evaluate("document.querySelector('audio').currentTime")
            assert 4.0 <= current <= 7.0, current
            page.get_by_role('heading', name='Results').wait_for(timeout=20000)
            body = page.inner_text('body')
            assert 'no reference' in body
            assert 'predicted offsets' in body
            manifest = page.evaluate(
                """async (url) => {const r = await fetch(url); return r.ok ? await r.json() : null;}""",
                src.replace('preview.wav', 'preview.json'))
            assert manifest['previews']['as_transcribed']['clipping'] is False
            assert manifest['previews']['as_transcribed']['mapping']['native_offsets']['notes'] > 0
            page.screenshot(path=str(OUT / 'results.png'), full_page=True)
            print(json.dumps({'status': 'ok', 'seconds': round(time.time(), 1),
                              'audio': src, 'resumed_at': round(current, 2)}))
            browser.close()
    finally:
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == '__main__':
    main()


