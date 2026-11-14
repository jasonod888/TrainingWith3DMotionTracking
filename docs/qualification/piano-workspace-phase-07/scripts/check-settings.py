"""Phase 7 correction: settings recovery and passage/map coherence, controlled routes."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('phase7_settings_source',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=m.World(m.LONG);context.route('**/api/**',world.route)
    page=context.new_page();m.open_route(page)
    def settings():
        panel=page.locator('[data-lesson-settings]')
        if panel.get_attribute('open') is None: panel.locator('summary').click()
        return panel
    panel=settings()
    panel.locator('[data-section] input').first.fill('Corrected section')
    panel.locator('[data-assessment-policy]').select_option('notes')
    page.wait_for_function("JSON.parse(localStorage.getItem('piano-workspace-recovery-v1') || '{}').notation !== undefined")
    page.wait_for_timeout(750)
    checkpoint=page.evaluate("JSON.parse(localStorage.getItem('piano-workspace-recovery-v1'))")
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('[data-recovery="offer"]')
    page.get_by_role('button',name='Restore local checkpoint',exact=True).click()
    panel=settings()
    label=panel.locator('[data-section] input').first.input_value()
    policy=panel.locator('[data-assessment-policy]').input_value()
    results.append({'name':'settings-recovered-after-reload','passed':label=='Corrected section' and policy=='notes',
                    'expected':{'label':'Corrected section','policy':'notes'},'actual':{'label':label,'policy':policy},
                    'checkpoint_fields':sorted(checkpoint.keys())})
    clock=page.get_by_label('Source clock position')
    clock.evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1'); e.dispatchEvent(new Event('input',{bubbles:true}));}")
    page.wait_for_timeout(100)
    before=float(page.locator('.ws-alignment[data-playhead-tick]').get_attribute('data-playhead-tick'))
    panel.locator('[data-passage="0"] select').select_option('explanation')
    page.wait_for_timeout(100)
    after=float(page.locator('.ws-alignment[data-playhead-tick]').get_attribute('data-playhead-tick'))
    kind=panel.locator('[data-passage="0"] select').input_value()
    results.append({'name':'passage-map-coherence-after-recovery','passed':kind!='explanation' or after==0,
                    'source_second':1,'kind':kind,'before_tick':before,'after_tick':after,
                    'expected':'reject incompatible edit or explicitly update map/score; do not declare a hold while cursor advances'})
    context.close();browser.close()
Path(__file__).with_name('settings-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
