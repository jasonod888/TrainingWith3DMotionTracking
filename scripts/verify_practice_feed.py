"""Browser checks for the unified practice feed. No external accounts or real camera."""
import copy
import json
import os
import re
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
 mode={'signed_in':True,'public_error':False,'empty':False,'jobs':[]}
 def api(route):
  parsed=urlparse(route.request.url);path=parsed.path.split('/api/',1)[1];query=parse_qs(parsed.query)
  if path=='auth/session':route.fulfill(json={'account':account,'csrf':'test'}) if mode['signed_in'] else route.fulfill(status=401,json={'detail':'Sign in'})
  elif path=='demo':route.fulfill(status=404,json={'detail':'No demo'})
  elif path=='lessons':route.fulfill(json=[] if mode['empty'] else own)
  elif path=='shared-lessons':route.fulfill(json=[] if mode['empty'] else shared)
  elif path=='workflow/lessons':route.fulfill(json={'lessons':[{'lesson_id':v['lesson_id'],'accepted_revision_id':v['revision_id'] if i==0 else None,'latest_revision_id':v['revision_id'],'audiences':{'direct':0,'groups':0,'public':i==0}} for i,v in enumerate(own)]})
  elif path=='conversions':route.fulfill(json={'jobs':mode['jobs'],'worker_online':True})
  elif path=='groups':
   if route.request.method=='POST':
    new_group={'id':'test-group','role':'owner','members':1,'moves':0,**route.request.post_data_json}
    mode.setdefault('groups',[]).append(new_group)
    route.fulfill(json=new_group)
   else:route.fulfill(json={'groups':mode.get('groups',[])})
  elif path=='groups/test-group':
   route.fulfill(json={**mode['groups'][0],'can_manage':True,'contribution_policy':'members','members':[],'moves':[],'invitations':[]})
  elif path=='public/tags':route.fulfill(json={'tags':[{'tag':'Foundations','count':25}]})
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
 for w,h in [(390,844),(320,568),(550,844),(760,844),(768,1024),(1100,800),(1280,800),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(w,'horizontal overflow')
  first=page.locator('.feed-thumbnail').first.bounding_box();assert first and first['y']<150,(w,first)
  nav=page.get_by_role('navigation',name='Main navigation').bounding_box();assert nav and nav['y']>=0 and nav['y']+nav['height']<=h+1,(w,nav)
  page.screenshot(path=str(ROOT/f'test-results/practice-feed-{w}.png'))
 # The browse pages share the shell and keep results close to the header.
 for width,height in [(1440,900),(900,800),(390,844)]:
  page.set_viewport_size({'width':width,'height':height})
  page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Explore',exact=True).click()
  expect(page.locator('.explore-screen')).to_be_visible()
  expect(page.locator('.explore-screen .feed-card')).to_have_count(24)
  first=page.locator('.explore-screen .feed-thumbnail').first.bounding_box()
  assert first['y']<150 and first['x']==page.locator('.explore-screen').bounding_box()['x']
  page.screenshot(path=str(ROOT/f'test-results/explore-{width}.png'))
  if width<=760:
   page.get_by_role('button',name='Open search',exact=True).click()
   expect(page.get_by_role('searchbox',name='Search public moves')).to_be_focused()
  search=page.get_by_role('searchbox',name='Search public moves')
  search.fill('Maya')
  expect(page.locator('.explore-screen .feed-card')).to_have_count(9)
  search.fill('no matching creator')
  expect(page.get_by_role('heading',name='No matching moves')).to_be_visible()
  page.get_by_role('button',name='Reset filters').click()
  expect(page.locator('.explore-screen .feed-card')).to_have_count(24)
  if width<=760:page.get_by_role('button',name='Close search',exact=True).click()
  page.get_by_role('button',name='Foundations',exact=True).click()
  expect(page.get_by_role('button',name='Foundations',exact=True)).to_have_attribute('aria-pressed','true')
  page.get_by_role('button',name='Groups',exact=True).click()
  expect(page.get_by_role('heading',name='No groups yet')).to_be_visible()
  page.screenshot(path=str(ROOT/f'test-results/groups-{width}.png'))
  page.get_by_role('button',name='Create a group',exact=True).click()
  expect(page.get_by_label('Group name')).to_be_focused()
  page.get_by_label('Group name').fill('Tuesday practice')
  if width<=760:
   page.get_by_role('button',name='Create group',exact=True).click()
   expect(page.get_by_role('heading',name='Tuesday practice')).to_be_visible()
   page.get_by_role('button',name='Groups',exact=True).last.click()
   expect(page.locator('.group-card')).to_contain_text('Tuesday practice')
  else:page.get_by_role('button',name='Cancel',exact=True).click()
  assert page.locator('.header').bounding_box()['height']==(56 if width<=760 else 60)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.get_by_role('button',name='Your account',exact=True).click()
  expect(page.locator('.account-card')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  if width<=760: page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Create',exact=True).click()
  else: page.get_by_role('button',name='Create a practice',exact=True).click()
  expect(page.locator('.create-screen')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Home',exact=True).click()
  expect(page.locator('.feed-header-search')).to_be_visible()
 # The desktop rail can expand without covering content or changing search.
 page.set_viewport_size({'width':1440,'height':900})
 page.get_by_role('button',name='Collapse sidebar',exact=True).click()
 expect(page.locator('.feed-app')).to_have_class(re.compile('sidebar-compact'))
 assert page.locator('main').bounding_box()['x']==80
 page.get_by_role('button',name='Expand sidebar',exact=True).click()
 assert page.locator('main').bounding_box()['x']==200
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_role('button',name='Shared with me',exact=True).click()
 expect(page.locator('.feed-card')).to_have_count(1)
 page.get_by_role('button',name='Open Balance and control',exact=True).click()
 expect(page.get_by_role('button',name='Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 expect(page.get_by_role('button',name='Shared with me',exact=True)).to_have_attribute('aria-pressed','true')
 page.get_by_role('button',name='My practices',exact=True).click()
 page.get_by_role('button',name='Open Taegeuk 1 · Full sequence',exact=True).click()
 expect(page.get_by_role('button',name='Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 page.get_by_label('Options for Footwork · First steps').click()
 expect(page.get_by_role('button',name='Adjust practice',exact=True)).to_be_visible()
 page.keyboard.press('Escape')
 expect(page.get_by_role('button',name='Adjust practice',exact=True)).not_to_be_visible()
 page.get_by_role('button',name='Public',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(24)
 page.get_by_role('button',name='More practices',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(25)
 page.get_by_role('button',name='Open search',exact=True).click()
 expect(page.get_by_label('Search practices',exact=True)).to_be_focused()
 page.screenshot(path=str(ROOT/'test-results/practice-feed-mobile-search.png'))
 page.get_by_label('Search practices',exact=True).fill('Maya')
 expect(page.locator('.feed-card-public')).to_have_count(9)
 page.keyboard.press('Escape')
 expect(page.get_by_label('Search practices',exact=True)).not_to_be_visible()
 expect(page.get_by_role('button',name='Open search',exact=True)).to_be_focused()
 expect(page.locator('.feed-card-public')).to_have_count(9)
 page.get_by_role('button',name='Open search',exact=True).click()
 page.get_by_label('Clear search',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(24)
 page.get_by_role('button',name='Close search',exact=True).click()
 # Returning from a card keeps source, query, loaded page and scroll position.
 page.get_by_role('button',name='More practices',exact=True).click()
 page.locator('.feed-card-public').nth(12).scroll_into_view_if_needed()
 saved_scroll=page.evaluate('scrollY')
 page.locator('.feed-card-public').nth(12).locator('.feed-thumbnail').click()
 expect(page.get_by_role('button',name='Practice',exact=True)).to_be_visible()
 page.get_by_role('button',name='Back to feed',exact=True).click()
 expect(page.locator('.feed-card-public')).to_have_count(25)
 page.wait_for_function('expected=>Math.abs(scrollY-expected)<30',arg=saved_scroll)
 # Processing uploads must be visible without expanding a disclosure, including after reload.
 job={'id':'in-progress','title':'My new upload','filename':'clip.mp4','bytes':1234,'start':0,'duration':20,'state':'processing','attempts':1,'frames':30,'error':None,'provider':'local','processor_online':True,'retryable':False,'lesson_id':None,'parts':{},'part_size':5242880}
 mode['jobs']=[job];page.reload()
 card=page.locator('.conversion-card');expect(card).to_be_visible()
 expect(card.get_by_role('status')).to_have_text('Preparing your 3D move')
 expect(card.get_by_role('button',name='Check move')).to_have_count(0)
 expect(card.locator('.conversion-thumbnail')).to_have_attribute('aria-disabled','true')
 # Seed a saved local thumbnail, then verify it survives navigation and appears dimmed.
 import base64
 poster='data:image/jpeg;base64,'+base64.b64encode((ROOT/'web/dist/assets/thumbnail.jpg').read_bytes()).decode()
 page.evaluate("""async image=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('form-prepared-clips',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('posters','readwrite');tx.objectStore('posters').put({image,expires:Date.now()+86400000},'in-progress');tx.oncomplete=resolve;tx.onerror=reject;});db.close();}""",poster)
 page.reload();expect(card.locator('img')).to_have_count(1)
 for w,h in [(390,844),(320,568),(1440,900)]:
  page.set_viewport_size({'width':w,'height':h})
  expect(card).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(w,'upload card overflow')
  page.screenshot(path=str(ROOT/f'test-results/processing-upload-{w}.png'))
 job['state']='exporting'
 expect(card.get_by_role('status')).to_have_text('Creating your 3D move',timeout=10000)
 job.update(state='failed',error='conversion_failed',retryable=True)
 expect(card.get_by_role('button',name='Retry',exact=True)).to_be_visible(timeout=10000)
 job.update(state='ready_for_review',error=None,retryable=False,lesson_id='own-check')
 expect(card.get_by_role('button',name='Check move',exact=True)).to_be_visible(timeout=10000)
 job['state']='cancelled'
 expect(card).to_have_count(0,timeout=10000)
 mode['jobs']=[];page.set_viewport_size({'width':390,'height':844})
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

