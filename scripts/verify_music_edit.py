"""Reviewed-lesson notation editor: touch selection, pitch/duration edits, undo, save and reopen.

Runs the real built UI against mocked API documents. It does not claim device-matrix
qualification; it exercises Chromium phone emulation and touch events.
"""
import hashlib
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 4,
    'events': [{'id': 'a', 'onset': 0.5, 'duration': 0.4, 'pitch': 60, 'optional': False},
               {'id': 'b', 'onset': 1.5, 'duration': 0.4, 'pitch': 64, 'optional': False}],
    'spans': [{'start': 0, 'end': 1, 'kind': 'explanation'}, {'start': 2, 'end': 4, 'kind': 'playing'}],
    'review': {'reviewer_id': 'owner', 'reviewed_at': '2026-11-10T12:00:00+00:00', 'draft_id': 'base-rev',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'music-edit', 'revision_id': 'base-rev', 'title': 'Editable piano', 'duration': 4,
            'section_set': {'id': 'sections', 'revision': 1, 'duration': 4, 'sections': [
                {'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 4}]},
            'reference': {'key': 'lessons/music-edit/reference.json', 'mime': 'application/json',
                          'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'reference_reviewed': True, 'source_video': None,
            'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                           'input_modes': ['none'], 'dimensions': []}}
summary = {'summary_version': 1, 'lesson_id': 'music-edit', 'revision_id': 'base-rev', 'title': 'Editable piano',
           'subject': 'piano', 'subject_label': 'Piano', 'experience_family': 'music', 'instrument': 'piano',
           'duration': 4, 'section_count': 1, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                  accept_downloads=True)
    page = context.new_page()
    errors, edits = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      localStorage.setItem('form-studio','1');
    """)
    state = {'manifest': manifest, 'reference': data}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        method = route.request.method
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='owner', email='owner@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}})
        elif path == 'public/moves':
            route.fulfill(json={'moves': [], 'next_offset': None})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        elif path == 'lessons/music-edit' and method == 'GET':
            route.fulfill(json=state['manifest'])
        elif path == 'lessons/music-edit/music-revision' and method == 'POST':
            body = route.request.post_data_json
            edits.append(body)
            # The server stores the notation with the reference; the mock does the same.
            raw = json.dumps({**reference, **({'events': body['events'], 'spans': body['spans'],
                                               'notation': body['notation']} if body.get('notation') else
                                              {'events': body['events'], 'spans': body['spans']})},
                             separators=(',', ':')).encode()
            state['reference'] = raw
            updated = {**state['manifest'], 'revision_id': 'edited-rev', 'title': body['title'],
                       'section_set': {**state['manifest']['section_set'], 'revision': 2, 'sections': body['sections']},
                       'assessment': body['assessment'],
                       'reference': {'key': 'lessons/music-edit/edited-reference.json', 'mime': 'application/json',
                                     'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}}
            state['manifest'] = updated
            route.fulfill(json=updated)
        elif path.endswith('/assets/reference.json') or path.endswith('/assets/edited-reference.json'):
            route.fulfill(body=state['reference'], content_type='application/json')
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_label('Options for Editable piano', exact=True).click()
    page.get_by_role('button', name='Edit lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Edit this music lesson', exact=True)).to_be_visible()
    expect(page.get_by_role('heading', name='Sheet music', exact=True)).to_be_visible()
    page.get_by_label('Lesson title', exact=True).fill('Edited in browser')

    # Touch selection: tap the C4 notehead. The editor starts in phone view.
    note = page.get_by_role('button', name=re.compile(r'^C4, measure 1'))
    expect(note).to_be_visible()
    note.tap()
    expect(page.get_by_role('heading', name='C4', exact=True)).to_be_visible()

    # Quarter-ish written value -> half -> undo.
    page.get_by_role('button', name='Half', exact=True).click()
    expect(page.locator('.notation-selection-facts')).to_contain_text('2.00 beats')
    page.get_by_role('button', name='Undo', exact=True).click()
    expect(page.locator('.notation-selection-facts')).not_to_contain_text('2.00 beats')

    # Pitch through the piano keyboard.
    page.get_by_role('tab', name='Keyboard', exact=True).click()
    page.locator('.keyboard-svg [aria-label="D4"]').first.tap()
    expect(page.get_by_role('heading', name='D4', exact=True)).to_be_visible()
    page.get_by_role('tab', name='Score', exact=True).click()
    expect(page.get_by_role('button', name=re.compile(r'^D4, measure 1'))).to_be_visible()

    # Add then delete a note in a gap. Seeking through the roll avoids overwriting
    # the D4 at 0.45 s when the entry duration is a quarter note.
    page.get_by_role('button', name='Quarter', exact=True).click()
    page.get_by_role('tab', name='Piano roll', exact=True).click()
    roll = page.locator('.roll-bg')
    box = roll.bounding_box()
    roll.click(position={'x': box['width'] * 0.52, 'y': box['height'] * 0.5})
    page.get_by_role('tab', name='Score', exact=True).click()
    page.get_by_role('button', name='Add note', exact=True).click()
    expect(page.locator('.notation-sheet')).to_have_attribute('aria-label', re.compile(r'3 notes'))
    expect(page.get_by_role('button', name='Delete note', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Delete note', exact=True).click()
    expect(page.locator('.notation-sheet')).to_have_attribute('aria-label', re.compile(r'2 notes'))

    # Restore the original C4 pitch on the remaining note and make it a half note.
    page.get_by_role('button', name=re.compile(r'^D4, measure 1')).tap()

    # Restore the original C4 pitch on the remaining note and make it a half note.
    page.get_by_role('tab', name='Score', exact=True).click()
    page.get_by_role('button', name=re.compile(r'^D4, measure 1')).tap()
    page.get_by_role('tab', name='Keyboard', exact=True).click()
    page.locator('.keyboard-svg [aria-label="C4"]').first.tap()
    page.get_by_role('tab', name='Score', exact=True).click()
    expect(page.get_by_role('heading', name='C4', exact=True)).to_be_visible()
    page.get_by_role('button', name='Half', exact=True).click()
    expect(page.locator('.notation-selection-facts')).to_contain_text('2.00 beats')

    page.get_by_role('button', name='Add passage', exact=True).click()
    page.get_by_role('checkbox', name='I have checked the notes, passages and sections against the instructor material.',
                     exact=True).check()
    page.get_by_role('button', name='Save new revision', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Edited in browser')

    assert len(edits) == 1, edits
    body = edits[0]
    assert body['base_revision_id'] == 'base-rev'
    assert body['title'] == 'Edited in browser'
    assert body['assessment']['assessment'] == 'none' and body['confirm_reviewed'] is True
    assert body['notation']['notation_version'] == 1
    assert len(body['notation']['measures']) == 2
    saved_note = next(item for item in body['notation']['events'] if item['notes'][0]['pitch'] == 60)
    assert saved_note['duration'] == 960, saved_note
    # The half note overwrites the E4 that started inside its span; the
    # performance events follow the notation so the roll cannot show a ghost.
    assert {note['pitch'] for note in body['events']} == {60}
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []

    # Reopen: the mock now returns a reference carrying notation.
    page.get_by_role('button', name='Back', exact=True).click()
    page.get_by_label('Options for Editable piano', exact=True).click()
    page.get_by_role('button', name='Edit lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Sheet music', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name=re.compile(r'^C4, measure 1'))).to_be_visible()
    page.get_by_role('button', name=re.compile(r'^C4, measure 1')).tap()
    expect(page.locator('.notation-selection-facts')).to_contain_text('2.00 beats')

    # MusicXML download from the reopened document.
    with page.expect_download() as download_info:
        page.get_by_role('button', name=re.compile('MusicXML')).click()
    download = download_info.value
    xml = Path(download.path()).read_text(encoding='utf-8')
    assert xml.startswith('<?xml'), xml[:30]
    assert '<score-partwise version="4.0">' in xml
    assert '<staves>2</staves>' in xml and '<backup>' in xml

    page.add_style_tag(content='.header{position:static !important}.notation-toolbar{position:static !important}')
    page.screenshot(path=str(ROOT / 'test-results/music-notation-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(250)
    page.screenshot(path=str(ROOT / 'test-results/music-notation-desktop.png'), full_page=True)
    browser.close()
print('PASS: touch note selection, pitch/duration edit, undo, save/reopen and MusicXML export.')
