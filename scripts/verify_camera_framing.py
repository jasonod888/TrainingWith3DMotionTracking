"""Browser verification for live camera auto-framing.

Run with Vite on http://127.0.0.1:5173 and Python Playwright installed.
Uses a generated canvas feed, synthetic pose messages and no real camera.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK = r"""
window.__poseMode = 'stand';
window.__posePaused = false;
window.captureCounts = {starts: 0};
const NativeRecorder = window.MediaRecorder;
window.MediaRecorder = class extends NativeRecorder {
 start(...args) { window.captureCounts.starts++; return super.start(...args); }
};
const point = (x, y) => ({ x, y, z: 0, visibility: .99, presence: .99 });
function makePose() {
 const mode = window.__poseMode || 'stand';
 const wide = mode === 'wide', edge = mode === 'edge';
 const p = new Array(33).fill(null).map(() => point(.5, .5));
 p[0] = point(.5, .15);
 for (let i = 1; i <= 6; i++) p[i] = point(.5 - (i % 2) * .012, .15);
 for (let i = 7; i <= 10; i++) p[i] = point(.5 - (i % 2) * .022, .16);
 const l = wide ? .12 : .42, r = wide ? .88 : .58;
 const wl = wide ? .05 : .43, wr = wide ? .95 : .57;
 p[11] = point(l + .03, .30); p[12] = point(r - .03, .30);
 p[13] = point(wl + .01, .40); p[14] = point(wr - .01, .40);
 p[15] = point(wl, wide ? .40 : .55); p[16] = point(wr, wide ? .40 : .55);
 for (const [i, dx] of [[17, -.006], [18, -.01], [19, -.014], [20, -.018]]) p[i] = point(wl + dx, .42);
 for (const [i, dx] of [[21, .006], [22, .018]]) p[i] = point(wr + dx, .42);
 p[23] = point(l + .05, .55); p[24] = point(r - .05, .55);
 p[25] = point(l + .05, .72); p[26] = point(r - .05, .72);
 const ay = edge ? .97 : .89, ty = edge ? .995 : .90;
 p[27] = point(l + .06, ay); p[28] = point(r - .06, ay);
 p[29] = point(l + .06, ay); p[30] = point(r - .06, ay);
 p[31] = point(l + .06, ty); p[32] = point(r - .06, ty);
 return p;
}
navigator.mediaDevices.getUserMedia = async () => {
 const canvas = document.createElement('canvas');
 canvas.width = 640; canvas.height = 480;
 const ctx = canvas.getContext('2d');
 const draw = () => {
  ctx.fillStyle = '#2c4a3b'; ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = '#7a4736'; ctx.fillRect(0, 0, 88, 480); ctx.fillRect(552, 0, 88, 480);
  ctx.fillStyle = '#395947'; ctx.fillRect(88, 392, 464, 88);
  ctx.strokeStyle = '#4b6a55'; ctx.lineWidth = 2;
  for (let x = 120; x < 552; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 392); ctx.stroke(); }
  ctx.fillStyle = '#d8ed9b'; ctx.font = '18px sans-serif';
  ctx.fillText('SYNTHETIC CAMERA ' + canvas.width + 'x' + canvas.height, 112, 36);
  ctx.strokeStyle = '#d8ed9b'; ctx.strokeRect(260, 120, 120, 272);
 };
 draw(); setInterval(draw, 50);
 const stream = canvas.captureStream(30);
 return stream;
};
navigator.mediaDevices.enumerateDevices = async () => [];
window.Worker = class {
 postMessage(data) {
  if (data.type === 'init') setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), 10);
  if (data.type === 'frame') {
   data.bitmap.close();
   const pose = makePose();
   const send = () => this.onmessage?.({ data: { type: 'pose', epoch: data.epoch, timestamp: data.timestamp, landmarks: pose, world: pose } });
   // A paused stream models a tracking stall while still letting the loop
   // recover once poses resume.
   setTimeout(send, window.__posePaused ? 2600 : 4);
  }
 }
 terminate() { this.onmessage = null; }
};
"""


def manifest():
    value = json.loads((ROOT / 'packages/lesson-schema/fixture.json').read_text())
    value['duration'] = 60
    value['section_set']['duration'] = 60
    value['section_set']['sections'] = [{'id': 'a', 'label': 'Practice movement', 'start': 0, 'end': 60}]
    return value


def route_api(page):
    data = manifest()

    def api(route):
        path = route.request.url.split('/api/', 1)[1]
        if path == 'auth/session':
            route.fulfill(status=401, json={'detail': 'Sign in'})
        elif path == 'demo':
            route.fulfill(json=data)
        elif path.startswith('demo/assets/'):
            name = path.rsplit('/', 1)[-1]
            route.fulfill(path=str(ROOT / 'packages/lesson-schema' / name))
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})
    page.route('**/api/**', api)


def start_practice(page, calibration_shot=False):
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') +
              '/?page=practice&id=synthetic-lesson&source=demo')
    page.get_by_role('button', name='Start practice', exact=True).click()
    expect(page.get_by_role('button', name='End practice', exact=True)).to_be_visible(timeout=15000)
    if calibration_shot:
        # Height matching must stay on the complete contained image.
        page.wait_for_timeout(900)
        expect(page.locator('.calibration-card')).to_be_visible()
        pane = page.locator('.camera-pane').bounding_box()
        frame = page.locator('.camera-frame').bounding_box()
        assert frame['height'] < pane['height'] - 40, (pane, frame)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-calibration-1280.png'))
    # Height matching needs a stable standing pose for 2.5s, then auto-frame acquires.
    page.wait_for_timeout(5200)


def open_camera_setup(page):
    page.get_by_role('button', name='More', exact=True).click()
    page.get_by_role('button', name='Camera', exact=True).click()
    expect(page.get_by_role('dialog', name='Camera setup')).to_be_visible()


def auto_frame_checkbox(page):
    return page.locator('label', has_text='Auto-frame me').locator('input[type=checkbox]')


def frame_is_full_pane(page):
    pane = page.locator('.camera-pane').bounding_box()
    frame = page.locator('.camera-frame').bounding_box()
    assert pane and frame, (pane, frame)
    assert frame['width'] >= pane['width'] - 1 and frame['height'] >= pane['height'] - 1, (pane, frame)


def run():
    (ROOT / 'test-results').mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(MOCK)
        route_api(page)
        start_practice(page, calibration_shot=True)

        # Desktop separate layout: the video covers the whole left pane.
        frame_is_full_pane(page)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-on-1280.png'))

        # Auto-frame off is the previous contained presentation in the expanded pane.
        open_camera_setup(page)
        checkbox = auto_frame_checkbox(page)
        assert checkbox.is_checked()
        checkbox.uncheck()
        page.get_by_role('button', name='Close Camera setup', exact=True).click()
        page.wait_for_timeout(900)
        pane = page.locator('.camera-pane').bounding_box()
        frame = page.locator('.camera-frame').bounding_box()
        assert frame['height'] < pane['height'] - 40, (pane, frame)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-off-1280.png'))

        # Restore the default preference.
        open_camera_setup(page)
        auto_frame_checkbox(page).check()
        page.get_by_role('button', name='Close Camera setup', exact=True).click()
        page.wait_for_timeout(2600)
        frame_is_full_pane(page)

        # A stalled pose stream must not leave a frozen skeleton or hand labels.
        page.evaluate("window.__posePaused=true")
        page.wait_for_timeout(1300)
        expect(page.locator('.hand-label').first).to_be_hidden()
        painted = page.evaluate("""() => {
            const c = document.querySelector('.camera-pane canvas');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
            return false;
        }""")
        assert not painted, 'stale skeleton pixels remain after tracking went stale'
        page.evaluate("window.__posePaused=false")
        page.wait_for_timeout(2200)
        expect(page.locator('.hand-label').first).to_be_visible()

        # Extended arms must widen immediately and the full image must remain visible.
        page.evaluate("window.__poseMode='wide'")
        page.wait_for_timeout(700)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-wide-fallback-1280.png'))
        frame = page.locator('.camera-frame').bounding_box()
        assert frame['height'] < pane['height'] - 40, frame
        tracking = page.locator('.practice-tracking').inner_text()
        assert 'Step back' in tracking, tracking

        # Recover after the arms come down.
        page.evaluate("window.__poseMode='stand'")
        page.wait_for_timeout(3200)
        frame_is_full_pane(page)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-recovered-1280.png'))

        # Feet leaving the source frame is a safe full-frame fallback, not more zoom.
        page.evaluate("window.__poseMode='edge'")
        page.wait_for_timeout(700)
        frame = page.locator('.camera-frame').bounding_box()
        assert frame['height'] < pane['height'] - 40, frame
        assert 'Step back' in page.locator('.practice-tracking').inner_text()
        page.evaluate("window.__poseMode='stand'")

        # Presentation-only resize must recompute geometry without a camera restart.
        page.set_viewport_size({'width': 1000, 'height': 700})
        page.wait_for_timeout(2600)
        frame_is_full_pane(page)
        page.screenshot(path=str(ROOT / 'test-results/autoframe-resize-1000.png'))
        assert not page.locator('.camera-pane').is_hidden()
        assert not errors, errors

        # Mobile combined layout keeps the existing contained view and disables the control.
        phone = browser.new_page(viewport={'width': 390, 'height': 844})
        phone_errors = []
        phone.on('pageerror', lambda error: phone_errors.append(str(error)))
        phone.add_init_script(MOCK)
        route_api(phone)
        start_practice(phone)
        open_camera_setup(phone)
        assert auto_frame_checkbox(phone).is_disabled()
        phone.screenshot(path=str(ROOT / 'test-results/autoframe-combined-mobile.png'))
        phone.get_by_role('button', name='Close Camera setup', exact=True).click()
        phone.wait_for_timeout(300)
        frame = phone.locator('.camera-frame').bounding_box()
        pane = phone.locator('.camera-pane').bounding_box()
        assert frame['height'] < pane['height'] - 40, (pane, frame)
        assert not phone_errors, phone_errors
        browser.close()
    print('PASS: full-pane fill, auto-frame off contained, stale overlay hidden and recovered, '
          'wide-arm fallback, recovery, feet-edge fallback, resize without restart, '
          'mobile combined unchanged.')


if __name__ == '__main__':
    run()
