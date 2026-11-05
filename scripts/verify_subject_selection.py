"""Subject selection appears before preparation, with music disabled by default."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
account = {'id': 'tester', 'email': 'test@example.test', 'platform_role': 'member', 'status': 'active', 'mfa_enrolled': False}
subjects = [
    dict(id='movement_other', label='Full Body Movement', experience_family='body', instrument=None, movement=True),
    dict(id='dance', label='Dance', experience_family='body', instrument=None, movement=True),
    dict(id='piano', label='Piano', experience_family='music', instrument='piano', movement=False),
    dict(id='guitar', label='Guitar', experience_family='music', instrument='guitar', movement=False),
]
limits = dict(max_bytes=250 * 1024 * 1024, max_seconds=300, max_active=2, part_size=5 * 1024 * 1024,
              processing=dict(provider='local', available=True, external_processing=False),
              subjects=subjects,
              routes={'body-default': {'available': True}, 'music-piano': {'available': False},
                      'music-guitar': {'available': False}},
              capabilities={'conversion': True, 'music_piano': False, 'music_guitar': False})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': account, 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path in ('lessons', 'shared-lessons'):
            route.fulfill(json=[])
        elif path == 'lessons/summaries' or path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': True})
        elif path == 'conversions/limits':
            route.fulfill(json=limits)
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}})
        elif path == 'public/moves':
            route.fulfill(json={'moves': []})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=create')
    selector = page.locator('select[aria-label="Lesson subject"]')
    expect(selector).to_be_visible()
    assert selector.input_value() == 'movement_other', selector.input_value()
    options = page.eval_on_selector_all('select[aria-label="Lesson subject"] option',
                                        'nodes => nodes.map(node => ({value: node.value, label: node.textContent, disabled: node.disabled}))')
    by_value = {option['value']: option for option in options}
    assert by_value['piano']['disabled'] and by_value['guitar']['disabled'], by_value
    assert 'not available yet' in by_value['piano']['label'], by_value['piano']
    assert not by_value['dance']['disabled'], by_value['dance']
    assert page.get_by_role('button', name='Create 3D move').count() == 0  # no clip chosen yet
    assert errors == [], errors
    browser.close()
print('PASS: subject choice before preparation, movement default, music options disabled with explanation.')
