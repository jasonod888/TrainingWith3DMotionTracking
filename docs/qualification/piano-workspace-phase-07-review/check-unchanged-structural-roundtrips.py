"""Stabilisation smoke matrix: unchanged supported structural decisions must round-trip."""
from pathlib import Path
helper=Path(__file__).with_name('check-verification.py')
exec(compile(helper.read_text(encoding='utf-8').split('\nwith sync_playwright() as pw:')[0],str(helper),'exec'))
class DeleteWorld(VerifyWorld):
    def __init__(self):
        super().__init__()
        self.finding={**self.finding,'id':'delete-1','kind':'extra_note',
            'proposed_edits':[{'op':'delete_note','event_ids':['fx-01'],
                              'before':copy.deepcopy(fixture['events'][0]),'after':None}]}
    def state(self):
        value=super().state();value['events']=copy.deepcopy(fixture['events'])
        if self.decision=='accepted':value['events']=[e for e in value['events'] if e['id']!='fx-01']
        return value
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    for name,world in [('delete',DeleteWorld()),('merge',VerifyWorld(True))]:
        context=browser.new_context(viewport={'width':1440,'height':1000})
        context.route('**/api/**',world.route)
        page=context.new_page();m.open_route(page)
        page.locator('[data-lesson-settings] summary').click();page.wait_for_selector('[data-finding]')
        count=lambda:int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
        before=count()
        page.locator('[data-verification-accept]').click();page.wait_for_timeout(150)
        accepted=count()
        page.locator('[data-verification-reject]').click();page.wait_for_timeout(150)
        after=count()
        results.append({'operation':name,'passed':accepted==before-1 and after==before,
                        'before':before,'accepted':accepted,'after_reject':after,
                        'server_after_reject':len(world.state()['events']),
                        'reports':page.locator('.ws-report').all_inner_texts()})
        context.close()
    browser.close()
Path(__file__).with_name('unchanged-structural-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
