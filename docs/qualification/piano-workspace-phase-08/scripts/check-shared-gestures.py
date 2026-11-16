"""Roll gesture mapping under the shared nonuniform timeline."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_shared_gesture', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
results = {}


def snapshot(page):
    return page.evaluate('() => window.__pianoWorkspaceSnapshot()')


def note_of(snap, occurrence):
    return next(n for n in snap['document']['performance'] if n['id'] == occurrence)


def drag(page, handle, dx, dy=0):
    box = page.locator(handle).bounding_box()
    page.mouse.move(box['x'] + 3, box['y'] + box['height'] / 2)
    page.mouse.down(); page.mouse.move(box['x'] + 3 + dx, box['y'] + box['height'] / 2 + dy, steps=4)
    suspended = page.locator('[data-follow-suspended="true"]').count()
    page.mouse.up(); page.wait_for_timeout(180)
    return suspended


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    for label in ('time', 'resize', 'pitch'):
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.route('**/api/**', m.World(m.LONG).route)
        page = context.new_page(); m.open_route(page)
        note = page.locator('.ws-roll-note').first
        occurrence = note.get_attribute('data-occurrence')
        before = snapshot(page); before_note = note_of(before, occurrence)
        note.click()
        if label == 'time':
            suspended = drag(page, '[data-handle="time"]', 40)
        elif label == 'resize':
            suspended = drag(page, '[data-handle="resize"]', 30)
        else:
            box = note.bounding_box()
            page.mouse.move(box['x'] + 4, box['y'] + box['height'] / 2)
            page.mouse.down(); page.mouse.move(box['x'] + 4, box['y'] + box['height'] / 2 - 14, steps=3)
            suspended = page.locator('[data-follow-suspended="true"]').count()
            page.mouse.up(); page.wait_for_timeout(180)
        after = snapshot(page); after_note = note_of(after, occurrence)
        undo = page.get_by_role('button', name='Undo', exact=True)
        if undo.count():
            undo.click(); page.wait_for_timeout(150)
        restored = note_of(snapshot(page), occurrence)
        results[label] = {
            'before': {k: before_note[k] for k in ('pitch', 'onset', 'duration')},
            'after': {k: after_note[k] for k in ('pitch', 'onset', 'duration')},
            'restored': {k: restored[k] for k in ('pitch', 'onset', 'duration')},
            'one_edit': after['past'] == 1, 'suspended': suspended == 1,
            'undo_restored': abs(restored['pitch'] - before_note['pitch']) < 1e-9
                and abs(restored['onset'] - before_note['onset']) < 1e-9
                and abs(restored['duration'] - before_note['duration']) < 1e-9,
        }
        if label == 'pitch':
            results[label]['timing_unchanged'] = (abs(after_note['onset'] - before_note['onset']) < 1e-9
                and abs(after_note['duration'] - before_note['duration']) < 1e-9)
        context.close()
    browser.close()

ok = all(item['one_edit'] and item['suspended'] and item['undo_restored']
         and (item.get('timing_unchanged', True)) for item in results.values())
Path(__file__).with_name('shared-gesture-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
raise SystemExit(0 if ok else 1)
