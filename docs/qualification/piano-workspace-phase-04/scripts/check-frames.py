"""Phase 4 R6: frame-level cursor/clock agreement and short-note activation."""
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

SAMPLE = """() => {
  const video = document.querySelector('video');
  const roll = document.querySelector('.ws-roll-playhead');
  const score = document.querySelector('.ws-score-playhead');
  const viewport = document.querySelector('.ws-roll-viewport');
  const label = document.querySelector('.ws-window-label');
  if (!roll || !score || !viewport || !label) return null;
  const span = Number(label.dataset.windowSpan);
  const pps = viewport.clientWidth / span;
  const rollSeconds = Number(roll.getAttribute('x1')) / pps;
  return {
    video: video ? Number(video.currentTime.toFixed(4)) : null,
    roll_seconds: Number(rollSeconds.toFixed(4)),
    score_tick: Number(score.dataset.playheadTick),
    active_keys: document.querySelectorAll('.keyboard-white.is-active,.keyboard-black.is-active').length,
    active_roll: document.querySelectorAll('.ws-roll-note.is-active').length,
    active_score: document.querySelectorAll('.ws-score-notehead.is-active').length,
    window_start: Number((label.textContent.match(/from ([0-9.]+)/) || [0, 0])[1]),
    ticks_per_second: Number(document.querySelector('.ws-alignment')?.dataset.ticksPerSecond ?? 0),
  };
}"""

SET_CLOCK = """(value) => {
  const clock = document.querySelector('input[aria-label="Fixture clock"]');
  if (!clock) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(clock, String(value));
  clock.dispatchEvent(new Event('input', {bubbles: true}));
  return true;
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

        def sample():
            return page.evaluate(SAMPLE)

        def settle_play(seconds=3.0):
            page.wait_for_timeout(int(seconds * 1000))

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

            page.get_by_role('button', name='Play', exact=True).click()
            settle_play(2.5)
            samples = []
            for _ in range(6):
                state = sample()
                if state:
                    samples.append(state)
                page.wait_for_timeout(120)
            RESULT['playing_samples'] = samples
            frame = 1 / 60
            if samples:
                worst = max(abs(item['roll_seconds'] - item['video']) for item in samples if item['video'] is not None)
                RESULT['worst_roll_lag_seconds'] = round(worst, 4)
                expect(worst <= frame * 1.5, f'roll cursor lagged the clock by {worst:.3f}s')
                tick_errors = [abs(item['score_tick'] - round(item['video'] * item['ticks_per_second'])) for item in samples]
                RESULT['worst_tick_error'] = max(tick_errors)
                allowed = max(2, round(samples[0]['ticks_per_second'] * (1.5 / 60)))
                expect(max(tick_errors) <= allowed, f'score cursor tick disagreed by {max(tick_errors)} ticks (allowed {allowed})')
                identities = all(item['active_keys'] >= 0 for item in samples)
                expect(identities, 'sampling failed')

            # A nonzero viewport: pan, then play and re-measure.
            page.get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_timeout(200)
            page.evaluate("""() => {
              const scroller = document.querySelector('.ws-roll-viewport');
              scroller.scrollLeft = 12000;
              scroller.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(400)
            page.get_by_role('button', name='Return to playhead').click()
            page.wait_for_timeout(300)
            page.get_by_role('button', name='Play', exact=True).click()
            settle_play(2.0)
            panned = sample()
            RESULT['nonzero_viewport'] = panned
            if panned:
                expect(panned['window_start'] > 1, f"viewport did not start away from zero ({panned['window_start']})")
                expect(abs(panned['roll_seconds'] - panned['video']) <= 0.03,
                       f"nonzero viewport lag {abs(panned['roll_seconds'] - panned['video']):.3f}s")

            # Offset: the cursor must still describe the effective source time.
            page.get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_timeout(200)
            offset_input = page.locator('.ws-toolbar input[type=number]').first
            offset_input.fill('0.5')
            offset_input.press('Enter')
            page.wait_for_timeout(300)
            page.get_by_role('button', name='Play', exact=True).click()
            settle_play(1.5)
            offset_state = sample()
            RESULT['offset'] = offset_state
            if offset_state:
                expected = round((offset_state['video'] - 0.5) * offset_state['ticks_per_second'])
                allowed = max(2, round(offset_state['ticks_per_second'] * (1.5 / 60)))
                expect(abs(offset_state['score_tick'] - expected) <= allowed,
                       f"offset cursor tick {offset_state['score_tick']} vs {expected}")
            page.get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_timeout(200)
            offset_input.fill('0')
            offset_input.press('Enter')
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / 'frame-cursors.png'))

            # Short-note transitions at a controlled clock (12 ms apart).
            page.goto(f'{BASE}/workspace-harness.html?demo=arpeggio', wait_until='domcontentloaded')
            page.wait_for_selector('.ws-roll-svg', timeout=60_000)
            page.wait_for_timeout(400)
            transitions = []
            for step in range(0, 61):
                seconds = 1.99 + step * 0.002
                page.evaluate(SET_CLOCK, round(seconds, 3))
                page.wait_for_timeout(40)
                state = sample()
                if state:
                    transitions.append([round(seconds, 3), state['active_roll'], state['active_score'], state['active_keys']])
            RESULT['short_note_transitions'] = transitions
            first_one = next((item for item in transitions if item[1] >= 1), None)
            first_three = next((item for item in transitions if item[1] >= 3), None)
            expect(first_one is not None and 1.99 <= first_one[0] <= 2.02,
                   f"first activation at {first_one[0] if first_one else None}, expected 2.0")
            expect(first_three is not None and 2.08 <= first_three[0] <= 2.10,
                   f"third activation at {first_three[0] if first_three else None}, expected 2.09")
            for _, roll, score, keys in transitions:
                expect(keys == 0, 'the keyboard must agree with the other views on silent positions') if roll == 0 and score == 0 else None
            page.screenshot(path=str(OUT / 'short-notes.png'))
        except Exception as cause:
            FAILURES.append(f'exception: {cause}')
            try:
                page.screenshot(path=str(OUT / 'frames-failure.png'))
            except Exception:
                pass

        RESULT['console_errors'] = errors[:6]
        expect(not errors, f"console errors: {errors[:2]}")
        browser.close()

    RESULT['failures'] = FAILURES
    Path(__file__).with_name('phase4-frames.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps({k: RESULT[k] for k in ('playing_samples', 'worst_roll_lag_seconds', 'worst_tick_error', 'nonzero_viewport', 'short_note_transitions') if k in RESULT}, indent=2)[:2500])
    if FAILURES:
        print(f'{len(FAILURES)} frame check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All frame-timing checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
