"""Browser QA for synchronized real/3D references; synthetic learner camera only."""
import json
import os
from pathlib import Path
import subprocess

from playwright.sync_api import sync_playwright, expect
from verify_practice_flow import MOCK

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results/focused-video'
OUT.mkdir(parents=True, exist_ok=True)
source = ROOT / '.local/focused-video/instructor.mp4'
if not source.exists():
    source = ROOT / 'web/dist/assets/demonstration.mp4'
# This fixture is intentionally local and uses a browser-portable codec. The
# production MP4 export and its clock are exercised by test_focused_video.py.
fixture = OUT / 'instructor.webm'
if not fixture.exists():
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(source), '-t', '6', '-an',
                    '-vf', 'scale=380:-2', '-c:v', 'libvpx',
                    '-b:v', '450k', str(fixture)], check=True)
manifest = json.loads((ROOT / 'packages/lesson-schema/fixture.json').read_text())
manifest.update(engine='sam-3d-body', duration=2, source_start=1, title='Focused instructor QA')
manifest['section_set'].update(duration=2, sections=[{'id':'whole','label':'Full movement','start':0,'end':2}])
manifest['source_video'] = {'key':'fixture/original.webm','mime':'video/mp4','bytes':1,'sha256':'0'*64}
manifest['focused_video'] = {**manifest['source_video'],'key':'fixture/instructor.webm'}
reference = json.loads((ROOT / 'web/dist/assets/reference.json').read_text())
mode = {'broken':False, 'missing':False}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':390,'height':844})
    page.set_default_timeout(15000)
    page.add_init_script(MOCK)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def api(route):
        path = route.request.url.split('/api/', 1)[1]
        if path == 'auth/session':
            route.fulfill(status=401, json={'detail':'Sign in'})
        elif path == 'capabilities':
            route.fulfill(json={'camera_calibration':False})
        elif path == 'demo':
            route.fulfill(json={**manifest, 'focused_video':None, 'source_video':None} if mode['missing'] else manifest)
        elif path.endswith('instructor.webm') and mode['broken']:
            route.fulfill(status=404, body='Unavailable')
        elif path.endswith('.webm'):
            data = fixture.read_bytes()
            header = route.request.headers.get('range')
            if header:
                bounds = header.removeprefix('bytes=').split('-')
                start = int(bounds[0] or 0)
                end = min(len(data)-1, int(bounds[1]) if bounds[1] else len(data)-1)
                route.fulfill(status=206, body=data[start:end+1], content_type='video/webm',
                              headers={'Accept-Ranges':'bytes', 'Content-Range':f'bytes {start}-{end}/{len(data)}'})
            else:
                route.fulfill(body=data, content_type='video/webm', headers={'Accept-Ranges':'bytes'})
        elif path.endswith('synthetic-landmarks.json'):
            route.fulfill(json=reference)
        elif path.startswith('demo/assets/'):
            route.fulfill(path=str(ROOT / 'packages/lesson-schema' / path.rsplit('/', 1)[-1]))
        else:
            route.fulfill(status=404, json={'detail':'Not found'})
    page.route('**/api/**', api)
    url = os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5197')
    page.goto(url + '/?page=practice&id=synthetic-lesson&source=demo')
    def choose(value):
        page.get_by_role('button', name='View', exact=True).click()
        dialog = page.get_by_role('dialog', name='View', exact=True)
        dialog.get_by_role('button', name='More', exact=True).click()
        expect(dialog.locator('.practice-pagination span')).to_have_text('2 / 3')
        dialog.get_by_role('button', name='More', exact=True).click()
        expect(dialog.locator('.practice-pagination span')).to_have_text('3 / 3')
        dialog.get_by_label('Reference', exact=True).select_option(value)
        dialog.get_by_role('button', name='Close View', exact=True).click()
    choose('both')
    expect(page.locator('.motion-host canvas')).to_be_visible()
    v = page.locator('.instructor-video')
    expect(v).to_be_visible()
    page.wait_for_function("document.querySelector('.instructor-video')?.readyState>=2")
    for width, height in [(390,844), (320,480), (812,375), (1280,800)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(150)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        box = page.locator('.instructor-video-inset').bounding_box()
        assert box and box['width']>=60 and box['height']>=60 and box['x']>=0 and box['y']>=0
        page.screenshot(path=str(OUT / f'both-{width}.png'))
    page.get_by_role('button', name='Play', exact=True).click()
    page.wait_for_function("!document.querySelector('.instructor-video').paused")
    page.wait_for_timeout(500)
    assert v.evaluate('v=>v.muted && v.playbackRate===1')
    page.get_by_role('button', name='Pause', exact=True).click()
    page.wait_for_function("document.querySelector('.instructor-video').paused")
    page.get_by_label('Lesson position', exact=True).fill('0.6')
    page.wait_for_timeout(250)
    assert abs(v.evaluate('v=>v.currentTime') - 1.6) < .16
    page.get_by_role('button', name='1× Speed', exact=True).click()
    page.get_by_role('button', name='0.5×', exact=True).click()
    page.wait_for_function("document.querySelector('.instructor-video').playbackRate===.5")
    choose('video')
    expect(page.locator('.motion-host canvas')).to_have_count(0)
    expect(page.locator('.motion-host>.instructor-video')).to_be_visible()
    mode['broken'] = True
    page.reload()
    choose('video')
    expect(page.get_by_text('Focused video unavailable · showing original', exact=True)).to_be_visible()
    expect(page.get_by_label('Original instructor video', exact=True)).to_be_visible()
    mode['broken'] = False
    page.goto(url + '/?page=compete&id=synthetic-lesson&source=demo')
    page.get_by_role('button', name='Instructor view', exact=True).click()
    page.get_by_label('Reference', exact=True).select_option('video')
    page.get_by_role('button', name='Close View', exact=True).click()
    page.get_by_role('button', name='Prepare to compete', exact=True).click()
    start = page.get_by_role('button', name='Start scored run', exact=True)
    expect(start).to_be_enabled()
    start.click()
    expect(page.get_by_role('button', name='More', exact=True)).to_be_disabled()
    expect(page.get_by_role('button', name='Instructor view', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='Stop run', exact=True)).to_be_visible()
    page.wait_for_function("document.querySelector('.is-playing')")
    expect(page.locator('.motion-host>.instructor-video')).to_be_visible()
    page.wait_for_function("!document.querySelector('.instructor-video').paused")
    expect(page.get_by_role('dialog', name='Your run', exact=True)).to_be_visible()
    assert page.evaluate('captureCounts.starts') == 0
    mode['missing'] = True
    page.goto(url + '/?page=practice&id=synthetic-lesson&source=demo')
    expect(page.locator('.motion-host canvas')).to_be_visible()
    page.get_by_role('button', name='View', exact=True).click()
    for _ in range(2):
        page.get_by_role('dialog').get_by_role('button', name='More', exact=True).click()
    assert page.get_by_label('Reference', exact=True).locator('option[value="video"]').get_attribute('disabled') is not None
    assert page.get_by_label('Reference', exact=True).locator('option[value="both"]').get_attribute('disabled') is not None
    assert not errors, errors
    browser.close()
print('PASS: focused and companion video, shared clock/seek/speed, responsive views, original fallback, missing media, challenge view lock, no learner recording.')
