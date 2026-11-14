"""Phase 5 workspace evidence in a real browser with controlled network responses.

Covers the two gaps that jsdom could not hold reliably:
  * delayed save: snapshot A in flight, edit B arrives, A resolves (success and 500);
    B stays dirty, recoverable and saveable, including after a reload.
  * preview validity: verified Piano audio survives spelling-only edits, pitch/time
    edits disable it and restore Original, and reopening an invalidated preview
    cannot re-enable it.
No forced exit: every route is fulfilled, the browser is closed normally.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).with_name('..')
BASE = 'http://127.0.0.1:5173'
LESSON = 'lesson-1'
FIXTURE = json.loads((ROOT / 'docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json').read_text(encoding='utf-8'))

FAILURES = []
RESULT = {}


def expect(condition, message):
    if not condition:
        FAILURES.append(message)


def wav_silence(seconds=0.6, rate=44100):
    frames = int(seconds * rate)
    data = b'\x00\x00' * frames
    header = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(data))
    return header + data


PREVIEW = wav_silence()
PREVIEW_SHA = hashlib.sha256(PREVIEW).hexdigest()


class World:
    """Network state shared by the routes: draft mode, manifest mode, held save."""

    def __init__(self):
        self.draft_available = True
        self.manifest = None
        self.reference = None
        self.held = None          # stored Playwright route awaiting fulfilment
        self.capture = None       # last save body
        self.save_status = 200
        self.save_detail = 'The save could not be completed.'

    def draft(self):
        value = dict(FIXTURE)
        value.update({'draft_id': 'draft-1', 'lesson_id': LESSON, 'title': 'Browser fixture',
                      'status': 'draft', 'source_video': None})
        value['reference'] = {**FIXTURE['reference'], 'sha256': 'b' * 64}
        return value


def route_handler(world: World, route, request):
    url = request.url
    path = url.split('/api', 1)[-1]
    if path == '/auth/session':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({
            'account': {'id': 'account-1', 'email': 'owner@test', 'platform_role': 'member',
                        'status': 'active', 'mfa_enrolled': False}, 'csrf': 'csrf'}))
    if path == f'/lessons/{LESSON}/music-draft':
        if not world.draft_available:
            return route.fulfill(status=404, content_type='application/json', body=json.dumps({'detail': 'No draft.'}))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(world.draft()))
    if path == f'/lessons/{LESSON}':
        if world.manifest is None:
            return route.fulfill(status=404, content_type='application/json', body=json.dumps({'detail': 'No lesson.'}))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(world.manifest))
    if path.endswith('/assets/preview.wav'):
        return route.fulfill(status=200, content_type='audio/wav', body=PREVIEW)
    if path.endswith('/assets/ref.json'):
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(world.reference))
    if '/music-draft/review' in path or '/music-revision' in path:
        world.capture = json.loads(request.post_data or '{}')
        if world.held is None:
            world.held = route
            return
        status = world.save_status
        body = {'revision_id': 'rev-saved-1'} if status == 200 else {'detail': world.save_detail}
        return route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
    return route.fulfill(status=404, content_type='application/json', body=json.dumps({'detail': 'No route.'}))


def release(world: World, status: int, body: dict):
    route = world.held
    world.held = None
    if route is not None:
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body))


def open_harness(page):
    page.goto(f'{BASE}/workspace-harness.html?id={LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-svg', timeout=30000)


def edit_note(page):
    page.locator('.ws-roll-note').first.click()
    page.get_by_role('button', name='+ semitone').click()
    page.wait_for_selector('.ws-status:has-text("Selected")')


def confirm(page):
    page.get_by_label('Confirm reviewed').check()


def save_button(page):
    return page.get_by_role('button', name='Save privately')


def checkpoint(page):
    raw = page.evaluate("() => localStorage.getItem('piano-workspace-recovery-v1')")
    return json.loads(raw) if raw else None


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        world = World()
        context.route('**/api/**', lambda route, request: route_handler(world, route, request))
        page = context.new_page()
        page.on('console', lambda message: None)

        # ---------------- delayed success: A in flight, B arrives ----------------
        open_harness(page)
        edit_note(page)
        confirm(page)
        expect(save_button(page).is_enabled(), 'an edited, confirmed draft should be saveable')
        page.get_by_role('button', name='Save privately').click()
        page.wait_for_timeout(150)
        expect(world.held is not None, 'the save request was not held')
        page.get_by_label('Sync offset in seconds (not saved)').fill('0.5')
        page.get_by_label('Sync offset in seconds (not saved)').press('Tab')
        release(world, 200, {'revision_id': 'rev-saved-1'})
        page.wait_for_selector('text=Saved an earlier version', timeout=10000)
        expect('Saved privately' not in page.locator('.ws-toolbar').inner_text(),
               'edit B must not be labelled Saved')
        page.wait_for_function("() => !!localStorage.getItem('piano-workspace-recovery-v1')", timeout=10000)
        saved = checkpoint(page)
        expect(saved is not None, 'edit B has no local checkpoint after a delayed success')
        if saved:
            expect(saved['offsetSeconds'] == 0.5, f"checkpoint offset {saved.get('offsetSeconds')} != 0.5")
            identity = saved['identity']
        expect({key: identity.get(key) for key in ('accountId', 'lessonId', 'draftId', 'sourceSha256')} ==
               {'accountId': 'account-1', 'lessonId': LESSON, 'draftId': 'draft-1',
                'sourceSha256': 'b' * 64},
               'the checkpoint lost its draft identity')
        expect(identity.get('baseRevisionId') in (None, 'rev-saved-1'),
               f"unexpected base revision in the checkpoint: {identity.get('baseRevisionId')}")
        confirm(page)
        expect(save_button(page).is_enabled(), 'edit B should still be saveable')
        RESULT['delayed_success'] = {'checkpoint_offset': saved['offsetSeconds'] if saved else None,
                                     'captured_draft_id': world.capture.get('draft_id') if world.capture else None}
        expect(world.capture and world.capture.get('draft_id') == 'draft-1',
               'the saved payload did not carry the draft identity')

        # ---------------- delayed failure, then reload recovery -------------------
        page.evaluate("() => localStorage.clear()")
        open_harness(page)
        edit_note(page)
        confirm(page)
        page.get_by_role('button', name='Save privately').click()
        page.wait_for_timeout(150)
        expect(world.held is not None, 'the failing save was not held')
        page.get_by_label('Sync offset in seconds (not saved)').fill('-0.5')
        page.get_by_label('Sync offset in seconds (not saved)').press('Tab')
        release(world, 500, {'detail': 'The save could not be completed.'})
        page.wait_for_selector('text=could not be completed', timeout=10000)
        page.wait_for_function("() => !!localStorage.getItem('piano-workspace-recovery-v1')", timeout=10000)
        failed = checkpoint(page)
        expect(failed is not None, 'a delayed failure left no checkpoint')
        if failed:
            expect(failed['offsetSeconds'] == -0.5, 'the failure checkpoint lost edit B')
        confirm(page)
        expect(save_button(page).is_enabled(), 'edit B must remain saveable after a failure')

        page.reload(wait_until='domcontentloaded')
        page.wait_for_selector('[data-recovery="offer"]', timeout=30000)
        expect('not saved to the server' in page.locator('[data-recovery="offer"]').inner_text(),
               'the recovery banner must say it is local')
        page.get_by_role('button', name='Restore local checkpoint').click()
        page.wait_for_selector('text=Restored a local checkpoint', timeout=10000)
        expect(page.locator('.ws-toolbar').inner_text().find('Saved privately') == -1,
               'a restored checkpoint must not be labelled Saved')
        confirm(page)
        expect(save_button(page).is_enabled(), 'the restored checkpoint must be saveable after reload')
        RESULT['delayed_failure_recovery'] = {'checkpoint_restored': True}

        # ---------------- preview validity ---------------------------------------
        captured = world.capture
        reference = {
            'reference_version': 1, 'duration': captured['notation']['duration'],
            'title': 'Preview revision', 'events': captured['events'], 'spans': captured['spans'],
            'notation': captured['notation'], 'alignment': captured['alignment'],
        }
        manifest = {
            'revision_id': 'rev-preview-1',
            'reference': {'key': f'lessons/{LESSON}/ref.json', 'mime': 'application/json',
                          'bytes': 1, 'sha256': 'c' * 64},
            'source_video': None, 'pedal': [], 'playback': None,
            'piano_preview': {'key': f'lessons/{LESSON}/preview.wav', 'mime': 'audio/wav',
                              'bytes': len(PREVIEW), 'sha256': PREVIEW_SHA},
            'preview_identity': PREVIEW_SHA,
            'section_set': {'id': 'set', 'revision': 1, 'duration': reference['duration'],
                            'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0,
                                          'end': reference['duration']}]},
            'assessment': {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                           'rubric_version': 'music-watch-v1'},
            'warnings': [],
        }
        world.manifest = manifest
        world.reference = reference
        world.draft_available = False
        page.evaluate("() => localStorage.clear()")
        open_harness(page)
        piano = page.get_by_role('button', name='Piano', exact=True)
        page.wait_for_function("() => {const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Piano'); return b && !b.disabled;}", timeout=20000)
        piano.click()
        page.wait_for_function("() => {const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Piano'); return b && b.getAttribute('aria-pressed')==='true';}", timeout=10000)

        page.locator('.ws-roll-note').first.click()
        page.get_by_role('button', name='♯').click()
        page.wait_for_timeout(400)
        expect(piano.is_enabled(), 'a spelling edit must keep the verified preview enabled')
        expect(piano.get_attribute('aria-pressed') == 'true', 'Piano must stay active after a spelling edit')

        page.get_by_role('button', name='+ semitone').click()
        page.wait_for_function("() => {const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Piano'); return b && b.disabled;}", timeout=10000)
        expect(page.locator('[data-preview-state]').get_attribute('data-preview-state') == 'stale',
               'a pitch edit did not mark the preview stale')
        expect(page.get_by_role('button', name='Original', exact=True).get_attribute('aria-pressed') == 'true',
               'a stale preview must restore Original audio')
        RESULT['preview_staleness'] = {'pitch_disabled': True, 'spelling_kept': True}

        # Reopening a revision whose preview was invalidated must not revive audio.
        world.manifest = {**manifest, 'revision_id': 'rev-preview-2', 'piano_preview': None,
                          'preview_identity': None}
        page.get_by_role('button', name='Reopen saved').click()
        page.wait_for_selector('text=Reopened revision rev-prev', timeout=10000)
        page.wait_for_timeout(500)
        expect(piano.is_disabled(), 'reopening re-enabled a preview that the revision invalidated')
        expect(page.locator('audio').count() == 0, 'the old audio element survived the reopened revision')
        expect(page.get_by_role('button', name='Original', exact=True).get_attribute('aria-pressed') == 'true',
               'Original must remain the source after reopening an invalidated preview')
        RESULT['preview_reopen'] = {'piano_disabled': True, 'audio_removed': True}

        context.close()
        browser.close()


def main() -> int:
    run()
    RESULT['failures'] = FAILURES
    (OUT / 'phase5-browser.json').write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    if FAILURES:
        print(f'{len(FAILURES)} browser check(s) failed:', file=sys.stderr)
        for item in FAILURES:
            print(' -', item, file=sys.stderr)
        return 1
    print('All Phase 5 browser checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
