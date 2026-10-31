"""Browser checks for the unified practice feed. No external accounts or real camera."""
import copy
import json
import os
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
BASE=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
def lesson(id,title):
 value=copy.deepcopy(BASE);value.update(lesson_id=id,title=title)
 value['animation']['key']=f'lessons/{id}/synthetic.glb'
 value['thumbnail']={'key':f'lessons/{id}/thumbnail.jpg','mime':'image/jpeg','bytes':100,'sha256':'0'*64}
 return value
own=[lesson('own-ready','Taegeuk 1 · Full sequence'),lesson('own-check','Footwork · First steps')]
shared=[lesson('shared-1','Balance and control')]
public=[{'lesson_id':f'public-{i}','title':f'Flow practice {i+1}','creator_name':['Maya Chen','Alex Tan','Form Studio'][i%3],'description':'','tags':['Movement','Foundations'],'duration':42+i,'thumbnail_url':None if i%3==1 else '/api/test-thumbnail'} for i in range(25)]
# One public post is also owned: the mixed feed should show it once.
public[0]['lesson_id']='own-ready'
public[0]['title']=own[0]['title']
account={'id':'tester','email':'test@example.test','platform_role':'member','status':'active','mfa_enrolled':False}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':390,'height':844})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 mode={'signed_in':True,'public_error':False,'empty':False}
 def api(route):
  parsed=urlparse(route.request.url);path=parsed.path.split('/api/',1)[1];query=parse_qs(parsed.query)
  if path=='auth/session':route.fulfill(json={'account':account,'csrf':'test'}) if mode['signed_in'] else route.fulfill(status=401,json={'detail':'Sign in'})
  elif path=='demo':route.fulfill(status=404,json={'detail':'No demo'})
  elif path=='lessons':route.fulfill(json=[] if mode['empty'] else own)
  elif path=='shared-lessons':route.fulfill(json=[] if mode['empty'] else shared)
  elif path=='workflow/lessons':route.fulfill(json={'lessons':[{'lesson_id':v['lesson_id'],'accepted_revision_id':v['revision_id'] if i==0 else None,'latest_revision_id':v['revision_id'],'audiences':{'direct':0,'groups':0,'public':i==0}} for i,v in enumerate(own)]})
  elif path=='conversions':route.fulfill(json={'jobs':[],'worker_online':True})
  elif path=='public/moves':
   if mode['public_error']:route.fulfill(status=503,json={'detail':'Public unavailable'});return
   q=query.get('q',[''])[0].lower();offset=int(query.get('offset',['0'])[0]);items=[] if mode['empty'] else [v for v in public if q in (v['title']+' '+v['creator_name']).lower()]
   route.fulfill(json={'moves':items[offset:offset+24]})
  elif path.startswith('public/moves/') and '/assets/' not in path:
   id=path.rsplit('/',1)[-1];value=lesson(id,next(v['title'] for v in public if v['lesson_id']==id));value['animation']['key']=f'public/{id}/synthetic.glb';route.fulfill(json=value)
  elif path.endswith('synthetic.glb'):route.fulfill(path=str(ROOT/'packages/lesson-schema/synthetic.glb'))
  elif path.endswith('synthetic-landmarks.json'):route.fulfill(path=str(ROOT/'packages/lesson-schema/synthetic-landmarks.json'))
  elif path.endswith('thumbnail.jpg') or path=='test-thumbnail':route.fulfill(path=str(ROOT/'web/dist/assets/thumbnail.jpg'))
  elif path.startswith('lessons/') and path.count('/')==1:
   id=path.split('/')[1];route.fulfill(json=next(v for v in own+shared if v['lesson_id']==id))
  elif path.endswith('/progress'):route.fulfill(json={})
  else:route.fulfill(status=404,json={'detail':'Not found'})
 page.route('**/api/**',api)
 page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5195')+'/')
 expect(page.locator('.feed-card-public')).to_have_count(23)
 expect(page.locator('.feed-card-own')).to_have_count(2)
 expect(page.locator('.feed-card-shared')).to_have_count(1)
 expect(page.get_by_role('button',name='Open Taegeuk 1 · Full sequence',exact=True)).to_have_count(1)
 for w,h in [(390,844),(320,568),(768,1024),(1440,900)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(w,'horizontal overflow')
  first=page.locator('.feed-thumbnail').first.bounding_box();assert first and first['y']<300,(w,first)
  nav=page.get_by_role('navigation',name='Main navigation').bounding_box();assert nav and nav['y']>=0 and nav['y']+nav['height']<=h+1,(w,nav)
  page.screenshot(path=str(ROOT/f'test-results/practice-feed-{w}.png'))
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_role('button',name='Shared with me',exact=True).click()
 expect(page.locator('.feed-card')).to_have_count(1)
 page.get_by_role('button',name='Open Balance and control',exact=True).click()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 expect(page.get_by_role('button',name='Shared with me',exact=True)).to_have_attribute('aria-pressed','true')
 page.get_by_role('button',name='My practices',exact=True).click()
 page.get_by_role('button',name='Open Taegeuk 1 · Full sequence',exact=True).click()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 page.get_by_label('Options for Footwork · First steps').click()
 expect(page.get_by_role('button',name='Adjust practice',exact=True)).to_be_visible()
 page.keyboard.press('Escape')
 expect(page.get_by_role('button',name='Adjust practice',exact=True)).not_to_be_visible()
 page.get_by_role('button',name='Public',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(24)
 page.get_by_role('button',name='More practices',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(25)
 page.get_by_label('Search practices',exact=True).fill('Maya')
 expect(page.locator('.feed-card-public')).to_have_count(9)
 page.get_by_label('Clear search',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(24)
 # Returning from a card keeps source, query, loaded page and scroll position.
 page.get_by_role('button',name='More practices',exact=True).click()
 page.locator('.feed-card-public').nth(12).scroll_into_view_if_needed()
 saved_scroll=page.evaluate('scrollY')
 page.locator('.feed-card-public').nth(12).locator('.feed-thumbnail').click()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(25)
 page.wait_for_function('expected=>Math.abs(scrollY-expected)<30',arg=saved_scroll)
 # Empty personal libraries still show public practices; public failure leaves private sources usable.
 mode['empty']=True;page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5195')+'/')
 expect(page.get_by_text('Your next practice starts here',exact=True)).to_be_visible()
 mode['empty']=False;mode['public_error']=True;page.reload()
 expect(page.locator('.feed-card-own')).to_have_count(2)
 expect(page.get_by_text('Public practices couldn’t load.',exact=False)).to_be_visible()
 mode['public_error']=False;mode['signed_in']=False;page.reload()
 expect(page.locator('.feed-card-public')).to_have_count(24)
 expect(page.locator('.feed-card-own')).to_have_count(0)
 page.get_by_role('button',name='Shared with me',exact=True).click()
 expect(page.get_by_text('Sign in to see your practices and anything shared with you.',exact=True)).to_be_visible()
 assert not errors,errors
 browser.close()
print('PASS: mixed-source feed; deduplication; source filters; search; pagination; card menus; direct practice entry; return state and scroll; empty states; partial failure; signed-out access; mobile/tablet/desktop layout.')

