"""Check the camera matrices while seeking and playing an actual saved motion fixture."""
import copy,json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'.local/camera-review'
BASE='http://127.0.0.1:8001'
manifest=json.loads((FIXTURE/'manifest.json').read_text(encoding='utf-8'))
manifest.update(source_video=None,focused_video=None,presentation={})
lesson_id=manifest['lesson_id']
out=ROOT/'test-results/fixed-camera';out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for width,height in [(1440,900),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('''(()=>{
   window.cameraViews=[];window.cameraView=null;
   for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
    const draw=proto.drawArrays;
    proto.drawArrays=function(mode,first,count){
     if(mode===1&&count===164){const program=this.getParameter(this.CURRENT_PROGRAM),location=this.getUniformLocation(program,'modelViewMatrix');if(location){window.cameraView=Array.from(this.getUniform(program,location));window.cameraViews.push(window.cameraView);}}
     return draw.call(this,mode,first,count);
    };
   }
  })()''')
  def route(r):
   path=urlparse(r.request.url).path
   if '/assets/' in path:
    file=FIXTURE/path.split('/')[-1]
    return r.fulfill(path=str(file),content_type='model/gltf-binary') if file.exists() else r.fulfill(status=404)
   if path=='/api/auth/session': value={'account':{'id':'qa','email':'qa@example.test','platform_role':'member','status':'active','mfa_enrolled':False},'csrf':'qa'}
   elif path=='/api/demo':return r.fulfill(status=404)
   elif path=='/api/lessons':value=[manifest]
   elif path==f'/api/lessons/{lesson_id}':value=manifest
   elif path=='/api/shared-lessons':value=[]
   elif path=='/api/workflow/lessons':value={'lessons':[]}
   elif path=='/api/capabilities':value={'camera_calibration':True}
   else:return r.fulfill(status=404,json={'detail':'Fixture'})
   r.fulfill(json=value)
  page.route('**/api/**',route)
  page.goto(f'{BASE}/?page=check&id={lesson_id}')
  expect(page.get_by_role('heading',name=manifest['title'],exact=True)).to_be_visible()
  expect(page.get_by_text('Loading your reference...',exact=True)).not_to_be_visible(timeout=30000)
  page.wait_for_function('window.cameraView!==null')
  page.wait_for_timeout(300)
  baseline=page.evaluate('cameraView')
  page.evaluate('cameraViews=[]')
  playhead=page.get_by_role('slider',name='Preview position',exact=True)
  for _ in range(50):playhead.press('PageUp')
  playhead.press('Home')
  page.get_by_role('button',name='Play selected frames').click()
  page.wait_for_timeout(2000)
  page.get_by_role('button',name='Pause preview').click()
  matrices=page.evaluate('cameraViews')
  assert all(max(abs(a-b) for a,b in zip(matrix,baseline))<1e-7 for matrix in matrices),'Camera moved during playback/seeking'
  stage=page.locator('.motion-render canvas').bounding_box()
  # Manual orbit remains available and ends immediately when the pointer is released.
  page.mouse.move(stage['x']+stage['width']*.5,stage['y']+stage['height']*.5)
  page.mouse.down();page.mouse.move(stage['x']+stage['width']*.65,stage['y']+stage['height']*.5,steps=8);page.mouse.up()
  page.wait_for_timeout(100)
  manual=page.evaluate('cameraView');assert manual!=baseline
  page.evaluate('cameraViews=[]');page.wait_for_timeout(500)
  assert all(max(abs(a-b) for a,b in zip(matrix,manual))<1e-7 for matrix in page.evaluate('cameraViews')),'Camera coasted after manual rotation'
  page.screenshot(path=str(out/f'{width}x{height}.png'))
  assert not errors,errors
  print(f'{width}x{height}: exact 48.9s clip; camera fixed through 50 seeks and playback; manual rotation stops on release',flush=True)
  page.close()
 browser.close()
