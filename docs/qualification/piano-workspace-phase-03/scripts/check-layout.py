"""Phase 3 layout, culling and viewport evidence with real assertions.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-03/scripts/check-layout.py
  python docs/qualification/piano-workspace-phase-03/scripts/check-layout.py --base-url http://127.0.0.1:5173 --lesson <id>

Authentication reuses a saved browser session in the scratch directory so repeated
runs do not keep logging in (the local API throttles repeated attempts). Output goes
to <phase folder>/captures and <phase folder>/phase3-result.json. The process exits
nonzero when an acceptance condition fails, so it can gate a submission.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PHASE_DIR = Path(__file__).resolve().parents[1]
CAPTURES = PHASE_DIR / 'captures'
SCRATCH = PHASE_DIR.parents[1] / '.local' / 'phase3'
SESSION = SCRATCH / 'session.json'
FAILURES: list[str] = []
RESULT: dict = {}

GEOMETRY = """() => {
  const roll = document.querySelector('.ws-roll-svg');
  const score = document.querySelector('.ws-score-svg');
  const viewport = document.querySelector('.ws-roll-viewport');
  return {
    window_label: document.querySelector('.ws-window-label')?.textContent?.trim() ?? null,
    window_span: Number(document.querySelector('.ws-window-label')?.dataset.windowSpan ?? 0),
    roll_rendered_notes: roll ? Number(roll.dataset.culledNotes) : null,
    roll_total_notes: roll ? Number(roll.dataset.totalNotes) : null,
    roll_pitch_height: roll ? Number(roll.dataset.pitchHeight) : null,
    roll_plot_height: roll ? Number(roll.dataset.plotHeight) : null,
    roll_scroll_left: viewport ? Math.round(viewport.scrollLeft) : -1,
    roll_scroll_top: viewport ? Math.round(viewport.scrollTop) : -1,
    score_rendered_measures: score ? Number(score.dataset.renderedMeasures) : null,
    score_total_measures: score ? Number(score.dataset.totalMeasures) : null,
    score_rendered_notes: score ? Number(score.dataset.renderedNotes) : null,
    score_scroll_left: Math.round(document.querySelector('.ws-score-viewport')?.scrollLeft ?? -1),
    page_scroll_width: document.documentElement.scrollWidth,
    page_client_width: document.documentElement.clientWidth,
    videos: document.querySelectorAll('video').length,
    white_keys: document.querySelectorAll('.keyboard-white').length,
    playhead: document.querySelector('.ws-time')?.textContent?.trim() ?? null,
    status: document.querySelector('.ws-status')?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 90) ?? null,
    selected: document.querySelector('.ws-facts')?.textContent?.replace(/\\s+/g, ' ').slice(0, 60) ?? null,
  };
}"""


def expect(condition, message: str) -> None:
    if not condition:
        FAILURES.append(message)


def auth(context, base: str) -> None:
    email = os.environ.get('PHASE1_UI_EMAIL') or 'owner@ui.test'
    password = os.environ.get('PHASE1_UI_PASSWORD') or 'PianoDemo2026!'
    response = context.request.post(f'{base}/api/auth/login',
        data={'email': email, 'password': password},
        headers={'Origin': base, 'X-Form-Request': '1'})
    if response.status != 200:
        print(f'ERROR: login failed with HTTP {response.status}', file=sys.stderr)
        raise SystemExit(2)


def main() -> int:
    parser = argparse.ArgumentParser(description='Capture and assert the Phase 3 layout.')
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--lesson', default='0df28929d427406cb86d9bb5e2dcd35b')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    SCRATCH.mkdir(parents=True, exist_ok=True)
    CAPTURES.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            storage_state=str(SESSION) if SESSION.exists() else None,
        )
        page = context.new_page()
        errors: list[str] = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(f'{base}/workspace-harness.html?id={args.lesson}', wait_until='domcontentloaded')
        page.wait_for_timeout(1500)
        if page.locator('.ws-roll-svg').count() == 0:
            auth(context, base)
            context.storage_state(path=str(SESSION))
            page.reload(wait_until='domcontentloaded')
            page.wait_for_timeout(1500)
            errors.clear()  # the pre-login 401 is expected while establishing the session
        page.wait_for_selector('.ws-roll-svg', timeout=120_000)
        page.wait_for_timeout(600)

        def geometry() -> dict:
            return page.evaluate(GEOMETRY)

        initial = geometry()
        RESULT['desktop_initial'] = initial
        expect(initial['window_span'] == 10, f"default window should be 10 s, got {initial['window_span']}")
        expect(initial['roll_rendered_notes'] is not None and initial['roll_rendered_notes'] < 200,
               f"roll should cull notes, rendered {initial['roll_rendered_notes']}")
        expect(initial['score_rendered_measures'] is not None and initial['score_rendered_measures'] < 15,
               f"score should cull measures, rendered {initial['score_rendered_measures']}")
        expect(initial['videos'] == 1, f"expected one video, got {initial['videos']}")
        expect(initial['page_scroll_width'] == initial['page_client_width'], 'page must not overflow horizontally')
        expect(initial['white_keys'] >= 30, f"desktop keybed should show five octaves, got {initial['white_keys']} white keys")
        page.screenshot(path=str(CAPTURES / 'layout-desktop.png'))

        page.evaluate("""() => {
          const scroller = document.querySelector('.ws-roll-viewport');
          scroller.scrollLeft = 3000;
          scroller.dispatchEvent(new Event('scroll'));
        }""")
        page.wait_for_timeout(500)
        scrolled = geometry()
        RESULT['after_roll_scroll'] = scrolled
        expect(scrolled['window_label'] != initial['window_label'], 'scrolling must move the window')
        expect(scrolled['playhead'] == initial['playhead'], 'scrolling must not seek')
        expect('No changes' in (scrolled['status'] or ''), 'scrolling must not dirty the document')

        page.get_by_role('button', name='Zoom in').click()
        page.wait_for_timeout(400)
        zoomed = geometry()
        RESULT['after_zoom_in'] = zoomed
        expect(zoomed['window_span'] < scrolled['window_span'], 'zoom in must reduce the window')
        expect(zoomed['playhead'] == initial['playhead'], 'zooming must not seek')

        page.locator('.ws-overview svg').click(position={'x': 900, 'y': 20})
        page.wait_for_timeout(400)
        panned = geometry()
        RESULT['after_overview_click'] = panned
        expect('No changes' in (panned['status'] or ''), 'overview pan must not dirty the document')
        expect(panned['playhead'] == initial['playhead'], 'overview pan must not seek')

        clicked = page.evaluate("""() => {
          const viewport = document.querySelector('.ws-roll-viewport').getBoundingClientRect();
          const notes = [...document.querySelectorAll('.ws-roll-note')];
          const visible = notes.find(note => {
            const rect = note.getBoundingClientRect();
            return rect.left >= viewport.left + 4 && rect.right <= viewport.right - 4 && rect.width > 1
              && rect.top >= viewport.top + 4 && rect.bottom <= viewport.bottom - 4;
          });
          if (!visible) return null;
          visible.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
          return visible.dataset.occurrence;
        }""")
        page.wait_for_timeout(500)
        selected = geometry()
        RESULT['clicked_occurrence'] = clicked
        RESULT['after_selection'] = selected
        expect(clicked is not None, 'no visible note could be selected')
        expect(selected['selected'] and clicked in (selected['selected'] or ''), 'selection did not take')
        RESULT['score_contains_selection'] = page.evaluate("""() => {
          const selected = document.querySelector('.ws-score-notehead.is-selected');
          if (!selected) return false;
          const box = selected.getBoundingClientRect();
          const host = document.querySelector('.ws-score-viewport').getBoundingClientRect();
          return box.left >= host.left && box.right <= host.right;
        }""")
        expect(RESULT['score_contains_selection'], 'selection was not revealed in the score')
        page.screenshot(path=str(CAPTURES / 'layout-selected.png'))

        before_pan = geometry()
        page.evaluate("""() => {
          const scroller = document.querySelector('.ws-roll-viewport');
          scroller.scrollLeft += 1500;
          scroller.dispatchEvent(new Event('scroll'));
        }""")
        page.wait_for_timeout(600)
        after_pan = geometry()
        RESULT['after_pan_with_selection'] = after_pan
        expect(after_pan['window_label'] != before_pan['window_label'], 'panning after a selection was reverted')
        expect(after_pan['roll_scroll_left'] != before_pan['roll_scroll_left'], 'scroll position did not persist')
        expect(after_pan['playhead'] == before_pan['playhead'], 'panning must not seek')

        page.get_by_role('button', name='Reveal in views').click()
        page.wait_for_timeout(600)
        revealed = geometry()
        RESULT['after_explicit_reveal'] = revealed
        expect(revealed['window_label'] != after_pan['window_label'], 'explicit reveal did not move the window')

        page.locator('.ws-roll-viewport').click(position={'x': 300, 'y': 12})
        page.wait_for_timeout(500)
        seeked = geometry()
        RESULT['after_ruler_seek'] = seeked
        expect(seeked['playhead'] != revealed['playhead'], 'ruler click should seek')
        expect('No changes' in (seeked['status'] or ''), 'seeking must not dirty the document')

        for _ in range(4):
            page.get_by_role('button', name='Zoom out').click()
            page.wait_for_timeout(150)
        page.wait_for_timeout(400)
        RESULT['zoomed_out'] = geometry()
        page.screenshot(path=str(CAPTURES / 'layout-zoom-out.png'))

        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(900)
        mobile = geometry()
        RESULT['mobile'] = mobile
        expect(mobile['page_scroll_width'] == mobile['page_client_width'], 'narrow page must not overflow horizontally')
        expect(mobile['white_keys'] <= 22, f"narrow keybed should be three octaves, got {mobile['white_keys']} white keys")
        expect(mobile['videos'] == 1, 'one video on narrow screens too')
        page.screenshot(path=str(CAPTURES / 'layout-mobile.png'))

        RESULT['console_errors'] = errors[:8]
        expect(not errors, f"console errors: {errors[:3]}")
        browser.close()

    RESULT['failures'] = FAILURES
    (PHASE_DIR / 'phase3-result.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps(RESULT, indent=2)[:3000])
    if FAILURES:
        print(f'\n{len(FAILURES)} acceptance check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(f' - {item}', file=sys.stderr)
        return 1
    print('\nAll Phase 3 acceptance checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
