"""Independent loaded-video transport/cursor checks, controlled local fixture."""
import hashlib
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('phase7_loaded_clock',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
def check(name,passed,**values):results.append({'name':name,'passed':bool(passed),**values})
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=m.World(m.LONG)
    world.video_bytes=(ROOT/'docs/qualification/piano-workspace-phase-07/fixtures/clip.mp4').read_bytes()
    world.draft={**world.draft,'source_video':{'key':f'lessons/{m.LESSON}/video/clip.mp4','mime':'video/mp4',
        'bytes':len(world.video_bytes),'sha256':hashlib.sha256(world.video_bytes).hexdigest()}}
    context.route('**/api/**',world.route)
    page=context.new_page();m.open_route(page)
    page.wait_for_function('document.querySelector("video")?.readyState >= 2')
    page.get_by_role('button',name='Play',exact=True).click();page.wait_for_timeout(450)
    played=page.locator('video').evaluate('(v)=>v.currentTime')
    page.get_by_role('button',name='Pause',exact=True).click();page.wait_for_timeout(150)
    paused_time=page.locator('video').evaluate('(v)=>v.currentTime')
    page.wait_for_timeout(200)
    stopped=page.locator('video').evaluate('(v)=>v.currentTime')
    check('play-pause',played>0.1 and abs(stopped-paused_time)<0.02,played=played,paused=paused_time,later=stopped)
    page.locator('select').filter(has_text='0.75').select_option('0.75')
    check('rate',page.locator('video').evaluate('(v)=>v.playbackRate')==0.75)
    page.get_by_label('Source clock position',exact=True).evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1.5');e.dispatchEvent(new Event('input',{bubbles:true}));}")
    page.wait_for_timeout(250)
    second=page.locator('video').evaluate('(v)=>v.currentTime')
    tick=float(page.locator('.ws-alignment').get_attribute('data-playhead-tick'))
    score_tick=float(page.locator('.ws-score-playhead').get_attribute('data-playhead-tick'))
    tps=float(page.locator('[data-ticks-per-second]').get_attribute('data-ticks-per-second'))
    span=float(page.locator('[data-window-span]').get_attribute('data-window-span'))
    width=page.locator('.ws-roll-viewport').evaluate('(e)=>e.clientWidth')
    roll_second=float(page.locator('.ws-roll-playhead').get_attribute('x1'))/(width/span)
    check('slider-seek-and-both-cursors',abs(second-1.5)<0.03 and abs(roll_second-second)<0.03 and abs(score_tick-second*tps)<3,
          before=stopped,video=second,roll_seconds=roll_second,score_tick=score_tick,mapped_tick=tick,ticks_per_second=tps)
    page.locator('video').evaluate('(v)=>{v.currentTime=2.9;v.playbackRate=1;}')
    page.get_by_role('button',name='Play',exact=True).click();page.wait_for_timeout(450)
    ended=page.locator('video').evaluate('(v)=>({ended:v.ended,paused:v.paused,time:v.currentTime})')
    check('video-ended',ended['ended'] and ended['paused'] and abs(ended['time']-3)<0.03,**ended)
    context.close();browser.close()
Path(__file__).with_name('loaded-clock-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
