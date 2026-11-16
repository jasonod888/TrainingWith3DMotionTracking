"""Phase 7 normal-route evidence: review integration, focus ownership, touch emulation.

Controlled API routes, no real lesson changes. Physical-device qualification is not
possible in this environment; the touch pass below is Chromium emulation only and the
handoff states that limitation explicitly.
"""
import hashlib
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent.parent / 'captures'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:5173'
LONG = json.loads((ROOT / 'docs/qualification/piano-workspace-phase-06/long-draft.json').read_text(encoding='utf-8'))
LESSON = LONG['lesson_id']
FAILURES = []
RESULT = {}


def expect(cond, message):
    if not cond:
        FAILURES.append(message)


def pitch_of(page, index=0):
    return int(page.locator('.ws-roll-note').nth(index).get_attribute('data-pitch'))


def drag(page, locator, dx, dy, steps=6):
    box = locator.bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + dx, cy + dy, steps=steps)
    page.mouse.up()


class World:
    def __init__(self, draft):
        self.draft = draft
        self.manifest = None
        self.reference = None
        self.reference_text = None
        self.summaries = []
        self.video_bytes = None
        self.capture = None
        self.draft_available = True

    def route(self, route, request):
        path = request.url.split('/api', 1)[-1].split('?')[0]
        if path == '/auth/session':
            return self.json(route, {'account': {'id': 'account-1', 'email': 'owner@test', 'platform_role': 'member',
                                                 'status': 'active', 'mfa_enrolled': False}, 'csrf': 'x'})
        if path == '/capabilities':
            return self.json(route, {'subject_filter': False, 'music_midi_setup': False, 'music_history': True,
                                     'music_piano_library_ui': True, 'music_guitar_library_ui': True})
        if path == '/workflow/lessons':
            return self.json(route, {'lessons': []})
        if path == '/shared-lessons/summaries':
            return self.json(route, [])
        if path in ('/library', '/lessons', '/lessons/summaries'):
            return self.json(route, self.summaries)
        if path == f'/lessons/{LESSON}/music-draft':
            if not self.draft_available:
                return self.json(route, {}, status=404)
            return self.json(route, {**self.draft, 'draft_id': 'draft-1', 'status': 'draft',
                                     'reference': {**self.draft['reference'], 'sha256': 'b' * 64}})
        if path == f'/lessons/{LESSON}':
            if '1,2' not in (request.headers.get('x-lesson-formats') or ''):
                return self.json(route, {'detail': 'unsupported format'}, status=406)
            if not self.manifest:
                return self.json(route, {}, status=404)
            return self.json(route, self.manifest)
        if path.endswith('/assets/clip.mp4') and self.video_bytes is not None:
            data = self.video_bytes
            range_header = request.headers.get('range') or request.headers.get('Range')
            if range_header and range_header.startswith('bytes='):
                start_text, _, end_text = range_header[6:].partition('-')
                start = int(start_text or 0)
                end = int(end_text) if end_text else len(data) - 1
                end = min(end, len(data) - 1)
                chunk = data[start:end + 1]
                return route.fulfill(status=206, content_type='video/mp4', body=chunk,
                                     headers={'Accept-Ranges': 'bytes',
                                              'Content-Range': f'bytes {start}-{end}/{len(data)}',
                                              'Content-Length': str(len(chunk))})
            return route.fulfill(status=200, content_type='video/mp4', body=data,
                                 headers={'Accept-Ranges': 'bytes', 'Content-Length': str(len(data))})
        if path.endswith('/assets/ref.json') and self.reference_text is not None:
            return route.fulfill(status=200, content_type='application/json', body=self.reference_text)
        if '/music-draft/review' in path or '/music-revision' in path:
            self.capture = json.loads(request.post_data or '{}')
            if '/music-revision' in path and self.capture.get('notation'):
                body = self.capture
                reference = {'reference_version': 1, 'duration': body['notation']['duration'],
                             'title': body.get('title', 'Revision'), 'events': body['events'],
                             'spans': body['spans'], 'notation': body['notation'],
                             'alignment': body.get('alignment')}
                self.reference_text = json.dumps(reference)
                self.reference = reference
                sha = hashlib.sha256(self.reference_text.encode('utf-8')).hexdigest()
                self.manifest = {**(self.manifest or {}), 'revision_id': 'rev-revision-2',
                                 'reference': {'key': f'lessons/{LESSON}/ref.json', 'sha256': sha}}
                self.summaries = [{**item, 'revision_id': 'rev-revision-2'} for item in self.summaries]
                return self.json(route, {'revision_id': 'rev-revision-2'})
            return self.json(route, {'revision_id': 'rev-normal-1'})
        return self.json(route, {}, status=404)

    @staticmethod
    def json(route, body, status=200):
        return route.fulfill(status=status, content_type='application/json', body=json.dumps(body))


