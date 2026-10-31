"""Looping publisher preview and navigation checks. Local media, no real camera."""
import json,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
manifest.update(title='Taegeuk 1',source_start=3,duration=2,creator_name='Form Studio',description='Learn the sequence, then make it yours.')
manifest['section_set']['duration']=2
manifest['source_video']={'key':'fixture/demonstration.webm','mime':'video/mp4','bytes':1763462,'sha256':'0'*64}
manifest['thumbnail']={'key':'fixture/thumbnail.jpg','mime':'image/jpeg','bytes':100,'sha256':'0'*64}
fixture=ROOT/'test-results/preview-fixture.webm'
if not fixture.exists():
 fixture.parent.mkdir(exist_ok=True)
 subprocess.run(['ffmpeg','-v','error','-i',str(ROOT/'web/dist/assets/demonstration.mp4'),'-t','8','-an','-vf','scale=640:-2','-c:v','libvpx','-b:v','500k','-y',str(fixture)],check=True)
mode={'missing':False,'broken':False};camera=[];requests=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':390,'height':844})
 page.set_default_timeout(15000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("window.cameraStarts=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraStarts++;throw new Error('Test camera');};")
 def api(route):
  path=route.request.url.split('/api/',1)[1];requests.append(path)
  if path=='auth/session':route.fulfill(status=401,json={'detail':'Sign in'})
  elif path=='demo':route.fulfill(json={**manifest,'source_video':None} if mode['missing'] else manifest)
  elif path.endswith('demonstration.webm'):
   if mode['broken']:route.fulfill(status=404,body='Missing')
   else:route.fulfill(path=str(fixture),content_type='video/webm')
  elif path.endswith('thumbnail.jpg'):route.fulfill(path=str(ROOT/'web/dist/assets/thumbnail.jpg'))
  elif path.startswith('demo/assets/'):route.fulfill(path=str(ROOT/'packages/lesson-schema'/path.rsplit('/',1)[-1]))
  elif path.startswith('public/moves'):route.fulfill(json={'moves':[]})
  else:route.fulfill(status=404,json={'detail':'Not found'})
 page.route('**/api/**',api)
 url=os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5195')+'/?page=preview&id=synthetic-lesson&source=demo'
 page.goto(url,wait_until='domcontentloaded')
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 page.wait_for_function("document.querySelector('.preview-media video')?.readyState>=2 && !document.querySelector('.preview-media video').paused")
 expect(page.locator('.preview-media video')).to_have_class('is-ready')
 expect(page.locator('.preview-media video')).to_have_css('opacity','1')
 assert not any(name.endswith('.glb') for name in requests)
 assert page.evaluate('cameraStarts')==0
 for selector in ['.mimic-transport','.mimic-shortcuts','.mimic-scrub','.mimic-section-link','canvas']:
  expect(page.locator(selector)).to_have_count(0)
 assert page.locator('video').evaluate('v=>v.muted')
 page.locator('video').evaluate('v=>v.currentTime=4.98')
 page.wait_for_function("document.querySelector('video').currentTime>=3 && document.querySelector('video').currentTime<3.5")
 page.get_by_role('button',name='Pause preview',exact=True).click()
 expect(page.get_by_role('button',name='Play preview',exact=True)).to_be_visible()
 t=page.locator('video').evaluate('v=>v.currentTime');page.wait_for_timeout(200)
 assert abs(page.locator('video').evaluate('v=>v.currentTime')-t)<.05
 page.get_by_role('button',name='Unmute preview',exact=True).click()
 assert not page.locator('video').evaluate('v=>v.muted')
 for w,h in [(390,844),(320,480),(812,375),(1280,800)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  for label in ['Lets Practice','Lets Compete']:
   box=page.get_by_role('button',name=label,exact=True).bounding_box();assert box and box['y']>=0 and box['y']+box['height']<=h,(w,label,box)
  page.screenshot(path=str(ROOT/f'test-results/publisher-preview-{w}.png'))
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_role('button',name='Lets Practice',exact=True).click()
 expect(page.get_by_role('button',name='Start practice',exact=True)).to_be_visible()
 expect(page.locator('.preview-media video')).to_have_count(0)
 assert page.evaluate('cameraStarts')==0
 expect(page.locator('.motion-host canvas')).to_be_visible()
 page.get_by_role('button',name='Exit',exact=True).click()
 expect(page.get_by_role('button',name='Lets Compete',exact=True)).to_be_visible()
 page.wait_for_function("document.querySelector('video')?.readyState>=2 && document.querySelector('video').currentTime>=3")
 assert page.locator('video').evaluate('v=>v.currentTime')>=3
 page.get_by_role('button',name='Lets Compete',exact=True).click()
 expect(page.get_by_role('button',name='Prepare to compete',exact=True)).to_be_visible()
 assert page.evaluate('cameraStarts')==0
 expect(page.locator('.mimic-shell')).to_have_class(re.compile('mode-compete'))
 page.go_back()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 mode['missing']=True;page.goto(url,wait_until='domcontentloaded')
 expect(page.get_by_text('Video preview unavailable',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_be_visible()
 expect(page.locator('canvas')).to_have_count(0)
 mode['missing']=False;mode['broken']=True;page.goto(url,wait_until='domcontentloaded')
 expect(page.get_by_text('Video preview unavailable',exact=True)).to_be_visible()
 assert not errors,errors
 browser.close()
print('PASS: original video only; bounded continuous loop; pause/mute; no camera or 3D on preview; separate session routes; preview return; unavailable/broken media; mobile/desktop layout.')

