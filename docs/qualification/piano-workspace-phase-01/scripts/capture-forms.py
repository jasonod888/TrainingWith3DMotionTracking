"""Phase 1 evidence: the note-form wall and roll density of the existing review page.

Read-only. Uses the same login helper as capture-review.py.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/capture-forms.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import SCRATCH, write_json
from lib.ui import launch, login, require_server

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('ERROR: playwright is not installed in this interpreter.\n'
          'HINT: pip install playwright && python -m playwright install chromium', file=sys.stderr)
    raise SystemExit(2)

LESSON = '0df28929d427406cb86d9bb5e2dcd35b'


def main() -> None:
    parser = argparse.ArgumentParser(description='Capture the note-form list (read-only).')
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--lesson', default=LESSON)
    parser.add_argument('--out', type=Path, default=SCRATCH)
    args = parser.parse_args()

    base = args.base_url.rstrip('/')
    url = f'{base}/?page=music-review&id={args.lesson}'
    captures = args.out / 'captures'
    captures.mkdir(parents=True, exist_ok=True)
    require_server(base)

    with sync_playwright() as pw:
        browser = launch(pw)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        login(context, base)
        page = context.new_page()
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_selector('.music-review-notes', timeout=90_000)
        page.locator('h2', has_text='Edit proposed notes').first.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        page.screenshot(path=str(captures / 'review-note-forms-1440x900.png'))
        geometry = page.evaluate("""() => {
          const roll = document.querySelector('.draft-roll');
          const rect = roll.getBoundingClientRect();
          const fieldsets = [...document.querySelectorAll('.music-review-notes fieldset')];
          const row = fieldsets[0].getBoundingClientRect();
          return {
            roll_css_px: {width: Math.round(rect.width), height: Math.round(rect.height)},
            pixels_per_second: +(rect.width / 209.594).toFixed(2),
            fieldset_height_px: Math.round(row.height),
            fieldset_count: fieldsets.length,
            scroll_position: Math.round(window.scrollY),
          };
        }""")
        browser.close()

    write_json(args.out / 'form-geometry.json', geometry)
    print(json.dumps(geometry, indent=2))


if __name__ == '__main__':
    main()
