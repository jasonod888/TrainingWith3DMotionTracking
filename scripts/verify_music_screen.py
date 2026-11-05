"""Browser visual check for the music fixture screen.

Mocks the API, so no database or worker is needed. Renders a reviewed music manifest
through the shared library/preview navigation and saves phone and desktop screenshots
for visual review.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

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
    # Instrument device entry points: watching a lesson must request none of them.
    page.add_init_script("""
      window.__permissionRequests = [];
      const media = navigator.mediaDevices;
      if (media && media.getUserMedia) {
        media.getUserMedia = (...args) => {
          window.__permissionRequests.push('getUserMedia');
          return Promise.reject(new Error('Blocked by the music screen check'));
        };
      }
      if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess = (...args) => {
          window.__permissionRequests.push('requestMIDIAccess');
          return Promise.reject(new Error('Blocked by the music screen check'));
        };
      }
      const permissions = navigator.permissions;
      if (permissions && permissions.query) {
        const query = permissions.query.bind(permissions);
        permissions.query = (descriptor) => {
          window.__permissionRequests.push('permissions:' + (descriptor && descriptor.name));
          return query(descriptor);
        };
      }
    """)

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': account, 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path in ('lessons', 'lessons/summaries'):
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
    expect(page.get_by_role('status')).to_contain_text('Live piano feedback is not enabled')
    expect(page.locator('.music-home-head')).to_contain_text('Instructor playback and the animated guide are not available yet')
    results.mkdir(exist_ok=True)
    page.screenshot(path=str(results / 'music-fixture-phone.png'))
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.wait_for_timeout(300)
    page.screenshot(path=str(results / 'music-fixture-desktop.png'))
    heading = page.locator('.music-home h1').inner_text()
    requests = page.evaluate('window.__permissionRequests')
    assert errors == [], f'page errors: {errors}'
    assert requests == [], f'device permission requests: {requests}'
    assert heading, 'music heading is missing'
    assert page.locator('.music-home-panel').count() == 2, 'music details are incomplete'
    manifest['subject'] = 'guitar'
    manifest['instrument'] = {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0}
    manifest['assessment'] = {'rubric_version':'guitar-watch-v1','assessment':'none','input_modes':['none'],'dimensions':[]}
    page.reload()
    expect(page.get_by_role('status')).to_contain_text('Live guitar feedback is not enabled')
    assert page.evaluate('window.__permissionRequests') == []
    assert errors == [], errors
    print(json.dumps({'heading': heading, 'errors': errors, 'permission_requests': requests,
                      'screenshots': ['test-results/music-fixture-phone.png', 'test-results/music-fixture-desktop.png']}))
    browser.close()