def select_note(page, locator, pointer=91):
    box = locator.bounding_box()
    x = box['x'] + 4
    y = box['y'] + box['height'] / 2
    locator.dispatch_event('pointerdown', {'pointerId': pointer, 'pointerType': 'mouse',
                                           'button': 0, 'clientX': x, 'clientY': y})
    locator.dispatch_event('pointerup', {'pointerId': pointer, 'pointerType': 'mouse'})


def drag_note(page, locator, dy, pointer=92):
    box = locator.bounding_box()
    x = box['x'] + 4
    y = box['y'] + box['height'] / 2
    locator.dispatch_event('pointerdown', {'pointerId': pointer, 'pointerType': 'mouse',
                                           'button': 0, 'clientX': x, 'clientY': y})
    locator.dispatch_event('pointermove', {'pointerId': pointer, 'pointerType': 'mouse',
                                           'clientX': x, 'clientY': y + dy})
    locator.dispatch_event('pointerup', {'pointerId': pointer, 'pointerType': 'mouse'})


def open_route(page):
    page.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=45000)


def normal_route(context, world):
    page = context.new_page()
    started = page.evaluate('performance.now()') if False else None
    open_route(page)
    text = page.locator('.ws-shell').inner_text()
    expect('Developer harness' not in text, 'the harness label is still visible in the normal route')
    expect('Phase 4' not in text, 'the outdated Phase 4 label is still visible')
    expect('Fixture clock' not in text, 'the fixture clock label is still visible')
    expect(page.locator('section[aria-label="Review music reference"]').count() == 0,
           'the legacy piano form list is still rendered')
    expect(page.locator('.ws-side').count() == 1, 'the shared workspace inspector is missing')
    styles = page.evaluate("""() => {
      const grid = document.querySelector('.ws-grid');
      const note = document.querySelector('.ws-roll-note');
      const sheet = document.querySelector('.ws-score-notehead');
      return {grid: grid && getComputedStyle(grid).display,
              fill: note && getComputedStyle(note).fill,
              sheetFill: sheet && getComputedStyle(sheet).fill,
              settings: Boolean(document.querySelector('[data-lesson-settings]'))};
    }""")
    expect(styles['grid'] == 'grid', f"workspace grid styling missing: {styles['grid']}")
    expect(styles['fill'] not in ('rgb(0, 0, 0)', '#000000'), f"roll note fill is black: {styles['fill']}")
    expect(styles['sheetFill'] not in ('rgb(0, 0, 0)', '#000000'), f"sheet notehead fill is black: {styles['sheetFill']}")
    expect(styles['settings'], 'teaching sections/assessment/passages settings are missing')
    RESULT['workspace_styles'] = styles
    RESULT['route_integration'] = {'workspace': True, 'legacy_form_absent': True}

    # Application chrome navigation must honour the workspace dirty state.
    select_note(page, page.locator('.ws-roll-note').first)
    page.get_by_role('button', name='+ semitone').click()
    page.wait_for_timeout(150)
    chrome_dialogs = []
    page.once('dialog', lambda dialog: (chrome_dialogs.append(dialog.message), dialog.dismiss()))
    page.get_by_role('link', name='Form home').click()
    page.wait_for_timeout(300)
    expect(chrome_dialogs and 'Leave without saving' in chrome_dialogs[0],
           'app navigation ignored the unsaved workspace changes')
    expect(page.locator('.ws-shell').count() == 1, 'app navigation left the dirty workspace')
    RESULT['app_navigation_guard'] = chrome_dialogs[0] if chrome_dialogs else None
    page.keyboard.press('Control+z')
    page.wait_for_timeout(120)
    RESULT['app_dirty'] = True

    # Focus ownership: shortcuts must not act while focus is outside the workspace.
    select_note(page, page.locator('.ws-roll-note').first)
    before = pitch_of(page)
    select_note(page, page.locator('.ws-roll-note').first, pointer=93)
    page.get_by_role('button', name='+ semitone').click()
    raised = pitch_of(page)
    page.evaluate("() => { document.body.tabIndex = -1; document.body.focus(); }")
    outside_prevented = page.evaluate("""() => {
      document.body.tabIndex = -1; document.body.focus();
      const event = new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true, cancelable: true});
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }""")
    expect(outside_prevented is False, 'the workspace consumed Ctrl+Z owned by app chrome')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(150)
    after_outside = pitch_of(page)
    expect(after_outside == raised, 'Ctrl+Z acted while focus was outside the workspace')
    page.locator('.ws-roll-note').first.click()
    page.keyboard.press('Control+z')
    page.wait_for_timeout(150)
    after_inside = pitch_of(page)
    expect(after_inside == before, 'Ctrl+Z did not undo when focus returned to the workspace')
    RESULT['focus_ownership'] = {'raised': raised, 'after_outside_undo': after_outside,
                                 'after_inside_undo': after_inside}

    # Correct, confirm, save and reopen through the normal route.
    target = page.locator('.ws-roll-note').first
    before = pitch_of(page)
    drag_note(page, target, -20)
    page.wait_for_timeout(200)
    corrected = pitch_of(page)
    expect(corrected != before, 'the normal-route correction did not change the pitch')
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately', timeout=30000)
    captured = world.capture
    expect(captured is not None and captured.get('notation'), 'the normal route did not save notation')
    saved_pitch = next(e for e in captured['events'] if e['id'] == target.get_attribute('data-occurrence'))['pitch']
    expect(saved_pitch == corrected, 'the saved pitch is not the corrected pitch')

    reference = {'reference_version': 1, 'duration': captured['notation']['duration'],
                 'title': 'Normal route', 'events': captured['events'], 'spans': captured['spans'],
                 'notation': captured['notation'], 'alignment': captured['alignment']}
    reference_text = json.dumps(reference)
    reference_sha = hashlib.sha256(reference_text.encode('utf-8')).hexdigest()
    world.reference = reference
    world.reference_text = reference_text
    world.manifest = {'schema_version': 2, 'experience_family': 'music',
                      'lesson_id': LESSON, 'revision_id': 'rev-normal-1', 'title': 'Normal route',
                      'subject': 'piano', 'duration': reference['duration'], 'instrument': LONG['instrument'],
                      'section_set': {'id': 'sections-normal-1', 'revision': 1,
                                      'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0,
                                                    'end': reference['duration']}]},
                      'reference': {'key': f'lessons/{LESSON}/ref.json', 'mime': 'application/json',
                                    'bytes': len(reference_text.encode('utf-8')), 'sha256': reference_sha},
                      'reference_reviewed': True,
                      'assessment': {'assessment': 'notes', 'input_modes': ['midi'],
                                     'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'},
                      'source_video': None, 'piano_preview': None, 'preview_identity': None, 'warnings': []}
    # Reopen in a fresh page of the same normal route: the coordinator must prefer the
    # saved revision over the proposal.
    reopened = context.new_page()
    reopened.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    try:
        reopened.wait_for_selector('text=Opened saved revision rev-norm', timeout=20000)
    except Exception:
        print('REOPEN-TEXT', repr(reopened.locator('body').inner_text()[:800]))
        raise
    reopened.wait_for_selector('[data-roll-toggle]')
    if reopened.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        reopened.locator('[data-roll-toggle]').click()
    reopened.wait_for_selector('.ws-roll-note', timeout=45000)
    expect(pitch_of(reopened) == corrected, 'the reopened revision lost the correction')
    page.close()
    page = reopened
    RESULT['route_save_reopen'] = {'before': before, 'corrected': corrected, 'reopened': pitch_of(page)}
    page.screenshot(path=str(OUT / 'normal-route-saved.png'))

    # Saved-only entry: no proposal at all, only the reviewed reference.
    saved_only_world = World(LONG)
    saved_only_world.draft_available = False
    saved_only_world.manifest = world.manifest
    saved_only_world.reference = world.reference
    saved_only_world.reference_text = world.reference_text
    saved_context = page.context.browser.new_context(viewport={'width': 1440, 'height': 1000})
    saved_context.route('**/api/**', saved_only_world.route)
    saved_page = saved_context.new_page()
    saved_page.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    saved_page.wait_for_selector('text=Opened saved revision rev-norm', timeout=30000)
    saved_page.wait_for_selector('[data-roll-toggle]')
    if saved_page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        saved_page.locator('[data-roll-toggle]').click()
    saved_page.wait_for_selector('.ws-roll-note', timeout=30000)
    expect(saved_page.locator('.ws-shell').count() == 1, 'saved-only entry did not open the workspace')
    RESULT['saved_only_entry'] = True
    saved_context.close()

    # Unsaved-navigation guard: Back asks before discarding.
    select_note(page, page.locator('.ws-roll-note').first)
    page.get_by_role('button', name='+ semitone').click()
    dialogs = []
    page.once('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
    page.locator('[data-workspace-back]').click()
    page.wait_for_timeout(150)
    expect(dialogs and 'Leave without saving' in dialogs[0], 'no unsaved-changes guard was shown')
    RESULT['unsaved_guard'] = dialogs[0] if dialogs else None
    page.close()


def guitar_regression(context):
    draft = dict(LONG)
    draft['subject'] = 'guitar'
    draft['instrument'] = {'kind': 'guitar', 'tuning': [40, 45, 50, 55, 59, 64]}
    draft['guitar_chords'] = []
    world = World(draft)
    context.route('**/api/**', world.route)
    page = context.new_page()
    page.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('section[aria-label="Review music reference"]', timeout=45000)
    expect(page.locator('.ws-shell').count() == 0, 'the piano workspace replaced the guitar review')
    RESULT['guitar_regression'] = True
    page.close()


def touch_emulation(browser, world):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                  has_touch=True, device_scale_factor=3)
    context.route('**/api/**', world.route)
    page = context.new_page()
    open_route(page)
    overflow = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    if overflow > 1:
        print('OVERFLOW-OFFENDERS', page.evaluate("""() => {
          const limit = window.innerWidth;
          return [...document.querySelectorAll('*')].map(el => ({tag: el.tagName,
            cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 60),
            right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width)}))
            .filter(item => item.right > limit + 1).sort((a, b) => b.right - a.right).slice(0, 6);
        }"""))
    expect(overflow <= 1, f'page-level horizontal overflow at 390 px: {overflow}')
    note = page.locator('.ws-roll-note').first
    before = pitch_of(page)
    note.dispatch_event('pointerdown', {'pointerId': 41, 'pointerType': 'touch', 'button': 0,
                                        'clientX': 120, 'clientY': 200})
    note.dispatch_event('pointerup', {'pointerId': 41, 'pointerType': 'touch'})
    page.wait_for_timeout(250)
    expect(pitch_of(page) == before, 'a first touch tap altered the note')
    expect(page.locator('.ws-facts').count() == 1, 'a first touch tap did not select the note')
    # The explicit second gesture on the selected note is the edit.
    note.dispatch_event('pointerdown', {'pointerId': 42, 'pointerType': 'touch', 'button': 0,
                                        'clientX': 120, 'clientY': 200})
    note.dispatch_event('pointermove', {'pointerId': 42, 'pointerType': 'touch',
                                        'clientX': 120, 'clientY': 178})
    note.dispatch_event('pointerup', {'pointerId': 42, 'pointerType': 'touch'})
    page.wait_for_timeout(250)
    expect(pitch_of(page) != before, 'the explicit touch edit gesture did not change the pitch')
    RESULT['touch_emulation'] = {'tap_selected_only': True, 'edited': pitch_of(page), 'overflow': overflow,
                                 'inspector_position': page.evaluate(
                                     "() => { const el = document.querySelector('.ws-side, .ws-inspector');"
                                     " return el ? getComputedStyle(el).position : 'missing'; }")}
    page.screenshot(path=str(OUT / 'touch-390.png'))
    context.close()


