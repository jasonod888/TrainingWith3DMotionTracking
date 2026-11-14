"""Isolate seeking in the submitted fixture from all application code."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
clip=Path(__file__).resolve().parents[3]/'docs/qualification/piano-workspace-phase-07/fixtures/clip.mp4'
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context()
    context.route('**/review-clip.mp4',lambda r:r.fulfill(status=200,content_type='video/mp4',body=clip.read_bytes()))
    page=context.new_page();page.set_content('<video src="http://127.0.0.1:5173/review-clip.mp4" controls preload="auto"></video>')
    page.wait_for_function('document.querySelector("video").readyState>=2')
    before=page.locator('video').evaluate('(v)=>({duration:v.duration,seekable:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)])})')
    page.locator('video').evaluate('(v)=>{v.currentTime=1.5}')
    page.wait_for_timeout(500)
    after=page.locator('video').evaluate('(v)=>({time:v.currentTime,seeking:v.seeking,readyState:v.readyState,error:v.error?.message})')
    result={'before':before,'after':after}
    Path(__file__).with_name('clip-seek-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result));context.close();browser.close()
