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
        if path == '/library' or path == '/lessons':
            return self.json(route, {'items': [], 'lessons': []})
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
        if path.endswith('/assets/ref.json') and self.reference_text is not None:
            return route.fulfill(status=200, content_type='application/json', body=self.reference_text)
        if '/music-draft/review' in path or '/music-revision' in path:
            self.capture = json.loads(request.post_data or '{}')
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
    world.manifest = {'schema_version': 2, 'experience_family': 'music', 'draft_id': 'draft-1',
                      'lesson_id': LESSON, 'revision_id': 'rev-normal-1', 'title': 'Normal route',
                      'subject': 'piano', 'duration': reference['duration'], 'instrument': LONG['instrument'],
                      'section_set': {'sections': []},
                      'reference': {'key': f'lessons/{LESSON}/ref.json', 'sha256': reference_sha},
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
