"""Real application, default-off library diagrams: mapping, lazy loading and fallback."""
import hashlib
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5196')
state={'subject':'piano','piano':False,'guitar':False,'capo':None}
template=json.loads((ROOT/'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))

def documents():
    subject=state['subject'];instrument={'instrument':subject}
    if state['capo'] is not None:instrument['capo']=state['capo']
    pitches=[60,61,64] if subject=='piano' else [40,45,50,55,59,64,41]
    events=[dict(id=str(index),pitch=pitch,onset=.5+index*.5,duration=.35,optional=False) for index,pitch in enumerate(pitches)]
    reference=dict(reference_version=1,subject=subject,instrument=instrument,duration=8,events=events,spans=[{'start':0,'end':8}],
        review=dict(reviewer_id='fixture-reviewer',reviewed_at='2026-11-10T00:00:00Z',draft_id='fixture',source_reference_sha256='a'*64))
    raw=json.dumps(reference).encode()
    manifest={**template,'lesson_id':'guide-ui','revision_id':'guide-ui-v1','title':'Instrument UI lesson',
        'subject':subject,'instrument':instrument,'duration':8,'source_video':None,
        'section_set':{'id':'sections','revision':1,'duration':8,'sections':[{'id':'all','label':'Whole lesson','start':0,'end':8}]},
        'reference':{'key':'lessons/guide-ui/reference.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mime':'application/json'},
        'assessment':{'assessment':'none','input_modes':['none'],'dimensions':[],'rubric_version':'music-watch-v1'}}
    summary=dict(summary_version=1,lesson_id='guide-ui',revision_id='guide-ui-v1',title='Instrument UI lesson',subject=subject,
        subject_label=subject.title(),experience_family='music',instrument=subject,duration=8,section_count=1,poster=None,
        capabilities={'preview':True,'practice':False,'live_input':'none'})
    return manifest,raw,summary

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':390,'height':844})
    errors=[];requests=[];calls=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append(request.url))
    page.add_init_script("""
      window.deviceRequests=[];window.audioContexts=0;
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('media');throw Error('Unexpected media');};
      navigator.permissions.query=()=>{deviceRequests.push('permission');throw Error('Unexpected permission');};
      window.AudioContext=class {constructor(){window.audioContexts++;throw Error('Unexpected audio');}};
      window.webkitAudioContext=window.AudioContext;
    """)
    def api(route):
        path=route.request.url.split('/api/',1)[1].split('?')[0];calls.append(path)
        manifest,raw,summary=documents()
        if path=='auth/session':route.fulfill(json={'account':dict(id='owner',email='fixture@example.test',platform_role='member',status='active',mfa_enrolled=False),'csrf':'test'})
        elif path=='capabilities':route.fulfill(json={'music_piano_library_ui':state['piano'],'music_guitar_library_ui':state['guitar'],'music_midi_setup':False,'music_history':False,'subject_filter':False})
        elif path=='lessons/summaries':route.fulfill(json=[summary])
        elif path=='shared-lessons/summaries':route.fulfill(json=[])
        elif path=='lessons/guide-ui':route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):route.fulfill(body=raw,content_type='application/json')
        elif path=='public/moves':route.fulfill(json={'moves':[],'next_offset':None})
        elif path=='public/subjects':route.fulfill(json={'subjects':[]})
        elif path=='workflow/lessons':route.fulfill(json={'lessons':[]})
        elif path=='conversions':route.fulfill(json={'jobs':[],'worker_online':False})
        elif path=='groups':route.fulfill(json={'groups':[]})
        else:route.fulfill(status=404,json={'detail':'No fixture route'})
    page.route('**/api/**',api)
    def open_lesson():
        page.goto(BASE+'/?page=moves')
        page.get_by_role('button',name='Open Instrument UI lesson',exact=True).click()
        expect(page.locator('.music-home h1')).to_have_text('Instrument UI lesson')
        page.wait_for_selector('.instrument-guide-stage')
    def seek(time):
        page.get_by_label('Lesson position').evaluate("""(el,time)=>{
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,time);
          el.dispatchEvent(new Event('input',{bubbles:true}));
        }""",str(time))
    open_lesson()
    expect(page.locator('.piano')).to_be_visible()
    assert not any('/renderers/PianoGuide' in url or '/renderers/GuitarNeckGuide' in url for url in requests)
    state.update(piano=True,guitar=True);requests.clear();open_lesson()
    piano=page.locator('[data-renderer="piano-library"]')
    expect(piano).to_be_visible();seek(.6)
    expect(piano).to_have_attribute('data-active-pitches','60')
    expect(page.locator('.ReactPiano__Key--active')).to_have_count(1)
    page.locator('.library-guide-scroll').click();page.keyboard.press('a')
    expect(piano).to_have_attribute('data-active-pitches','60')
    seek(1.1);expect(piano).to_have_attribute('data-active-pitches','61')
    seek(2);expect(piano).to_have_attribute('data-active-pitches','')
    assert not any('/renderers/GuitarNeckGuide' in url or 'fretboard_js' in url for url in requests)
    page.screenshot(path=str(ROOT/'test-results/music-library-piano-phone.png'),full_page=True)
    state.update(subject='guitar');requests.clear();open_lesson()
    neck=page.locator('[data-renderer="guitar-library"]')
    expect(neck).to_be_visible();seek(.6)
    expect(neck).to_have_attribute('data-positions','6:0:40')
    low_y=float(neck.locator('.dots circle').get_attribute('cy'))
    seek(3.1);expect(neck).to_have_attribute('data-positions','1:0:64')
    high_y=float(neck.locator('.dots circle').get_attribute('cy'));assert low_y>high_y
    seek(3.6);expect(neck).to_have_attribute('data-positions','6:1:41')
    for width,height in [(390,844),(812,375),(1280,800)]:
        page.set_viewport_size({'width':width,'height':height})
        expect(neck.locator('svg')).to_have_count(1)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not any('/renderers/PianoGuide' in url or 'react-piano' in url for url in requests)
    page.screenshot(path=str(ROOT/'test-results/music-library-guitar-desktop.png'),full_page=True)
    state['capo']=2;open_lesson();seek(.6)
    expect(page.locator('[data-renderer="guitar-library"]')).to_have_attribute('data-positions','')
    expect(page.locator('.instrument-guide-stage')).to_contain_text('unavailable')
    # A failed diagram import leaves the existing guide and transport usable.
    state.update(subject='piano',capo=None)
    page.route('**/renderers/PianoGuide.tsx*',lambda route:route.abort())
    open_lesson()
    expect(page.locator('.instrument-guide-stage')).to_contain_text('Using the basic guide')
    expect(page.locator('.piano')).to_be_visible()
    seek(.6);expect(page.locator('.piano .is-active')).to_have_count(1)
    assert page.evaluate('window.deviceRequests')==[] and page.evaluate('window.audioContexts')==0
    assert not any('/attempts' in path or 'music-attempts' in path for path in calls)
    assert not any(any(extension in url.lower() for extension in ('.woff','.ttf','.mp3','.wav','.ogg')) for url in requests)
    assert errors==[],errors
    browser.close()
print('PASS: independent flags, exact piano/guitar mappings, isolated lazy imports, read-only input, resize cleanup and failed-import fallback; no devices/audio/history requests.')
