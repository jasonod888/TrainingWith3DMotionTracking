"""Local feedback only for an explicitly MIDI-enabled rubric; watch-only stays ungraded."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
base_reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 4,
    'events': [{'id': 'a', 'onset': 0.3, 'duration': 0.3, 'pitch': 60, 'optional': False},
               {'id': 'b', 'onset': 0.7, 'duration': 0.3, 'pitch': 64, 'optional': False}],
    'spans': [{'start': 0.05, 'end': 3.8}],
    'review': {'reviewer_id': 'tester', 'reviewed_at': '2026-11-05T12:00:00+00:00', 'draft_id': 'draft-1',
               'source_reference_sha256': 'a' * 64},
}
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))


def build(assessment):
    reference = json.loads(json.dumps(base_reference))
    data = json.dumps(reference, separators=(',', ':')).encode()
    manifest = {**base, 'lesson_id': 'music-feedback', 'revision_id': 'music-feedback-v1',
                'title': 'Feedback lesson', 'duration': 4,
                'section_set': {'id': 'feedback-sections', 'revision': 1, 'duration': 4, 'sections': [
                    {'id': 'intro', 'label': 'Intro', 'start': 0, 'end': 1.6},
                    {'id': 'phrase', 'label': 'Phrase', 'start': 1.6, 'end': 4}]},
                'reference': {'key': 'lessons/music-feedback/reference.json', 'mime': 'application/json',
                              'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
                'reference_reviewed': True, 'source_video': None, 'assessment': assessment}
    summary = {'summary_version': 1, 'lesson_id': 'music-feedback', 'revision_id': 'music-feedback-v1',
               'title': 'Feedback lesson', 'subject': 'piano', 'subject_label': 'Piano',
               'experience_family': 'music', 'instrument': 'piano', 'duration': 4, 'section_count': 2,
               'poster': None, 'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}
    return manifest, data, summary


rubric = {'rubric_version': 'piano-midi-v1', 'assessment': 'notes', 'input_modes': ['midi'], 'dimensions': ['pitch', 'timing']}
watch = {'rubric_version': 'music-watch-v1', 'assessment': 'none', 'input_modes': ['none'], 'dimensions': []}
manifest, reference_bytes, summary = build(rubric)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    calls = []
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

    current = {'assessment': rubric, 'manifest': manifest}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        calls.append(path)
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='tester', email='test@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'lessons/music-feedback':
            route.fulfill(json=current['manifest'])
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=reference_bytes, content_type='application/json')
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}, 'music_midi_setup': True})
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
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Open Feedback lesson', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Feedback lesson')
    page.get_by_role('button', name='Connect a keyboard', exact=True).click()
    page.get_by_label('Keyboard input').select_option('kbd-1')
    expect(page.get_by_role('button', name='Estimate timing alignment')).to_be_visible()
    page.get_by_label('Practice section').select_option('intro')
    page.get_by_label('Count-in').select_option('0')
    page.get_by_label('Repeats').select_option('1')
    page.get_by_role('button', name='Start practice', exact=True).click()
    page.wait_for_timeout(240)
    page.evaluate('window.playNote(60)')
    page.wait_for_timeout(400)
    page.evaluate('window.playNote(64)')
    page.wait_for_selector('.music-feedback', timeout=15000)
    expect(page.locator('.music-feedback')).to_contain_text('2 matched · 0 missing · 0 extra')
    expect(page.locator('.music-feedback')).to_contain_text('2 of 2 notes eligible for comparison (100% of reference notes)')
    expect(page.locator('.music-feedback')).to_contain_text('Nothing is saved or sent')
    expect(page.locator('.music-feedback')).to_contain_text('No timing alignment estimate was made')

    # A repeat that omits one note produces one missing correction, per repeat.
    page.get_by_role('button', name='Practice again', exact=True).click()
    page.wait_for_timeout(240)
    page.evaluate('window.playNote(60)')
    page.wait_for_selector('.music-feedback', timeout=15000)
    expect(page.locator('.music-feedback')).to_contain_text('1 missing')

    # Exercise the actual calibration UI. A chord counts as one tap per visual pulse.
    page.get_by_role('button', name='Close practice', exact=True).click()
    # React to rendered pulses in-page, avoiding automation polling delay in a 300 ms window.
    page.evaluate('''() => {
      window.calibrationPulses=[];window.calibrationTapCount=0;
      window.pulseObserver=new MutationObserver(()=>{
        const pulse=Number(document.querySelector('.calibration-pulse strong')?.textContent);
        const count=Number(document.querySelector('.calibration-pulse small')?.textContent.split(' ')[0]);
        if(Number.isFinite(count))window.calibrationTapCount=Math.max(window.calibrationTapCount,count);
        if(pulse>0&&!window.calibrationPulses.includes(pulse)){
          window.calibrationPulses.push(pulse);window.playNote(60);window.playNote(64);window.playNote(67);
        }
      });
      window.pulseObserver.observe(document.querySelector('.music-home'),{childList:true,subtree:true,characterData:true});
    }''')
    page.get_by_role('button', name='Estimate timing alignment', exact=True).click()
    expect(page.get_by_role('button', name='Start practice', exact=True)).to_be_disabled()
    page.wait_for_function('window.calibrationTapCount===8')
    assert page.evaluate('window.calibrationPulses') == list(range(1, 9))
    page.evaluate('window.pulseObserver.disconnect()')
    expect(page.get_by_role('region', name='Timing alignment')).to_contain_text('Estimated personal alignment:')
    expect(page.get_by_role('region', name='Timing alignment')).to_contain_text('hardware latency is not measured')
    page.get_by_role('button', name='Measure again', exact=True).click()
    page.get_by_role('button', name='Estimate timing alignment', exact=True).click()
    expect(page.locator('.calibration-pulse')).to_be_visible()
    page.get_by_label('Keyboard input').select_option('')
    expect(page.locator('.calibration-pulse')).to_have_count(0)
    page.wait_for_timeout(900)
    assert 'Estimated personal alignment:' not in page.locator('.input-delay').inner_text()

    # A watch-only rubric never produces feedback.
    watch_manifest = {**manifest, 'assessment': watch}
    current['manifest'] = watch_manifest
    page.reload()
    page.wait_for_selector('.music-home h1', timeout=15000)
    page.get_by_role('button', name='Connect a keyboard', exact=True).click()
    page.get_by_label('Keyboard input').select_option('kbd-1')
    page.get_by_label('Count-in').select_option('0')
    page.get_by_role('button', name='Start practice', exact=True).click()
    expect(page.locator('.music-practice')).to_contain_text('stays ungraded', timeout=15000)
    assert page.locator('.music-feedback').count() == 0
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    assert not any('/progress' in path or '/attempts' in path for path in calls), calls
    browser.close()
print('PASS: MIDI-rubric feedback matched/missing per repeat, watch-only stays ungraded, no persistence or media calls.')
