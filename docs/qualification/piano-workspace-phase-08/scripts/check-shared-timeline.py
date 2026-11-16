"""Shared timeline/follow evidence on the real correction fixture."""
import hashlib
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
CAPTURES = Path(__file__).resolve().parents[1] / 'captures'
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_shared_route', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
results = {}


def world():
    w = m.World(m.LONG)
    w.video_bytes = (Path(__file__).resolve().parents[1] / 'fixtures/clip30.mp4').read_bytes()
    w.draft = {**w.draft, 'source_video': {
        'key': f'lessons/{m.LESSON}/video/clip.mp4', 'mime': 'video/mp4',
        'bytes': len(w.video_bytes), 'sha256': hashlib.sha256(w.video_bytes).hexdigest()}}
    return w


def state(page):
    return page.evaluate('''() => {
      const bar = document.querySelector('[data-shared-scrollbar]');
      const cursor = document.querySelector('.ws-score [data-shared-cursor]');
      const roll = document.querySelector('.ws-roll-viewport');
      const score = document.querySelector('.ws-score-viewport');
      const snap = window.__pianoWorkspaceSnapshot?.();
      const rollGrid = document.querySelector('.ws-roll-grid');
      const scoreBar = document.querySelector('.ws-score-measure .ws-score-barline');
      const rollCursor = document.querySelector('.ws-roll [data-shared-cursor]');
      const scoreCursor = document.querySelector('.ws-score [data-shared-cursor]');
      const rect = (el) => el ? el.getBoundingClientRect().left : null;
      return {barLeft: bar?.scrollLeft, barWidth: bar?.clientWidth, barScrollWidth: bar?.scrollWidth,
        cursorLeft: cursor ? parseFloat(cursor.getAttribute('x1')) - (document.querySelector('.ws-score-viewport')?.scrollLeft || 0) : null,
        rollLeft: roll?.scrollLeft, scoreLeft: score?.scrollLeft,
        rollOverflowX: roll ? getComputedStyle(roll).overflowX : null,
        scoreOverflowX: score ? getComputedStyle(score).overflowX : null,
        sharedBars: document.querySelectorAll('[data-shared-scrollbar]').length,
        suspended: !!document.querySelector('[data-follow-suspended]'),
        direction: document.querySelector('[data-follow-direction]')?.getAttribute('data-follow-direction') ?? null,
        followLabel: document.querySelector('[data-follow-suspended]') ? 'resume' : null,
        time: document.querySelector('video')?.currentTime, paused: document.querySelector('video')?.paused,
        selection: snap?.selection ?? null, past: snap?.past ?? 0, dirty: snap?.dirty ?? false,
        rollGridX: rect(rollGrid), scoreBarX: rect(scoreBar),
        rollCursorX: rect(rollCursor), scoreCursorX: rect(scoreCursor),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
    }''')


