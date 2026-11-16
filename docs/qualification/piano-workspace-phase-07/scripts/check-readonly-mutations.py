"""Parameterised read-only mutation families: no canonical/authored/history/network mutation."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
spec = importlib.util.spec_from_file_location('ro_mut_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
b_spec = importlib.util.spec_from_file_location('ro_mut_bench', SCRIPTS / 'bench-interactive.py')
bench = importlib.util.module_from_spec(b_spec); b_spec.loader.exec_module(bench)

draft = bench.limit_draft(5000)
draft['events'] = list(draft['events']) + [
    {'id': 'over-limit', 'onset': 1000.0, 'duration': 0.2, 'pitch': 60, 'velocity': 0.6,
     'confidence': None, 'optional': False, 'string': None, 'fret': None},
]

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_init_script('window.__PIANO_INTERACTIVE_LIMIT_APPROVED__ = true;')
    context.route('**/api/**', m.World(draft).route)
    writes = []
    context.on('request', lambda request: writes.append((request.method, request.url))
               if request.method not in ('GET', 'HEAD', 'OPTIONS') else None)
    page = context.new_page()
    page.set_default_timeout(15000)
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    before = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    offset = page.locator('[aria-label="Sync offset in seconds"]')
    assessment = page.locator('[data-assessment-policy]')
    storage_before = page.evaluate("() => localStorage.getItem('piano-workspace-recovery-v1') || ''")
    authored_before = {'offset': offset.input_value(), 'assessment': assessment.input_value(),
                       'dirty': page.locator('.ws-shell').get_attribute('data-workspace-dirty')}

    actions = []
    def action(name, callback):
        callback()
        page.wait_for_timeout(120)
        after = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
        storage_after = page.evaluate("() => localStorage.getItem('piano-workspace-recovery-v1') || ''")
        assert after['document'] == before['document'], name
        assert after['past'] == before['past'] and after['future'] == before['future'], name
        assert storage_after == storage_before, name
        actions.append(name)

    action('offset-programmatic', lambda: offset.evaluate(
        "node => { node.value = '0.5'; node.dispatchEvent(new Event('input', {bubbles: true})); "
        "node.dispatchEvent(new Event('change', {bubbles: true})); }"))
    action('assessment-programmatic', lambda: assessment.evaluate(
        "node => { node.value = 'notes'; node.dispatchEvent(new Event('change', {bubbles: true})); }"))
    for selector, name in [('[data-section-add]', 'add-section'), ('[data-save-button]', 'save'),
                           ('button:has-text("Apply anchor")', 'apply-anchor'),
                           ('button:has-text("Reset")', 'reset-anchors'),
                           ('button:has-text("Delete note")', 'delete-note'),
                           ('button:has-text("Replace pitch")', 'replace-pitch')]:
        if page.locator(selector).count():
            action(name, lambda selector=selector: page.locator(selector).first.click(force=True))
    # Musical gesture attempt.
    node = page.locator('.ws-roll-note').first
    box = node.bounding_box()
    action('pitch-gesture', lambda: page.evaluate("""async ([x, y]) => {
      const node = document.elementFromPoint(x, y);
      const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
        pointerId: 73, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
      fire('pointerdown', 0); fire('pointermove', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      fire('pointerup', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }""", [box['x'] + 4, box['y'] + box['height'] / 2]))
    # Decision buttons, if a report exists, must not send a request.
    for label in ('Accept', 'Reject'):
        button = page.get_by_role('button', name=label, exact=False)
        if button.count():
            action(f'decision-{label}', lambda button=button: button.first.click(force=True))
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download reference').click()
    exported = json.loads(Path(download_info.value.path()).read_text(encoding='utf-8'))
    assert exported['authored']['offsetSeconds'] == 0.0, exported['authored']
    assert exported['authored']['assessment'] == 'none', exported['authored']
    assert exported['authored']['alignment']['anchors'] == [], exported['authored']
    assert writes == [], writes
    print(json.dumps({'count': 5001, 'actions': actions, 'write_requests': writes,
                      'document_unchanged': True, 'authored_unchanged': True,
                      'history_unchanged': True, 'checkpoint_unchanged': True}, indent=2))
    context.close(); browser.close()
