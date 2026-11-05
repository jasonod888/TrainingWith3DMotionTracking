"""Browser visual check for the reviewed music guide.

Mocks the API, so no database or worker is needed. Renders a reviewed piano reference and
then a guitar reference through the shared preview navigation, saves phone and desktop
screenshots, and asserts no camera/microphone/MIDI requests are made.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
account = {'id': 'tester', 'email': 'test@example.test', 'platform_role': 'member', 'status': 'active', 'mfa_enrolled': False}
results = ROOT / 'test-results'


def reference(subject: str) -> dict:
    pitches = [60, 64, 67] if subject == 'piano' else [40, 45, 50]
    return {
        'reference_version': 1, 'subject': subject, 'instrument': {'instrument': subject}, 'duration': 8,
        'events': [{'id': f'{subject}-{index}', 'onset': 0.5 + index, 'duration': 0.5, 'pitch': pitch,
                    'velocity': 0.7, 'optional': False} for index, pitch in enumerate(pitches)],
        'spans': [{'start': 0.2, 'end': 7.5}],
        'review': {'reviewer_id': 'tester', 'reviewed_at': '2026-11-05T12:00:00+00:00', 'draft_id': 'draft-1',
                   'source_reference_sha256': 'a' * 64},
    }


manifest = {**BASE, 'lesson_id': 'music-fixture', 'revision_id': 'music-fixture-v1',
            'reference': {**BASE['reference'], 'key': 'lessons/music-fixture/reference.json'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # Watching a lesson must request no input devices.
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
        elif path in ('lessons', 'lessons/summaries', 'shared-lessons', 'shared-lessons/summaries'):
            route.fulfill(json=[])
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True})
        elif path == 'lessons/music-fixture':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(json=reference(manifest['subject']))
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=preview&id=music-fixture')
    page.wait_for_selector('.music-home h1', timeout=15000)
    expect(page.locator('.piano')).to_be_visible()
    expect(page.locator('.music-now')).to_contain_text('No note sounding')
    expect(page.locator('.music-video')).to_contain_text('original video is unavailable')
    results.mkdir(exist_ok=True)
    page.screenshot(path=str(results / 'music-fixture-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(300)
    page.screenshot(path=str(results / 'music-fixture-desktop.png'), full_page=True)
    heading = page.locator('.music-home h1').inner_text()
    requests = page.evaluate('window.__permissionRequests')
    assert errors == [], f'page errors: {errors}'
    assert requests == [], f'device permission requests: {requests}'
    assert heading, 'music heading is missing'
    assert page.locator('.music-home-panel').count() == 2, 'music details are incomplete'

    manifest['subject'] = 'guitar'
    manifest['instrument'] = {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0}
    manifest['assessment'] = {'rubric_version': 'guitar-watch-v1', 'assessment': 'none', 'input_modes': ['none'], 'dimensions': []}
    page.reload()
    page.wait_for_selector('.fretboard', timeout=15000)
    expect(page.locator('.fret-cell').first).to_be_visible()
    assert page.evaluate('window.__permissionRequests') == []
    assert errors == [], errors
    print(json.dumps({'heading': heading, 'errors': errors, 'permission_requests': requests,
                      'screenshots': ['test-results/music-fixture-phone.png', 'test-results/music-fixture-desktop.png']}))
    browser.close()
