"""Exercise review layout at phone, desktop and landscape sizes with isolated API fixtures."""
import copy,json,re
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8001'
original=json.load(urlopen(BASE+'/api/demo'))
original.update(lesson_id='review-qa',revision_id='review-qa-v1',title='Movement review')
for field in ('animation','landmarks','source_video','thumbnail','focused_video'):
    if original.get(field): original[field]['key']='lessons/review-qa/'+original[field]['key'].split('/')[-1]
original['presentation']={}
out=ROOT/'test-results/review-trim';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='chrome')
    for width,height in [(1440,900),(390,844),(320,568),(844,390)]:
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
        current=copy.deepcopy(original);calls=[];errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        def route(r):
            path=urlparse(r.request.url).path
            if '/assets/' in path:
                name=path.split('/')[-1]
                return r.fulfill(response=r.fetch(url=BASE+'/api/demo/assets/'+name))
            if path=='/api/auth/session': value={'account':{'id':'qa','email':'qa@example.test','platform_role':'member','status':'active','mfa_enrolled':False},'csrf':'qa'}
            elif path=='/api/demo': return r.fulfill(status=404,json={'detail':'No demo in fixture'})
            elif path=='/api/lessons': value=[current]
            elif path=='/api/lessons/review-qa': value=current
            elif path=='/api/workflow/lessons': value={'lessons':[{'lesson_id':'review-qa','latest_revision_id':current['revision_id'],'accepted_revision_id':None,'audiences':{'direct':0,'groups':0,'public':False}}]}
            elif path=='/api/shared-lessons': value=[]
            elif path=='/api/lessons/review-qa/trim':
                body=r.request.post_data_json;calls.append(body)
                start=body['start_frame']/15;end=body['end_frame']/15
                current.update(revision_id='qa-trimmed',duration=end-start,source_start=original['source_start']+start,focused_video_start=(original.get('focused_video_start') if original.get('focused_video_start') is not None else original['source_start'])+start,animation_start=(original.get('animation_start') or 0)+start,animation_duration=original['duration'])
                current['section_set']={'id':'qa','revision':2,'duration':end-start,'sections':[{'id':'a','label':'Move','start':0,'end':end-start}]}
                value=current
            elif path=='/api/conversions': value={'jobs':[]}
            elif path=='/api/capabilities': value={'camera_calibration':True}
            else: return r.fulfill(status=404,json={'detail':'Unavailable in fixture'})
            r.fulfill(json=value)
        page.route('**/api/**',route)
        page.goto(BASE+'/?page=check&id=review-qa')
        expect(page.get_by_role('heading',name='Movement review',exact=True)).to_be_visible()
        expect(page.get_by_role('button',name='Looks good',exact=True)).to_be_visible()
        page.wait_for_timeout(1800)
        controls=['Clip start','Clip end','Preview position']
        for name in controls:
            box=page.get_by_role('slider',name=name,exact=True).bounding_box()
            assert box and box['y']>=0 and box['y']+box['height']<=height+1,(width,height,name,box)
        for name in ['Looks good','Choose another video']:
            box=page.get_by_role('button',name=name,exact=True).bounding_box()
            assert box and box['y']+box['height']<=height+1,(width,height,name,box)
        size=page.evaluate('({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
        assert size['scroll']<=height+1 and size['scrollWidth']<=width+1,(width,height,size)
        expect(page.locator('.check-stage .instructor-video')).to_be_visible()
        expect(page.get_by_role('button',name='Show segmented instructor')).to_have_attribute('aria-pressed','true')
        expect(page.locator('.timeline-filmstrip img')).to_have_count(10,timeout=15000)
        page.screenshot(path=str(out/f'{width}x{height}-full.png'))
        start_handle=page.get_by_role('slider',name='Clip start',exact=True)
        end_handle=page.get_by_role('slider',name='Clip end',exact=True)
        track=page.locator('.timeline-track').bounding_box()
        start_box=start_handle.bounding_box()
        page.mouse.move(start_box['x']+start_box['width']/2,start_box['y']+start_box['height']/2)
        page.mouse.down()
        page.mouse.move(track['x']+track['width']*.2,start_box['y']+start_box['height']/2,steps=8)
        page.mouse.up()
        assert float(start_handle.get_attribute('aria-valuenow'))>0
        assert abs(float(end_handle.get_attribute('aria-valuenow'))-original['duration'])<.00001
        # One arrow key moves exactly one reconstructed frame.
        start_handle.press('Home')
        for _ in range(15): start_handle.press('ArrowRight')
        end_handle.press('Home')
        for _ in range(44): end_handle.press('ArrowRight')
        assert abs(float(start_handle.get_attribute('aria-valuenow'))-1)<.001
        assert abs(float(end_handle.get_attribute('aria-valuenow'))-4)<.001
        playhead=page.get_by_role('slider',name='Preview position',exact=True)
        playhead.press('Home')
        focused_start=original.get('focused_video_start')
        if focused_start is None:focused_start=original['source_start']
        page.wait_for_function("target=>{const v=document.querySelector('.check-stage .instructor-video');return v&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-target)<.0001;}",arg=focused_start+1)
        page.get_by_role('button',name='Show 3D move',exact=True).click()
        expect(page.locator('.motion-render canvas')).to_be_visible()
        page.wait_for_function("frame=>document.querySelector('.motion-render')?.dataset.referenceFrame===String(frame)",arg=round(((original.get('animation_start') or 0)+1)*15))
        assert float(playhead.get_attribute('aria-valuenow'))==1
        page.get_by_role('button',name='Show segmented instructor',exact=True).click()
        page.wait_for_function("target=>{const v=document.querySelector('.check-stage .instructor-video');return v&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-target)<.0001;}",arg=focused_start+1)
        assert float(start_handle.get_attribute('aria-valuenow'))==1 and float(end_handle.get_attribute('aria-valuenow'))==4
        assert page.locator('input[type=range],input[type=number]').count()==0
        expect(page.locator('.timeline-filmstrip img')).to_have_count(10,timeout=10000)
        page.get_by_role('button',name='Play selected frames').click()
        page.wait_for_timeout(350)
        page.get_by_role('button',name='Pause preview').click()
        page.get_by_role('slider',name='Preview position',exact=True).press('ArrowRight')
        page.screenshot(path=str(out/f'{width}x{height}.png'))
        page.get_by_role('button',name='Review notes',exact=False).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).not_to_be_visible()
        page.get_by_role('button',name='Looks good',exact=True).click()
        expect(page).to_have_url(re.compile('page=move'))
        assert calls==[{'base_revision_id':'review-qa-v1','start_frame':15,'end_frame':60,'accept':True}],calls
        assert not errors,errors
        print(f'{width}x{height}: filmstrip loaded, handles drag and step by frame, no scrolling, trim saved',flush=True)
        page.close()
    browser.close()
