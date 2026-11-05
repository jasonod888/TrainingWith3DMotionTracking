"""Dev-only Phase 3 preparation evidence. Synthetic media; no account, uploads or models.

This checks the existing harness on installed Chromium, not a complete browser/device
qualification: audible review, cancellation, limits and target-device runs remain separate.
"""
import json
import os
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
RESULTS.mkdir(exist_ok=True)
source = RESULTS / 'music-prepare-tone.mp4'
silent = RESULTS / 'music-prepare-silent.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=24',
                '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', str(source)], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-i', str(source), '-an', '-c:v', 'copy', '-y', str(silent)], check=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors, uploads = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: uploads.append(request.url) if '/api/' in request.url else None)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5196') + '/spike/music-prepare.html')
    expect(page.locator('#capability-result table')).to_be_visible()
    page.locator('#source').set_input_files(str(source))
    page.locator('#start').fill('1')
    page.locator('#end').fill('4')
    page.locator('#run').click()
    expect(page.locator('#results tr')).to_have_count(2, timeout=60000)
    expect(page.locator('#run')).to_be_enabled()
    rows = page.locator('#results tr').all_inner_texts()
    passed = [index for index in range(2) if page.locator('#results tr').nth(index).locator('td.pass').count()]
    assert passed, rows
    # The same usable encoder must reject an input that has no audio track.
    candidate = ['mp4-aac', 'webm-opus'][passed[0]]
    for checkbox in page.locator('input[name="path"]').all():
        checkbox.set_checked(checkbox.input_value() == candidate)
    page.locator('#source').set_input_files(str(silent))
    page.locator('#run').click()
    expect(page.locator('#results tr')).to_have_count(3, timeout=60000)
    expect(page.locator('#run')).to_be_enabled()
    last = page.locator('#results tr').last
    expect(last.locator('td.fail')).to_be_visible()
    expect(last).to_contain_text('audio')
    assert errors == [], errors
    assert uploads == [], uploads
    report = dict(browser=browser.version, user_agent=page.evaluate('navigator.userAgent'),
                  selected_seconds=[1,4], capabilities=page.locator('#capability-result').inner_text(),
                  results=page.locator('#results tr').all_inner_texts(), page_errors=errors, api_requests=uploads,
                  scope='Headless Chromium stream-fact smoke test; not full device qualification')
    (RESULTS / 'music-prepare-chromium.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    browser.close()
