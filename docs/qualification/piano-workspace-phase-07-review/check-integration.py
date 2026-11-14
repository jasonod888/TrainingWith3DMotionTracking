"""Independent Phase 7 route probes; controlled API, no real lesson mutation."""
import importlib.util
import hashlib
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('phase7_submission',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=m.World(m.LONG)
    requests=[]
    def handler(route,request):
        requests.append(request.url)
        return world.route(route,request)
    context.route('**/api/**',handler)
    page=context.new_page();m.open_route(page)
    styles=page.evaluate("""() => ({
      workspaceCss: [...document.querySelectorAll('style[data-vite-dev-id]')].some(e=>e.dataset.viteDevId.endsWith('/music/workspace/workspace.css')),
      gridDisplay: getComputedStyle(document.querySelector('.ws-grid')).display,
      shellFont: getComputedStyle(document.querySelector('.ws-shell')).fontSize,
      noteFill: getComputedStyle(document.querySelector('.ws-roll-note')).fill,
      videos: document.querySelectorAll('video').length,
      staleCopy: document.querySelector('.ws-shell').innerText.includes('this harness has no save')
    })""")
    results.append({'name':'workspace-style-loaded','passed':styles['workspaceCss'],'measured':styles})
    page.locator('.ws-roll-note').first.click()
    page.get_by_role('button',name='+ semitone',exact=True).click()
    dialogs=[]
    page.on('dialog',lambda d:(dialogs.append(d.message),d.dismiss()))
    page.get_by_role('link',name='Form home',exact=True).click()
    page.wait_for_timeout(250)
    results.append({'name':'app-chrome-unsaved-guard','passed':bool(dialogs),
                    'dialogs':dialogs,'workspace_still_mounted':page.locator('.ws-shell').count()>0,
                    'url':page.url})
    results.append({'name':'draft-load-count','informational':True,
                    'draft_gets':sum(u.endswith('/music-draft') for u in requests),
                    'note':'Dev StrictMode may repeat mounts; parent and child both load/store the draft in code.'})
    reference={'reference_version':1,'duration':m.LONG['duration'],'events':m.LONG['events'],'spans':m.LONG['spans']}
    world.reference_text=json.dumps(reference)
    world.manifest={'schema_version':2,'experience_family':'music','lesson_id':m.LESSON,'revision_id':'rev-saved-only',
        'title':'Saved only','subject':'piano','duration':m.LONG['duration'],'instrument':m.LONG['instrument'],
        'section_set':{'sections':[{'id':'whole','label':'Whole lesson','start':0,'end':m.LONG['duration']}]},
        'reference':{'key':f'lessons/{m.LESSON}/ref.json','sha256':hashlib.sha256(world.reference_text.encode()).hexdigest()},
        'reference_reviewed':True,'assessment':{'assessment':'none','input_modes':['none'],'dimensions':[],'rubric_version':'music-watch-v1'},
        'source_video':None,'piano_preview':None,'warnings':[]}
    world.draft_available=False
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}',wait_until='domcontentloaded')
    page.wait_for_selector('section[aria-label="Review music reference"], .ws-shell')
    page.wait_for_timeout(250)
    results.append({'name':'saved-only-review-entry','passed':page.locator('.ws-shell').count()>0,
                    'body':page.locator('main').first.inner_text()[:800]})
    context.close();browser.close()
out=Path(__file__).with_name('integration-results.json');out.write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(1 if any(r.get('passed') is False for r in results) else 0)
