"""Interactive performance evidence: real 1,338-note draft and a 20,000-note limit fixture."""
import importlib.util
import json
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase7_perf', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OUT = ROOT / 'docs/qualification/piano-workspace-phase-07/phase7-performance.json'
CAPTURES = ROOT / 'docs/qualification/piano-workspace-phase-07/captures'
RESULT = {'scope': 'controlled dev server, mocked API, local video fixture', 'runs': 20}


def limit_draft(count=20_000):
    events = []
    pitches = [60, 64, 67, 71, 74]
    for index in range(count):
        events.append({'id': f'big-{index}', 'onset': 0.5 + (index % 4000) * 0.04,
                       'duration': 0.04 * 5, 'pitch': pitches[index % 5],
                       'velocity': 0.6, 'confidence': None, 'optional': False,
                       'string': None, 'fret': None})
    return {**m.LONG, 'title': f'{count} event fixture', 'duration': 200,
            'events': events, 'spans': [{'start': 0, 'end': 200, 'kind': 'playing'}]}


def measure(page):
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    metrics = page.evaluate("""() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {domMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd),
              notes: document.querySelectorAll('.ws-roll-note').length,
              heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
              recoveryBytes: (localStorage.getItem('piano-workspace-recovery-v1') || '').length};
    }""")
    node = page.locator('.ws-roll-note').first
    node.scroll_into_view_if_needed()
    pitch_before = node.get_attribute('data-pitch')
    box = node.bounding_box()
    samples = []
    for _ in range(20):
        samples.append(page.evaluate("""async ([x, y]) => {
          const node = document.querySelector('.ws-roll-note');
          const fire = (kind, id, dy) => node.dispatchEvent(new PointerEvent(kind, {
            pointerId: id, pointerType: 'mouse', button: 0, buttons: 1,
            clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
          const start = performance.now();
          fire('pointerdown', 41, 0); fire('pointermove', 41, -8);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          const preview = performance.now() - start;
          const commitStart = performance.now();
          fire('pointerup', 41, -8);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          return {preview, commit: performance.now() - commitStart};
        }""", [box['x'] + 4, box['y'] + box['height'] / 2]))
    def stat(key):
        values = sorted(item[key] for item in samples)
        return {'median': round(statistics.median(values), 2), 'p95': round(values[-1], 2)}
    metrics['pointer'] = {key: stat(key) for key in ('preview', 'commit')}
    metrics['pointer_samples'] = samples
    metrics['gesture_applied'] = page.locator('.ws-roll-note').first.get_attribute('data-pitch') != pitch_before
    metrics['undo_enabled'] = page.get_by_role('button', name='Undo', exact=True).is_enabled()
    metrics['history_label'] = page.locator('.ws-report').all_inner_texts()[:2]
    return metrics


def run_case(browser, world, label):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', world.route)
    page = context.new_page()
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    metrics = measure(page)
    page.screenshot(path=str(CAPTURES / f'performance-{label}.png'))
    context.close()
    return metrics


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        real = m.World(m.LONG)
        RESULT['real_1338'] = run_case(browser, real, 'real')
        for count in (5_000, 10_000, 20_000):
            limit = m.World(limit_draft(count))
            RESULT[f'limit_{count}'] = run_case(browser, limit, f'limit-{count}')
        browser.close()
    OUT.write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps(RESULT, indent=2))


if __name__ == '__main__':
    main()
