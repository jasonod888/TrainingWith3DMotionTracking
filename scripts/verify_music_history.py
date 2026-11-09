"""Explicit Save summary / History controls, default-off capability, retry and delete."""
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID, uuid4
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 4,
    'events': [{'id': 'a', 'onset': 0.3, 'duration': 0.3, 'pitch': 60, 'optional': False},
               {'id': 'b', 'onset': 0.7, 'duration': 0.3, 'pitch': 64, 'optional': False}],
    'spans': [{'start': 0.05, 'end': 3.8}],
    'review': {'reviewer_id': 'tester', 'reviewed_at': '2026-11-09T12:00:00+00:00', 'draft_id': 'draft-1',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'music-history', 'revision_id': 'music-history-v1', 'title': 'History lesson',
            'duration': 4,
            'section_set': {'id': 'history-sections', 'revision': 1, 'duration': 4, 'sections': [
                {'id': 'intro', 'label': 'Intro', 'start': 0, 'end': 1.6},
                {'id': 'phrase', 'label': 'Phrase', 'start': 1.6, 'end': 4}]},
            'reference': {'key': 'lessons/music-history/reference.json', 'mime': 'application/json',
                          'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'reference_reviewed': True, 'source_video': None,
            'assessment': {'rubric_version': 'piano-midi-v1', 'assessment': 'notes',
                           'input_modes': ['midi'], 'dimensions': ['pitch', 'timing']}}
summary = {'summary_version': 1, 'lesson_id': 'music-history', 'revision_id': 'music-history-v1',
           'title': 'History lesson', 'subject': 'piano', 'subject_label': 'Piano', 'experience_family': 'music',
           'instrument': 'piano', 'duration': 4, 'section_count': 2, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, posts, deletes, reads = [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      const input={id:'kbd-1',name:'Test keyboard',state:'connected',handlers:new Set(),
        open:async()=>{},close:async()=>{},
        addEventListener(type,handler){if(type==='midimessage')this.handlers.add(handler);},
        removeEventListener(type,handler){this.handlers.delete(handler);}};
      const access={inputs:new Map([['kbd-1',input]]),outputs:new Map(),addEventListener(){},removeEventListener(){}};
      window.playNote=pitch=>{const event=new Event('midimessage');Object.defineProperty(event,'data',{value:new Uint8Array([0x90,pitch,100])});input.handlers.forEach(handler=>handler(event));};
      navigator.requestMIDIAccess=async()=>access;
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
    """)

    state = {'history_enabled': True, 'rows': [], 'attempts': 0, 'more_failure': True, 'hold_next': False}
    saved_payload = {}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        method = route.request.method
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='tester', email='test@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'lessons/music-history':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=data, content_type='application/json')
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {},
                                'music_midi_setup': True, 'music_history': state['history_enabled']})
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
        elif path == 'lessons/music-history/music-attempts' and method == 'POST':
            payload = route.request.post_data_json
            posts.append(payload)
            if state['attempts'] == 0:
                state['attempts'] += 1
                route.fulfill(status=503, json={'detail': 'Temporary history failure.'})
                return
            UUID(payload['id'])
            assert payload['summary_version'] == 1 and payload['status'] == 'complete'
            assert payload['save_requested'] is True and payload['assessment'] == 'unscored'
            assert payload['revision_id'] == 'music-history-v1'
            assert payload['reference_sha256'] == manifest['reference']['sha256']
            assert payload['rubric_version'] == 'piano-midi-v1'
            assert payload['section_id'] == 'intro' and payload['start'] == 0 and payload['end'] == 1.6
            assert payload['speed'] == 1 and payload['run'] == 0
            assert set(payload['note_window']) == {'total', 'eligible', 'matched', 'missing', 'extra'}
            for key in ('score', 'accuracy', 'events', 'midi', 'latency_ms'):
                assert key not in payload
            saved_payload.update(payload)
            if not any(row['id']==payload['id'] for row in state['rows']):
                state['rows'].insert(0,{**payload,'evidence':'client-reported','date':'2026-11-10T12:00:00+00:00','lesson_id':'music-history','title':'History lesson'})
            if state['hold_next']:
                state['hold_next']=False;state['held_route']=route
                return
            route.fulfill(status=201, json={**payload, 'evidence': 'client-reported',
                                            'date': '2026-11-09T12:00:00+00:00'})
        elif path in ('lessons/music-history/music-attempts/page','music-attempts') and method == 'GET':
            reads.append(route.request.url)
            offset=int(parse_qs(urlparse(route.request.url).query).get('cursor',['0'])[0])
            if path=='music-attempts' and offset and state['more_failure']:
                state['more_failure']=False
                route.fulfill(status=503,json={'detail':'Temporary page failure.'})
            else:
                rows=state['rows'][offset:offset+2]
                route.fulfill(json={'items':rows,'next_cursor':str(offset+2) if offset+2<len(state['rows']) else None})
        elif path == 'lessons/music-history/music-attempts' and method == 'GET':
            route.fulfill(json=[{**saved_payload, 'evidence': 'client-reported',
                                 'date': '2026-11-09T12:00:00+00:00'}] if saved_payload else [])
        elif path.startswith('lessons/music-history/music-attempts/') and method == 'DELETE':
            deletes.append(path.rsplit('/', 1)[-1])
            state['rows']=[row for row in state['rows'] if row['id']!=deletes[-1]]
            route.fulfill(json={'ok': True})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Open History lesson', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('History lesson')
    page.get_by_role('button', name='Connect a keyboard', exact=True).click()
    page.get_by_label('Keyboard input').select_option('kbd-1')
    page.get_by_label('Practice section').select_option('intro')
    page.get_by_label('Count-in').select_option('0')
    page.get_by_role('button', name='Start practice', exact=True).click()
    page.wait_for_timeout(240)
    page.evaluate('window.playNote(60)')
    page.wait_for_timeout(420)
    page.evaluate('window.playNote(64)')
    page.wait_for_selector('.music-feedback', timeout=15000)
    assert posts == [] and reads == [], 'completion must not upload or load history automatically'
    save = page.get_by_role('button', name='Save summary', exact=True)
    expect(save).to_be_visible()
    save.click()
    expect(page.locator('.feedback-save')).to_contain_text('Temporary history failure')
    page.get_by_role('button', name='Retry save', exact=True).click()
    expect(page.locator('.feedback-save')).to_contain_text('Summary saved')
    assert len(posts) == 2 and posts[0] == posts[1], 'retry must reuse the exact payload'
    # The same range in another session is a new performance, not an already-saved run.
    state['hold_next']=True
    page.get_by_role('button',name='Practice again',exact=True).click()
    page.wait_for_selector('.music-feedback',timeout=15000)
    expect(page.get_by_role('button',name='Save summary',exact=True)).to_be_visible()
    page.get_by_role('button',name='Save summary',exact=True).click()
    expect(page.locator('.feedback-save')).to_contain_text('Saving…')
    # A late response from that session cannot mark a third session's run as saved.
    page.get_by_role('button',name='Practice again',exact=True).click()
    page.wait_for_selector('.music-feedback',timeout=15000)
    state['held_route'].fulfill(status=201,json={**posts[-1],'evidence':'client-reported','date':'2026-11-10T12:00:00Z'})
    page.wait_for_timeout(100)
    expect(page.get_by_role('button',name='Save summary',exact=True)).to_be_visible()
    assert 'Summary saved' not in page.locator('.feedback-save').inner_text()
    assert len(posts)==3 and posts[-1]['id']!=posts[0]['id']
    assert reads==[], 'saving does not silently open history'
    page.get_by_role('button', name='View music history', exact=True).click()
    history = page.locator('.history-list li')
    expect(history).to_have_count(2)
    expect(history.first).to_contain_text('Whole lesson' if saved_payload['section_id'] == 'all' else 'intro')
    expect(history.first).to_contain_text('matched')
    page.get_by_role('button', name=f"Delete summary {saved_payload['id']}", exact=True).click()
    expect(page.locator('.history-list li')).to_have_count(1)
    assert deletes == [saved_payload['id']] and page.evaluate('window.deviceRequests') == []
    assert errors == [], errors

    # Account history is also explicitly loaded and supports retrying a later page.
    seed=state['rows'][0]
    state['rows'].extend([{**seed,'id':str(uuid4()),'title':None if index==0 else 'Earlier piano'} for index in range(4)])
    before=len(reads)
    page.get_by_role('button',name='Account menu',exact=True).click()
    page.get_by_role('menuitem',name='Account',exact=True).click()
    expect(page.get_by_role('button',name='View all music history',exact=True)).to_be_visible()
    assert len(reads)==before
    page.get_by_role('button',name='View all music history',exact=True).click()
    panel=page.get_by_role('region',name='Account music history',exact=True)
    expect(panel.locator('.history-list li')).to_have_count(2)
    expect(panel).to_contain_text('Lesson unavailable')
    page.get_by_role('button',name='More summaries',exact=True).click()
    expect(panel).to_contain_text('Temporary page failure')
    expect(panel.locator('.history-list li')).to_have_count(2)
    page.get_by_role('button',name='Retry more summaries',exact=True).click()
    expect(panel.locator('.history-list li')).to_have_count(4)
    assert reads[-1]==reads[-2], 'retry requests the same cursor'
    page.get_by_role('button',name='More summaries',exact=True).click()
    expect(panel.locator('.history-list li')).to_have_count(5)
    assert page.get_by_role('button',name='More summaries',exact=True).count()==0
    for width,height in [(390,844),(1280,900)]:
        page.set_viewport_size({'width':width,'height':height})
        page.evaluate('window.scrollTo(0,0)')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(ROOT/f'test-results/music-account-history-{width}.png'),full_page=True)

    # Capability off: no save or history controls, and no history requests.
    state['history_enabled'] = False
    posts.clear()
    before=len(reads)
    page.reload()
    page.wait_for_selector('.account-email', timeout=15000)
    assert page.get_by_role('button', name='View all music history', exact=True).count() == 0
    page.get_by_role('button',name='My moves',exact=False).click()
    page.get_by_role('button',name='Open History lesson',exact=True).click()
    page.wait_for_selector('.music-home h1',timeout=15000)
    assert page.get_by_role('button', name='Save summary', exact=True).count() == 0
    assert page.get_by_role('button', name='View music history', exact=True).count() == 0
    assert posts == [] and len(reads)==before
    assert errors==[],errors
    browser.close()
print('PASS: distinct practice-session saves, account pagination and page retry, no auto-reads, explicit save with stable retry id, private history list and delete, no auto-upload, capability-off hidden.')
