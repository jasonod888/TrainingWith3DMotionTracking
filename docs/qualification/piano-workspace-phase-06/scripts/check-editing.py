"""Phase 6 editing-surface evidence in Chromium (controlled routes, no services).

Records the roll pitch/time/resize drags, sheet drag, Replace pitch, Add note with its
duplicate warning, Escape cancellation and a saved/reopened correction.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).with_name('..') / 'captures'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:5173'
FIXTURE = json.loads((ROOT / 'docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json').read_text(encoding='utf-8'))

FAILURES = []
RESULT = {}


def expect(condition, message):
    if not condition:
        FAILURES.append(message)


def pitch_of(page, index=0):
    return int(page.locator('.ws-roll-note').nth(index).get_attribute('data-pitch'))


def onset_of(page, index=0):
    label = page.locator('.ws-roll-note').nth(index).get_attribute('aria-label') or ''
    return float(label.split(' at ')[1].split(' seconds')[0])


def drag(page, locator, dx, dy, steps=6):
    box = locator.bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + dx, cy + dy, steps=steps)
    page.mouse.up()


def ensure_add_mode(page):
    toggle = page.locator('[data-add="toggle"]')
    if toggle.get_attribute('aria-pressed') != 'true':
        toggle.click()
    page.wait_for_selector('.ws-roll-add-layer', timeout=10000)


def demo_gestures(page):
    page.goto(f'{BASE}/workspace-harness.html?demo=frames', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-svg')

    first = page.locator('.ws-roll-note').first
    start_pitch, start_onset = pitch_of(page), onset_of(page)
    drag(page, first, 0, -22)
    page.wait_for_timeout(200)
    expect(pitch_of(page) > start_pitch, 'a vertical drag must raise the pitch')
    expect(abs(onset_of(page) - start_onset) < 1e-6, 'a pitch drag must not move the onset')
    expect(page.get_by_role('button', name='Undo', exact=True).is_enabled(), 'a completed drag must be undoable')
    page.screenshot(path=str(OUT / 'pitch-drag.png'))
    RESULT['pitch_drag'] = {'from': start_pitch, 'to': pitch_of(page)}

    # Escape cancels the next drag without an undo entry.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-svg')
    before = pitch_of(page)
    box = page.locator('.ws-roll-note').first.bounding_box()
    page.mouse.move(box['x'] + 5, box['y'] + 5)
    page.mouse.down()
    page.mouse.move(box['x'] + 5, box['y'] - 20, steps=4)
    page.keyboard.press('Escape')
    page.mouse.up()
    page.wait_for_timeout(200)
    expect(pitch_of(page) == before, 'Escape must restore the original pitch')
    expect(page.get_by_role('button', name='Undo', exact=True).is_disabled(), 'a cancelled drag must not add history')
    RESULT['escape_cancel'] = {'pitch': before}

    # Horizontal drag keeps exact recorded seconds with Snap off.
    before_onset = onset_of(page)
    drag(page, page.locator('.ws-roll-note').first, 60, 1)
    page.wait_for_timeout(200)
    moved = onset_of(page)
    span = float(page.locator('.ws-window-label').get_attribute('data-window-span'))
    width = page.evaluate("() => document.querySelector('.ws-roll-viewport').clientWidth")
    expected = before_onset + 60 * span / width
    expect(abs(moved - expected) < 0.02, f'exact time drag expected {expected:.3f}, got {moved}')
    RESULT['time_drag'] = {'from': before_onset, 'to': moved}
    page.screenshot(path=str(OUT / 'time-drag.png'))

    # Resize the recorded length through the visible handle.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-svg')
    page.locator('.ws-roll-note').first.click()
    handle = page.locator('[data-handle="resize"]').first
    drag(page, handle, 60, 0)
    page.wait_for_timeout(200)
    length = page.get_by_label('Recorded length (s)').input_value()
    expect(float(length) > 0.8, f'recorded length should grow, got {length}')
    RESULT['resize'] = {'length': length}
    page.screenshot(path=str(OUT / 'resize.png'))

    # Sheet drag: one diatonic step with a candidate label.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.ws-score-notehead')
    head = page.locator('.ws-score-notehead').first
    label = head.get_attribute('aria-label')
    drag(page, head, 0, -12)
    page.wait_for_timeout(200)
    expect(page.locator('.ws-score-notehead').first.get_attribute('aria-label') != label,
           'sheet drag must change the written pitch')
    RESULT['sheet_drag'] = {'from': label, 'to': page.locator('.ws-score-notehead').first.get_attribute('aria-label')}
    page.screenshot(path=str(OUT / 'sheet-drag.png'))

    # Replace pitch through the keyboard.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    page.locator('.ws-roll-note').first.click()
    target = pitch_of(page)
    page.get_by_role('button', name='Replace pitch').click()
    page.wait_for_selector('[data-replace="active"]')
    key = page.locator(f'.keyboard-white[data-pitch="{target + 2}"], .keyboard-black[data-pitch="{target + 2}"]').first
    key.click()
    page.wait_for_timeout(200)
    expect(pitch_of(page) == target + 2, 'Replace pitch must change exactly the target')
    expect(page.locator('[data-replace="active"]').count() == 0, 'Replace pitch must exit')
    RESULT['replace_pitch'] = {'from': target, 'to': pitch_of(page)}
    page.screenshot(path=str(OUT / 'replace-pitch.png'))

    # Add note: ghost, Insert, then a duplicate warning.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    total = lambda: int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    start = total()
    ensure_add_mode(page)
    layer = page.locator('.ws-roll-add-layer')
    box = layer.bounding_box()
    page.mouse.click(box['x'] + 300, box['y'] + 40)
    page.wait_for_selector('[data-ghost="true"]')
    page.screenshot(path=str(OUT / 'add-ghost.png'))
    page.get_by_role('button', name='Insert').click()
    page.wait_for_timeout(300)
    expect(total() == start + 1, f'Insert should add one note, total {total()} from {start}')
    RESULT['add_note'] = {'before': start, 'after': total()}

    ensure_add_mode(page)
    # Clicking an existing note in add mode proposes its exact position.
    page.locator('.ws-roll-note').first.click()
    page.wait_for_selector('[data-ghost="true"]')
    page.get_by_role('button', name='Insert').click()
    page.wait_for_selector('[data-add="duplicate"]', timeout=10000)
    RESULT['duplicate_warning'] = True
    page.screenshot(path=str(OUT / 'duplicate-warning.png'))


def surface_checks(page):
    page.goto(f'{BASE}/workspace-harness.html?demo=frames', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    page.locator('.ws-roll-note').first.click()
    facts = lambda: page.locator('.ws-facts').inner_text()
    pitch_before = pitch_of(page)
    page.get_by_role('button', name='♯').click()
    page.wait_for_timeout(150)
    sharp = facts()
    page.get_by_role('button', name='♭').click()
    page.wait_for_timeout(150)
    flat = facts()
    page.get_by_role('button', name='♮').click()
    page.wait_for_timeout(150)
    natural = facts()
    expect(pitch_of(page) == pitch_before, 'accidentals must not change the sounding pitch')
    expect(len({sharp, flat, natural}) == 3, f'sharp/flat/natural must differ: {sharp} | {flat} | {natural}')
    page.locator('.ws-row[aria-label="Respell"] input').fill('B#3')
    page.get_by_role('button', name='Apply spelling').click()
    page.wait_for_timeout(150)
    expect('B#3' in facts(), f'respell did not change the spelling: {facts()}')
    expect(pitch_of(page) == pitch_before, 'enharmonic respelling must not change the pitch')
    RESULT['accidentals'] = {'sharp': sharp, 'flat': flat, 'natural': natural, 'respell': facts()}
    page.screenshot(path=str(OUT / 'accidentals-respell.png'))

    # Chord member isolation: two recorded attacks engraved as one written chord.
    page.goto(f'{BASE}/workspace-harness.html?demo=explanation', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    member = page.locator('.ws-roll-note[data-pitch="62"]').first
    member.click()
    page.wait_for_selector('.ws-facts')
    page.get_by_role('button', name='+ semitone').click()
    page.wait_for_timeout(200)
    expect(page.locator('.ws-roll-note[data-pitch="63"]').count() == 1, 'the edited member must change')
    expect(page.locator('.ws-roll-note[data-pitch="66"]').count() == 1, 'the sibling chord member must not change')
    RESULT['chord_isolation'] = True
    page.screenshot(path=str(OUT / 'chord-isolation.png'))

    # Overlap picker for repeated attacks of the same pitch.
    page.goto(f'{BASE}/workspace-harness.html?demo=double', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    page.locator('input[aria-label="Fixture clock"]').evaluate(
        "(node) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;"
        " setter.call(node, '2.05'); node.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_timeout(200)
    key = page.locator('.keyboard-white[data-pitch="60"], .keyboard-black[data-pitch="60"]').first
    key.click()
    page.wait_for_selector('[data-overlap="true"]')
    choices = page.locator('[data-overlap-id]')
    expect(choices.count() == 2, f'overlap picker should list two attacks, got {choices.count()}')
    choices.first.click()
    page.wait_for_selector('[data-tie-scope], [data-recorded-attacks="true"]')
    RESULT['overlap_picker'] = 2
    page.screenshot(path=str(OUT / 'overlap-picker.png'))


def long_round_trip(page, world):
    long_draft = json.loads((ROOT / 'docs/qualification/piano-workspace-phase-06/long-draft.json').read_text(encoding='utf-8'))
    world['long'] = long_draft
    lesson = long_draft['lesson_id']
    page.goto(f'{BASE}/workspace-harness.html?id={lesson}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note', timeout=30000)
    total = int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    target = page.locator('.ws-roll-note').first
    target_id = target.get_attribute('data-occurrence')
    target_pitch = int(target.get_attribute('data-pitch'))
    target_onset = onset_of(page)
    original = {event['id']: event for event in long_draft['events']}
    unrelated = page.locator('.ws-roll-note').nth(10)
    unrelated_id = unrelated.get_attribute('data-occurrence')
    unrelated_pitch = int(unrelated.get_attribute('data-pitch'))
    drag(page, target, 0, -20)
    page.wait_for_timeout(200)
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately', timeout=20000)
    captured = world['long_capture']
    expect(captured is not None, 'the long draft was not saved')
    events = captured['events']
    expect(len(events) == total, f'saved events {len(events)} != loaded {total}')
    saved_target = next(event for event in events if event['id'] == target_id)
    saved_unrelated = next(event for event in events if event['id'] == unrelated_id)
    delta = saved_target['pitch'] - target_pitch
    expect(delta > 0, f'the gesture correction was not saved (delta {delta})')
    expect(abs(saved_target['onset'] - original[target_id]['onset']) < 1e-9, 'the correction moved its onset')
    expect(saved_unrelated['pitch'] == original[unrelated_id]['pitch'], 'an unrelated note changed')
    expect(abs(saved_unrelated['onset'] - original[unrelated_id]['onset']) < 1e-9, 'an unrelated onset changed')

    # Reopen the stored reference and confirm the correction and integrity survive.
    world['long_manifest'] = {'revision_id': 'rev-long-1',
                              'reference': {'key': f'lessons/{lesson}/ref.json', 'sha256': 'd' * 64},
                              'source_video': None, 'piano_preview': None, 'preview_identity': None,
                              'section_set': {'sections': []}, 'assessment': None}
    world['long_reference'] = {'reference_version': 1, 'duration': captured['notation']['duration'],
                               'title': 'Long edited', 'events': captured['events'],
                               'spans': captured['spans'], 'notation': captured['notation'],
                               'alignment': captured['alignment']}
    world['long_draft_available'] = False
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('text=Opened saved revision rev-long', timeout=30000)
    page.wait_for_selector('.ws-roll-note', timeout=30000)
    reopened_total = int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    reopened = page.locator(f'.ws-roll-note[data-occurrence="{target_id}"]')
    expect(reopened_total == total, f'reopened notes {reopened_total} != {total}')
    expect(int(reopened.first.get_attribute('data-pitch')) == target_pitch + delta, 'the reopened pitch lost the correction')
    RESULT['long_round_trip'] = {'notes': total, 'target': [target_id, target_pitch, target_pitch + delta],
                                 'unrelated_preserved': unrelated_pitch}
    page.screenshot(path=str(OUT / 'long-saved-reopened.png'))


def saved_round_trip(page, world):
    page.goto(f'{BASE}/workspace-harness.html?id=lesson-1', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note')
    before = pitch_of(page)
    drag(page, page.locator('.ws-roll-note').first, 0, -20)
    page.wait_for_timeout(200)
    expect(pitch_of(page) != before, 'the correction drag did not change the pitch')
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately')
    captured = world['capture']
    expect(captured is not None and captured.get('notation'), 'no notation was saved')
    # Reopen the stored reference: the correction must survive.
    world['manifest'] = {'revision_id': 'rev-edited-1',
                         'reference': {'key': 'lessons/lesson-1/ref.json', 'sha256': 'c' * 64},
                         'source_video': None, 'piano_preview': None, 'preview_identity': None,
                         'section_set': {'sections': []}, 'assessment': None}
    world['reference'] = {'reference_version': 1, 'duration': captured['notation']['duration'],
                          'title': 'Edited', 'events': captured['events'], 'spans': captured['spans'],
                          'notation': captured['notation'], 'alignment': captured['alignment']}
    world['draft_available'] = False
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('text=Opened saved revision rev-edit')
    page.wait_for_selector('.ws-roll-note')
    reopened = pitch_of(page)
    expect(reopened != before, 'the reopened reference lost the correction')
    RESULT['saved_round_trip'] = {'before': before, 'saved': captured['notation']['events'][0]['notes'][0]['pitch'],
                                  'reopened': reopened}
    page.screenshot(path=str(OUT / 'saved-round-trip.png'))


def run():
    world = {'draft_available': True, 'manifest': None, 'reference': None, 'capture': None}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 900})

        def handler(route, request):
            path = request.url.split('/api', 1)[-1]
            if path == '/auth/session':
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({
                    'account': {'id': 'account-1', 'email': 'owner@test', 'platform_role': 'member',
                                'status': 'active', 'mfa_enrolled': False}, 'csrf': 'x'}))
            if world.get('long') and path == f"/lessons/{world['long']['lesson_id']}/music-draft":
                if world.get('long_draft_available') is False:
                    return route.fulfill(status=404, content_type='application/json', body='{}')
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(world['long']))
            if world.get('long') and path == f"/lessons/{world['long']['lesson_id']}":
                if not world.get('long_manifest'):
                    return route.fulfill(status=404, content_type='application/json', body='{}')
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(world['long_manifest']))
            if world.get('long') and path.endswith('/assets/ref.json') and world.get('long_reference'):
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(world['long_reference']))
            if path == '/lessons/lesson-1/music-draft':
                if not world['draft_available']:
                    return route.fulfill(status=404, content_type='application/json', body='{}')
                draft = {**FIXTURE, 'draft_id': 'draft-1', 'lesson_id': 'lesson-1', 'title': 'Phase 6',
                         'status': 'draft', 'source_video': None,
                         'reference': {**FIXTURE['reference'], 'sha256': 'b' * 64}}
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(draft))
            if path == '/lessons/lesson-1':
                if not world['manifest']:
                    return route.fulfill(status=404, content_type='application/json', body='{}')
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(world['manifest']))
            if path.endswith('/assets/ref.json'):
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(world['reference']))
            if '/music-draft/review' in path or '/music-revision' in path:
                world['capture'] = json.loads(request.post_data or '{}')
                if world.get('long') and request.url.split('/api', 1)[-1].startswith('/lessons/' + world['long']['lesson_id']):
                    world['long_capture'] = world['capture']
                return route.fulfill(status=200, content_type='application/json',
                                     body=json.dumps({'revision_id': 'rev-edited-1'}))
            return route.fulfill(status=404, content_type='application/json', body='{}')

        context.route('**/api/**', handler)
        page = context.new_page()
        demo_gestures(page)
        surface_checks(page)
        saved_round_trip(page, world)
        long_round_trip(page, world)
        context.close()
        browser.close()


def main() -> int:
    run()
    RESULT['failures'] = FAILURES
    (Path(__file__).with_name('..') / 'phase6-editing.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    if FAILURES:
        print(f'{len(FAILURES)} editing check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All Phase 6 editing checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
