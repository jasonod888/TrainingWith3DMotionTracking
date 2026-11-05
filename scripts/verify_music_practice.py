"""Timed practice controls: count-in, section, repeats, speed and clean reset. No devices."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 6,
    'events': [{'id': 'a', 'onset': 0.1, 'duration': 0.3, 'pitch': 60, 'velocity': 0.8},
               {'id': 'b', 'onset': 1.0, 'duration': 0.3, 'pitch': 64, 'velocity': 0.8}],
    'spans': [{'start': 0.05, 'end': 5.8}],
    'review': {'reviewer_id': 'tester', 'reviewed_at': '2026-11-05T12:00:00+00:00', 'draft_id': 'draft-1',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
manifest = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest.update(lesson_id='music-practice', revision_id='music-practice-v1', title='Practice lesson', duration=6,
                section_set={'id': 'practice-sections', 'revision': 1, 'duration': 6, 'sections': [
                    {'id': 'intro', 'label': 'Intro', 'start': 0, 'end': 0.8},
                    {'id': 'phrase', 'label': 'Phrase', 'start': 0.8, 'end': 6}]},
                reference={'key': 'lessons/music-practice/reference.json', 'mime': 'application/json',
                           'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
                reference_reviewed=True, source_video=None,
                assessment={'rubric_version': 'music-watch-v1', 'assessment': 'none',
                            'input_modes': ['none'], 'dimensions': []})
summary = {'summary_version': 1, 'lesson_id': 'music-practice', 'revision_id': 'music-practice-v1',
           'title': 'Practice lesson', 'subject': 'piano', 'subject_label': 'Piano', 'experience_family': 'music',
           'instrument': 'piano', 'duration': 6, 'section_count': 2, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      window.midiRequests=0;
      const input={id:'kbd-1',name:'Test keyboard',state:'connected',handlers:new Set(),
        open:async()=>{},close:async()=>{},
        addEventListener(type,handler){if(type==='midimessage')this.handlers.add(handler);},
        removeEventListener(type,handler){this.handlers.delete(handler);}};
      const access={inputs:new Map([['kbd-1',input]]),outputs:new Map(),addEventListener(){},removeEventListener(){}};
      window.playNote=pitch=>{const event=new Event('midimessage');Object.defineProperty(event,'data',{value:new Uint8Array([0x90,pitch,100])});input.handlers.forEach(handler=>handler(event));};
      navigator.requestMIDIAccess=async()=>{midiRequests+=1;return access;};
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
    """)

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='tester', email='test@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'lessons/music-practice':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=data, content_type='application/json')
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}})
        elif path in ('public/moves',):
            route.fulfill(json={'moves': [], 'next_offset': None})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Open Practice lesson', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Practice lesson')
    expect(page.get_by_role('group', name='Timed practice')).to_be_visible()
    page.get_by_label('Practice section').select_option('intro')
    page.get_by_label('Count-in').select_option('2')
    page.get_by_label('Repeats').select_option('2')
    page.get_by_role('button', name='Start practice', exact=True).click()
    expect(page.locator('.practice-count')).to_contain_text('Get ready')
    expect(page.locator('.practice-status')).to_contain_text('Count-in 2')
    expect(page.locator('.music-practice')).to_contain_text('Practice complete', timeout=15000)
    expect(page.locator('.music-practice')).to_contain_text('0 notes played')
    expect(page.locator('.music-practice')).to_contain_text('unscored')
    # A seek during a new run resets practice cleanly.
    page.get_by_role('button', name='Practice again', exact=True).click()
    expect(page.locator('.music-practice')).to_be_visible()
    page.get_by_label('Lesson position').evaluate(
        """el => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, '0.2');
          el.dispatchEvent(new Event('input', {bubbles: true}));
        }""")
    expect(page.locator('.music-practice')).to_have_count(0)
    expect(page.get_by_role('group', name='Timed practice')).to_be_visible()
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    page.screenshot(path=str(ROOT / 'test-results/music-practice-phone.png'), full_page=True)

    # With the opt-in setup capability on, attacks played during a run are counted (unscored).
    def api_midi(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}, 'music_midi_setup': True})
        else:
            api(route)

    page.unroute('**/api/**')
    page.route('**/api/**', api_midi)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Open Practice lesson', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Practice lesson')
    page.get_by_role('button', name='Connect a keyboard', exact=True).click()
    page.get_by_label('Keyboard input').select_option('kbd-1')
    page.get_by_label('Practice section').select_option('intro')
    page.get_by_label('Count-in').select_option('0')
    page.get_by_label('Repeats').select_option('1')
    page.get_by_role('button', name='Start practice', exact=True).click()
    page.wait_for_timeout(150)
    page.evaluate('window.playNote(60)')
    expect(page.locator('.music-practice')).to_contain_text('Practice complete', timeout=15000)
    expect(page.locator('.music-practice')).to_contain_text('1 note played')
    assert page.evaluate('window.midiRequests') == 1
    assert errors == [], errors
    browser.close()
print('PASS: count-in, section practice, repeats, unscored completion and clean reset on seek; no devices.')
