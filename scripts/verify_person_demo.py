"""Check the actual served demo with an H.264-capable browser and fake camera."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from verify_practice_flow import MOCK

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results/person-demo'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1917,'height':915})
    page.set_default_timeout(20000)
    page.add_init_script(MOCK)
    page.route('**/api/capabilities',lambda route:route.fulfill(json={'camera_calibration':False}))
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:8001/?page=practice&id=taegeuk-demo&source=demo')
    page.get_by_role('button',name='View',exact=True).click()
    dialog=page.get_by_role('dialog',name='View',exact=True)
    for index in range(2):
        dialog.get_by_role('button',name='More',exact=True).click()
        expect(dialog.locator('.practice-pagination span')).to_have_text(f'{index+2} / 3')
    page.get_by_label('Reference',exact=True).select_option('video')
    page.get_by_role('button',name='Close View',exact=True).click()
    page.wait_for_function("document.querySelector('.instructor-video')?.readyState>=2")
    video=page.locator('.instructor-video')
    assert video.evaluate('v=>v.videoWidth===158 && v.videoHeight===224')
    assert 'instructor-person-' in video.evaluate('v=>v.currentSrc')
    page.get_by_role('button',name='Start practice',exact=True).click()
    expect(page.get_by_role('button',name='End practice',exact=True)).to_be_visible()
    page.get_by_label('Lesson position',exact=True).fill('0.1')
    for time in (0,16,34,42):
        page.get_by_label('Lesson position',exact=True).fill(str(time))
        page.wait_for_timeout(350)
        assert abs(video.evaluate('v=>v.currentTime')-(5.505506+time))<.2
        page.screenshot(path=str(OUT/f'person-{time}.png'))
    page.get_by_label('Lesson position',exact=True).fill('16')
    page.wait_for_function("document.querySelectorAll('.instructor-limb-marker[visibility=visible]').length===4")
    def markers():
        return page.locator('.instructor-limb-guides').evaluate('''svg=>({width:svg.getBoundingClientRect().width,
          points:[...svg.querySelectorAll('.instructor-limb-marker')].map(g=>({name:g.dataset.limb,
            x:Number(g.querySelector('.limb-anchor').getAttribute('cx')),
            y:Number(g.querySelector('.limb-anchor').getAttribute('cy')),text:g.querySelector('text').textContent}))})''')
    page.wait_for_function("Math.abs(document.querySelector('.instructor-video').currentTime-21.505506)<.15 && !document.querySelector('.instructor-video').seeking")
    page.wait_for_timeout(100)
    before=markers()
    page.get_by_role('button',name='More',exact=True).click()
    page.get_by_role('dialog',name='Practice options',exact=True).get_by_role('button',name='Camera',exact=True).click()
    camera=page.get_by_role('dialog',name='Camera setup',exact=True)
    for _ in range(2):camera.get_by_role('button',name='More',exact=True).click()
    camera.get_by_label('Follow instructor').select_option('mirror')
    camera.get_by_role('button',name='Close Camera setup',exact=True).click()
    page.wait_for_timeout(150)
    after=markers()
    for original,flipped in zip(before['points'],after['points']):
        assert original['name']==flipped['name'] and original['text']==flipped['text']
        assert abs(original['x']+flipped['x']-before['width'])<1
        assert abs(original['y']-flipped['y'])<1
    page.screenshot(path=str(OUT/'person-mirrored-guides.png'))
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(200)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    expect(page.locator('.instructor-limb-marker[visibility=visible]')).to_have_count(4)
    page.screenshot(path=str(OUT/'person-mobile-guides.png'))
    page.get_by_role('button',name='Play',exact=True).click()
    page.wait_for_function("!document.querySelector('.instructor-video').paused")
    page.wait_for_timeout(250)
    page.get_by_role('button',name='Pause',exact=True).click()
    assert page.evaluate('captureCounts.starts')==0
    assert not errors,errors
    browser.close()
print('PASS: actual person-only demo, synchronized anatomical hand/foot guides, upright mirrored labels, mobile fit, seek/playback, synthetic live camera, no recording.')
