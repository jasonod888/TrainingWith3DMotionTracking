"""Browser visual check for the music fixture screen.

Mocks the API, so no database or worker is needed. Renders a reviewed music manifest
through the shared library/preview navigation and saves phone and desktop screenshots
for visual review.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**BASE, 'lesson_id': 'music-fixture', 'revision_id': 'music-fixture-v1'}
account = {'id': 'tester', 'email': 'test@example.test', 'platform_role': 'member', 'status': 'active', 'mfa_enrolled': False}
results = ROOT / 'test-results'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': account, 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons':
            route.fulfill(json=[])
        elif path == 'shared-lessons':
            route.fulfill(json=[])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True})
        elif path == 'lessons/music-fixture':
            route.fulfill(json=manifest)
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=preview&id=music-fixture')
    # The lazy chunk renders a fallback with the same section class; wait for its heading.
    page.wait_for_selector('.music-home h1', timeout=15000)
    results.mkdir(exist_ok=True)
    page.screenshot(path=str(results / 'music-fixture-phone.png'))
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.wait_for_timeout(300)
    page.screenshot(path=str(results / 'music-fixture-desktop.png'))
    heading = page.locator('.music-home h1').inner_text()
    print(json.dumps({'heading': heading, 'errors': errors,
                      'screenshots': ['test-results/music-fixture-phone.png', 'test-results/music-fixture-desktop.png']}))
    browser.close()
