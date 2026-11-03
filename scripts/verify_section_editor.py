"""Verify viewport fit, shared preview frames and the marker editing/save workflow."""
import copy,json,math
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8001'
original=json.load(urlopen(BASE+'/api/demo'))
original.update(lesson_id='marker-qa',revision_id='qa-v1',title='Taegeuk 1 · movement sections',presentation={})
original['section_set']['sections']=[{'id':'start','label':'Full movement','start':0,'end':original['duration']}]
for field in ('animation','landmarks','source_video','thumbnail','focused_video'):
    if original.get(field):original[field]['key']='lessons/marker-qa/'+original[field]['key'].split('/')[-1]
out=ROOT/'test-results/section-editor';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='chrome')
    for width,height in [(1440,900),(390,844),(320,568),(320,480),(844,390)]:
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
        current=copy.deepcopy(original);calls=[];errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        def route(r):
            path=urlparse(r.request.url).path
            if '/assets/' in path:return r.fulfill(response=r.fetch(url=BASE+'/api/demo/assets/'+path.split('/')[-1]))
            if path=='/api/auth/session':value={'account':{'id':'qa','email':'qa@example.test','platform_role':'member','status':'active','mfa_enrolled':False},'csrf':'qa'}
            elif path=='/api/demo':return r.fulfill(status=404,json={'detail':'No demo in fixture'})
            elif path=='/api/lessons':value=[current]
            elif path=='/api/lessons/marker-qa':value=current
            elif path=='/api/lessons/marker-qa/sections':
                body=r.request.post_data_json;calls.append(body)
                current.update(title=body['title'],revision_id='qa-v2')
                current['section_set']['sections']=body['sections'];value=current
            elif path=='/api/workflow/lessons':value={'lessons':[{'lesson_id':'marker-qa','latest_revision_id':current['revision_id'],'accepted_revision_id':None,'audiences':{'direct':0,'groups':0,'public':False}}]}
            elif path=='/api/shared-lessons':value=[]
            elif path=='/api/conversions':value={'jobs':[]}
            elif path=='/api/capabilities':value={'camera_calibration':True}
            else:return r.fulfill(status=404,json={'detail':'Unavailable in fixture'})
            r.fulfill(json=value)
        page.route('**/api/**',route)
        page.goto(BASE+'/?page=review&id=marker-qa')
        expect(page.get_by_role('region',name='Section marker editor')).to_be_visible()
        expect(page.locator('.section-preview .instructor-video')).to_be_visible()
        page.wait_for_timeout(1000)
        size=page.evaluate('({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth})')
        assert size['height']<=height+1 and size['width']<=width+1,(width,height,size)
        for selector in ['.section-preview','.section-edit-dock','.studio-save','.section-add-marker']:
            box=page.locator(selector).bounding_box()
            assert box and box['y']>=0 and box['y']+box['height']<=height+1,(width,height,selector,box)
        assert page.locator('input[type=range]').count()==0
        assert page.locator('.marker-track').count()==1
        playhead=page.get_by_role('slider',name='Preview position',exact=True)
        def seek_frames(frames):
            playhead.press('Home')
            remaining=round(frames-float(playhead.get_attribute('aria-valuenow'))*15)
            arrow='ArrowRight' if remaining>=0 else 'ArrowLeft'
            for _ in range(abs(remaining)//10):playhead.press('Shift+'+arrow)
            for _ in range(abs(remaining)%10):playhead.press(arrow)
        assert page.locator('.marker-pin').count()==0
        expect(page.locator('.marker-playhead')).to_be_visible()
        expect(page.get_by_role('button',name='Select section 1',exact=True)).to_be_visible()
        assert page.locator('.marker-list>button').count()==1
        preview=page.locator('.section-preview').bounding_box();dock=page.locator('.section-edit-dock').bounding_box()
        assert abs(preview['x']-dock['x'])<1 and abs(preview['width']-dock['width'])<1
        assert dock['y']>=preview['y']+preview['height']
        expect(page.locator('.section-add-marker')).to_be_disabled()
        seek_frames(75)
        expect(page.locator('.section-add-marker')).to_be_enabled()
        page.screenshot(path=str(out/f'{width}x{height}-empty.png'))
        page.locator('.section-add-marker').click()
        expect(page.get_by_role('textbox',name='Section name',exact=True)).to_have_value('1')
        first=page.get_by_role('slider',name='Marker 1 position',exact=True)
        expected=5
        assert abs(float(first.get_attribute('aria-valuenow'))-expected)<.001
        expect(playhead).to_be_visible()
        assert float(playhead.get_attribute('aria-valuenow'))==expected
        expect(page.locator('.section-add-marker')).to_be_disabled()
        assert page.locator('.marker-list>button').count()==2
        # The final section is a first-class tile, with its own confined blue line and playback.
        page.get_by_role('button',name='Select timeline section 2',exact=True).click()
        expect(page.get_by_role('button',name='Select section 2',exact=True)).to_have_attribute('aria-pressed','true')
        active=page.locator('.marker-clip-section.is-active')
        assert abs(float(active.get_attribute('data-start'))-expected)<.001
        assert float(active.get_attribute('data-end'))==original['duration']
        expect(page.get_by_role('spinbutton',name='Section end time',exact=True)).to_be_disabled()
        playhead.press('Home');playhead.press('Shift+ArrowLeft')
        assert abs(float(playhead.get_attribute('aria-valuenow'))-expected)<.001
        playhead.press('End');playhead.press('Shift+ArrowRight')
        assert abs(float(playhead.get_attribute('aria-valuenow'))-original['duration'])<.001
        playhead.press('ArrowLeft')
        page.get_by_role('button',name='Play preview',exact=True).click()
        expect(page.get_by_role('button',name='Play preview',exact=True)).to_be_visible(timeout=3000)
        assert abs(float(playhead.get_attribute('aria-valuenow'))-original['duration'])<.001
        page.screenshot(path=str(out/f'{width}x{height}-final-section.png'))
        page.get_by_role('button',name='Select section 1',exact=True).click()
        playhead.press('End');playhead.press('Shift+ArrowRight')
        assert abs(float(playhead.get_attribute('aria-valuenow'))-expected)<.001
        playhead.press('Home');playhead.press('Shift+ArrowLeft')
        assert float(playhead.get_attribute('aria-valuenow'))==0
        page.get_by_role('spinbutton',name='Section end time',exact=True).fill('2')
        page.get_by_role('spinbutton',name='Section end time',exact=True).press('Enter')
        page.get_by_role('button',name='Select section 2',exact=True).click()
        seek_frames(90)
        page.locator('.section-add-marker').click()
        second=page.get_by_role('slider',name='Marker 2 position',exact=True)
        assert abs(float(second.get_attribute('aria-valuenow'))-6)<.001
        assert 2<=float(playhead.get_attribute('aria-valuenow'))<=float(second.get_attribute('aria-valuenow'))
        expect(page.get_by_role('textbox',name='Section name',exact=True)).to_have_value('2')
        page.get_by_role('textbox',name='Section name',exact=True).fill('Turn and block')
        page.get_by_role('spinbutton',name='Section end time',exact=True).fill('3.4')
        page.get_by_role('slider',name='Marker 2 position',exact=True).press('ArrowLeft')
        assert abs(float(playhead.get_attribute('aria-valuenow'))-50/15)<.001
        # Both visual representations resolve to the same frame after a switch.
        page.get_by_role('button',name='Show 3D animation',exact=True).click()
        page.wait_for_function('frame=>document.querySelector(".motion-render")?.dataset.referenceFrame===String(frame)',arg=round((original.get('animation_start',0)+50/15)*15))
        page.get_by_role('button',name='Show segmented video',exact=True).click()
        offset=original.get('focused_video_start')
        if offset is None:offset=original.get('source_start',0)
        page.wait_for_function('t=>{const v=document.querySelector(".instructor-video");return v&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-t)<.0001}',arg=offset+50/15)
        page.get_by_role('button',name='Select section 1',exact=True).click()
        pin=page.get_by_role('slider',name='Marker 1 position',exact=True)
        box=pin.bounding_box();track=page.locator('.marker-track').bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
        page.mouse.move(track['x']+track['width']*2/original['duration'],box['y']+box['height']/2,steps=8)
        # The inspector time and preview change before the pin is released.
        expect(page.get_by_role('spinbutton',name='Section end time',exact=True)).to_have_value('2')
        assert abs(float(playhead.get_attribute('aria-valuenow'))-2)<.08
        page.mouse.up()
        assert abs(float(pin.get_attribute('aria-valuenow'))-2)<.08
        page.get_by_role('button',name='Remove section boundary',exact=True).click()
        expect(page.get_by_role('slider',name='Marker 2 position',exact=True)).to_have_count(0)
        page.get_by_role('button',name='Select section 1',exact=True).click()
        page.get_by_role('textbox',name='Section name',exact=True).fill('Turn and block')
        page.get_by_role('button',name='Zoom timeline in',exact=True).click()
        page.get_by_role('button',name='Zoom timeline out',exact=True).click()
        # The selected boundary highlights its LEFT section, including after deletion.
        active=page.locator('.marker-clip-section.is-active')
        expect(active).to_have_attribute('data-start','0')
        assert abs(float(active.get_attribute('data-end'))-50/15)<.001
        boundary=float(page.get_by_role('slider',name='Marker 1 position',exact=True).get_attribute('aria-valuenow'))
        # Dragging the blue line previews a frame without moving a boundary or changing selection.
        seek_frames(15)
        box=playhead.bounding_box();track=page.locator('.marker-track').bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
        page.mouse.move(track['x']+track['width']*2/original['duration'],box['y']+box['height']/2,steps=5);page.mouse.up()
        assert abs(float(playhead.get_attribute('aria-valuenow'))-2)<.08
        assert float(page.get_by_role('slider',name='Marker 1 position',exact=True).get_attribute('aria-valuenow'))==boundary
        expect(page.get_by_role('button',name='Select section 1',exact=True)).to_have_attribute('aria-pressed','true')
        seek_frames(49)
        page.get_by_role('button',name='Play preview',exact=True).click()
        expect(page.get_by_role('button',name='Play preview',exact=True)).to_be_visible(timeout=3000)
        assert abs(float(playhead.get_attribute('aria-valuenow'))-50/15)<.001
        # Playing at the boundary restarts the highlighted section, rather than the next section.
        page.get_by_role('button',name='Play preview',exact=True).click()
        page.wait_for_timeout(250)
        page.get_by_role('button',name='Pause preview',exact=True).click()
        assert float(playhead.get_attribute('aria-valuenow'))<1
        page.get_by_role('button',name='Next frame',exact=True).click()
        page.get_by_role('button',name='Previous frame',exact=True).click()
        page.screenshot(path=str(out/f'{width}x{height}.png'))
        page.get_by_role('button',name='Save',exact=True).click()
        expect(page.get_by_role('button',name='Save',exact=True)).to_be_disabled()
        assert len(calls)==1,calls
        saved=calls[0]
        assert saved['base_revision_id']=='qa-v1' and len(saved['sections'])==2,saved
        assert saved['sections'][0]['end']==saved['sections'][1]['start']
        assert saved['sections'][0]['label']=='Turn and block'
        assert saved['sections'][1]['end']==original['duration']
        # Clicking blocks selects sections; clicking the ruler above the selection seeks.
        track=page.locator('.marker-track').bounding_box()
        seek_frames(0)
        before=float(playhead.get_attribute('aria-valuenow'))
        clip=page.get_by_role('button',name='Select timeline section 1',exact=True)
        clip_x=clip.bounding_box()['width']-2
        page.get_by_role('button',name='Select timeline section 1',exact=True).click(position={'x':clip_x,'y':20})
        assert float(playhead.get_attribute('aria-valuenow'))==before
        page.get_by_role('button',name='Select timeline section 2',exact=True).click()
        expect(page.get_by_role('button',name='Select section 2',exact=True)).to_have_attribute('aria-pressed','true')
        assert abs(float(playhead.get_attribute('aria-valuemin'))-50/15)<.001
        page.get_by_role('button',name='Select timeline section 1',exact=True).click(position={'x':2,'y':20})
        ruler=page.locator('.marker-seek-surface')
        ruler.click(position={'x':track['width']/original['duration'],'y':6})
        assert abs(float(playhead.get_attribute('aria-valuenow'))-1)<.001
        ruler.click(position={'x':track['width']*.8,'y':6})
        assert abs(float(playhead.get_attribute('aria-valuenow'))-1)<.001
        expect(page.get_by_role('button',name='Select section 1',exact=True)).to_have_attribute('aria-pressed','true')
        assert page.locator('.marker-pin').count()==1
        assert '\ufffd' not in page.locator('.marker-track-caption').inner_text()
        # Optional labels, keyboard insertion and long lists remain usable on phones.
        for frame in [90,120,150,180,210,240,270,300]:
            page.locator('.marker-list>button').last.click()
            seek_frames(frame)
            playhead.press('m')
        expect(page.get_by_role('button',name='Select section 9',exact=True)).to_be_visible()
        assert page.locator('.marker-list>button').count()==10
        expect(page.get_by_role('button',name='Select section 10',exact=True)).to_be_attached()
        name=page.get_by_role('textbox',name='Section name',exact=True)
        name.fill('');page.get_by_role('spinbutton',name='Section end time',exact=True).focus()
        expect(name).to_have_value('9')
        marker_time=page.get_by_role('spinbutton',name='Section end time',exact=True)
        previous=marker_time.input_value()
        marker_time.fill('0');marker_time.press('Escape');marker_time.press('Tab')
        expect(marker_time).to_have_value(previous)
        marker_time.fill(str(round(float(previous)-1/15,4)));marker_time.press('Enter')
        assert float(marker_time.input_value())<float(previous)
        assert float(playhead.get_attribute('aria-valuemin'))<=float(playhead.get_attribute('aria-valuenow'))<=float(playhead.get_attribute('aria-valuemax'))
        # Removing all boundaries restores the full-video preview range.
        for _ in range(9):
            page.get_by_role('button',name='Remove section boundary',exact=True).click()
        expect(playhead).to_be_visible()
        expect(playhead).to_have_attribute('aria-valuemin','0')
        assert page.locator('.marker-pin').count()==0
        size=page.evaluate('({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth})')
        assert size['height']<=height+1 and size['width']<=width+1,(width,height,size)
        page.screenshot(path=str(out/f'{width}x{height}-many-markers.png'))
        assert not errors,errors
        print(f'{width}x{height}: viewport fitted; video/3D frames match; add, drag, step, remove and save passed',flush=True)
        page.unroute_all(behavior='ignoreErrors')
        page.close()
    browser.close()
