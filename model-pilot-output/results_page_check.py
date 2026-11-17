"""Open the existing frozen comparison to verify the completed results table."""
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
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.auth import COOKIE, digest
from apps.api.config import Settings
from apps.api.database import LoginSession, PianoComparison
from apps.api.main import create_app

OUT = ROOT / 'model-pilot-output/browser'
DB = OUT / 'acceptance.db'
BASE = 'http://127.0.0.1:8766'


def main():
    settings = Settings(database_url=f'sqlite:///{DB.as_posix()}', public_url=BASE,
                        demo_enabled=False, web_dist_dir=ROOT / 'apps/web/dist',
                        piano_comparison_dir=OUT / 'comparisons')
    app = create_app(settings)
    raw = secrets.token_urlsafe(32)
    with Session(app.state.engine) as session:
        identifier = session.scalar(select(PianoComparison.id)
                                    .order_by(PianoComparison.created_at.desc()))
        session.add(LoginSession(token_hash=digest(raw), account_id='acct-1',
                                 expires_at=datetime.now(timezone.utc) + timedelta(hours=2)))
        session.commit()
    assert identifier, 'no comparison in the acceptance database'
    config = uvicorn.Config(app, host='127.0.0.1', port=8766, log_level='warning')
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1280, 'height': 1000})
            context.add_cookies([{'name': COOKIE, 'value': raw, 'url': BASE}])
            page = context.new_page()
            page.goto(f'{BASE}/?page=music-comparison&id={identifier}',
                      wait_until='domcontentloaded')
            page.get_by_role('heading', name='Results').wait_for(timeout=60000)
            body = page.inner_text('body')
            for label in ('relative dynamics', 'audio', 'stereo room', 'human similarity'):
                assert label in body, label
            assert 'objective' in body
            page.screenshot(path=str(OUT / 'results-complete.png'), full_page=True)
            print({'comparison': identifier, 'rows': len(page.locator('tbody tr').all())})
            browser.close()
    finally:
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == '__main__':
    main()
