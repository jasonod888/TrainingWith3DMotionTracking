"""Phase 4 F1/F2/F3 evidence: audio gating is probed in tests; this measures timing."""
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

WINDOW = """() => {
  const label = document.querySelector('.ws-window-label');
  const head = document.querySelector('.ws-roll-playhead');
  return {
    window_start: Number((label?.textContent?.match(/from ([0-9.]+)/) || [0, 0])[1]),
    window_span: Number(label?.dataset.windowSpan ?? 0),
    roll_cursor: head ? Number(head.getAttribute('x1')) : null,
  };
}"""

SAMPLE = """() => {
  const video = document.querySelector('video');
  const roll = document.querySelector('.ws-roll-playhead');
  const score = document.querySelector('.ws-score-playhead');
  const viewport = document.querySelector('.ws-roll-viewport');
  const label = document.querySelector('.ws-window-label');
  if (!roll || !score || !viewport || !label) return null;
  const span = Number(label.dataset.windowSpan);
  const rollSeconds = Number(roll.getAttribute('x1')) / (viewport.clientWidth / span);
  return {
    video: video ? Number(video.currentTime.toFixed(4)) : null,
    rate: video ? video.playbackRate : null,
    roll_seconds: Number(rollSeconds.toFixed(4)),
    score_tick: Number(score.dataset.playheadTick),
    ticks_per_second: Number(document.querySelector('.ws-alignment')?.dataset.ticksPerSecond ?? 0),
    window_start: Number((label.textContent.match(/from ([0-9.]+)/) || [0, 0])[1]),
    roll_ids: [...document.querySelectorAll('.ws-roll-note.is-active')].map(n => n.dataset.occurrence),
    score_ids: [...new Set([...document.querySelectorAll('.ws-score-notehead.is-active')]
      .flatMap(n => (n.dataset.occurrences || '').split(',').filter(Boolean)))],
    key_pitches: [...document.querySelectorAll('.keyboard-white.is-active,.keyboard-black.is-active')]
      .map(n => Number(n.dataset.pitch)),
    roll_pitches: [...document.querySelectorAll('.ws-roll-note.is-active')].map(n => Number(n.dataset.pitch)),
  };
}"""

STEP = """async (value) => {
  const clock = document.querySelector('input[aria-label="Fixture clock"]');
  if (!clock) return null;
  clock.step = '0.001';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(clock, String(value));
  clock.dispatchEvent(new Event('input', {bubbles: true}));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const roll = document.querySelector('.ws-roll-playhead');
  const score = document.querySelector('.ws-score-playhead');
  const viewport = document.querySelector('.ws-roll-viewport');
  const label = document.querySelector('.ws-window-label');
  const span = Number(label.dataset.windowSpan);
  const rollSeconds = roll ? Number(roll.getAttribute('x1')) / (viewport.clientWidth / span) : null;
  return {
    requested: Number(clock.value),
    roll_seconds: Number(rollSeconds.toFixed(4)),
    score_tick: Number(score.dataset.playheadTick),
    ticks_per_second: Number(document.querySelector('.ws-alignment')?.dataset.ticksPerSecond ?? 0),
    roll_ids: [...document.querySelectorAll('.ws-roll-note.is-active')].map(n => n.dataset.occurrence),
    score_ids: [...new Set([...document.querySelectorAll('.ws-score-notehead.is-active')]
      .flatMap(n => (n.dataset.occurrences || '').split(',').filter(Boolean)))],
    key_pitches: [...document.querySelectorAll('.keyboard-white.is-active,.keyboard-black.is-active')]
      .map(n => Number(n.dataset.pitch)),
    roll_pitches: [...document.querySelectorAll('.ws-roll-note.is-active')].map(n => Number(n.dataset.pitch)),
  };
}"""


def expect(condition, message):
    if not condition:
        FAILURES.append(message)


