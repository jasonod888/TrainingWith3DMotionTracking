"""Independent browser checks for Phase 6 correction 7bad6cb; demo data only."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent / 'correction-results.json'
results = []
def check(name, passed, **measured):
    results.append(dict(name=name, passed=bool(passed), **measured))

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width':1440, 'height':1000})
    context.route('**/api/**', lambda route: route.fulfill(status=404, content_type='application/json', body='{}'))
    page = context.new_page()
    def open_demo():
        page.goto('http://127.0.0.1:5173/workspace-harness.html?demo=frames',wait_until='domcontentloaded')
        page.wait_for_selector('.ws-roll-note')
    def first(): return page.locator('.ws-roll-note[data-occurrence="f-1"]')
    def pitch(): return int(first().get_attribute('data-pitch'))
    def place(second=3.5):
        layer=page.locator('.ws-roll-add-layer')
        box=layer.bounding_box()
        width=page.locator('.ws-roll-viewport').evaluate('(e)=>e.clientWidth')
        span=float(page.locator('.ws-window-label').get_attribute('data-window-span'))
        page.mouse.click(box['x']+second*width/span,box['y']+160)
    def pointer(node,kind,pointer_id,x,y):
        node.dispatch_event(kind,{'pointerId':pointer_id,'pointerType':'mouse','button':0,'clientX':x,'clientY':y,'bubbles':True})

    open_demo()
    page.locator('[data-add="toggle"]').click()
    page.locator('[data-add="length"]').fill('0.25')
    page.locator('[data-add="written"]').select_option('960')
    place()
    page.get_by_role('button',name='Insert',exact=True).click()
    page.wait_for_selector('.ws-facts')
    facts=page.locator('.ws-facts').inner_text()
    check('independent-written-duration', 'written 960 ticks' in facts, expected_ticks=960, recorded_seconds=0.25, actual=facts)

    open_demo()
    first().click()
    page.get_by_role('button',name='+ semitone',exact=True).click()
    before=pitch()
    page.get_by_role('button',name='Replace pitch',exact=True).click()
    page.keyboard.press('Control+z')
    page.wait_for_timeout(100)
    check('replace-blocks-keyboard-undo',pitch()==before,before=before,after=pitch(),replace_active=page.locator('[data-replace="active"]').count()>0)

    open_demo()
    first().click()
    field=page.locator('[data-written-start]')
    original=int(field.input_value())
    field.fill(str(original+240))
    page.locator('[data-written-start-apply]').click()
    page.locator('.ws-roll-note[data-occurrence="f-2"]').click()
    sibling=int(page.locator('[data-written-start]').input_value())
    check('written-position-isolation',sibling==original,original_chord_start=original,sibling_after=sibling,
          scope_text=page.locator('[aria-label="Written beat position"]').inner_text())

    open_demo()
    page.get_by_label('Sync offset in seconds').fill('0.5')
    page.locator('[data-add="toggle"]').click()
    before_total=int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    place(0.1)
    page.get_by_role('button',name='Insert',exact=True).click()
    after_total=int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    check('negative-stored-onset-rejected',after_total==before_total,before=before_total,after=after_total,
          facts=page.locator('.ws-facts').inner_text() if page.locator('.ws-facts').count() else '')

    open_demo()
    node=first()
    box=node.bounding_box(); x=box['x']+5; y=box['y']+3
    pointer(node,'pointerdown',31,x,y)
    pointer(node,'pointermove',31,x,y-22)
    pointer(node,'pointerup',99,x,y-22)
    check('foreign-pointer-cannot-commit',pitch()==60,expected=60,actual=pitch())
    page.evaluate("window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:31}))")

    open_demo()
    head=page.locator('.ws-score-notehead[data-occurrence="f-1"]').first
    cy=float(head.get_attribute('cy')); box=head.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-5,steps=3)
    page.wait_for_selector('[data-sheet-drag-label]')
    preview_cy=float(head.get_attribute('cy'))
    label=page.locator('[data-sheet-drag-label]').first.get_attribute('data-sheet-drag-label')
    check('candidate-head-follows-staff-position',preview_cy<cy,original_cy=cy,preview_cy=preview_cy,label=label)
    page.keyboard.press('Escape');page.mouse.up()

    context.close();browser.close()
OUT.write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
