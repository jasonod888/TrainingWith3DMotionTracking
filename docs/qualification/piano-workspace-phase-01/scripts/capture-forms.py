"""Phase 1 evidence: the note-form wall and roll density of the existing review page."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
URL = f'{BASE}/?page=music-review&id={LESSON}'
OUT = Path(__file__).with_name('captures')

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    context.request.post(f'{BASE}/api/auth/login',
        data={'email': 'owner@ui.test', 'password': 'PianoDemo2026!'},
        headers={'Origin': BASE, 'X-Form-Request': '1'})
    page = context.new_page()
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_selector('.music-review-notes', timeout=90_000)
    page.locator('h2', has_text='Edit proposed notes').first.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / 'review-note-forms-1440x900.png'))

    geometry = page.evaluate("""() => {
      const roll = document.querySelector('.draft-roll');
      const rect = roll.getBoundingClientRect();
      const fieldsets = [...document.querySelectorAll('.music-review-notes fieldset')];
      const row = fieldsets[0].getBoundingClientRect();
      const first = fieldsets[0];
      const inputs = [...first.querySelectorAll('label')].map(l => l.textContent.trim().slice(0, 28));
      return {
        roll_css_px: {width: Math.round(rect.width), height: Math.round(rect.height)},
        pixels_per_second: +(rect.width / 209.594).toFixed(2),
        fieldset_height_px: Math.round(row.height),
        fieldset_labels: inputs,
        scroll_position: Math.round(window.scrollY),
      };
    }""")
    print(json.dumps(geometry, indent=2))
    browser.close()