def identity_ok(state):
    return sorted(state['roll_ids']) == sorted(state['score_ids']) and sorted(state['roll_pitches']) == sorted(state['key_pitches'])


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

            # Live playback at rate 1.
            page.get_by_role('button', name='Play', exact=True).click()
            page.wait_for_timeout(2500)
            live = [page.evaluate(SAMPLE) for _ in range(5)]
            RESULT['rate1'] = live
            lag = max(abs(s['roll_seconds'] - s['video']) for s in live if s and s['video'] is not None)
            RESULT['rate1_worst_lag'] = round(lag, 4)
            frame = 1 / 60
            expect(lag <= frame, f'rate 1: cursor lagged {lag:.4f}s (target one displayed frame)')
            tick_errors = [abs(s['score_tick'] - round(s['video'] * s['ticks_per_second'])) for s in live]
            RESULT['rate1_worst_tick'] = max(tick_errors)
            expect(max(tick_errors) <= round(live[0]['ticks_per_second'] * frame) + 2,
                   f'rate 1: score tick off by {max(tick_errors)}')
            expect(all(identity_ok(s) for s in live if s['roll_ids']), 'rate 1: occurrence identities disagree across views')

            # Rate 0.5: the clock itself must slow, and the cursor must stay with it.
            page.locator('.ws-toolbar select').first.select_option('0.5')
            page.wait_for_timeout(200)
            first = page.evaluate(SAMPLE)
            page.wait_for_timeout(1000)
            second = page.evaluate(SAMPLE)
            RESULT['rate_half'] = {'first': first, 'second': second}
            delta = second['video'] - first['video']
            RESULT['rate_half_delta'] = round(delta, 3)
            expect(0.25 <= delta <= 0.8, f'rate 0.5 advanced {delta:.3f}s of media in 1s wall time')
            expect(abs(second['roll_seconds'] - second['video']) <= frame,
                   f"rate 0.5: cursor lag {abs(second['roll_seconds'] - second['video']):.4f}s")
            page.get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_timeout(200)
            page.locator('.ws-toolbar select').first.select_option('1')

            # Seek: the cursor must agree after a seek, not just during playback.
            page.locator('.ws-score-ruler').click(position={'x': 400, 'y': 10})
            page.wait_for_timeout(500)
            seeked = page.evaluate(SAMPLE)
            RESULT['seek'] = seeked
            RESULT['seek_window'] = page.evaluate(WINDOW)
            expect(abs(seeked['roll_seconds'] - seeked['video']) <= frame,
                   f"seek: cursor lag {abs(seeked['roll_seconds'] - seeked['video']):.4f}s")
            expect(abs(seeked['score_tick'] - round(seeked['video'] * seeked['ticks_per_second'])) <= 2,
                   'seek: score tick disagrees with the clock')
            page.screenshot(path=str(OUT / 'timing-after-seek.png'))

            # Controls: 12 ms attacks, stepped clock, identities compared across views.
            page.goto(f'{BASE}/workspace-harness.html?demo=frames', wait_until='domcontentloaded')
            page.wait_for_selector('.ws-roll-svg', timeout=60_000)
            page.wait_for_timeout(400)
            steps = []
            for index in range(0, 11):
                state = page.evaluate(STEP, round(1.996 + index * 0.004, 3))
                if state:
                    steps.append(state)
            RESULT['stepped_frames'] = steps
            by_request = {step['requested']: step for step in steps}
            expect(by_request.get(1.996, {}).get('roll_ids') == [], 'no note should sound at 1.996 s')
            expect(by_request.get(2.004, {}).get('roll_ids') == ['f-1'], 'only the first attack by 2.004 s')
            expect(by_request.get(2.016, {}).get('roll_ids') == ['f-1', 'f-2'], 'the second attack by 2.016 s')
            expect(sorted(by_request.get(2.028, {}).get('roll_ids', [])) == ['f-1', 'f-2', 'f-3'],
                   'all three attacks by 2.028 s')
            for step in steps:
                expect(identity_ok(step), f"identities disagree at {step['requested']} s: {step['roll_ids']} vs {step['score_ids']} vs {step['key_pitches']}")

            def step_run(base, count, label):
                offset_input = page.locator('.ws-toolbar input[type=number]').first
                step_states = []
                for index in range(count):
                    state = page.evaluate(STEP, round(base + index * 0.004, 3))
                    if state:
                        step_states.append(state)
                RESULT[label] = step_states
                return {state['requested']: state for state in step_states}

            # The controlled scenario must run at a nonzero viewport.
            page.evaluate("""() => {
              const scroller = document.querySelector('.ws-roll-viewport');
              scroller.scrollLeft = 130;
              scroller.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(400)
            RESULT['stepped_viewport_start'] = page.evaluate(WINDOW)['window_start']
            expect(RESULT['stepped_viewport_start'] > 1,
                   f"the stepped scenario must run at a nonzero viewport (start {RESULT['stepped_viewport_start']})")

            # Positive offset: attacks move later by exactly 0.5 s.
            page.locator('.ws-toolbar input[type=number]').first.fill('0.5')
            page.locator('.ws-toolbar input[type=number]').first.press('Enter')
            page.wait_for_timeout(300)
            positive = step_run(2.492, 9, 'stepped_offset_positive')
            expect(sorted(positive.get(2.504, {}).get('roll_ids', [])) == ['f-1'],
                   'positive offset: the first attack should be at 2.504 s')
            expect(sorted(positive.get(2.516, {}).get('roll_ids', [])) == ['f-1', 'f-2'],
                   'positive offset: the second attack should be at 2.516 s')

            # Negative offset: the same attacks arrive earlier.
            page.locator('.ws-toolbar input[type=number]').first.fill('-0.5')
            page.locator('.ws-toolbar input[type=number]').first.press('Enter')
            page.wait_for_timeout(300)
            negative = step_run(1.492, 9, 'stepped_offset_negative')
            expect(sorted(negative.get(1.504, {}).get('roll_ids', [])) == ['f-1'],
                   'negative offset: the first attack should be at 1.504 s')
            expect(sorted(negative.get(1.516, {}).get('roll_ids', [])) == ['f-1', 'f-2'],
                   'negative offset: the second attack should be at 1.516 s')

            # Release boundary without offset: f-1 ends at 2.500 s exactly.
            page.locator('.ws-toolbar input[type=number]').first.fill('0')
            page.locator('.ws-toolbar input[type=number]').first.press('Enter')
            page.wait_for_timeout(300)
            release = step_run(2.496, 4, 'stepped_release')
            expect('f-1' not in (release.get(2.500) or {}).get('roll_ids', []),
                   'release: f-1 must stop sounding at its exact end (2.500 s)')
            expect('f-1' in (release.get(2.496) or {}).get('roll_ids', []), 'release: f-1 still sounds before its end')
            for label in ('stepped_offset_positive', 'stepped_offset_negative', 'stepped_release'):
                for state in RESULT[label]:
                    expect(identity_ok(state), f"identities disagree in {label} at {state['requested']} s")
            page.screenshot(path=str(OUT / 'frames-12ms.png'))
        except Exception as cause:
            FAILURES.append(f'exception: {cause}')
            try:
                page.screenshot(path=str(OUT / 'timing-failure.png'))
            except Exception:
                pass
        RESULT['console_errors'] = errors[:6]
        expect(not errors, f'console errors: {errors[:2]}')
        browser.close()

    RESULT['failures'] = FAILURES
    Path(__file__).with_name('phase4-timing.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps({key: RESULT[key] for key in ('rate1_worst_lag', 'rate1_worst_tick', 'rate_half_delta', 'frames') if key in RESULT}, indent=2)[:1800])
    if FAILURES:
        print(f'{len(FAILURES)} timing check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All timing checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
