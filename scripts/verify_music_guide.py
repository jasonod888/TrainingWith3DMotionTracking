"""Reviewed music guide: instructor video, animated keys and section seeking. No devices."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
reference = {
    'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 6,
    'events': [
        {'id': 'a', 'onset': 0.5, 'duration': 0.5, 'pitch': 60, 'velocity': 0.8, 'optional': False},
        {'id': 'b', 'onset': 1.5, 'duration': 0.5, 'pitch': 64, 'velocity': 0.7, 'optional': False},
        {'id': 'c', 'onset': 3.0, 'duration': 1.0, 'pitch': 67, 'velocity': 0.7, 'optional': True},
    ],
    'spans': [{'start': 0.2, 'end': 2.4}, {'start': 2.5, 'end': 5.8}],
    'review': {'reviewer_id': 'tester', 'reviewed_at': '2026-11-05T12:00:00+00:00', 'draft_id': 'draft-1',
               'source_reference_sha256': 'a' * 64},
}
data = json.dumps(reference, separators=(',', ':')).encode()
manifest = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
video_path = ROOT / 'test-results/music-guide.webm'
if not video_path.exists() or video_path.stat().st_size == 0:
    video_path.parent.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(ROOT / 'web/dist/assets/demonstration.mp4'),
                    '-t', '6', '-an', '-vf', 'scale=640:-2', '-c:v', 'libvpx', '-b:v', '500k', '-y', str(video_path)],
                   check=True)
video = video_path.read_bytes()
manifest.update(lesson_id='music-guide', revision_id='music-guide-v1', title='Guide lesson', duration=6,
                section_set={'id': 'guide-sections', 'revision': 1, 'duration': 6, 'sections': [
                    {'id': 'intro', 'label': 'Intro', 'start': 0, 'end': 2},
                    {'id': 'phrase', 'label': 'Phrase', 'start': 2, 'end': 6}]},
                reference={'key': 'lessons/music-guide/reference.json', 'mime': 'application/json',
                           'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()},
                reference_reviewed=True,
                source_video={'key': 'lessons/music-guide/source.webm', 'mime': 'video/webm',
                              'bytes': len(video), 'sha256': hashlib.sha256(video).hexdigest()},
                assessment={'rubric_version': 'music-watch-v1', 'assessment': 'none',
                            'input_modes': ['none'], 'dimensions': []})
summary = {'summary_version': 1, 'lesson_id': 'music-guide', 'revision_id': 'music-guide-v1',
           'title': 'Guide lesson', 'subject': 'piano', 'subject_label': 'Piano', 'experience_family': 'music',
           'instrument': 'piano', 'duration': 6, 'section_count': 2, 'poster': None,
           'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      localStorage.setItem('form-studio','1');
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
    """)

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='tester', email='test@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[])
        elif path == 'lessons/music-guide':
            route.fulfill(json=manifest)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(body=data, content_type='application/json')
        elif path.endswith('/assets/source.webm'):
            byte_range = route.request.headers.get('range')
            headers = {'Accept-Ranges': 'bytes'}
            if byte_range:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', byte_range)
                assert match, byte_range
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else len(video) - 1
                headers['Content-Range'] = f'bytes {start}-{end}/{len(video)}'
                route.fulfill(status=206, body=video[start:end + 1], content_type='video/webm', headers=headers)
            else:
                route.fulfill(body=video, content_type='video/webm', headers=headers)
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': False, 'conversion': True, 'processing': {}})
        elif path in ('public/moves',):
            route.fulfill(json={'moves': [], 'next_offset': None})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': []})
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'groups':
            route.fulfill(json={'groups': []})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_role('button', name='Open Guide lesson', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Guide lesson')
    expect(page.locator('.piano')).to_be_visible()
    assert page.locator('.piano-white').count() >= 8
    page.wait_for_function("document.querySelector('.music-video video')?.readyState>=2")

    def seek(value):
        page.get_by_label('Lesson position').evaluate(
            """(el, value) => {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(el, value);
              el.dispatchEvent(new Event('input', {bubbles: true}));
            }""", str(value))

    seek(0.6)
    expect(page.locator('.piano-white.is-active')).to_have_count(1)
    expect(page.locator('.music-now')).to_contain_text('C4')
    page.get_by_role('button', name='Play section Phrase', exact=True).click()
    assert float(page.get_by_label('Lesson position').input_value()) >= 2.0
    seek(3.2)
    expect(page.locator('.music-now')).to_contain_text('G4')
    expect(page.locator('.piano-black.is-active')).to_have_count(0)
    page.get_by_role('button', name='Play guide', exact=True).click()
    page.wait_for_function("document.querySelector('.music-video video')?.currentTime>2.2")
    page.screenshot(path=str(ROOT / 'test-results/music-guide-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.get_by_role('button', name='Pause guide', exact=True).click()
    page.screenshot(path=str(ROOT / 'test-results/music-guide-desktop.png'), full_page=True)
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    browser.close()
print('PASS: reviewed guide loads, keys follow reviewed timing, sections seek, video plays, no device requests.')
