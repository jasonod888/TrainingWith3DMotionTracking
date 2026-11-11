"""Representative piano passage in the notation editor: chords, voices, ties and both staves.

This is a view/usability check with the generated fixture, not a device qualification.
"""
import hashlib
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
notation = json.loads((ROOT / 'packages/music-notation/fixtures/representative-piano.json').read_text(encoding='utf-8'))
performance = notation['performance']
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 4,
    'events': performance,
    'spans': [{'start': 0, 'end': 4, 'kind': 'playing'}],
    'notation': notation,
    'review': {'reviewer_id': 'owner', 'reviewed_at': '2026-11-10T12:00:00+00:00', 'draft_id': 'base-rev',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
video_bytes = (ROOT / 'music-candidate-run/existing-clip.mp4').read_bytes()
video_asset = {'key': 'lessons/music-edit/source.mp4', 'mime': 'video/mp4', 'bytes': len(video_bytes),
               'sha256': hashlib.sha256(video_bytes).hexdigest()}
base = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest = {**base, 'lesson_id': 'music-edit', 'revision_id': 'base-rev', 'title': 'Representative piano', 'duration': 4,
            'section_set': {'id': 'sections', 'revision': 1, 'duration': 4, 'sections': [
                {'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 4}]},
            'reference': {'key': 'lessons/music-edit/reference.json', 'mime': 'application/json',
                          'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
            'reference_reviewed': True, 'source_video': video_asset,
            'assessment': {'rubric_version': 'music-watch-v1', 'assessment': 'none',
                           'input_modes': ['none'], 'dimensions': []}}
summary = {'summary_version': 1, 'lesson_id': 'music-edit', 'revision_id': 'base-rev', 'title': 'Representative piano',
           'subject': 'piano', 'subject_label': 'Piano', 'experience_family': 'music', 'instrument': 'piano',
           'duration': 4, 'section_count': 1, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                  accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
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
        elif path in ('public/moves', 'workflow/lessons', 'groups'):
            route.fulfill(json={'moves': [], 'next_offset': None} if path == 'public/moves' else
                          {'lessons': []} if path == 'workflow/lessons' else {'groups': []})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'lessons/music-edit':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=data, content_type='application/json')
        elif path.endswith('/assets/source.mp4'):
            route.fulfill(body=video_bytes, content_type='video/mp4')
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_label('Options for Representative piano', exact=True).click()
    page.get_by_role('button', name='Edit lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Sheet music', exact=True)).to_be_visible()
    score = page.locator('.notation-sheet')
    expect(score).to_have_attribute('aria-label', re.compile(r'7 notes, 1 ties'))
    # Both staves are present and the bass note is drawn.
    expect(page.get_by_role('button', name=re.compile(r'^C3, measure 1, bass'))).to_be_visible()
    page.get_by_role('button', name='Next measure', exact=True).click()
    expect(page.get_by_role('button', name=re.compile(r'^G2, measure 2, bass'))).to_be_visible()
    page.get_by_role('button', name='Previous measure', exact=True).click()

    # Select one note inside the E4/G4 chord.
    page.get_by_role('button', name=re.compile(r'^E4, measure 1, treble voice 2')).tap()
    expect(page.get_by_role('heading', name='E4', exact=True)).to_be_visible()
    chord = page.get_by_role('group', name='Notes in this chord')
    expect(chord.get_by_role('button', name='G4')).to_be_visible()
    chord.get_by_role('button', name='G4').click()
    expect(page.get_by_role('heading', name='G4', exact=True)).to_be_visible()

    # Change only that chord pitch through the on-screen keyboard.
    page.get_by_role('tab', name='Keyboard', exact=True).click()
    page.locator('.keyboard-svg [aria-label="A4"]').first.tap()
    expect(page.get_by_role('heading', name='A4', exact=True)).to_be_visible()
    page.get_by_role('tab', name='Score', exact=True).click()
    expect(page.get_by_role('button', name=re.compile(r'^A4, measure 1, treble voice 2'))).to_be_visible()
    expect(page.get_by_role('button', name=re.compile(r'^E4, measure 1, treble voice 2'))).to_be_visible()

    # Play from the selected note seeks the source video to its performance onset.
    page.wait_for_function("document.querySelector('video') && document.querySelector('video').readyState >= 1")
    page.get_by_role('button', name='Play from selected note', exact=True).click()
    page.wait_for_function("document.querySelector('video').currentTime >= 0.45", timeout=5000)
    assert page.evaluate("document.querySelector('video').currentTime") >= 0.45

    # Quarter -> half -> whole, with the long value crossing the barline.
    page.get_by_role('button', name='Half', exact=True).click()
    expect(page.locator('.notation-selection-facts')).to_contain_text('2.00 beats')
    page.get_by_role('button', name='Whole', exact=True).click()
    expect(page.locator('.notation-selection-facts')).to_contain_text('4.00 beats')
    expect(score).to_have_attribute('aria-label', re.compile(r'3 ties'))
    # Full-page screenshots should not paint sticky chrome mid-page.
    page.add_style_tag(content='.header{position:static !important}.notation-toolbar{position:static !important}')
    page.screenshot(path=str(ROOT / 'test-results/music-notation-passage-phone.png'), full_page=True)

    # Undo restores the chord and the original tie count.
    page.get_by_role('button', name='Undo', exact=True).click()
    page.get_by_role('button', name='Undo', exact=True).click()
    expect(score).to_have_attribute('aria-label', re.compile(r'7 notes, 1 ties'))

    # Desktop: score, roll and keyboard are visible together.
    page.set_viewport_size({'width': 1280, 'height': 1000})
    page.wait_for_timeout(300)
    expect(page.locator('.piano-roll')).to_be_visible()
    expect(page.locator('.keyboard-svg')).to_be_visible()
    page.get_by_role('button', name=re.compile(r'^C3, measure 1, bass')).click()
    expect(page.get_by_role('heading', name='C3', exact=True)).to_be_visible()
    expect(page.locator('.piano-roll .roll-note.is-selected')).to_have_count(1)
    expect(page.locator('.keyboard-svg .is-selected')).to_have_count(1)
    page.screenshot(path=str(ROOT / 'test-results/music-notation-passage-desktop.png'), full_page=True)

    assert errors == [], errors
    browser.close()
print('PASS: representative passage shows both staves, chord/voice editing, ties and all three linked views.')
