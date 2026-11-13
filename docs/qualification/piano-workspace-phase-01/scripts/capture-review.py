"""Phase 1 evidence: capture the existing review experience for the real draft.

Read-only: it authenticates, loads the page, records DOM/geometry measurements and
screenshots. Nothing is submitted and no musical data is modified.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/capture-review.py
"""
from __future__ import annotations

import argparse
import json
import sys
import time
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


def measure(page) -> dict:
    return page.evaluate("""() => {
      const q = s => document.querySelectorAll(s);
      const text = document.body.innerText;
      return {
        note_fieldsets: q('.music-review-notes fieldset').length,
        videos: q('video').length,
        svg_rolls: q('.draft-roll').length,
        canvases: q('canvas').length,
        page_scroll_width: document.documentElement.scrollWidth,
        page_client_width: document.documentElement.clientWidth,
        page_scroll_height: document.documentElement.scrollHeight,
        shows_edit_heading: text.includes('Edit proposed notes'),
        note_count_claim: (text.match(/(\\d+) notes\\. Changes reset/) || [])[1] || null,
        pagination: (text.match(/Page (\\d+) of (\\d+)/) || [null, null, null]).slice(1),
      };
    }""")


def main() -> None:
    parser = argparse.ArgumentParser(description='Capture the current review page (read-only).')
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--lesson', default=LESSON)
    parser.add_argument('--out', type=Path, default=SCRATCH)
    args = parser.parse_args()

    base = args.base_url.rstrip('/')
    url = f'{base}/?page=music-review&id={args.lesson}'
    captures = args.out / 'captures'
    captures.mkdir(parents=True, exist_ok=True)
    require_server(base)

    summary: dict = {'url': url}
    with sync_playwright() as pw:
        browser = launch(pw)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        summary['login_status'] = login(context, base)
        page = context.new_page()
        errors: list[str] = []
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        started = time.time()
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_selector('.music-review-notes', timeout=90_000)
        summary['seconds_to_note_forms'] = round(time.time() - started, 2)
        summary['desktop'] = measure(page)
        page.screenshot(path=str(captures / 'review-desktop-1440x900.png'))
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(800)
        summary['mobile'] = measure(page)
        page.screenshot(path=str(captures / 'review-mobile-390x844.png'))
        summary['console_errors'] = errors[:10]
        browser.close()

    write_json(args.out / 'measurements.json', summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
