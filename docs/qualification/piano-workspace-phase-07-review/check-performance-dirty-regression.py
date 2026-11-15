"""Review guard: edit then full undo must restore clean workspace identity."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

source = Path(__file__).resolve().parents[1] / 'piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('normal_perf_review', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    world = m.World(m.LONG)
    context.route('**/api/**', world.route)
    page = context.new_page()
    m.open_route(page)
    note = page.locator('.ws-roll-note').first
    original = note.get_attribute('data-pitch')
    note.click()
    page.get_by_role('button', name='+ semitone').click()
    page.get_by_role('button', name='Undo', exact=True).click()
    page.wait_for_timeout(350)
    restored = page.locator('.ws-roll-note').first.get_attribute('data-pitch')
    reports = page.locator('.ws-report').all_inner_texts()
    dialogs = []
    def dismiss(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()
    page.on('dialog', dismiss)
    page.get_by_role('link', name='Form home').click()
    result = {'pitch_before': original, 'pitch_after_undo': restored,
              'reports': reports,
              'navigation_dialogs_after_full_undo': dialogs,
              'passed': original == restored and not dialogs}
    print(json.dumps(result, indent=2))
    Path(__file__).with_name('performance-dirty-regression-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    context.close()
    browser.close()
raise SystemExit(0 if result['passed'] else 1)
