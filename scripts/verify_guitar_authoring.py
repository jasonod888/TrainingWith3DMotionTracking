"""Reviewed guitar position and chord authoring through the editor."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {
    'reference_version': 1, 'subject': 'guitar', 'instrument': {'instrument': 'guitar',
        'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0},
    'duration': 4,
    'events': [{'id': 'low', 'onset': 0.5, 'duration': 0.4, 'pitch': 40, 'optional': False},
               {'id': 'a', 'onset': 2, 'duration': 0.4, 'pitch': 45, 'optional': False}],
    'spans': [{'start': 0, 'end': 4, 'kind': 'playing'}],
    'review': {'reviewer_id': 'owner', 'reviewed_at': '2026-11-10T12:00:00+00:00', 'draft_id': 'base-rev',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'guitar-edit', 'revision_id': 'base-rev', 'title': 'Guitar choices', 'duration': 4,
            'subject': 'guitar', 'instrument': {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0},
            'section_set': {'id': 'sections', 'revision': 1, 'duration': 4, 'sections': [
                {'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 4}]},
            'reference': {'key': 'lessons/guitar-edit/reference.json', 'mime': 'application/json',
                          'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'reference_reviewed': True, 'source_video': None,
            'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                           'input_modes': ['none'], 'dimensions': []}}
summary = {'summary_version': 1, 'lesson_id': 'guitar-edit', 'revision_id': 'base-rev', 'title': 'Guitar choices',
           'subject': 'guitar', 'subject_label': 'Guitar', 'experience_family': 'music', 'instrument': 'guitar',
           'duration': 4, 'section_count': 1, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, edits = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      localStorage.setItem('form-studio','1');
    """)
    state = {'manifest': manifest, 'reference': data}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        method = route.request.method
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
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {},
                                'music_guitar_library_ui': True})
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
        elif path == 'lessons/guitar-edit' and method == 'GET':
            route.fulfill(json=state['manifest'])
        elif path == 'lessons/guitar-edit/music-revision' and method == 'POST':
            body = route.request.post_data_json
            edits.append(body)
            raw = json.dumps({**reference, 'events': body['events'], 'spans': body['spans'],
                              'guitar_chords': body['guitar_chords']}).encode()
            state['reference'] = raw
            updated = {**state['manifest'], 'revision_id': 'edited-rev',
                       'reference': {'key': 'lessons/guitar-edit/edited-reference.json', 'mime': 'application/json',
                                     'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}}
            state['manifest'] = updated
            route.fulfill(json=updated)
        elif path.endswith('/assets/reference.json') or path.endswith('/assets/edited-reference.json'):
            route.fulfill(body=state['reference'], content_type='application/json')
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_label('Options for Guitar choices', exact=True).click()
    page.get_by_role('button', name='Edit lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Edit this music lesson', exact=True)).to_be_visible()
    page.get_by_label('Note 1 string', exact=True).select_option('6')
    page.get_by_role('button', name='Add chord', exact=True).click()
    page.get_by_label('Chord 1 name', exact=True).fill('C')
    page.get_by_role('checkbox', name='I have checked the notes, passages and sections against the instructor material.', exact=True).check()
    page.get_by_role('button', name='Save new revision', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Guitar choices')
    assert len(edits) == 1
    body = edits[0]
    assert body['events'][0]['string'] == 6 and body['events'][0]['fret'] == 0
    assert body['guitar_chords'][0]['name'] == 'C'
    neck = page.locator('[data-renderer="guitar-library"]')
    expect(neck).to_be_visible()
    expect(page.locator('.guitar-chords')).to_contain_text('C')
    page.screenshot(path=str(ROOT / 'test-results/guitar-authoring-phone.png'), full_page=True)
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    browser.close()
print('PASS: reviewed string/fret position and chord shape save through the editor and render in the guide.')
