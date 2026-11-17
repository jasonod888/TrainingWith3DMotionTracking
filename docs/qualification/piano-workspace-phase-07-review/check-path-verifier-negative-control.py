"""Review negative control: a deliberately suppressed resize must not count as applied."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[3]
source = root / 'docs/qualification/piano-workspace-phase-07/scripts/bench-paths.py'
spec = importlib.util.spec_from_file_location('review_paths', source)
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context, page = bench.open_case(browser, bench.m.LONG)
    node = page.locator('.ws-roll-note').first
    occurrence = node.get_attribute('data-occurrence')
    paths = bench.make_paths(page, occurrence, bench.m.LONG['duration'])
    # Deliberately do not dispatch the edit; leave the genuine rendered workspace intact.
    bench.gesture = lambda *args, **kwargs: {'preview': 0.1, 'commit': 0.1}
    before_count = bench.total(page)
    before_dirty = page.locator('.ws-shell').get_attribute('data-workspace-dirty')
    timing, claimed_applied = paths['roll_resize'][0]()
    bench.undo_all(page)
    claimed_restored = bench.total(page) == before_count and page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'false'
    result = {'occurrence': occurrence, 'gesture_was_suppressed': True,
              'dirty_before': before_dirty,
              'dirty_after': page.locator('.ws-shell').get_attribute('data-workspace-dirty'),
              'benchmark_claims_applied': claimed_applied,
              'benchmark_claims_restored': claimed_restored,
              'timing': timing, 'passed': not claimed_applied}
    print(json.dumps(result, indent=2))
    Path(__file__).with_name('path-verifier-negative-control-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    context.close()
    browser.close()
raise SystemExit(0 if result['passed'] else 1)