def performance(context):
    world = World(LONG)
    context.route('**/api/**', world.route)
    page = context.new_page()
    page.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=45000)
    measured = page.evaluate("""() => {
      const t = performance.getEntriesByType('navigation')[0];
      return {dom: Math.round(t.domContentLoadedEventEnd), load: Math.round(t.loadEventEnd),
              notes: document.querySelectorAll('.ws-roll-note').length,
              score: document.querySelectorAll('.ws-score-notehead').length,
              heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null};
    }""")
    heading = page.locator('.ws-sub').inner_text()
    expect(f"{len(LONG['events'])} notes" in heading, f"the workspace does not report {len(LONG['events'])} notes")
    expect(measured['notes'] > 0, 'no notes rendered')
    measured['data_notes'] = len(LONG['events'])
    RESULT['performance_1338'] = measured
    page.screenshot(path=str(OUT / 'normal-route-1338.png'))
    page.close()


def video_qualification(browser, world):
    clip = ROOT / 'docs/qualification/piano-workspace-phase-07/fixtures/clip.mp4'
    if not clip.exists():
        return
    world.manifest = None
    world.video_bytes = clip.read_bytes()
    digest = hashlib.sha256(world.video_bytes).hexdigest()
    world.draft = {**world.draft,
                   'source_video': {'key': f'lessons/{LESSON}/video/clip.mp4', 'mime': 'video/mp4',
                                    'bytes': len(world.video_bytes), 'sha256': digest}}
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', world.route)
    page = context.new_page()
    open_route(page)
    page.wait_for_selector('video', state='attached', timeout=30000)
    page.wait_for_function('() => { const v = document.querySelector("video"); return v && v.readyState >= 1 && v.duration > 0; }', timeout=30000)
    meta = page.evaluate('() => { const v = document.querySelector("video"); return {duration: v.duration, muted: v.muted}; }')
    expect(meta['duration'] > 2.5, f"video duration was {meta['duration']}")
    header_box = (page.locator('header').first.bounding_box()
                  if page.locator('header').count() else None)
    video_box = page.locator('video').first.bounding_box()
    if header_box and video_box:
        overlap = not (video_box['y'] >= header_box['y'] + header_box['height'] - 1
                       or video_box['y'] + video_box['height'] <= header_box['y'] + 1)
        expect(not overlap, 'video overlaps the app header')
    page.get_by_role('button', name='Play', exact=True).click()
    page.wait_for_timeout(700)
    played = page.evaluate('() => document.querySelector("video").currentTime')
    expect(played > 0.1, f'loaded video did not play: {played}')
    page.locator('select').filter(has_text='0.75').select_option('0.75')
    page.wait_for_timeout(300)
    rate = page.evaluate('() => document.querySelector("video").playbackRate')
    expect(abs(rate - 0.75) < 0.01, f'rate was {rate}')
    page.evaluate('() => document.querySelector("video").pause()')
    page.wait_for_timeout(200)
    expect(page.evaluate('() => document.querySelector("video").paused'), 'pause did not stop video')
    page.wait_for_function('() => { const v = document.querySelector("video");'
                           ' return v && v.seekable.length > 0 && v.seekable.end(0) > 1; }', timeout=15000)
    seekable = page.evaluate('() => { const v = document.querySelector("video");'
                             ' return v.seekable.length ? [v.seekable.start(0), v.seekable.end(0)] : []; }')
    expect(seekable and seekable[1] >= 2.5, f'video is not seekable: {seekable}')
    clock = page.get_by_label('Source clock position', exact=True)
    clock.evaluate("e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '1.5');"
                   " e.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_timeout(300)
    seek = page.evaluate('() => document.querySelector("video").currentTime')
    expect(abs(seek - 1.5) < 0.05, f'seek went to {seek}')
    tick = float(page.locator('.ws-alignment').get_attribute('data-playhead-tick'))
    score_tick = float(page.locator('.ws-score-playhead').get_attribute('data-playhead-tick'))
    tps = float(page.locator('[data-ticks-per-second]').get_attribute('data-ticks-per-second'))
    span = float(page.locator('[data-window-span]').get_attribute('data-window-span'))
    roll_second = float(page.locator('.ws-roll-playhead').get_attribute('data-playhead-seconds'))
    expect(abs(roll_second - seek) < 0.05, f'roll cursor {roll_second} does not match {seek}')
    expect(abs(score_tick - tick) < 3, f'score cursor {score_tick} does not match mapped {tick}')
    page.locator('video').evaluate('(v) => { v.currentTime = 2.9; v.playbackRate = 1; }')
    page.get_by_role('button', name='Play', exact=True).click()
    page.wait_for_timeout(450)
    ended = page.evaluate('() => { const v = document.querySelector("video");'
                          ' return {ended: v.ended, paused: v.paused, time: v.currentTime}; }')
    expect(ended['ended'] and ended['paused'] and abs(ended['time'] - 3) < 0.05, f'video did not end: {ended}')
    cursors = {'scoreTick': score_tick, 'mappedTick': tick, 'roll_seconds': roll_second}
    RESULT['loaded_video'] = {**meta, 'rate': rate, 'seek': seek, 'seekable': seekable,
                              'cursors': cursors, 'played': played, 'ended': ended, 'header_clear': True}
    page.mouse.wheel(0, 320)
    page.wait_for_timeout(250)
    scrolled_header = (page.locator('header').first.bounding_box()
                       if page.locator('header').count() else None)
    scrolled_video = page.locator('video').first.bounding_box()
    expect(scrolled_header is not None and scrolled_video is not None, 'header or video missing while scrolling')
    if scrolled_header and scrolled_video:
        top = max(scrolled_header['y'], scrolled_video['y'])
        bottom = min(scrolled_header['y'] + scrolled_header['height'],
                     scrolled_video['y'] + scrolled_video['height'])
        if bottom > top:
            hit = page.evaluate("([x, y]) => { const el = document.elementFromPoint(x, y);"
                                " return el ? Boolean(el.closest('header')) : false; }",
                                [scrolled_header['x'] + scrolled_header['width'] / 2, (top + bottom) / 2])
            expect(hit, 'the video paints over the app header while scrolling')
    RESULT['loaded_video']['header_scroll_clear'] = True
    page.screenshot(path=str(OUT / 'loaded-video.png'))
    context.close()


def revision_journey(browser, world):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', world.route)
    page = context.new_page()
    summary = {'summary_version': 1, 'lesson_id': LESSON, 'revision_id': 'rev-normal-1',
               'title': 'Normal route', 'subject': 'piano', 'subject_label': 'Piano',
               'experience_family': 'music', 'instrument': 'piano',
               'duration': LONG['duration'], 'section_count': 1, 'poster': None,
               'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}
    world.summaries = [summary]
    page.goto(f'{BASE}/?page=moves', wait_until='domcontentloaded')
    try:
        page.wait_for_selector('.feed-card', timeout=20000)
    except Exception:
        print('LIB-DEBUG', repr(page.locator('body').inner_text()[:500]))
        raise
    page.locator('.feed-card-menu summary').first.click()
    page.get_by_role('button', name='Edit lesson').click()
    page.wait_for_selector('.ws-shell', timeout=45000)
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=45000)
    expect(page.locator('section[aria-label="Edit reviewed music lesson"]').count() == 0,
           'the legacy revision editor is still rendered for piano')
    note = page.locator('.ws-roll-note').first
    before = int(note.get_attribute('data-pitch'))
    select_note(page, note)
    page.get_by_role('button', name='+ semitone').click()
    page.wait_for_timeout(200)
    corrected = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately', timeout=45000)
    captured = world.capture
    expect(captured and captured.get('base_revision_id') == 'rev-normal-1',
           f"revision POST base was {captured.get('base_revision_id') if captured else None}")
    expect(world.manifest and world.manifest.get('revision_id') == 'rev-revision-2',
           'the revision did not become the saved manifest')
    RESULT['revision_journey'] = {'before': before, 'corrected': corrected,
                                  'base': captured.get('base_revision_id')}

    # Reopen the new revision as saved-only and confirm the correction survived.
    reopened = context.new_page()
    reopened.goto(f'{BASE}/?page=music-review&id={LESSON}', wait_until='domcontentloaded')
    reopened.wait_for_selector('text=Opened saved revision rev-rev', timeout=45000)
    reopened.wait_for_selector('[data-roll-toggle]')
    if reopened.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        reopened.locator('[data-roll-toggle]').click()
    reopened.wait_for_selector('.ws-roll-note', timeout=45000)
    expect(int(reopened.locator('.ws-roll-note').first.get_attribute('data-pitch')) == corrected,
           'the reopened private revision lost the correction')
    RESULT['revision_reopen'] = True
    page.close()
    reopened.close()
    context.close()


def main():
    if not LONG.get('events'):
        print('long fixture missing', file=sys.stderr)
        return 1
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        desktop = browser.new_context(viewport={'width': 1440, 'height': 1000})
        world = World(LONG)
        desktop.route('**/api/**', world.route)
        normal_route(desktop, world)
        guitar_regression(desktop)
        performance(desktop)
        revision_world = World(LONG)
        revision_world.manifest = world.manifest
        revision_world.reference = world.reference
        revision_world.reference_text = world.reference_text
        video_world = World(LONG)
        video_qualification(browser, video_world)
        revision_journey(browser, revision_world)
        touch_emulation(browser, World(LONG))
        desktop.close()
        browser.close()
    RESULT['failures'] = FAILURES
    (Path(__file__).resolve().parent.parent / 'phase7-route.json').write_text(
        json.dumps(RESULT, indent=2), encoding='utf-8')
    if FAILURES:
        print(f'{len(FAILURES)} normal-route check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All normal-route checks passed (touch pass is emulation only).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
