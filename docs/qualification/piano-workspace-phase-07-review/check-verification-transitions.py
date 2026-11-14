"""Follow-up: rejecting a suggestion must protect subsequent edits and authored spelling."""
from pathlib import Path
prefix=Path(__file__).with_name('check-verification.py').read_text(encoding='utf-8').split('with sync_playwright() as pw:')[0]
exec(compile(prefix,str(Path(__file__).with_name('check-verification.py')),'exec'))
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    def open_world():
        context=browser.new_context(viewport={'width':1440,'height':1000})
        world=VerifyWorld();context.route('**/api/**',world.route)
        page=context.new_page();m.open_route(page)
        page.locator('[data-lesson-settings] summary').click()
        page.wait_for_selector('[data-finding]')
        return context,page,world
    def pitch(page):return int(page.locator('.ws-roll-note[data-occurrence="fx-01"]').get_attribute('data-pitch'))
    context,page,world=open_world()
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(150)
    page.locator('.ws-roll-note[data-occurrence="fx-01"]').click()
    page.get_by_role('button',name='+ semitone',exact=True).click()
    before=pitch(page)
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(150)
    results.append({'name':'reject-preserves-manual-edit-after-acceptance','passed':pitch(page)==before,
                    'manual_before_reject':before,'actual_after_reject':pitch(page)})
    context.close()

    context,page,world=open_world()
    page.locator('.ws-roll-note[data-occurrence="fx-01"]').click()
    page.locator('[aria-label="Respell"] input').fill('B#3')
    page.get_by_role('button',name='Apply spelling',exact=True).click()
    before=page.locator('.ws-facts strong').first.inner_text()
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(150)
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(150)
    after=page.locator('.ws-facts strong').first.inner_text()
    results.append({'name':'accept-reject-restores-authored-spelling','passed':after==before,
                    'before':before,'after':after,'pitch':pitch(page)})
    context.close();browser.close()
Path(__file__).with_name('verification-transition-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
