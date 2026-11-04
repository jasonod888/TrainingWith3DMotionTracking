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
window.SpeechRecognition = class {
 start() { window.denyVoiceStart = () => this.onerror?.({error:'not-allowed'}); }
 abort() {}
};
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
  expect(page.get_by_role('button',name='Without voice',exact=True)).to_be_visible()
  page.get_by_role('button',name='Start practice',exact=True).click()
  expect(page.get_by_role('button',name='Connecting…',exact=True)).to_be_visible()
  expect(page.locator('.practice-countdown')).to_have_count(0)
  page.evaluate('window.denyVoiceStart()')
  voice_prompt=page.get_by_role('dialog',name='Practise with or without voice',exact=True)
  voice_prompt.get_by_role('button',name='Continue without voice',exact=True).click()
  expect(page.locator('.practice-countdown')).to_be_visible()
  expect(page.get_by_role('button',name='Voice off',exact=True)).to_be_visible()
  page.reload()
  expect(page.get_by_role('button',name='Without voice',exact=True)).to_be_visible()
  expect(page.get_by_role('button',name='Use camera feedback',exact=True)).to_have_count(0)
  expect(page.locator('.mimic-transport')).to_have_count(0)
  # Mobile uses the entire viewport; settings remain contained and keyboard dismissible.
  page.set_viewport_size({'width':390,'height':844})
  expect(page.locator('.mimic-stage')).to_have_css('width','390px')
  stage=page.locator('.mimic-stage').bounding_box()
  timeline=page.locator('.practice-timeline').bounding_box()
  assert stage and timeline and stage['x']==0 and stage['y']==0 and stage['y']+stage['height']<=timeline['y'], (stage,timeline)
  settings=page.get_by_role('button',name='Practice settings',exact=True)
  settings.click()
  sheet=page.get_by_role('dialog',name='Practice settings',exact=True)
  sheet.get_by_role('button',name=re.compile('^Playback & timing')).click()
  expect(sheet).to_be_visible()
  expect(sheet.get_by_role('button',name=re.compile('^Playback & timing'))).to_have_attribute('aria-expanded','true')
  expect(sheet.get_by_role('button',name='0.5×',exact=True)).to_be_visible()
  bounds=sheet.bounding_box()
  assert bounds and bounds['y']>=0 and bounds['y']+bounds['height']<=844, bounds
  page.keyboard.press('Escape')
  expect(sheet).to_have_count(0)
  expect(settings).to_be_focused()
  # Instructor-only practice must never request a camera, including when cast.
  expect(page.locator('.mimic-shell')).to_have_class(re.compile(r'instructor-only'))
  expect(page.get_by_role('button',name='Without voice',exact=True)).to_be_visible()
  assert page.evaluate('window.captureCounts.streams.length')==0
  settings.click()
  expect(sheet.get_by_role('group',name='Camera',exact=True).get_by_role('button',name='Off',exact=True)).to_have_attribute('aria-pressed','true')
  expect(sheet.get_by_role('button',name='3D',exact=True)).to_be_visible()
  expect(sheet.get_by_role('button',name='Real + 3D',exact=True)).to_be_disabled()
  page.keyboard.press('Escape')
  page.get_by_role('button',name='Practice settings',exact=True).click()
  page.get_by_role('button',name='Enable TV presentation',exact=True).click()
  assert page.evaluate('window.captureCounts.streams.length')==0
  page.get_by_role('button',name='Turn off TV presentation',exact=True).click()
  page.get_by_role('group',name='Camera',exact=True).get_by_role('button',name='Front',exact=True).click()
  # Choosing a feed opens that camera at once, so the person sees the real arrangement.
  expect(page.locator('.camera-pane')).to_be_visible(timeout=30000)
  page.keyboard.press('Escape')
  expect(page.get_by_role('button',name='End practice',exact=True)).to_be_visible()
  # Playback remains available by keyboard; touching the stage restores overlays.
  page.locator('.mimic-stage').click(position={'x':20,'y':200})
  page.keyboard.press('Space')
  page.wait_for_function("document.querySelector('.mimic-shell').classList.contains('controls-resting')")
  expect(page.locator('.mimic-shell')).to_have_class(re.compile(r'is-playing'))
  page.locator('.mimic-stage').click(position={'x':20,'y':200})
  expect(page.locator('.mimic-shell')).not_to_have_class(re.compile(r'controls-resting'))
  page.locator('.mimic-stage').click(position={'x':20,'y':200})
  page.keyboard.press('p')
  page.set_viewport_size({'width':1280,'height':800})
  assert page.get_by_role('button',name='Record practice',exact=True).count()==0
  expect(page.locator('.camera-pane')).to_be_visible()
  record=page.get_by_role('button',name='Record practice',exact=True)
  try:expect(record).to_be_enabled(timeout=15000)
  except AssertionError:
   print(page.locator('body').inner_text(),flush=True)
   print(errors,flush=True)
   raise
  assert page.evaluate('captureCounts.starts')==0, 'Live preview must never start recording'
  # Recording starts during playback without resetting its position.
  page.locator('.mimic-stage').click(position={'x':20,'y':200})
  page.keyboard.press('Space')
  expect(page.locator('.mimic-shell')).to_have_class(re.compile(r'is-playing'))
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
  expect(page.locator('.mimic-shell')).to_have_class(re.compile(r'is-playing'))
  assert page.evaluate("captureCounts.streams.at(-1).active")
  page.get_by_role('button',name='End practice',exact=True).click()
  expect(page.get_by_role('button',name='Start camera practice',exact=True)).to_be_visible()
  assert not page.evaluate('captureCounts.streams.at(-1).active')
  page.get_by_role('button',name='Review take · not saved',exact=True).click()
  expect(page.get_by_role('dialog',name='Your take',exact=True)).to_be_visible()
  expect(page.get_by_role('button',name='Record another',exact=True)).to_be_disabled()
  page.get_by_role('button',name='Close Your take',exact=True).click()
  page.get_by_role('button',name='Start camera practice',exact=True).click()
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
   for selector in ['.practice-player-primary','.record-take']:
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
