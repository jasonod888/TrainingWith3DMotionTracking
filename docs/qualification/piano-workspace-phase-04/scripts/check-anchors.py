"""Phase 4 R4/R2: anchor authoring flow and post-explanation engraving agreement."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
OUT = Path(__file__).with_name('captures')
OUT.mkdir(exist_ok=True)
SESSION = Path('.local/phase3/session.json')
FAILURES = []
RESULT = {}

SET_CLOCK = """(value) => {
  const clock = document.querySelector('input[aria-label="Fixture clock"]');
  if (!clock) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(clock, String(value));
  clock.dispatchEvent(new Event('input', {bubbles: true}));
  return true;
}"""

STATE = """() => {
  const head = document.querySelector('.ws-score-playhead');
  const active = [...document.querySelectorAll('.ws-score-notehead.is-active')];
  const ellipses = active.map(node => Number(node.getAttribute('cx')));
  const alignment = document.querySelector('.ws-alignment');
  return {
    mode: alignment?.dataset.alignmentMode ?? null,
    playhead_tick: alignment?.dataset.playheadTick ?? '',
    cursor_x: head ? Number(head.getAttribute('x1')) : null,
    active_x: ellipses,
    anchor_points: document.querySelectorAll('.ws-panel[aria-label="Alignment"] button').length,
    status: document.querySelector('.ws-status')?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 60) ?? null,
    notice: document.querySelector('.ws-toast, .ws-report')?.textContent ?? '',
  };
}"""


def expect(condition, message):
    if not condition:
        FAILURES.append(message)


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 900},
            storage_state=str(SESSION) if SESSION.exists() else None)
        page = context.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        try:
            page.goto(f'{BASE}/workspace-harness.html?id={LESSON}', wait_until='domcontentloaded')
            page.wait_for_timeout(1500)
            if page.locator('.ws-roll-svg').count() == 0:
                login = context.request.post(f'{BASE}/api/auth/login',
                    data={'email': 'owner@ui.test', 'password': 'PianoDemo2026!'},
                    headers={'Origin': BASE, 'X-Form-Request': '1'})
                if login.status != 200:
                    raise RuntimeError(f'login failed with HTTP {login.status}')
                context.storage_state(path=str(SESSION))
                errors.clear()
                page.reload(wait_until='domcontentloaded')
                page.wait_for_timeout(1500)
            page.wait_for_selector('.ws-roll-svg', timeout=120_000)
            page.wait_for_timeout(600)

            # R4: author an anchor at the current source position.
            panel = page.locator('.ws-panel[aria-label="Alignment"]')
            page.evaluate("""() => {
              const video = document.querySelector('video');
              if (video) { video.pause(); video.currentTime = 10; video.dispatchEvent(new Event('seeked')); }
            }""")
            page.wait_for_timeout(500)
            panel.get_by_role('button', name='Use current').click()
            page.wait_for_timeout(150)
            tick = page.get_by_label('Anchor tick').input_value()
            RESULT['anchor_tick'] = tick
            panel.get_by_role('button', name='Apply anchor').click()
            page.wait_for_timeout(500)
            applied = page.evaluate(STATE)
            RESULT['anchor_applied'] = applied
            expect(applied['mode'] == 'anchored', f"anchor did not anchor the map: {applied['mode']}")
            expect('No changes' in (applied['status'] or ''), 'authoring an anchor must not dirty the document')

            panel.get_by_role('button', name='Undo point').click()
            page.wait_for_timeout(300)
            undone = page.evaluate(STATE)
            RESULT['anchor_undone'] = undone
            expect(undone['mode'] == 'estimated', f"undo did not restore the estimate: {undone['mode']}")

            panel.get_by_role('button', name='Redo point').click()
            page.wait_for_timeout(300)
            redone = page.evaluate(STATE)
            RESULT['anchor_redone'] = redone
            expect(redone['mode'] == 'anchored', 'redo did not restore the anchor')

            # Seeking still resolves through the anchored map.
            page.evaluate("""() => {
              const video = document.querySelector('video');
              if (video) { video.currentTime = 25; video.dispatchEvent(new Event('seeked')); }
            }""")
            page.wait_for_timeout(400)
            moved = page.evaluate(STATE)
            RESULT['anchor_seek'] = moved
            expect(moved['playhead_tick'] not in ('', None), 'no tick after seeking with an anchor')
            page.screenshot(path=str(OUT / 'anchors.png'))

            # R2: the engraved note after the explanation sits under the cursor.
            page.goto(f'{BASE}/workspace-harness.html?demo=explanation', wait_until='domcontentloaded')
            page.wait_for_selector('.ws-roll-svg', timeout=60_000)
            page.wait_for_timeout(400)
            page.evaluate(SET_CLOCK, 8)
            page.wait_for_timeout(400)
            state = page.evaluate(STATE)
            RESULT['explanation_note'] = state
            expect(abs(int(state['playhead_tick']) - 4800) <= 2, f"cursor tick {state['playhead_tick']} != 4800")
            if state['active_x']:
                closest = min(abs(state['cursor_x'] - x) for x in state['active_x'])
                RESULT['notehead_vs_cursor_px'] = closest
                expect(closest <= 1.5, f'the post-explanation notehead is {closest}px from its cursor')
            else:
                FAILURES.append('no active notehead at 8 s after the explanation')

            # The explanation ruler seeks by written position, not absolute seconds.
            page.locator('.ws-score-viewport').evaluate(
                "node => { node.scrollLeft = 0; node.dispatchEvent(new Event('scroll')); }")
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / 'explanation-aligned.png'))
        except Exception as cause:
            FAILURES.append(f'exception: {cause}')
            try:
                page.screenshot(path=str(OUT / 'anchors-failure.png'))
            except Exception:
                pass

        RESULT['console_errors'] = errors[:6]
        expect(not errors, f"console errors: {errors[:2]}")
        browser.close()

    RESULT['failures'] = FAILURES
    Path(__file__).with_name('phase4-anchors.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps({k: RESULT[k] for k in ('anchor_applied', 'anchor_undone', 'anchor_redone', 'explanation_note', 'notehead_vs_cursor_px') if k in RESULT}, indent=2)[:2200])
    if FAILURES:
        print(f'{len(FAILURES)} anchor check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All anchor/engraving checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
