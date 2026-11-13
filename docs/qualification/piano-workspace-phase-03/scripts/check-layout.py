"""Phase 3 layout, culling and viewport evidence for the isolated harness."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
OUT = Path(__file__).with_name('captures')
OUT.mkdir(exist_ok=True)
result = {}

GEOMETRY = """() => {
  const roll = document.querySelector('.ws-roll-svg');
  const score = document.querySelector('.ws-score-svg');
  return {
    window_label: document.querySelector('.ws-window-label')?.textContent?.trim() ?? null,
    window_span: document.querySelector('.ws-window-label')?.dataset.windowSpan ?? null,
    roll_rendered_notes: roll ? Number(roll.dataset.culledNotes) : null,
    roll_total_notes: roll ? Number(roll.dataset.totalNotes) : null,
    score_rendered_measures: score ? Number(score.dataset.renderedMeasures) : null,
    score_total_measures: score ? Number(score.dataset.totalMeasures) : null,
    score_rendered_notes: score ? Number(score.dataset.renderedNotes) : null,
    roll_scroll_left: Math.round(document.querySelector('.ws-roll-viewport')?.scrollLeft ?? -1),
    score_scroll_left: Math.round(document.querySelector('.ws-score-viewport')?.scrollLeft ?? -1),
    page_scroll_width: document.documentElement.scrollWidth,
    page_client_width: document.documentElement.clientWidth,
    videos: document.querySelectorAll('video').length,
    playhead: document.querySelector('.ws-time')?.textContent?.trim() ?? null,
    status: document.querySelector('.ws-status')?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 90) ?? null,
    selected: document.querySelector('.ws-facts')?.textContent?.replace(/\\s+/g, ' ').slice(0, 40) ?? null,
  };
}"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    context.request.post(f'{BASE}/api/auth/login',
        data={'email': 'owner@ui.test', 'password': 'PianoDemo2026!'},
        headers={'Origin': BASE, 'X-Form-Request': '1'})
    page = context.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    try:
        page.goto(f'{BASE}/workspace-harness.html?id={LESSON}', wait_until='domcontentloaded')
        page.wait_for_selector('.ws-roll-svg', timeout=120_000)
        page.wait_for_timeout(900)

        result['desktop_initial'] = page.evaluate(GEOMETRY)
        page.screenshot(path=str(OUT / 'layout-desktop.png'))

        page.evaluate("""() => {
          const scroller = document.querySelector('.ws-roll-viewport');
          scroller.scrollLeft = 3000;
          scroller.dispatchEvent(new Event('scroll'));
        }""")
        page.wait_for_timeout(500)
        result['after_roll_scroll'] = page.evaluate(GEOMETRY)

        page.get_by_role('button', name='Zoom in').click()
        page.wait_for_timeout(500)
        result['after_zoom_in'] = page.evaluate(GEOMETRY)

        page.locator('.ws-overview svg').click(position={'x': 900, 'y': 20})
        page.wait_for_timeout(500)
        result['after_overview_click'] = page.evaluate(GEOMETRY)

        result['clicked_occurrence'] = page.evaluate("""() => {
          const viewport = document.querySelector('.ws-roll-viewport').getBoundingClientRect();
          const notes = [...document.querySelectorAll('.ws-roll-note')];
          const visible = notes.find(note => {
            const rect = note.getBoundingClientRect();
            return rect.left >= viewport.left + 4 && rect.right <= viewport.right - 4 && rect.width > 1;
          });
          if (!visible) return null;
          visible.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
          return visible.dataset.occurrence;
        }""")
        page.wait_for_timeout(600)
        result['after_selection'] = page.evaluate(GEOMETRY)
        result['score_contains_selection'] = page.evaluate("""() => {
          const selected = document.querySelector('.ws-score-notehead.is-selected');
          if (!selected) return false;
          const box = selected.getBoundingClientRect();
          const host = document.querySelector('.ws-score-viewport').getBoundingClientRect();
          return box.left >= host.left && box.right <= host.right;
        }""")
        page.screenshot(path=str(OUT / 'layout-selected.png'))

        # Ruler click seeks; zooming keeps the playhead where it was on screen.
        page.locator('.ws-roll-viewport').click(position={'x': 300, 'y': 12})
        page.wait_for_timeout(500)
        seeked = page.evaluate(GEOMETRY)
        result['after_ruler_seek'] = seeked
        page.get_by_role('button', name='Zoom in').click()
        page.wait_for_timeout(500)
        result['after_zoom_with_playhead'] = page.evaluate(GEOMETRY)

        for _ in range(4):
            page.get_by_role('button', name='Zoom out').click()
            page.wait_for_timeout(200)
        page.wait_for_timeout(400)
        result['zoomed_out'] = page.evaluate(GEOMETRY)
        page.screenshot(path=str(OUT / 'layout-zoom-out.png'))

        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(800)
        result['mobile'] = page.evaluate(GEOMETRY)
        result['mobile_overflow_sections'] = page.evaluate("""() => {
          const overflowing = [];
          for (const element of document.querySelectorAll('.ws-shell *')) {
            if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === 'visible') {
              overflowing.push(element.className || element.tagName);
            }
          }
          return overflowing.slice(0, 8);
        }""")
        page.screenshot(path=str(OUT / 'layout-mobile.png'), full_page=False)
        result['console_errors'] = errors[:8]
    except Exception as cause:
        result['failure'] = str(cause)
        page.screenshot(path=str(OUT / 'layout-failure.png'))
    finally:
        browser.close()

(OUT.parent / 'phase3-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))

