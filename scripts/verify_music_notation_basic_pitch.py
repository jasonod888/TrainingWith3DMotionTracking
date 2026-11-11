"""Existing Basic Pitch piano test lesson rendered as an editable score.

This is the representative-passage check requested for the prototype: 59 notes across
six measures, both staves, both voices and ties. It is a render/interaction check, not a
transcription-accuracy claim.
"""
import hashlib
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
notation = json.loads((ROOT / 'packages/music-notation/fixtures/basic-pitch-piano.json').read_text(encoding='utf-8'))
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 12,
    'events': notation['performance'],
    'spans': [{'start': 0, 'end': 12, 'kind': 'playing'}],
    'notation': notation,
    'review': {'reviewer_id': 'owner', 'reviewed_at': '2026-11-10T12:00:00+00:00', 'draft_id': 'basic-pitch',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'music-edit', 'revision_id': 'base-rev', 'title': 'Basic Pitch piano passage',
            'duration': 12,
            'section_set': {'id': 'sections', 'revision': 1, 'duration': 12, 'sections': [
                {'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 12}]},
            'reference': {'key': 'lessons/music-edit/reference.json', 'mime': 'application/json',
                          'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'reference_reviewed': True, 'source_video': None,
            'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                           'input_modes': ['none'], 'dimensions': []}}
summary = {'summary_version': 1, 'lesson_id': 'music-edit', 'revision_id': 'base-rev',
           'title': 'Basic Pitch piano passage', 'subject': 'piano', 'subject_label': 'Piano',
           'experience_family': 'music', 'instrument': 'piano', 'duration': 12, 'section_count': 1,
           'poster': None, 'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='owner', email='owner@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}})
        elif path == 'public/moves':
            route.fulfill(json={'moves': [], 'next_offset': None})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        elif path == 'lessons/music-edit':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=data, content_type='application/json')
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_label('Options for Basic Pitch piano passage', exact=True).click()
    page.get_by_role('button', name='Edit lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Sheet music', exact=True)).to_be_visible()
    score = page.locator('.notation-sheet')
    expect(score).to_have_attribute('aria-label', re.compile(r'59 notes, 18 ties'))
    expect(score).to_have_attribute('aria-label', re.compile(r'6 measures'))
    page.get_by_role('button', name='Next measure', exact=True).click()
    page.get_by_role('button', name='Next measure', exact=True).click()
    # At least one note in measure 3 is selectable, and the inspector reports its measure.
    note = page.get_by_role('button', name=re.compile(r'^[A-G][#b]?\d, measure 3'))
    expect(note.first).to_be_visible()
    note.first.focus()
    page.keyboard.press('Enter')
    expect(page.locator('.notation-selection-facts')).to_contain_text('3 / 6')
    page.add_style_tag(content='.header{position:static !important}.notation-toolbar{position:static !important}')
    page.screenshot(path=str(ROOT / 'test-results/music-notation-basic-pitch-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 1000})
    page.wait_for_timeout(300)
    expect(page.locator('.piano-roll')).to_be_visible()
    expect(page.locator('.keyboard-svg')).to_be_visible()
    page.screenshot(path=str(ROOT / 'test-results/music-notation-basic-pitch-desktop.png'), full_page=True)
    assert errors == [], errors
    browser.close()
print('PASS: the existing Basic Pitch passage renders six measures, both staves/dense voices, 18 ties and linked views.')
