"""Compete browser regression with a synthetic camera and local reference assets."""
import copy,json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from verify_practice_flow import MOCK
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
manifest.update(engine='sam-3d-body',duration=3,title='Mode verification')
manifest['section_set']['duration']=3
manifest['section_set']['sections']=[{'id':str(i),'label':label,'start':i,'end':i+1} for i,label in enumerate(['Opening','Middle','Finish'])]
reference=json.loads((ROOT/'web/dist/assets/reference.json').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':390,'height':844})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script(MOCK.replace('visibility:.99,presence:.99','visibility:window.poseUnclear?.1:.99,presence:.99'))
 def api(route):
  path=route.request.url.split('/api/',1)[1]
  if path=='auth/session':route.fulfill(status=401,json={'detail':'Sign in'})
  elif path=='demo':route.fulfill(json=manifest)
  elif path.endswith('synthetic-landmarks.json'):route.fulfill(json=reference)
  elif path.startswith('demo/assets/'):route.fulfill(path=str(ROOT/'packages/lesson-schema'/path.rsplit('/',1)[-1]))
  else:route.fulfill(status=404,json={'detail':'Not found'})
 page.route('**/api/**',api)
 page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5193')+'/?page=practice&id=synthetic-lesson&source=demo')
 expect(page.locator('.mimic-shell')).to_have_class(re.compile('mode-practice'))
 page.get_by_role('button',name='Section 1/3',exact=True).click()
 page.get_by_role('button',name='Middle',exact=True).click()
 page.get_by_role('button',name='1× Speed',exact=True).click()
 page.get_by_role('button',name='0.5×',exact=True).click()
 page.get_by_role('button',name='Loop off',exact=True).click()
 page.get_by_label('Repeat automatically',exact=True).check()
 page.get_by_role('button',name='Close Loop',exact=True).click()
 start=page.get_by_role('button',name='Start scored run',exact=True)
 def enter_compete():
  page.get_by_role('button',name='Exit',exact=True).click()
  expect(page.get_by_role('button',name='Lets Compete',exact=True)).to_be_visible()
  page.get_by_role('button',name='Lets Compete',exact=True).click()
  expect(page.get_by_role('button',name='Prepare to compete',exact=True)).to_be_visible()
  page.get_by_role('button',name='Prepare to compete',exact=True).click()
  expect(start).to_be_enabled(timeout=15000)
 enter_compete()
 expect(page.get_by_label('Lesson position',exact=True)).to_have_count(0)
 expect(page.get_by_role('button',name='0.5× Speed',exact=True)).to_have_count(0)
 start.click()
 expect(page.get_by_role('button',name='Lets Practice',exact=True)).to_have_count(0)
 expect(page.get_by_role('button',name='More',exact=True)).to_be_disabled()
 expect(page.get_by_role('button',name='Stop run',exact=True)).to_be_visible()
 # Keyboard navigation and speed commands cannot alter the scored run.
 page.locator('.mimic-stage').click(position={'x':5,'y':180})
 page.keyboard.press('ArrowRight')
 page.wait_for_function("document.querySelector('.is-playing')")
 page.wait_for_function("document.querySelector('.compete-progress progress').value>1.25")
 expect(page.get_by_role('dialog')).to_have_count(0)
 expect(page.locator('.mimic-context h2')).to_have_text('Middle')
 expect(page.get_by_role('dialog',name='Your run',exact=True)).to_be_visible(timeout=10000)
 score=page.locator('.compete-result-score>strong').inner_text()
 assert score.endswith('%'),score
 expect(page.locator('.compete-section-results button')).to_have_count(3)
 assert page.evaluate('captureCounts.starts')==0
 page.screenshot(path=str(ROOT/'test-results/compete-result-mobile.png'))
 page.get_by_role('button',name='Try again',exact=True).click()
 expect(page.locator('.compete-progress progress')).to_have_attribute('value','0')
 page.get_by_role('button',name='Cancel',exact=True).click()
 expect(page.get_by_role('dialog',name='Attempt stopped',exact=True)).to_be_visible()
 page.get_by_role('button',name='Return to practice',exact=True).click()
 expect(page.get_by_role('button',name='0.5× Speed',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Loop on',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Section 2/3',exact=True)).to_be_visible()
 # Low tracking must yield an unscored completion, then allow section practice.
 enter_compete()
 expect(start).to_be_enabled()
 start.click()
 page.wait_for_function("document.querySelector('.is-playing')")
 page.evaluate('window.poseUnclear=true')
 expect(page.get_by_role('dialog',name='Your run',exact=True)).to_be_visible(timeout=10000)
 expect(page.get_by_text('Not enough tracking for a reliable score',exact=True)).to_be_visible()
 expect(page.locator('.compete-result-score>strong')).to_have_text('—')
 page.get_by_role('button',name='Practise Middle',exact=True).click()
 expect(page.locator('.mimic-shell')).to_have_class(re.compile('mode-practice'))
 expect(page.get_by_role('button',name='Section 2/3',exact=True)).to_be_visible()
 # Backgrounding during countdown interrupts instead of silently resuming.
 page.evaluate('window.poseUnclear=false')
 enter_compete()
 expect(start).to_be_enabled(timeout=10000);start.click()
 page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
 expect(page.get_by_role('dialog',name='Attempt stopped',exact=True)).to_be_visible()
 expect(page.get_by_text('No competition score was recorded.',exact=False)).to_be_visible()
 assert not errors,errors
 browser.close()
print('PASS: mode defaults and restoration; full-run playback; camera readiness; locked controls; completion and section scores; no recording; countdown cancellation; low coverage; section practice; background interruption; responsive layouts.')
