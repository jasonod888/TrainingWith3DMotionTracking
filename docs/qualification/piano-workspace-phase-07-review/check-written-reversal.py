"""The existing U1 policy must also protect later written-rhythm edits."""
from pathlib import Path
helper=Path(__file__).with_name('check-verification-recovery.py')
prefix=helper.read_text(encoding='utf-8').split('\nwith sync_playwright() as pw:')[0]
exec(compile(prefix,str(helper),'exec'))
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=AddWorld();context.route('**/api/**',world.route)
    page=context.new_page();m.open_route(page)
    page.locator('[data-lesson-settings] summary').click()
    page.wait_for_selector('[data-finding]')
    page.locator('[data-verification-accept]').click()
    note=page.locator('.ws-roll-note[data-occurrence="vf-add-1-a"]')
    note.wait_for();note.click()
    page.get_by_role('button',name='Half',exact=True).click()
    page.wait_for_function("document.querySelector('.ws-facts')?.textContent.includes('written 960 ticks')")
    before=page.locator('.ws-facts').inner_text()
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(200)
    retained=note.count()==1
    result={'name':'reject-preserves-later-written-duration-edit','passed':retained,
            'authored_before_reject':before,'note_retained_after_reject':retained}
    context.close();browser.close()
Path(__file__).with_name('written-reversal-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
raise SystemExit(0 if retained else 1)
