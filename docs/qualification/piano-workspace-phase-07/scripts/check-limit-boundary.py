"""Approval-enabled boundary: 4,999 and 5,000 stay editable; 5,001 is read-only."""
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
spec = importlib.util.spec_from_file_location('boundary_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
b_spec = importlib.util.spec_from_file_location('boundary_bench', SCRIPTS / 'bench-interactive.py')
bench = importlib.util.module_from_spec(b_spec); b_spec.loader.exec_module(bench)


def draft_for(count):
    base = bench.limit_draft(5000)
    events = list(base['events'])[:count]
    if count > len(events):
        events.append({'id': 'boundary-extra', 'onset': 1000.0, 'duration': 0.2, 'pitch': 60,
                       'velocity': 0.6, 'confidence': None, 'optional': False, 'string': None, 'fret': None})
    return {**base, 'events': events}


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    for count, editable in ((4999, True), (5000, True), (5001, False)):
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script('window.__PIANO_INTERACTIVE_LIMIT_APPROVED__ = true;')
        context.route('**/api/**', m.World(draft_for(count)).route)
        page = context.new_page()
        page.set_default_timeout(20000)
        page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
        page.wait_for_selector('.ws-roll-note', timeout=60000)
        read_only = page.locator('[data-read-only="true"]').count() == 1
        assert read_only is (not editable), (count, read_only)
        if not editable:
            assert page.locator('[data-save-button="true"]').is_disabled()
        else:
            assert page.locator('.ws-shell').get_attribute('data-interactive-mode') == 'editing'
        if editable:
            occurrence = page.locator('.ws-roll-note[data-pitch="68"]').first.get_attribute('data-occurrence')
            node = page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]')
            box = node.bounding_box()
            page.evaluate("""async ([x, y]) => {
              const node = document.elementFromPoint(x, y);
              const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
                pointerId: 61, pointerType: 'mouse', button: 0, buttons: 1,
                clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
              fire('pointerdown', 0); fire('pointermove', -8);
              await new Promise(resolve => requestAnimationFrame(() => resolve()));
              fire('pointerup', -8);
              await new Promise(resolve => requestAnimationFrame(() => resolve()));
            }""", [box['x'] + 4, box['y'] + box['height'] / 2])
            snapshot = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
            assert snapshot['past'] == 1, (count, snapshot['past'])
            assert page.locator('[data-read-only="true"]').count() == 0
        print({'count': count, 'read_only': read_only, 'editable': editable})
        context.close()
    browser.close()
