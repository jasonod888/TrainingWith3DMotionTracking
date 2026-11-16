"""Independent Phase 8 visible geometry, read-only and mode-return checks."""
import hashlib
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_review_route',source)
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
def check(name, passed, **evidence):
    results.append({'name':name,'passed':bool(passed),**evidence})

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    context.route('**/api/**',m.World(m.LONG).route)
    page=context.new_page();m.open_route(page)
    page.locator('.ws-roll-note').first.click()
    page.locator('.ws-roll-viewport').evaluate('(e)=>{e.scrollTop=25;e.scrollLeft=80;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(180)
    if page.locator('.ws-score-viewport').count():
        page.locator('.ws-score-viewport').evaluate('(e)=>{e.scrollLeft=137;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(180)
    def scroll_state():
        return page.evaluate('''() => ({
          rollTop:document.querySelector('.ws-roll-viewport')?.scrollTop,
          rollLeft:document.querySelector('.ws-roll-viewport')?.scrollLeft,
          scoreLeft:document.querySelector('.ws-score-viewport')?.scrollLeft,
          start:document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-start'),
          span:document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-span')})''')
    before_scroll=scroll_state()
    before=page.evaluate('()=>window.__pianoWorkspaceSnapshot()')
    page.get_by_role('button',name='Formatted score',exact=True).click()
    page.wait_for_selector('[data-formatted-page="1"]')
    style=page.locator('.formatted-staff').first.evaluate('(e)=>({stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth})')
    check('five-line-staff-visible',style['stroke']!='none',computed=style)
    geometry=page.evaluate('''async () => {
      const {buildNotation}=await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
      const {layoutFormattedScore}=await import('/src/music/workspace/FormattedScore.tsx');
      const doc=buildNotation([
        {id:'E4',pitch:64,onset:0,duration:0.5,velocity:0.6,confidence:null,optional:false,string:null,fret:null},
        {id:'F5',pitch:77,onset:1,duration:0.5,velocity:0.6,confidence:null,optional:false,string:null,fret:null},
        {id:'A3',pitch:57,onset:2,duration:0.5,velocity:0.6,confidence:null,optional:false,string:null,fret:null}
      ],{duration:4,bpm:120});
      const layout=layoutFormattedScore(doc);
      const answer=[];
      for(const segment of doc.segments) for(const note of segment.notes){
        const p=layout.notePositions.get(note.id);const system=layout.systems[p.system];
        const id=note.performance_ids[0];
        const expected=system.y+(id==='E4'?70:id==='F5'?38:112);
        answer.push({id,actual:p.y,expected,passed:Math.abs(p.y-expected)<0.001});
      }
      return answer;
    }''')
    check('pitch-positions-align-with-staff-lines',all(row['passed'] for row in geometry),notes=geometry)
    page.get_by_role('button',name='Return to correction',exact=True).click()
    page.wait_for_selector('.ws-roll-svg')
    page.wait_for_timeout(180)
    after_scroll=scroll_state()
    check('restore-nondefault-roll-and-score-scroll',before_scroll==after_scroll,before=before_scroll,after=after_scroll)
    # Test mutation isolation separately, after the pure mode-switch check.
    before=page.evaluate('()=>window.__pianoWorkspaceSnapshot()')
    page.get_by_role('button',name='Formatted score',exact=True).click()
    page.wait_for_selector('[data-formatted-page="1"]')
    page.keyboard.press('Delete');page.wait_for_timeout(150)
    deleted=page.evaluate('()=>window.__pianoWorkspaceSnapshot()')
    check('formatted-preview-blocks-delete',deleted['document']==before['document'],before_count=len(before['document']['performance']),after_count=len(deleted['document']['performance']),before_history=before['past'],after_history=deleted['past'])
    context.close()

    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=m.World(m.LONG)
    world.video_bytes=(ROOT/'docs/qualification/piano-workspace-phase-07/fixtures/clip.mp4').read_bytes()
    world.draft={**world.draft,'source_video':{'key':f'lessons/{m.LESSON}/video/clip.mp4','mime':'video/mp4','bytes':len(world.video_bytes),'sha256':hashlib.sha256(world.video_bytes).hexdigest()}}
    context.route('**/api/**',world.route)
    page=context.new_page();m.open_route(page)
    page.wait_for_function('document.querySelector("video")?.readyState>=2')
    page.locator('select').filter(has_text='0.75').select_option('0.75')
    page.locator('video').evaluate('(v)=>{v.pause();v.currentTime=1.5;window.__reviewVideo=v;}')
    page.wait_for_timeout(220)
    original_time=page.locator('video').evaluate('(v)=>v.currentTime')
    page.get_by_role('button',name='Formatted score',exact=True).click()
    page.wait_for_selector('[data-formatted-page="1"]')
    page.get_by_role('button',name='Return to correction',exact=True).click()
    page.wait_for_selector('video')
    page.wait_for_function('document.querySelector("video")?.readyState>=2')
    returned=page.locator('video').evaluate('(v)=>({same:v===window.__reviewVideo,time:v.currentTime,rate:v.playbackRate})')
    check('return-preserves-loaded-source-position-rate',abs(returned['time']-original_time)<0.03 and abs(returned['rate']-0.75)<0.001,before_time=original_time,after=returned)
    page.get_by_role('button',name='Play',exact=True).click();page.wait_for_timeout(300)
    native=page.locator('video').evaluate('(v)=>({time:v.currentTime,paused:v.paused})')
    clock=page.locator('.ws-time').inner_text()
    check('returned-source-clock-follows-playing-video',abs(float(clock.split(' s')[0])-native['time'])<0.1,native=native,clock=clock)
    context.close();browser.close()

Path(__file__).with_name('review-probes-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(row['passed'] for row in results) else 1)
