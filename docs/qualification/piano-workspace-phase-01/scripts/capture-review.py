"""Phase 1 evidence: capture the existing review experience for the real draft.

Read-only: no edits, no saves. Records screenshots plus DOM/geometry measurements that the
audit cites. Credentials are read from the local UI-test account used by the dev server.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
URL = f'{BASE}/?page=music-review&id={LESSON}'
OUT = Path(__file__).resolve().parent.parent / 'captures'
OUT.mkdir(exist_ok=True)

SUMMARY = {}


def measure(page):
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
        body_text_head: text.slice(0, 240),
        shows_edit_heading: text.includes('Edit proposed notes'),
        note_count_claim: (text.match(/(\\d+) notes\\. Changes reset/) || [])[1] || null,
        pagination: (text.match(/Page (\\d+) of (\\d+)/) || [null, null, null]).slice(1),
      };
    }""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    login = context.request.post(f'{BASE}/api/auth/login',
        data={'email': 'owner@ui.test', 'password': 'PianoDemo2026!'},
        headers={'Origin': BASE, 'X-Form-Request': '1'})
    SUMMARY['login_status'] = login.status

    page = context.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    started = time.time()
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_selector('.music-review-notes', timeout=90_000)
    SUMMARY['seconds_to_note_forms'] = round(time.time() - started, 2)
    SUMMARY['desktop'] = measure(page)
    page.screenshot(path=str(OUT / 'review-desktop-1440x900.png'), full_page=False)
    page.screenshot(path=str(OUT / 'review-desktop-full.png'), full_page=True)

    # Long example: how tall is the page once every note row has rendered?
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(800)
    SUMMARY['mobile'] = measure(page)
    page.screenshot(path=str(OUT / 'review-mobile-390x844.png'), full_page=False)

    SUMMARY['console_errors'] = errors[:10]
    SUMMARY['library'] = context.request.get(f'{BASE}/api/lessons/summaries',
        headers={'X-Lesson-Formats': '1,2'}).json()
    browser.close()

(OUT.parent / 'measurements.json').write_text(json.dumps(SUMMARY, indent=2, default=str), encoding='utf-8')
print(json.dumps(SUMMARY, indent=2, default=str)[:4000])

