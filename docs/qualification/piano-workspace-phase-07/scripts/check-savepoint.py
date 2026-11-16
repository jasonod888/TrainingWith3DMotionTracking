"""B1 saved-point identity on the normal route: save A, edit B, undo/redo."""
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright

source = Path(__file__).with_name('check-normal-route.py')
spec = importlib.util.spec_from_file_location('phase7_savepoint', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    world = m.World(m.LONG)
    context.route('**/api/**', world.route)
    page = context.new_page()
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    dirty = lambda: page.locator('.ws-shell').get_attribute('data-workspace-dirty')
    select = lambda: page.locator('.ws-roll-note').first.dispatch_event(
        'pointerdown', {'pointerId': 31, 'pointerType': 'mouse', 'button': 0,
                        'clientX': 120, 'clientY': 200})
    page.locator('.ws-roll-note').first.dispatch_event(
        'pointerdown', {'pointerId': 30, 'pointerType': 'mouse', 'button': 0,
                        'clientX': 120, 'clientY': 200})
    page.locator('.ws-roll-note').first.dispatch_event('pointerup', {'pointerId': 30})
    page.get_by_role('button', name='+ semitone', exact=True).click()
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately', timeout=30000)
    page.wait_for_timeout(200)
    saved_dirty = dirty()
    saved_pitch = page.locator('.ws-roll-note').first.get_attribute('data-pitch')
    # Edit B, then undo back to the saved point.
    page.get_by_role('button', name='+ semitone', exact=True).click()
    page.wait_for_timeout(200)
    edit_dirty = dirty()
    page.get_by_role('button', name='Undo', exact=True).click()
    page.wait_for_timeout(200)
    undo_dirty = dirty()
    undo_pitch = page.locator('.ws-roll-note').first.get_attribute('data-pitch')
    page.get_by_role('button', name='Redo', exact=True).click()
    page.wait_for_timeout(200)
    redo_dirty = dirty()
    redo_pitch = page.locator('.ws-roll-note').first.get_attribute('data-pitch')
    result = {'saved_clean': saved_dirty == 'false', 'edit_dirty': edit_dirty == 'true',
              'undo_clean': undo_dirty == 'false', 'redo_dirty': redo_dirty == 'true',
              'undo_pitch': undo_pitch, 'saved_pitch': saved_pitch, 'redo_pitch': redo_pitch}
    result['passed'] = all([result['saved_clean'], result['edit_dirty'], result['undo_clean'],
                            result['redo_dirty'], undo_pitch == saved_pitch, redo_pitch != saved_pitch])
    print(result)
    context.close()
    browser.close()
Path(__file__).with_name('savepoint-results.json').write_text(
    __import__('json').dumps(result, indent=2), encoding='utf-8')
raise SystemExit(0 if result['passed'] else 1)
