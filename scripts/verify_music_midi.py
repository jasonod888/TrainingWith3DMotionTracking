"""Opt-in keyboard setup with virtual MIDI ports. No hardware qualification or grading."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
raw=(ROOT/'packages/lesson-schema/fixtures/music-corpus/piano-scale/reference.json').read_bytes()
reference=json.loads(raw)
manifest=json.loads((ROOT/'packages/lesson-schema/fixtures/music-v2.json').read_text())
manifest.update(lesson_id='midi-fixture',revision_id='midi-v1',title='Keyboard setup fixture',duration=3,source_video=None,
    section_set=dict(id='whole',revision=1,duration=3,sections=[dict(id='all',label='Whole lesson',start=0,end=3)]),
    reference=dict(key='lessons/midi-fixture/reference.json',mime='application/json',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()),
    assessment=dict(rubric_version='music-watch-v1',assessment='none',input_modes=['none'],dimensions=[]))

MOCK="""
window.midiRequests=[];window.otherRequests=[];window.denied=false;window.deferMIDI=false;
class Port extends EventTarget{
 constructor(id){super();this.id=id;this.name='Keyboard '+id;this.state='connected';this.connection='closed';this.openCount=0;this.closeCount=0;this.handlers=new Set();}
 addEventListener(type,handler,...rest){super.addEventListener(type,handler,...rest);if(type==='midimessage')this.handlers.add(handler);}
 removeEventListener(type,handler,...rest){super.removeEventListener(type,handler,...rest);if(type==='midimessage')this.handlers.delete(handler);}
 async open(){this.connection='open';this.openCount++;midiAccess.dispatchEvent(new Event('statechange'));return this;}
 async close(){if(this.connection==='open')this.closeCount++;this.connection='closed';midiAccess.dispatchEvent(new Event('statechange'));return this;}
}
window.ports={A:new Port('A'),B:new Port('B')};
window.midiAccess=new EventTarget();midiAccess.inputs=new Map(Object.values(ports).map(port=>[port.id,port]));
navigator.requestMIDIAccess=async options=>{midiRequests.push(options);if(denied)throw new DOMException('Declined','NotAllowedError');if(deferMIDI)return new Promise(resolve=>window.resolveMIDI=resolve);return midiAccess;};
navigator.mediaDevices.getUserMedia=()=>{otherRequests.push('media');throw Error('Unexpected media request');};
navigator.permissions.query=()=>{otherRequests.push('permission query');throw Error('Unexpected permission query');};
window.emit=(id,bytes)=>{const event=new Event('midimessage');Object.defineProperty(event,'data',{value:new Uint8Array(bytes)});ports[id].dispatchEvent(event);};
if(location.hash==='#unsupported')navigator.requestMIDIAccess=undefined;
"""

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':390,'height':844})
    errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append(request.url))
    page.add_init_script(MOCK)
    def api(route):
        path=route.request.url.split('/api/',1)[1].split('?')[0]
        if path=='auth/session':route.fulfill(json={'account':dict(id='tester',email='tester@example.test',platform_role='member',status='active',mfa_enrolled=False),'csrf':'test'})
        elif path=='demo':route.fulfill(status=404,json={'detail':'No demo'})
        elif path in ('lessons/summaries','shared-lessons/summaries'):route.fulfill(json=[])
        elif path=='workflow/lessons':route.fulfill(json={'lessons':[]})
        elif path=='conversions':route.fulfill(json={'jobs':[],'worker_online':False})
        elif path=='capabilities':route.fulfill(json={'subject_filter':False,'music_midi_setup':True})
        elif path=='public/moves':route.fulfill(json={'moves':[]})
        elif path=='lessons/midi-fixture':route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):route.fulfill(body=raw,content_type='application/json')
        else:route.fulfill(status=404,json={'detail':'Unexpected mock route'})
    page.route('**/api/**',api)
    url=os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5196')+'/?page=preview&id=midi-fixture'
    page.goto(url)
    connect=page.get_by_role('button',name='Connect a keyboard',exact=True)
    expect(connect).to_be_visible();assert page.evaluate('midiRequests.length')==0
    connect.click()
    select=page.get_by_role('combobox',name='Keyboard input',exact=True)
    select.select_option('A')
    expect(page.get_by_role('region',name='Keyboard check',exact=True).get_by_role('status')).to_contain_text('Play a note')
    page.evaluate("emit('B',[0x90,60,100])")
    expect(page.get_by_test_id('midi-pressed')).to_have_text('None')
    page.evaluate("emit('A',[0x90,60,100]);emit('A',[0xb0,64,127]);emit('A',[0x90,60,0])")
    expect(page.get_by_test_id('midi-pressed')).to_have_text('None')
    expect(page.get_by_test_id('midi-sounding')).to_have_text('C4')
    page.evaluate("emit('A',[0xb0,64,0]);emit('A',[0x90,64,100]);emit('A',[0x90,64,100])")
    expect(page.get_by_test_id('midi-attacks')).to_have_text('3')
    assert page.evaluate('ports.A.openCount')==1, 'Opening a port must not cause a statechange reopen loop'
    select.select_option('B');page.evaluate("emit('A',[0x90,70,100]);emit('B',[0x90,65,100])")
    expect(page.get_by_test_id('midi-pressed')).to_have_text('F4')
    page.evaluate("ports.B.state='disconnected';midiAccess.dispatchEvent(new Event('statechange'))")
    expect(select).to_have_value('');expect(page.get_by_test_id('midi-pressed')).to_have_text('None')
    select.select_option('A');page.evaluate("emit('A',[0x90,60,100])")
    page.get_by_role('button',name='Play guide',exact=True).click()
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
    expect(select).to_have_value('');expect(page.get_by_role('button',name='Play guide',exact=True)).to_be_visible()
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
    select.select_option('A');page.evaluate("emit('A',[0x90,60,100])")
    page.screenshot(path=str(ROOT/'test-results/midi-keyboard-check.png'),full_page=True)
    page.get_by_role('button',name='Back',exact=True).click()
    assert page.evaluate("Object.values(ports).every(port=>port.connection==='closed'&&port.handlers.size===0)")
    assert page.evaluate('midiRequests')==[{'sysex':False}]
    page.goto(url);page.evaluate('denied=true');connect.click()
    expect(page.get_by_role('region',name='Keyboard check',exact=True).get_by_role('status')).to_contain_text('unavailable or declined')
    expect(page.locator('.piano')).to_be_visible()
    page.evaluate('denied=false;deferMIDI=true');connect.click()
    page.get_by_role('button',name='Back',exact=True).click()
    page.evaluate('resolveMIDI(midiAccess)')
    assert page.evaluate("Object.values(ports).every(port=>port.openCount===0&&port.handlers.size===0)")
    page.goto(url+'#unsupported')
    expect(page.get_by_text('This browser cannot connect a keyboard here.',exact=False)).to_be_visible()
    expect(connect).to_have_count(0)
    expect(page.get_by_role('button',name='Play guide',exact=True)).to_be_visible()
    assert page.evaluate('midiRequests.length')==0
    assert page.evaluate('otherRequests')==[] and errors==[],errors
    assert not any('/attempt' in request or '/progress' in request for request in requests)
    browser.close()
print('PASS: explicit MIDI permission, selected input only, attacks/pedal, switching/disconnect, visibility/exit cleanup, denial and late permission; no grading, persistence or media access.')
