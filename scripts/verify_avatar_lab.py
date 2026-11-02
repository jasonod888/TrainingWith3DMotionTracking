"""Headless checks of the served demo comparison lab; no sign-in or uploads."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('AVATAR_LAB_TEST_URL', 'http://127.0.0.1:8001')
SHOTS = ROOT/'test-results/avatar-v2'
SHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440, 'height':1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    for avatar in ('male', 'female'):
        page.goto(f'{BASE}/avatar-lab.html?project=taegeuk-demo&avatar={avatar}&view=front&speed=1&t=0.00')
        expect(page.locator('#stage-overlay')).to_be_hidden(timeout=30000)
        expect(page.locator('#project-info')).to_contain_text('2.0.0')
        expect(page.locator('#project-info')).to_contain_text('Captured finger motion')
        expect(page.locator('#pose-comparison')).to_contain_text('Left elbow')
        assert 'NaN' not in page.locator('#pose-comparison').inner_text()
        for time in (0, 4, 8):
            page.locator('#time').fill(str(time))
            page.locator('#time').dispatch_event('input')
            expect(page.locator('#time')).to_have_value(str(time))
            expect(page.locator('#stage-clock')).to_contain_text(f'{time:.2f}s')
            page.screenshot(path=str(SHOTS/f'{avatar}-{time}-front.png'))
        at_eight=page.locator('#pose-comparison').inner_text()
        elbow_errors=page.locator('#pose-comparison dd').evaluate_all(
            '(rows)=>rows.slice(0,2).map(r=>Math.abs(Number(r.dataset.mixamoAngle)-Number(r.dataset.referenceAngle)))')
        assert max(elbow_errors)<.5, elbow_errors
        end=page.locator('#time').get_attribute('max')
        page.locator('#time').fill(str(int(float(end)*100)/100))
        page.locator('#time').dispatch_event('input')
        page.get_by_role('button',name='Step forward one frame').click()
        page.locator('#time').fill('8')
        page.locator('#time').dispatch_event('input')
        assert page.locator('#pose-comparison').inner_text()==at_eight, 'Seeking back from the end froze the pose'
        page.locator('#time').fill('0');page.locator('#time').dispatch_event('input')
        page.get_by_role('button',name='Step forward one frame').click()
        assert .06<float(page.locator('#time').input_value())<.08, 'Frame step must use the source sample clock'
        page.locator('#time').fill('8');page.locator('#time').dispatch_event('input')
        page.get_by_role('button', name='Left', exact=True).click()
        page.screenshot(path=str(SHOTS/f'{avatar}-8-left.png'))
        page.locator('#next-source-jump').click()
        assert float(page.locator('#time').input_value()) > 0
        page.locator('#pin-travel').uncheck()
        page.get_by_role('button', name='Play comparison').click()
        page.wait_for_timeout(500)
        page.get_by_role('button', name='Pause comparison').click()
        expect(page.locator('#stage-overlay')).to_be_hidden()
        if avatar=='male':
            page.locator('#upload').set_input_files(str(ROOT/'web/dist/assets/avatar-male.glb'))
            expect(page.locator('#project-info')).to_contain_text('Uploaded file: avatar-male.glb')
            page.locator('#clear-upload').click()
            expect(page.locator('#project-info')).to_contain_text('Captured finger motion')
    assert not errors, errors
    # Compact viewport must keep the two bodies and controls available.
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#pin-travel').check()
    page.get_by_role('button', name='Front',exact=True).click()
    page.screenshot(path=str(SHOTS/'mobile.png'))
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    browser.close()
print('Avatar lab: both avatars, frame scrubbing, side views, source jumps, travel playback and mobile layout passed.')
