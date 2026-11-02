"""Local browser checks for trimming and section timing; uses Playwright and FFmpeg."""
import json,os,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('TIMELINE_TEST_URL','http://127.0.0.1:5198')
fixture=ROOT/'test-results/preview-fixture.webm'
if not fixture.exists():
 fixture.parent.mkdir(exist_ok=True)
 subprocess.run(['ffmpeg','-v','error','-i',str(ROOT/'web/dist/assets/demonstration.mp4'),'-t','8','-an','-vf','scale=640:-2','-c:v','libvpx','-b:v','500k','-y',str(fixture)],check=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1280,'height':1000});page.set_default_timeout(10000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/timeline-qa',lambda r:r.fulfill(content_type='text/html',body='<html><body><div id="qa"></div></body></html>'))
 page.route('**/api/conversions/limits',lambda r:r.fulfill(json={'max_bytes':262144000,'max_seconds':300,'max_active':3,'part_size':5242880,'processing':{'provider':'local','available':True,'external_processing':False}}))
 page.goto(BASE+'/timeline-qa');print('Harness loaded',flush=True)
 page.evaluate('''async()=>{
 const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default??reactModule;const client=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=(client.default??client).createRoot;
 const {CreateLesson}=await import('/src/CreateLesson.tsx');await import('/src/style.css');
 window.qaRoot=createRoot(document.querySelector('#qa'));qaRoot.render(React.createElement(CreateLesson,{onBack:()=>{},onDone:()=>{}}));
 }''')
 print('Component loaded',flush=True)
 page.get_by_label('Choose video',exact=True).set_input_files(str(fixture))
 start=page.get_by_role('slider',name='Clip start',exact=True);end=page.get_by_role('slider',name='Clip end',exact=True)
 expect(end).to_be_visible();page.wait_for_function("document.querySelector('.upload-preview video').readyState>=2")
 page.wait_for_function("document.querySelectorAll('.timeline-filmstrip img').length===10")
 print('Filmstrip loaded',flush=True)
 duration=float(end.get_attribute('aria-valuenow'))
 start.focus();page.keyboard.press('ArrowRight');expect(start).to_have_attribute('aria-valuenow','0.1')
 page.keyboard.press('Shift+ArrowRight');expect(start).to_have_attribute('aria-valuenow','0.11')
 track=page.locator('.timeline-track').bounding_box()
 box=start.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(track['x']+track['width']*.25,track['y']+32,steps=10);page.mouse.up()
 assert abs(float(start.get_attribute('aria-valuenow'))-duration*.25)<.05
 # A touch pointer uses the same captured-pointer interaction.
 cdp=page.context.new_cdp_session(page);box=end.bounding_box()
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':track['x']+track['width']*.7,'y':track['y']+30}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 assert abs(float(end.get_attribute('aria-valuenow'))-duration*.7)<.05
 page.get_by_label('Start time in seconds').fill('1');page.get_by_label('End time in seconds').fill('2')
 page.get_by_role('button',name='Preview selection').click()
 page.wait_for_function("document.querySelector('.upload-preview video').paused && document.querySelector('.upload-preview video').currentTime>=2",timeout=5000)
 for width in [1280,390,320]:
  page.set_viewport_size({'width':width,'height':1000})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  page.screenshot(path=str(ROOT/f'test-results/trim-timeline-{width}.png'),full_page=True)
 # Reuse the component with boundaries; keyboard events must not trigger player shortcuts.
 page.evaluate('''async()=>{
 const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default??reactModule;const {VideoTimeline}=await import('/src/VideoTimeline.tsx');
 function Harness(){const [boundary,setBoundary]=React.useState(4);const [time,setTime]=React.useState(0);return React.createElement(VideoTimeline,{duration:10,time,onSeek:setTime,markers:[{id:'a',time:boundary,label:'Step boundary',min:.05,max:9.95}],onMarkerChange:(_,v)=>setBoundary(v),segments:[{id:'a',start:0,end:boundary,label:'First'},{id:'b',start:boundary,end:10,label:'Second'}]});}
 qaRoot.render(React.createElement(Harness));}''')
 boundary=page.get_by_role('slider',name='Step boundary');boundary.focus();page.keyboard.press('ArrowRight');expect(boundary).to_have_attribute('aria-valuenow','4.1')
 page.keyboard.press('End');expect(boundary).to_have_attribute('aria-valuenow','9.95')
 page.keyboard.press('Home');expect(boundary).to_have_attribute('aria-valuenow','0.05')
 # Verify the real section editor updates and saves both sides of a dragged boundary.
 page.route('**/src/MotionStage.tsx',lambda r:r.fulfill(content_type='application/javascript',body='export function MotionStage(){return null}'))
 manifest=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
 manifest['duration']=10
 manifest['section_set']['sections']=[{'id':'one','label':'First','start':0,'end':4},{'id':'two','label':'Second','start':4,'end':10}]
 page.evaluate("""async lesson=>{const mod=await import('/src/LessonWorkspace.tsx');const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default??reactModule;window.saved=null;qaRoot.render(React.createElement(mod.LessonWorkspace,{lesson,sections:lesson.section_set.sections,review:true,onBack:()=>{},onEdit:()=>{},onSave:sections=>{window.saved=sections},notice:''}));}""",manifest)
 boundary=page.get_by_role('slider',name='Boundary between sections 1 and 2')
 boundary.focus();page.keyboard.press('ArrowRight');expect(boundary).to_have_attribute('aria-valuenow','4.1')
 expect(page.get_by_label('Section 1 end time')).to_have_value('4.1')
 page.get_by_role('button',name='Keep draft').click()
 page.wait_for_function('window.saved!==null')
 assert page.evaluate('saved[0].end===4.1 && saved[1].start===4.1')
 page.get_by_role('slider',name='Video playhead').fill('7')
 page.get_by_role('button',name='Split here').click()
 expect(page.get_by_role('slider',name='Boundary between sections 2 and 3')).to_be_visible()
 assert not errors,errors
 print(json.dumps({'filmstrip':10,'mouse_drag':True,'touch_pointer':True,'keyboard':True,'preview_range':True,'responsive':[1280,390,320],'step_boundaries':True,'editor_save_and_split':True,'page_errors':errors}))
 browser.close()
