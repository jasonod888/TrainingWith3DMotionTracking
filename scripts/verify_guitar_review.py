"""Initial draft review: guitar positions and chords authored before finalisation."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {'reference_version': 1, 'subject': 'guitar',
             'instrument': {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0},
             'duration': 4,
             'events': [{'id': 'low', 'onset': 0.5, 'duration': 0.4, 'pitch': 40, 'optional': False}],
             'spans': [{'start': 0, 'end': 4, 'kind': 'playing'}], 'guitar_chords': [],
             'review': {'reviewer_id': 'owner', 'reviewed_at': '2026-11-10T12:00:00+00:00', 'draft_id': 'draft-1',
                        'source_reference_sha256': 'a' * 64}}
raw = json.dumps(reference, separators=(',', ':')).encode()
asset = {'key': 'lessons/guitar-review/reference.json', 'mime': 'application/json',
         'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
draft = {'draft_version': 1, 'draft_id': 'draft-1', 'lesson_id': 'guitar-review', 'revision_id': 'draft-rev',
         'title': 'Draft guitar', 'status': 'draft', 'subject': 'guitar',
         'instrument': {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0},
         'duration': 4, 'reference': asset, 'source_video': None,
         'events': [{'id': 'low', 'onset': 0.5, 'duration': 0.4, 'pitch': 40, 'velocity': 0.7,
                     'confidence': 0.8, 'optional': False, 'string': None, 'fret': None}],
         'spans': [{'start': 0, 'end': 4, 'kind': 'playing'}], 'guitar_chords': [],
         'provenance': {'adapter': 'fixture', 'engine': 'fixture', 'model': None, 'model_version': 'fixture-v1',
                        'code_version': 'fixture-v1', 'audio_sha256': 'a' * 64},
         'warnings': ['Fixture proposal for review testing.']}
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'guitar-review', 'revision_id': 'reviewed-rev', 'title': 'Draft guitar', 'duration': 4,
            'subject': 'guitar', 'instrument': {'instrument': 'guitar', 'tuning': 'E2 A2 D3 G3 B3 E4', 'capo': 0},
            'section_set': {'id': 's', 'revision': 1, 'duration': 4,
                            'sections': [{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 4}]},
            'reference': asset, 'reference_reviewed': True, 'source_video': None,
            'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                           'input_modes': ['none'], 'dimensions': []}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, saves = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      localStorage.setItem('form-studio','1');
    """)
    state = {'manifest': manifest, 'reference': raw}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        method = route.request.method
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='owner', email='owner@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'conversions':
            route.fulfill(json={'jobs': [dict(id='job', title='Draft guitar', state='ready_for_review',
                                              lesson_id='guitar-review', subject='guitar', instrument='guitar',
                                              provider='local', processor_online=True, retryable=False, error=None)],
                                'worker_online': True})
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {},
                                'music_guitar_library_ui': True})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': [dict(lesson_id='guitar-review', latest_revision_id=None,
                                                 accepted_revision_id=None, experience_family='music')]})
        elif path == 'public/moves':
            route.fulfill(json={'moves': [], 'next_offset': None})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        elif path == 'lessons/guitar-review/music-draft':
            route.fulfill(json=draft)
        elif path == 'lessons/guitar-review/music-draft/review' and method == 'POST':
            body = route.request.post_data_json
            saves.append(body)
            updated = json.dumps({**reference, 'events': body['events'], 'guitar_chords': body['guitar_chords']}).encode()
            state['reference'] = updated
            state['manifest'] = {**manifest,
                                 'reference': {'key': 'lessons/guitar-review/reviewed.json', 'mime': 'application/json',
                                               'bytes': len(updated), 'sha256': hashlib.sha256(updated).hexdigest()},
                                 'section_set': {**manifest['section_set'], 'sections': body['sections']},
                                 'assessment': body['assessment']}
            route.fulfill(json=state['manifest'])
        elif path == 'lessons/guitar-review' and method == 'GET':
            route.fulfill(json=state['manifest'])
        elif path.endswith('/assets/reference.json') or path.endswith('/assets/reviewed.json'):
            route.fulfill(body=state['reference'], content_type='application/json')
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Review music', exact=True).click()
    expect(page.get_by_role('heading', name='Review your music reference', exact=True)).to_be_visible()
    page.get_by_label('Note 1 string', exact=True).select_option('6')
    page.get_by_role('button', name='Add chord', exact=True).click()
    page.get_by_label('Chord 1 name', exact=True).fill('C')
    page.get_by_role('checkbox', name='I have checked the notes and teaching sections against the instructor material.', exact=True).check()
    page.get_by_role('button', name='Save reviewed reference', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Draft guitar')
    assert saves and saves[0]['events'][0]['string'] == 6 and saves[0]['events'][0]['fret'] == 0
    assert saves[0]['guitar_chords'][0]['name'] == 'C'
    expect(page.locator('.guitar-chords')).to_contain_text('C')
    chord_list = page.get_by_label('Chord diagrams, scrollable')
    expect(chord_list).to_be_visible()
    chord_list.focus()
    assert page.evaluate('document.activeElement === document.querySelector(".guitar-chord-list")')
    page.screenshot(path=str(ROOT / 'test-results/guitar-review-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(200)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(ROOT / 'test-results/guitar-review-desktop.png'), full_page=True)
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    browser.close()
print('PASS: guitar positions and chords authored during draft review, rendered lazily, keyboard-focusable.')
