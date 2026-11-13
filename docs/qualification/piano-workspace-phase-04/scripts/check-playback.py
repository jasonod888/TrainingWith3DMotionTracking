"""Phase 4 evidence: one clock, two playheads, linked navigation, follow and alignment holds."""
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

JS = """() => {
  const video = document.querySelector('video');
  const rollHead = document.querySelector('.ws-roll-playhead');
  const scoreHead = document.querySelector('.ws-score-playhead');
  const rollViewport = document.querySelector('.ws-roll-viewport');
  const scoreViewport = document.querySelector('.ws-score-viewport');
  const follow = document.querySelector('.ws-toolbar input[type=checkbox]');
  return {
    video_time: video ? Number(video.currentTime.toFixed(3)) : null,
    video_rate: video ? video.playbackRate : null,
    video_paused: video ? video.paused : null,
    roll_playhead_x: rollHead ? Number(rollHead.getAttribute('x1')) : null,
    score_playhead_x: scoreHead ? Number(scoreHead.getAttribute('x1')) : null,
    score_playhead_tick: scoreHead ? Number(scoreHead.dataset.playheadTick) : null,
    roll_scroll: rollViewport ? Math.round(rollViewport.scrollLeft) : null,
    score_scroll: scoreViewport ? Math.round(scoreViewport.scrollLeft) : null,
    window_label: document.querySelector('.ws-window-label')?.textContent?.trim() ?? null,
    window_span: Number(document.querySelector('.ws-window-label')?.dataset.windowSpan ?? 0),
    follow: follow ? follow.checked : null,
    alignment_mode: document.querySelector('.ws-alignment')?.dataset.alignmentMode ?? null,
    playhead_tick: document.querySelector('.ws-alignment')?.dataset.playheadTick ?? '',
    ticks_per_second: Number(document.querySelector('.ws-alignment')?.dataset.ticksPerSecond ?? 0),
    active_roll: document.querySelectorAll('.ws-roll-note.is-active').length,
    active_score: document.querySelectorAll('.ws-score-notehead.is-active').length,
    status: document.querySelector('.ws-status')?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 70) ?? null,
    videos: document.querySelectorAll('video').length,
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

        def g():
            return page.evaluate(JS)

        def set_clock(seconds: float) -> None:
            page.evaluate(SET_CLOCK, seconds)
            page.wait_for_timeout(250)

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

            initial = g()
            RESULT['initial'] = initial
            expect(initial['videos'] == 1, f"expected one video, got {initial['videos']}")
            expect(initial['follow'] is True, 'follow should start on')
            expect(initial['alignment_mode'] == 'estimated', f"alignment mode {initial['alignment_mode']}")

            page.get_by_role('button', name='Play', exact=True).click()
            page.wait_for_timeout(2200)
            playing = g()
            RESULT['playing'] = playing
            expect(playing['video_paused'] is False, 'video did not start')
            expect(playing['video_time'] > 0.25, 'video clock did not advance')
            expect(playing['roll_playhead_x'] is not None and playing['score_playhead_x'] is not None,
                   'a playhead is missing while playing')
            # The two cursors must describe the same musical moment.
            agreement = page.evaluate("""() => {
              const roll = document.querySelector('.ws-roll-playhead');
              const score = document.querySelector('.ws-score-playhead');
              const viewport = document.querySelector('.ws-roll-viewport');
              if (!roll || !score || !viewport) return null;
              const span = Number(document.querySelector('.ws-window-label').dataset.windowSpan);
              const start = Number((document.querySelector('.ws-window-label').textContent.match(/from ([0-9.]+)/) || [0, 0])[1]);
              const x = Number(roll.getAttribute('x1'));
              const seconds = start + (x / Math.max(1, viewport.clientWidth)) * span;
              return {seconds: Number(seconds.toFixed(3)), tick: Number(score.dataset.playheadTick)};
            }""")
            RESULT['cursor_agreement'] = agreement
            if agreement:
                expected_tick = round(agreement['seconds'] * playing['ticks_per_second'])
                expect(abs(agreement['tick'] - expected_tick) <= 12,
                       f"cursors disagree: score tick {agreement['tick']} vs roll-derived {expected_tick}")

            page.get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_timeout(300)
            paused = g()
            RESULT['paused'] = paused
            expect(paused['video_paused'] is True, 'video did not pause')

            page.locator('.ws-score-ruler').click(position={'x': 420, 'y': 10})
            page.wait_for_timeout(500)
            seeked = g()
            RESULT['score_ruler_seek'] = seeked
            expect(abs(seeked['video_time'] - paused['video_time']) > 0.2, 'score ruler did not seek the video')
            expect(seeked['status'] and 'No changes' in seeked['status'], 'seeking must not dirty the document')

            page.locator('.ws-toolbar select').first.select_option('0.5')
            page.wait_for_timeout(200)
            rated = g()
            RESULT['rate'] = rated
            expect(rated['video_rate'] == 0.5, f"rate not applied: {rated['video_rate']}")

            before_pan = g()
            page.evaluate("""() => {
              const scroller = document.querySelector('.ws-roll-viewport');
              scroller.scrollLeft += 4000;
              scroller.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(600)
            panned = g()
            RESULT['after_pan'] = panned
            expect(panned['follow'] is False, 'manual pan must suspend Follow')
            expect(panned['window_label'] != before_pan['window_label'], 'pan did not move the window')
            expect(panned['score_scroll'] != before_pan['score_scroll'], 'the score did not follow by musical position')
            expect(panned['video_paused'] is True, 'scrolling must not start playback')

            page.get_by_role('button', name='Return to playhead').click()
            page.wait_for_timeout(600)
            returned = g()
            RESULT['after_return'] = returned
            expect(returned['follow'] is True, 'Return to playhead must re-enable Follow')
            expect(returned['window_label'] != panned['window_label'], 'Return to playhead did not move the roll')
            expect(returned['video_paused'] is True, 'Return to playhead must not start playback')

            before_score = g()
            page.evaluate("""() => {
              const scroller = document.querySelector('.ws-score-viewport');
              scroller.scrollLeft += 900;
              scroller.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(600)
            score_pan = g()
            RESULT['after_score_pan'] = score_pan
            expect(score_pan['window_label'] != before_score['window_label'], 'score scroll did not move the roll')
            expect(score_pan['video_time'] == before_score['video_time'], 'score scrolling must not seek')

            page.get_by_role('button', name='Return to playhead').click()
            page.wait_for_timeout(400)
            base = g()
            offset_input = page.locator('.ws-toolbar input[type=number]').first
            offset_input.fill('0.5')
            offset_input.press('Enter')
            page.wait_for_timeout(500)
            offset_g = g()
            RESULT['offset'] = {**offset_g, 'base_tick': base['score_playhead_tick']}
            shift = base['score_playhead_tick'] - offset_g['score_playhead_tick']
            expected = round(0.5 * offset_g['ticks_per_second'])
            expect(abs(shift - expected) <= 4,
                   f"offset shift {shift} ticks, expected {expected} (base {base['score_playhead_tick']} -> {offset_g['score_playhead_tick']})")
            offset_input.fill('0')
            offset_input.press('Enter')
            page.wait_for_timeout(300)

            page.screenshot(path=str(OUT / 'playback-desktop.png'))

            page.goto(f'{BASE}/workspace-harness.html?demo=explanation', wait_until='domcontentloaded')
            page.wait_for_selector('.ws-roll-svg', timeout=60_000)
            page.wait_for_timeout(500)
            hold = []
            for seconds in (4.4, 5.2, 6.4, 6.9):
                set_clock(seconds)
                state = g()
                hold.append({'seconds': seconds, 'tick': state['score_playhead_tick'], 'x': state['score_playhead_x']})
            RESULT['explanation_hold'] = hold
            ticks = [item['tick'] for item in hold if item['tick'] is not None]
            expect(len(ticks) == 4, f'fixture clock did not move the score cursor: {hold}')
            if len(ticks) == 4:
                expect(len(set(ticks)) == 1, f"the held cursor moved during the explanation: {ticks}")
            set_clock(8)
            resumed = g()
            RESULT['explanation_resumed'] = resumed
            if ticks:
                expect(resumed['score_playhead_tick'] > ticks[0], 'the cursor did not resume after the explanation')
            page.screenshot(path=str(OUT / 'explanation-hold.png'))

            page.goto(f'{BASE}/workspace-harness.html?demo=arpeggio', wait_until='domcontentloaded')
            page.wait_for_selector('.ws-roll-svg', timeout=60_000)
            page.wait_for_timeout(500)
            arpeggio = []
            for seconds in (1.9, 2.01, 2.05, 2.1):
                set_clock(seconds)
                state = g()
                arpeggio.append([seconds, state['active_roll'], state['active_score']])
            RESULT['arpeggio'] = arpeggio
            counts = {item[0]: item[1] for item in arpeggio}
            expect(counts.get(1.9) == 0, 'no note should sound before the arpeggio')
            expect(counts.get(2.01) == 1, f'one note should sound at 2.01 s, got {counts.get(2.01)}')
            expect(counts.get(2.05) == 2, f'two notes should sound at 2.05 s, got {counts.get(2.05)}')
            expect(counts.get(2.1) == 3, f'three notes should sound at 2.1 s, got {counts.get(2.1)}')
            score_counts = {item[0]: item[2] for item in arpeggio}
            expect(score_counts.get(1.9) == 0, 'the score should not highlight a note before the arpeggio')
            expect(score_counts.get(2.1) >= 3, f'the score should highlight the sounding chord at 2.1 s, got {score_counts.get(2.1)}')
        except Exception as cause:
            FAILURES.append(f'exception: {cause}')
            try:
                page.screenshot(path=str(OUT / 'playback-failure.png'))
            except Exception:
                pass

        RESULT['console_errors'] = errors[:6]
        expect(not errors, f"console errors: {errors[:2]}")
        browser.close()

    RESULT['failures'] = FAILURES
    Path(__file__).with_name('phase4-result.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps({key: RESULT[key] for key in ('initial', 'playing', 'after_pan', 'after_return', 'offset', 'explanation_hold', 'arpeggio') if key in RESULT}, indent=2))
    if FAILURES:
        print(f'{len(FAILURES)} check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All Phase 4 playback checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
