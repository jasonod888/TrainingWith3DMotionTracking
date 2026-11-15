"""Capture Playwright traces for a real-recording edit and the 20k limit edit."""
import importlib.util
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'docs/qualification/piano-workspace-phase-07/captures'
BASE = os.environ.get('PERF_BASE', 'http://localhost:4173')

route_spec = importlib.util.spec_from_file_location(
    'phase7_trace_route', ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py')
route = importlib.util.module_from_spec(route_spec)
route_spec.loader.exec_module(route)
bench_spec = importlib.util.spec_from_file_location(
    'phase7_trace_bench', ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/bench-interactive.py')
bench = importlib.util.module_from_spec(bench_spec)
bench_spec.loader.exec_module(bench)


def capture(browser, draft, name):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', route.World(draft).route)
    context.tracing.start(screenshots=True, snapshots=False, sources=False)
    page = context.new_page()
    page.goto(f'{BASE}/?page=music-review&id={route.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    node = page.locator('.ws-roll-note').first
    node.scroll_into_view_if_needed()
    box = node.bounding_box()
    page.evaluate("""async ([x, y]) => {
      const node = document.querySelector('.ws-roll-note');
      const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
        pointerId: 71, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
      fire('pointerdown', 0); fire('pointermove', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      fire('pointerup', -8);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }""", [box['x'] + 4, box['y'] + box['height'] / 2])
    page.wait_for_timeout(300)
    path = OUT / name
    context.tracing.stop(path=str(path))
    context.close()
    return str(path)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    print(capture(browser, route.LONG, 'trace-real-edit.zip'))
    print(capture(browser, bench.limit_draft(20_000), 'trace-20k-edit.zip'))
    browser.close()
