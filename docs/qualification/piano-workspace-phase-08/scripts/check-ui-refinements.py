"""UI refinement evidence: collapsible roll (desktop/mobile) and full drag preview."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
CAPTURES = Path(__file__).resolve().parents[1] / 'captures'
CAPTURES.mkdir(exist_ok=True)
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_ui', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
results = {}


def open_page(browser, world, viewport):
    context = browser.new_context(viewport=viewport)
    context.route('**/api/**', world.route)
    page = context.new_page(); page.set_default_timeout(20000)
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    return context, page


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    for label, viewport in (('desktop', {'width': 1440, 'height': 1000}),
                            ('mobile', {'width': 390, 'height': 844})):
        context, page = open_page(browser, m.World(m.LONG), viewport)
        toggle = page.locator('[data-roll-toggle]')
        assert toggle.get_attribute('aria-expanded') == 'false'
        page.screenshot(path=str(CAPTURES / f'roll-collapsed-{label}.png'), full_page=False)
        toggle.click()
        page.wait_for_selector('.ws-roll-note', timeout=60000)
        if label == 'mobile':
            page.locator('#piano-roll-body').scroll_into_view_if_needed()
            page.evaluate('window.scrollBy(0, 320)')
            page.wait_for_timeout(200)
        page.screenshot(path=str(CAPTURES / f'roll-expanded-{label}.png'), full_page=False)
        page.locator('.ws-roll-note').first.click()
        page.locator('.ws-roll-viewport').evaluate('(e)=>{e.scrollTop=25;e.scrollLeft=80;e.dispatchEvent(new Event("scroll"));}')
        page.locator('.ws-score-viewport').evaluate('(e)=>{e.scrollLeft=117;e.dispatchEvent(new Event("scroll"));}')
        page.wait_for_timeout(150)
        before = page.evaluate('''() => ({
          top: document.querySelector('.ws-roll-viewport').scrollTop,
          left: document.querySelector('.ws-roll-viewport').scrollLeft,
          score: document.querySelector('.ws-score-viewport').scrollLeft,
          start: document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-start'),
          span: document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-span'),
          selection: window.__pianoWorkspaceSnapshot().selection})''')
        toggle.click(); page.wait_for_timeout(150)
        toggle.click(); page.wait_for_selector('.ws-roll-note', timeout=60000)
        after = page.evaluate('''() => ({
          top: document.querySelector('.ws-roll-viewport').scrollTop,
          left: document.querySelector('.ws-roll-viewport').scrollLeft,
          score: document.querySelector('.ws-score-viewport').scrollLeft,
          start: document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-start'),
          span: document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-span'),
          selection: window.__pianoWorkspaceSnapshot().selection})''')
        results[f'accordion-{label}'] = {'before': before, 'after': after,
                                          'passed': before == after}
        # Full sheet drag preview and cancel.
        page.locator('.ws-score-viewport').scroll_into_view_if_needed()
        event_group = None
        head = None
        stem = None
        for index in range(min(80, page.locator('.ws-score-event').count())):
            candidate = page.locator('.ws-score-event').nth(index)
            if candidate.locator('.ws-score-notehead').count() >= 2 and candidate.locator('.ws-score-stem').count():
                event_group, head = candidate, candidate.locator('.ws-score-notehead[data-occurrence]').first
                stem = candidate.locator('.ws-score-stem').first
                break
        if head is None:
            event_group = page.locator('.ws-score-event').first
            head = event_group.locator('.ws-score-notehead[data-occurrence]').first
            stem = event_group.locator('.ws-score-stem').first
        head.scroll_into_view_if_needed()
        occurrence = head.get_attribute('data-occurrence')
        before_cy = float(head.get_attribute('cy'))
        before_stem = (stem.get_attribute('y1'), stem.get_attribute('y2')) if stem.count() else None
        box = head.bounding_box()
        head.dispatch_event('pointerdown', {'clientX': box['x'] + box['width'] / 2,
                                            'clientY': box['y'] + box['height'] / 2,
                                            'pointerId': 61, 'button': 0, 'buttons': 1})
        head.dispatch_event('pointermove', {'clientX': box['x'] + box['width'] / 2,
                                            'clientY': box['y'] + box['height'] / 2 - 10,
                                            'pointerId': 61, 'buttons': 1})
        page.wait_for_timeout(120)
        preview = page.locator(f'.ws-score-notehead[data-occurrence="{occurrence}"][data-sheet-preview]').first
        preview_cy = float(preview.get_attribute('cy'))
        preview_stem = (stem.get_attribute('y1'), stem.get_attribute('y2')) if stem.count() else None
        page.locator('.ws-panel[aria-label="Score"]').screenshot(path=str(CAPTURES / f'drag-preview-{label}.png'))
        page.keyboard.press('Escape')
        head.dispatch_event('pointerup', {'pointerId': 61})
        page.wait_for_timeout(120)
        doc = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
        results[f'drag-preview-{label}'] = {
            'before_cy': before_cy, 'preview_cy': preview_cy, 'before_stem': before_stem,
            'preview_stem': preview_stem, 'document_unchanged_after_cancel': doc['past'] == 0,
            'passed': preview_cy != before_cy and (before_stem is None or preview_stem != before_stem)
                      and doc['past'] == 0,
        }
        context.close()
    browser.close()

# Mobile roll remains usable: notes have a box, toggle works.
ok = all(item['passed'] for item in results.values())
Path(__file__).with_name('ui-refinements-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
raise SystemExit(0 if ok else 1)
