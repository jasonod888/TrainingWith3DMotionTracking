"""Old checkpoints without accepted-state baselines must refuse unsafe reversals."""
from pathlib import Path
helper=Path(__file__).with_name('check-verification-recovery.py')
exec(compile(helper.read_text(encoding='utf-8').split('\nwith sync_playwright() as pw:')[0],str(helper),'exec'))
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    world=AddWorld();context.route('**/api/**',world.route)
    page=context.new_page();m.open_route(page)
    page.locator('[data-lesson-settings] summary').click();page.wait_for_selector('[data-finding]')
    page.locator('[data-verification-accept]').click()
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    note=page.locator('.ws-roll-note[data-occurrence="vf-add-1-a"]');note.wait_for();note.click()
    page.get_by_role('button',name='Half',exact=True).click()
    page.wait_for_function("document.querySelector('.ws-facts')?.textContent.includes('written 960 ticks')")
    page.wait_for_timeout(800)
    # This is the legitimate checkpoint format written before W1 introduced the optional field.
    page.evaluate("() => { const k='piano-workspace-recovery-v1';const c=JSON.parse(localStorage.getItem(k));delete c.acceptedBaselines;localStorage.setItem(k,JSON.stringify(c)); }")
    page.reload(wait_until='domcontentloaded');page.wait_for_selector('[data-recovery="offer"]')
    page.get_by_role('button',name='Restore local checkpoint',exact=True).click()
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    note=page.locator('.ws-roll-note[data-occurrence="vf-add-1-a"]');note.wait_for();note.click()
    before=page.locator('.ws-facts').inner_text()
    page.locator('[data-lesson-settings] summary').click();page.wait_for_selector('[data-verification-reject]')
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(200)
    retained=note.count()==1
    result={'name':'legacy-checkpoint-refuses-reversal-without-authored-after-baseline','passed':retained,
            'restored_before_reject':before,'note_retained_after_reject':retained}
    context.close();browser.close()
Path(__file__).with_name('legacy-reversal-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
raise SystemExit(0 if retained else 1)
