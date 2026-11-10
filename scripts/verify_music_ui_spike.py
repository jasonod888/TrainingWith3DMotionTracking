"""UI-L0 library spike: piano highlighting, guitar neck, chord diagram, Strict Mode lifecycle."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      navigator.permissions.query=()=>{deviceRequests.push('permission');throw Error('Unexpected permission');};
    """)

    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/spike.html')
    expect(page.locator('.ReactPiano__Keyboard')).to_be_visible()
    expect(page.locator('.ReactPiano__Key--active')).to_have_count(2)
    expect(page.locator('.guitar svg')).to_be_visible()
    expect(page.locator('.chord svg')).to_be_visible()
    expect(page.locator('.chord')).to_contain_text('C')

    # Controlled highlight can be switched off and on.
    page.get_by_role('button', name='Toggle highlight').click()
    expect(page.locator('.ReactPiano__Key--active')).to_have_count(0)
    page.get_by_role('button', name='Toggle highlight').click()
    expect(page.locator('.ReactPiano__Key--active')).to_have_count(2)

    # Narrow layout does not overflow the page; the diagram container may scroll internally.
    page.get_by_role('button', name='Resize (640px)').click()
    expect(page.get_by_role('button', name='Resize (360px)')).to_be_visible()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(200)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(RESULTS / 'music-ui-spike-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(200)
    page.screenshot(path=str(RESULTS / 'music-ui-spike-desktop.png'), full_page=True)

    # Strict Mode remount: destroy clears all three renderers, remount draws them again once.
    page.get_by_role('button', name='Destroy diagrams').click()
    expect(page.locator('.ReactPiano__Keyboard')).to_have_count(0)
    expect(page.locator('.guitar svg')).to_have_count(0)
    expect(page.locator('.chord svg')).to_have_count(0)
    page.get_by_role('button', name='Remount diagrams').click()
    expect(page.locator('.ReactPiano__Keyboard')).to_have_count(1)
    expect(page.locator('.guitar svg')).to_have_count(1)
    expect(page.locator('.chord svg')).to_have_count(1)

    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    forbidden = [url for url in requests if any(token in url.lower() for token in
                 ('.ttf', '.woff', '.mp3', '.wav', '.ogg', 'font', 'soundfont', 'sample'))]
    assert forbidden == [], forbidden
    print(json.dumps({'errors': errors, 'device_requests': [], 'forbidden_asset_requests': forbidden,
                      'screenshots': ['test-results/music-ui-spike-phone.png',
                                      'test-results/music-ui-spike-desktop.png']}))
    browser.close()
print('PASS: piano highlight, guitar neck, chord diagram, resize, Strict Mode destroy/remount, no devices or sample fonts.')
