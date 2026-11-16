"""A normal edit must still commit after returning from formatted preview."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_post_preview', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', m.World(m.LONG).route)
    page = context.new_page(); m.open_route(page)
    note = page.locator('.ws-roll-note').first
    before_pitch = int(note.get_attribute('data-pitch'))
    note.click()
    page.get_by_role('button', name='Formatted score', exact=True).click()
    page.wait_for_selector('[data-formatted-page="1"]')
    page.get_by_role('button', name='Return to correction', exact=True).click()
    page.wait_for_selector('.ws-roll-note')
    page.get_by_role('button', name='+ semitone', exact=True).click()
    page.wait_for_timeout(200)
    snap = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    after_pitch = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    result = {'before': before_pitch, 'after': after_pitch, 'past': snap['past'],
              'passed': after_pitch == before_pitch + 1 and snap['past'] == 1}
    page.get_by_role('button', name='Undo', exact=True).click()
    page.wait_for_timeout(150)
    restored = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    result['undo_restored'] = restored == before_pitch
    Path(__file__).with_name('post-preview-edit-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
    context.close(); browser.close()
raise SystemExit(0 if result['passed'] and result['undo_restored'] else 1)
