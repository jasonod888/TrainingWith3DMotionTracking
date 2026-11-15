"""Approval-enabled read-only integration: banner, mutation rejection, download."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
route_spec = importlib.util.spec_from_file_location('ro_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(route_spec); route_spec.loader.exec_module(m)
bench_spec = importlib.util.spec_from_file_location('ro_bench', SCRIPTS / 'bench-interactive.py')
bench = importlib.util.module_from_spec(bench_spec); bench_spec.loader.exec_module(bench)

draft = bench.limit_draft(5000)
draft['events'] = list(draft['events']) + [
    {'id': 'over-limit', 'onset': 1000.0, 'duration': 0.2, 'pitch': 60, 'velocity': 0.6,
     'confidence': None, 'optional': False, 'string': None, 'fret': None},
]

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    context.add_init_script('window.__PIANO_INTERACTIVE_LIMIT_APPROVED__ = true;')
    context.route('**/api/**', m.World(draft).route)
    page = context.new_page()
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    banner = page.locator('[data-read-only="true"]')
    assert banner.count() == 1, 'read-only banner missing'
    assert page.locator('[data-save-button="true"]').is_disabled(), 'save must be disabled'
    assert page.get_by_role('button', name='Download reference').count() == 1
    before = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    assert len(before['document']['performance']) == 5001
    assert before['past'] == 0
    # Attempt a normal pitch gesture; the reducer must reject it atomically.
    node = page.locator('.ws-roll-note').first
    box = node.bounding_box()
    page.evaluate("""async ([x, y]) => {
      const node = document.elementFromPoint(x, y);
      const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
        pointerId: 71, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
      fire('pointerdown', 0); fire('pointermove', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      fire('pointerup', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }""", [box['x'] + 4, box['y'] + box['height'] / 2])
    after = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    assert after['document']['performance'] == before['document']['performance']
    assert after['past'] == 0, 'rejected mutation must add no history'
    reports = page.locator('.ws-report').all_inner_texts()
    assert any('limited' in text.lower() or 'read-only' in text.lower() for text in reports), reports
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download reference').click()
    download = download_info.value
    exported = json.loads(Path(download.path()).read_text(encoding='utf-8'))
    assert exported['occurrenceCount'] == 5001
    assert len(exported['document']['performance']) == 5001
    assert exported['editingMode'] == 'read-only'
    assert exported['authored']['identity']['lessonId'] == m.LESSON
    print(json.dumps({'count': 5001, 'banner': True, 'save_disabled': True,
                      'mutation_rejected': True, 'history': 0, 'download': exported['kind']}, indent=2))
    context.close(); browser.close()
