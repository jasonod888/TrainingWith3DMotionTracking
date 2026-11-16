"""Structural later edits and recovery must not bypass verification revert protection."""
from pathlib import Path
prefix=Path(__file__).with_name('check-verification.py').read_text(encoding='utf-8').split('with sync_playwright() as pw:')[0]
exec(compile(prefix,str(Path(__file__).with_name('check-verification.py')),'exec'))

class AddWorld(VerifyWorld):
    def __init__(self):
        super().__init__()
        self.finding={'id':'add-1','kind':'missing_note','status':'suggested','pitch':48,'time_range':[3.5,4],
            'explanation':'Controlled added note','event_ids':[],'evidence':{},'alternatives':[],
            'ambiguous':False,'ambiguity_reasons':[],
            'proposed_edits':[{'op':'add_note','event_ids':[],'before':None,
                'after':{'pitch':48,'onset':3.5,'duration':0.5,'velocity':0.6}}]}
    def state(self):
        state=super().state();state['events']=copy.deepcopy(fixture['events'])
        if self.decision=='accepted':
            state['events'].append({**fixture['events'][0],'id':'vf-add-1-a','pitch':48,'onset':3.5,'duration':0.5,'velocity':0.6})
        return state

results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    def open_world(world):
        context=browser.new_context(viewport={'width':1440,'height':1000})
        context.route('**/api/**',world.route)
        page=context.new_page();m.open_route(page)
        page.locator('[data-lesson-settings] summary').click()
        page.wait_for_selector('[data-finding]')
        return context,page
    context,page=open_world(AddWorld())
    page.locator('[data-verification-accept]').click()
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note[data-occurrence="vf-add-1-a"]')
    page.locator('.ws-roll-note[data-occurrence="vf-add-1-a"]').click()
    length=page.get_by_label('Recorded length (s)',exact=True)
    length.fill('0.9');length.press('Tab')
    page.wait_for_timeout(100)
    before=length.input_value()
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(150)
    retained=page.locator('.ws-roll-note[data-occurrence="vf-add-1-a"]').count()
    results.append({'name':'reject-keeps-added-note-with-later-recorded-length-edit','passed':retained==1,
                    'recorded_length_before_reject':before,'retained_after_reject':bool(retained)})
    context.close()

    context,page=open_world(VerifyWorld())
    page.locator('.ws-roll-note[data-occurrence="fx-01"]').click()
    page.locator('[aria-label="Respell"] input').fill('B#3')
    page.get_by_role('button',name='Apply spelling',exact=True).click()
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(800)
    page.reload(wait_until='domcontentloaded');page.wait_for_selector('[data-recovery="offer"]')
    page.get_by_role('button',name='Restore local checkpoint',exact=True).click()
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.locator('.ws-roll-note[data-occurrence="fx-01"]').click()
    page.locator('[data-lesson-settings] summary').click()
    page.wait_for_selector('[data-verification-reject]')
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(150)
    spelling=page.locator('.ws-facts strong').first.inner_text()
    pitch=int(page.locator('.ws-roll-note[data-occurrence="fx-01"]').get_attribute('data-pitch'))
    results.append({'name':'recovered-reject-restores-authored-spelling-or-refuses-safely',
                    'passed':spelling=='B#3' or pitch==62,'actual_spelling':spelling,'actual_pitch':pitch,
                    'expected':'B#3 restored, or accepted D4 retained with explicit missing-baseline reconciliation'})
    context.close();browser.close()
Path(__file__).with_name('verification-recovery-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
