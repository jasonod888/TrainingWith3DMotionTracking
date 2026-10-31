"""Browser regression for live practice and optional recording.
Run with Vite on http://127.0.0.1:5173 and Python Playwright installed.
Uses a generated canvas feed and synthetic pose messages; no real camera.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = r"""
window.captureCounts = {starts:0, streams:[]};
const NativeRecorder = window.MediaRecorder;
window.MediaRecorder = class extends NativeRecorder {
 start(...args) { window.captureCounts.starts++; return super.start(...args); }
};
navigator.mediaDevices.getUserMedia = async () => {
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
 const ctx=canvas.getContext('2d');let n=0;
 const timer=setInterval(()=>{ctx.fillStyle=n++%2?'#2b5142':'#355d4b';ctx.fillRect(0,0,640,480);ctx.fillStyle='white';ctx.fillText('Simulated live practice',200,240);},33);
 const stream=canvas.captureStream(30);window.captureCounts.streams.push(stream);
 stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
};
navigator.mediaDevices.enumerateDevices=async()=>[];
window.Worker=class {
 postMessage(data) {
  if(data.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),10);
  if(data.type==='frame'){
   data.bitmap.close();
   const image=Array.from({length:33},()=>({x:.5,y:.18,z:0,visibility:.99,presence:.99}));
   for(const [i,x,y] of [[11,.4,.3],[12,.6,.3],[23,.45,.55],[24,.55,.55],[25,.45,.72],[26,.55,.72],[27,.45,.87],[28,.55,.87],[29,.45,.88],[30,.55,.88],[31,.44,.9],[32,.56,.9]])Object.assign(image[i],{x,y});
   setTimeout(()=>this.onmessage?.({data:{type:'pose',epoch:data.epoch,landmarks:image,world:image}}),5);
  }
 }
 terminate(){this.onmessage=null;}
};
"""

def run():
 manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
 manifest['duration']=60
 manifest['section_set']['duration']=60
 manifest['section_set']['sections']=[{'id':'a','label':'Practice movement','start':0,'end':60}]
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  page=browser.new_page(viewport={'width':1280,'height':800})
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.add_init_script(MOCK)
  def api(route):
   path=route.request.url.split('/api/',1)[1]
   if path=='auth/session':route.fulfill(status=401,json={'detail':'Sign in'})
   elif path=='demo':route.fulfill(json=manifest)
   elif path.startswith('demo/assets/'):
    name=path.rsplit('/',1)[-1]
    route.fulfill(path=str(ROOT/'packages/lesson-schema'/name))
   else:route.fulfill(status=404,json={'detail':'Not found'})
  page.route('**/api/**',api)
  page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5173')+'/?page=practice&id=synthetic-lesson&source=demo')
  expect(page.get_by_role('button',name='Start practice',exact=True)).to_be_visible()
  # Mobile uses the entire viewport; settings remain contained and keyboard dismissible.
  page.set_viewport_size({'width':390,'height':844})
  expect(page.locator('.mimic-stage')).to_have_css('width','390px')
  stage=page.locator('.mimic-stage').bounding_box()
  assert stage and stage['x']==0 and stage['y']==0 and stage['height']==844, stage
  speed=page.get_by_role('button',name='1× Speed',exact=True)
  speed.click()
  sheet=page.get_by_role('dialog',name='Speed',exact=True)
  expect(sheet).to_be_visible()
  bounds=sheet.bounding_box()
  assert bounds and bounds['y']>=0 and bounds['y']+bounds['height']<=844, bounds
  page.keyboard.press('Escape')
  expect(sheet).to_have_count(0)
  expect(speed).to_be_focused()
  # Quiet secondary overlays must never hide Pause; touching the stage restores them.
  page.get_by_role('button',name='Play',exact=True).click()
  page.wait_for_function("document.querySelector('.mimic-shell').classList.contains('controls-resting')")
  expect(page.get_by_role('button',name='Pause',exact=True)).to_be_visible()
  page.locator('.mimic-stage').click(position={'x':20,'y':200})
  expect(page.locator('.mimic-shell')).not_to_have_class(re.compile(r'controls-resting'))
  page.get_by_role('button',name='Pause',exact=True).click()
  page.set_viewport_size({'width':1280,'height':800})
  assert page.get_by_role('button',name='Record practice',exact=True).count()==0
  page.get_by_role('button',name='Start practice',exact=True).click()
  expect(page.locator('.camera-pane')).to_be_visible()
  record=page.get_by_role('button',name='Record practice',exact=True)
  try:expect(record).to_be_enabled(timeout=15000)
  except AssertionError:
   print(page.locator('body').inner_text(),flush=True)
   print(errors,flush=True)
   raise
  assert page.evaluate('captureCounts.starts')==0, 'Live preview must never start recording'
  # Recording starts during playback without resetting its position.
  page.get_by_role('button',name='Play',exact=True).click()
  expect(page.get_by_role('button',name='Pause',exact=True)).to_be_visible()
  page.wait_for_function("document.querySelector('.mimic-scrub input').value > 1")
  before=float(page.locator('.mimic-scrub input').input_value())
  record.click()
  expect(page.get_by_role('button',name='Stop recording',exact=True)).to_be_visible()
  assert page.evaluate('captureCounts.starts')==1
  assert float(page.locator('.mimic-scrub input').input_value())>=before
  page.wait_for_timeout(650)
  page.get_by_role('button',name='Stop recording',exact=True).click()
  expect(page.get_by_role('button',name='Review take · not saved',exact=True)).to_be_visible()
  assert page.get_by_role('dialog').count()==0, 'Stopping recording must not interrupt practice'
  expect(page.get_by_role('button',name='Pause',exact=True)).to_be_visible()
  assert page.evaluate("captureCounts.streams.at(-1).active")
  page.get_by_role('button',name='End practice',exact=True).click()
  expect(page.get_by_role('button',name='Start practice',exact=True)).to_be_visible()
  assert not page.evaluate('captureCounts.streams.at(-1).active')
  page.get_by_role('button',name='Review take · not saved',exact=True).click()
  expect(page.get_by_role('dialog',name='Your take',exact=True)).to_be_visible()
  expect(page.get_by_role('button',name='Record another',exact=True)).to_be_disabled()
  page.get_by_role('button',name='Close Your take',exact=True).click()
  page.get_by_role('button',name='Start practice',exact=True).click()
  expect(page.get_by_role('button',name='End practice',exact=True)).to_be_visible()
  page.get_by_role('button',name='Review take · not saved',exact=True).click()
  page.once('dialog',lambda dialog:dialog.accept())
  page.get_by_role('button',name='Discard',exact=True).click()
  expect(record).to_be_enabled(timeout=15000)
  # Cancel a queued recording; ordinary playback must not inherit its intent.
  record.click()
  expect(page.get_by_role('button',name='Cancel recording',exact=True)).to_be_visible()
  page.get_by_role('button',name='Cancel recording',exact=True).click()
  page.wait_for_timeout(3500)
  assert page.evaluate('captureCounts.starts')==1
  for width,height in [(320,480),(812,375),(1280,800)]:
   page.set_viewport_size({'width':width,'height':height})
   page.wait_for_timeout(200)
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   assert page.evaluate('document.documentElement.scrollHeight <= innerHeight')
   (ROOT/'test-results').mkdir(exist_ok=True)
   page.screenshot(path=str(ROOT/f'test-results/practice-live-{width}.png'))
   for selector in ['.practice-session-toggle','.record-take']:
    box=page.locator(selector).bounding_box()
    assert box and box['y']>=0 and box['y']+box['height']<=height, (width,height,box)
  record.click()
  expect(page.get_by_role('button',name='Stop recording',exact=True)).to_be_visible()
  page.wait_for_timeout(650)
  page.get_by_role('button',name='End practice',exact=True).click()
  expect(page.get_by_role('button',name='Review take · not saved',exact=True)).to_be_visible()
  assert not page.evaluate('captureCounts.streams.at(-1).active')
  assert page.evaluate('captureCounts.starts')==2
  assert page.get_by_role('dialog').count()==0
  assert not errors, errors
  browser.close()
 print('PASS: mobile full-screen stage; settings sheet and keyboard focus; touch-to-reveal overlays; live preview without capture; record during playback; stop without interruption; end/restart; retained review; cancelled recording; desktop/mobile fit.')

if __name__=='__main__':run()