def capture(page, name, target='.ws-roll'):
    if page.locator(target).count():
        page.locator(target).first.evaluate('(e) => e.scrollIntoView({block: "start"})')
        page.wait_for_timeout(200)
        page.evaluate('window.scrollBy(0, -90)')
        page.wait_for_timeout(120)
    page.screenshot(path=str(CAPTURES / name))


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    for label, viewport in (('desktop', {'width': 1440, 'height': 1000}),
                            ('mobile', {'width': 390, 'height': 844})):
        context = browser.new_context(viewport=viewport)
        context.route('**/api/**', world().route)
        page = context.new_page(); m.open_route(page)
        page.wait_for_selector('[data-shared-scrollbar]')
        page.wait_for_function('document.querySelector("video")?.readyState>=2')
        page.wait_for_timeout(250)
        start = state(page)
        assert start['sharedBars'] == 1
        assert start['rollOverflowX'] in ('hidden', 'clip')
        assert start['scoreOverflowX'] in ('hidden', 'clip')
        print('START', label, json.dumps(start), flush=True)
        assert start['pageOverflow'] <= 1, ('page-wide horizontal overflow', start['pageOverflow'])
        assert abs(start['rollGridX'] - start['scoreBarX']) <= 1.5, ('shared grid alignment', start)
        assert abs(start['rollCursorX'] - start['scoreCursorX']) <= 1.5, ('one cursor position', start)
        capture(page, f'shared-expanded-{label}.png')
        page.locator('[data-roll-toggle]').click(); page.wait_for_timeout(200)
        capture(page, f'shared-collapsed-{label}.png', '.ws-score')
        page.locator('[data-roll-toggle]').click(); page.wait_for_timeout(220)
        # Play through several screenfuls by seeking the media forward.
        page.get_by_role('button', name='Play', exact=True).click()
        samples = []
        for seconds in (4, 10, 18):
            page.evaluate('(s) => { const v = document.querySelector("video"); v.currentTime = s; v.play(); }', seconds)
            page.wait_for_timeout(1300)
            sample = state(page)
            samples.append(sample)
        follow = {'samples': samples,
                  'scroll_advanced': samples[-1]['barLeft'] > samples[0]['barLeft'],
                  'cursor_in_view': all(0 <= s['cursorLeft'] <= s['barWidth'] for s in samples),
                  'cursor_near_safe_area': all(0.5 * s['barWidth'] <= s['cursorLeft'] <= 0.85 * s['barWidth']
                                               for s in samples[1:]),
                  'scrolls_match': all(abs(s['rollLeft'] - s['barLeft']) <= 2
                                       and abs(s['scoreLeft'] - s['barLeft']) <= 2 for s in samples)}
        print(label, json.dumps(follow), flush=True)
        assert follow['scroll_advanced'] and follow['cursor_in_view'] and follow['scrolls_match']
        capture(page, f'shared-follow-{label}.png')
        # Pause freezes the view.
        page.evaluate('() => document.querySelector("video").pause()')
        page.wait_for_timeout(250)
        paused = state(page); page.wait_for_timeout(500); paused_later = state(page)
        pause = {'frozen': paused['barLeft'] == paused_later['barLeft'],
                 'cursor_frozen': paused['cursorLeft'] == paused_later['cursorLeft'],
                 'media_paused': paused_later['paused']}
        print('PAUSE', json.dumps(pause), paused['barLeft'], paused_later['barLeft'],
              paused['cursorLeft'], paused_later['cursorLeft'], flush=True)
        assert all(pause.values())
        # Manual pan suspends Follow without pausing or seeking.
        page.evaluate('''() => { const b = document.querySelector('[data-shared-scrollbar]');
          b.scrollLeft = Math.max(0, b.scrollLeft - 320); b.dispatchEvent(new Event('scroll')); }''')
        page.wait_for_timeout(250)
        manual = state(page)
        manual['direction'] = page.locator('[data-follow-direction]').get_attribute('data-follow-direction') if \
            page.locator('[data-follow-direction]').count() else manual['direction']
        capture(page, f'shared-manual-{label}.png')
        manual_ok = manual['suspended'] and manual['paused'] and abs(manual['time'] - paused_later['time']) < 0.2
        # Resume follow through the explicit control; media state must not change.
        page.get_by_role('button', name='Resume follow', exact=True).click()
        page.wait_for_timeout(400)
        resumed = state(page)
        resume_ok = not resumed['suspended'] and abs(resumed['time'] - manual['time']) < 0.4
        capture(page, f'shared-resume-{label}.png')
        # Collapse/reopen preserves the shared viewport, selection and roll pitch scroll.
        page.evaluate('''() => { const r = document.querySelector('.ws-roll-viewport'); if (r) r.scrollTop = 18; }''')
        before_collapse = state(page)
        page.locator('[data-roll-toggle]').click(); page.wait_for_timeout(150)
        page.locator('[data-roll-toggle]').click(); page.wait_for_timeout(250)
        after_collapse = state(page)
        collapse_ok = abs(after_collapse['barLeft'] - before_collapse['barLeft']) <= 2
        # Formatted mode preserves the shared viewport and returns without reveal.
        page.locator('[data-formatted-toggle]').click()
        page.wait_for_selector('[data-formatted-page="1"]')
        page.get_by_role('button', name='Return to correction', exact=True).click()
        page.wait_for_selector('[data-shared-scrollbar]')
        after_mode = state(page)
        mode_ok = abs(after_mode['barLeft'] - before_collapse['barLeft']) <= 3
        zoom_before = state(page)
        zoom_doc = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
        page.get_by_role('button', name='Zoom in').click(); page.wait_for_timeout(300)
        zoom_after = state(page)
        zoom_doc_after = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
        zoom_ok = (zoom_after['barScrollWidth'] != zoom_before['barScrollWidth']
                   and zoom_doc_after['document'] == zoom_doc['document']
                   and zoom_doc_after['selection'] == zoom_doc['selection'])
        results[label] = {'start': start, 'follow': follow, 'pause': pause,
                          'manual': manual, 'manual_ok': manual_ok,
                          'resume': resumed, 'resume_ok': resume_ok,
                          'collapse_ok': collapse_ok, 'mode_ok': mode_ok,
                          'zoom_before': zoom_before['barScrollWidth'],
                          'zoom_after': zoom_after['barScrollWidth'], 'zoom_ok': zoom_ok}
        context.close()
    browser.close()

ok = all(r['manual_ok'] and r['resume_ok'] and r['collapse_ok'] and r['mode_ok'] and r['zoom_ok']
         for r in results.values())
Path(__file__).with_name('shared-timeline-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
raise SystemExit(0 if ok else 1)
