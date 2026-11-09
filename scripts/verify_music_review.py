"""Real owner review UI with mocked API: feed entry, corrections, save retry, private preview."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
source=RESULTS/'review-instructor.mp4'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=green:s=320x180:r=15',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2',
                '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',str(source)],check=True)
lesson_id='review-fixture'
source_asset=dict(key=f'lessons/{lesson_id}/draft-source.mp4',mime='video/mp4',bytes=source.stat().st_size,
                  sha256=hashlib.sha256(source.read_bytes()).hexdigest())
draft=dict(draft_version=1,draft_id='draft-fixture',lesson_id=lesson_id,title='Piano proposal',status='draft',revision_id=None,
           subject='piano',instrument={'instrument':'piano'},duration=2,
           reference=dict(key=f'lessons/{lesson_id}/draft-reference.json',mime='application/json',bytes=10,sha256='a'*64),
           source_video=source_asset,events=[dict(id='first',onset=.5,duration=.4,pitch=60),dict(id='second',onset=1,duration=.4,pitch=64)],
           spans=[dict(start=.2,end=1.8)],warnings=['Synthetic fixture for review verification.'],
           provenance=dict(adapter='fixture',engine='fixture',model=None,model_version='fixture-v1',code_version='v1',audio_sha256='b'*64))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1280,'height':900})
    errors,saves=[],[]
    state={'reviewed':False,'manifest':None}
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('media');throw Error('No device access expected');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('No MIDI expected');};
      navigator.permissions.query=()=>{deviceRequests.push('permission');throw Error('No permission expected');};
    """)
    def api(route):
        path=route.request.url.split('/api/',1)[1].split('?')[0]
        if path=='auth/session':route.fulfill(json={'account':dict(id='owner',email='owner@example.test',platform_role='member',status='active',mfa_enrolled=False),'csrf':'test'})
        elif path=='demo':route.fulfill(status=404,json={'detail':'No demo'})
        elif path=='lessons/summaries':route.fulfill(json=[] if not state['reviewed'] else [dict(summary_version=1,lesson_id=lesson_id,revision_id='reviewed-v1',
            title='Reviewed piano',subject='piano',subject_label='Piano',experience_family='music',instrument='piano',duration=2,section_count=2,
            poster=None,capabilities=dict(preview=True,practice=False,live_input='none'))])
        elif path=='shared-lessons/summaries':route.fulfill(json=[])
        elif path=='workflow/lessons':route.fulfill(json={'lessons':[dict(lesson_id=lesson_id,subject='piano',subject_label='Piano',experience_family='music',instrument='piano',
            latest_revision_id='reviewed-v1' if state['reviewed'] else None,accepted_revision_id='reviewed-v1' if state['reviewed'] else None,
            published_revision_id=None,distribution='private',audiences=dict(direct=0,groups=0,public=False),public_listing=None)]})
        elif path=='conversions':route.fulfill(json={'jobs':[dict(id='job',title='Piano proposal',state='ready_for_review',lesson_id=lesson_id,
            subject='piano',instrument='piano',provider='local',processor_online=True,retryable=False,error=None)] if not state['reviewed'] else [],'worker_online':False})
        elif path=='capabilities':route.fulfill(json={'subject_filter':False})
        elif path=='public/moves':route.fulfill(json={'moves':[]})
        elif path==f'lessons/{lesson_id}/music-draft':route.fulfill(json=draft)
        elif path==f'lessons/{lesson_id}/assets/draft-source.mp4':
            data=source.read_bytes();headers={'Accept-Ranges':'bytes'};byte_range=route.request.headers.get('range')
            if byte_range:
                match=re.fullmatch(r'bytes=(\d+)-(\d*)',byte_range);assert match
                start=int(match[1]);end=min(int(match[2]) if match[2] else len(data)-1,len(data)-1)
                headers['Content-Range']=f'bytes {start}-{end}/{len(data)}'
                route.fulfill(status=206,body=data[start:end+1],headers=headers,content_type='video/mp4')
            else:route.fulfill(body=data,headers=headers,content_type='video/mp4')
        elif path==f'lessons/{lesson_id}/assets/reference.json':route.fulfill(body=state['reference_bytes'],content_type='application/json')
        elif path==f'lessons/{lesson_id}/music-draft/review':
            payload=route.request.post_data_json;saves.append(copy.deepcopy(payload))
            if len(saves)==1:route.fulfill(status=503,json={'detail':'Temporary save failure. Try again.'});return
            assert payload==saves[0], 'Save retry must retain the same review identity and corrections'
            assert payload['events'][0]['pitch']==62 and payload['confirm_reviewed'] is True
            assert payload['assessment']==dict(assessment='notes',input_modes=['midi'],dimensions=['pitch','timing'],rubric_version='piano-midi-v1')
            assert len(payload['sections'])==2
            manifest=json.loads((ROOT/'packages/lesson-schema/fixtures/music-v2.json').read_text())
            manifest.update(lesson_id=lesson_id,revision_id='reviewed-v1',title='Reviewed piano',duration=2,
                            source_video=source_asset,section_set=dict(id='reviewed-sections',revision=1,duration=2,sections=payload['sections']),
                            assessment=dict(rubric_version=payload['assessment']['rubric_version'],assessment=payload['assessment']['assessment'],
                            input_modes=payload['assessment']['input_modes'],dimensions=payload['assessment']['dimensions']))
            ref=dict(reference_version=1,subject='piano',instrument={'instrument':'piano'},duration=2,events=payload['events'],spans=payload['spans'],review=dict(reviewer_id='fixture-owner',reviewed_at='2026-11-05T12:00:00Z',draft_id='fixture',source_reference_sha256='a'*64))
            raw=json.dumps(ref).encode();manifest['reference']=dict(key=f'lessons/{lesson_id}/reference.json',mime='application/json',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
            state.update(reviewed=True,manifest=manifest,reference_bytes=raw);route.fulfill(json=manifest)
        elif path==f'lessons/{lesson_id}':route.fulfill(json=state['manifest']) if state['reviewed'] else route.fulfill(status=409,json={'detail':'Review this draft first.'})
        else:route.fulfill(status=404,json={'detail':'Unexpected mock route'})
    page.route('**/api/**',api)
    page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5196')+'/')
    page.get_by_role('button',name='Review music',exact=True).click()
    expect(page.get_by_role('heading',name='Review your music reference',exact=True)).to_be_visible()
    review_url=page.url
    page.reload()  # the dedicated owner review destination survives refresh
    expect(page.get_by_label('Note 1 pitch',exact=True)).to_have_value('60')
    expect(page.get_by_label('Instructor video for reference review',exact=True)).to_be_visible()
    page.get_by_label('Lesson title',exact=True).fill('Reviewed piano')
    page.get_by_role('radio',name='MIDI note feedback (unscored)',exact=True).check()
    expect(page.get_by_role('radio',name='MIDI note feedback (unscored)',exact=True)).to_be_checked()
    page.get_by_label('Note 1 pitch',exact=True).select_option('62')
    page.get_by_role('button',name='Add section',exact=True).click()
    confirm=page.get_by_role('checkbox',name='I have checked the notes and teaching sections against the instructor material.',exact=True)
    confirm.check()
    page.get_by_label('Note 1 start',exact=True).fill('.6')
    expect(confirm).not_to_be_checked()
    expect(page.get_by_role('button',name='Save reviewed reference',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Listen from note 1',exact=True).click()
    page.wait_for_function("document.querySelector('video')?.currentTime > .7")
    page.locator('video').evaluate('video=>video.pause()')
    for width,height in [(390,844),(1280,900)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(RESULTS/f'music-review-{width}.png'),full_page=True)
    confirm.check()
    page.get_by_role('button',name='Save reviewed reference',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('Temporary save failure')
    expect(page.get_by_label('Note 1 pitch',exact=True)).to_have_value('62')
    page.get_by_role('button',name='Save reviewed reference',exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Reviewed piano')
    assert len(saves)==2 and page.evaluate('window.deviceRequests')==[]
    assert saves[1]['assessment']['assessment']=='notes' and saves[1]['assessment']['input_modes']==['midi']
    # A guitar review defaults to watch-only and cannot select the piano-only policy.
    state['reviewed']=False
    draft['subject']='guitar';draft['instrument']={'instrument':'guitar'}
    page.goto(review_url)
    expect(page.get_by_role('radio',name='Watch only — no feedback',exact=True)).to_be_checked()
    expect(page.get_by_role('radio',name='MIDI note feedback (unscored)',exact=True)).to_be_disabled()
    assert errors==[],errors
    browser.close()
print('PASS: existing feed entry, deep-link refresh, video review, corrected notes/sections, confirmation reset, save retry and private preview; no device requests.')
