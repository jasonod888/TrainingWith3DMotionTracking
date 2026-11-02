"""Compare decoded preview frames during continuous dragging on a long-GOP video."""
import json,os,time,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('TIMELINE_TEST_URL','http://127.0.0.1:5198')
fixture=ROOT/'test-results/trim-long-gop.webm'
if not fixture.exists():
 fixture.parent.mkdir(exist_ok=True)
 subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','16','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-b:v','1800k','-g','300','-an','-y',str(fixture)],check=True)
results=[]
with sync_playwright() as p:
 for engine in ['chromium','firefox']:
  browser=getattr(p,engine).launch(headless=True)
  for mode in ['direct','scheduled']:
   page=browser.new_page(viewport={'width':1280,'height':1000});page.set_default_timeout(15000)
   page.route('**/scrub-qa',lambda r:r.fulfill(content_type='text/html',body='<html><body><div id="qa"></div></body></html>'))
   page.route('**/api/conversions/limits',lambda r:r.fulfill(json={'max_bytes':262144000,'max_seconds':300,'max_active':3,'part_size':5242880,'processing':{'provider':'local','available':True,'external_processing':False}}))
   if mode=='direct':
    page.route('**/src/video-scrubber.ts',lambda r:r.fulfill(content_type='application/javascript',body='export function createVideoScrubber(v){return {seek:t=>{v.pause();v.currentTime=t},busy:()=>false,cancel(){},dispose(){}}}'))
   page.goto(BASE+'/scrub-qa')
   page.evaluate('''async()=>{const rm=await import('/node_modules/.vite/deps/react.js');const React=rm.default??rm;const cm=await import('/node_modules/.vite/deps/react-dom_client.js');const {CreateLesson}=await import('/src/CreateLesson.tsx');await import('/src/style.css');(cm.default??cm).createRoot(document.querySelector('#qa')).render(React.createElement(CreateLesson,{onBack:()=>{},onDone:()=>{}}));}''')
   page.get_by_label('Choose video',exact=True).set_input_files(str(fixture))
   handle=page.get_by_role('slider',name='Clip start',exact=True);expect(handle).to_be_visible()
   page.wait_for_function("document.querySelector('.upload-preview video').readyState>=2")
   page.wait_for_function("document.querySelectorAll('.timeline-filmstrip img').length===10")
   page.evaluate('''()=>{const v=document.querySelector('.upload-preview video');window.framesSeen=[];window.seeksDone=[];v.addEventListener('seeked',()=>seeksDone.push({at:performance.now(),time:v.currentTime}));function frame(t,m){framesSeen.push({at:performance.now(),time:m.mediaTime});v.requestVideoFrameCallback(frame);}v.requestVideoFrameCallback(frame);}''')
   track=page.locator('.timeline-track').bounding_box();box=handle.bounding_box()
   page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
   started=page.evaluate('performance.now()')
   for i in range(1,101):
    page.mouse.move(track['x']+track['width']*(.05+.75*i/100),track['y']+30)
    time.sleep(.008)
   released=page.evaluate('performance.now()');page.mouse.up()
   page.wait_for_function("!document.querySelector('.upload-preview video').seeking && Math.abs(document.querySelector('.upload-preview video').currentTime-Number(document.querySelector('[aria-label=\"Clip start\"]').getAttribute('aria-valuenow')))<.001")
   page.wait_for_timeout(100)
   data=page.evaluate('({frames:framesSeen,seeks:seeksDone,fastSeek:typeof document.querySelector("video").fastSeek})')
   during=[x for x in data['frames'] if started<x['at']<released]
   values={round(x['time'],2) for x in during}
   gaps=[b['at']-a['at'] for a,b in zip(during,during[1:])]
   result={'browser':engine,'mode':mode,'drag_ms':round(released-started),'decoded_frames_during_drag':len(during),'distinct_frames_during_drag':len(values),'max_frame_gap_ms':round(max(gaps)) if gaps else None,'release_to_final_ms':round(data['frames'][-1]['at']-released) if data['frames'] else None,'fastSeek':data['fastSeek']}
   
   if mode=='scheduled':
    assert len(values)>=5,('Preview did not keep changing during drag',result)
    assert gaps and max(gaps)<1000,('Preview stalled for over a second',result)
    assert result['release_to_final_ms']<1000,('Final frame took over a second',result)
   results.append(result);print(json.dumps(result),flush=True);page.close()
  browser.close()
(ROOT/'test-results/trim-scrub-performance.json').write_text(json.dumps(results,indent=2))

