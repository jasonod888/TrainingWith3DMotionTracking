import json
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

helper = Path('docs/qualification/piano-workspace-phase-07-review/check-verification.py')
prefix = helper.read_text(encoding='utf-8').split('\nwith sync_playwright() as pw:')[0]
exec(compile(prefix, str(helper), 'exec'))


class SlowWorld(VerifyWorld):
    def route(self, route, request):
        if '/music-draft/verification-decision' in request.url:
            self.decision = json.loads(request.post_data)['decision']
            payload = json.dumps(self.state())
            threading.Timer(0.6, lambda: route.fulfill(status=200, content_type='application/json', body=payload)).start()
            return
        return super().route(route, request)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    world = SlowWorld()
    context.route('**/api/**', world.route)
    page = context.new_page()
    m.open_route(page)
    page.locator('[data-lesson-settings] summary').click()
    page.wait_for_selector('[data-finding]')
    pitch = lambda: int(page.locator('.ws-roll-note[data-occurrence="fx-01"]').get_attribute('data-pitch'))
    page.locator('[data-verification-accept]').click()
    page.wait_for_timeout(150)
    print('after-click', pitch())
    page.wait_for_timeout(1500)
    print('after-response', pitch(), 'server', world.state()['events'][0]['pitch'])
    browser.close()
