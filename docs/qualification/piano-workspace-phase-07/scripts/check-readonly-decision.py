"""Read-only verification decisions: findings render, Accept/Reject send no request."""
import copy
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
spec = importlib.util.spec_from_file_location('ro_dec_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
b_spec = importlib.util.spec_from_file_location('ro_dec_bench', SCRIPTS / 'bench-interactive.py')
bench = importlib.util.module_from_spec(b_spec); b_spec.loader.exec_module(bench)

draft = bench.limit_draft(5000)
draft['events'] = list(draft['events']) + [
    {'id': 'over-limit', 'onset': 1000.0, 'duration': 0.2, 'pitch': 60, 'velocity': 0.6,
     'confidence': None, 'optional': False, 'string': None, 'fret': None},
]
finding = {'id': 'pitch-1', 'kind': 'pitch', 'status': 'suggested', 'pitch': 60,
           'time_range': [0, 3], 'explanation': 'Controlled valid correction',
           'event_ids': ['big-0'], 'evidence': {}, 'alternatives': [], 'ambiguous': False,
           'ambiguity_reasons': [],
           'proposed_edits': [{'op': 'set_pitch', 'event_ids': ['big-0'], 'before': {'pitch': 60},
                               'after': {'pitch': 62}}]}


class DecisionWorld(m.World):
    def state(self):
        events = copy.deepcopy(draft['events'])
        return {'schema_version': 1, 'available': True, 'draft_id': 'draft-1', 'lesson_id': m.LESSON,
                'proposal_sha256': 'b' * 64, 'report_proposal_sha256': 'b' * 64,
                'report_sha256': 'c' * 64, 'stale': False, 'report_error': None,
                'invalid_working': None, 'decisions': [], 'events': events, 'conflicts': [],
                'state_token': 'e' * 64,
                'report': {'schema_version': 1, 'verifier_version': 'controlled-fixture',
                           'mode': 'piano', 'status': 'complete',
                           'source': {'proposal_sha256': 'b' * 64, 'audio_sha256': None},
                           'findings': [finding], 'summary': {}}}

    def route(self, route, request):
        if '/music-analysis/verification?' in request.url:
            return self.json(route, self.state())
        return super().route(route, request)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_init_script('window.__PIANO_INTERACTIVE_LIMIT_APPROVED__ = true;')
    context.route('**/api/**', DecisionWorld(draft).route)
    writes = []
    context.on('request', lambda request: writes.append((request.method, request.url))
               if request.method not in ('GET', 'HEAD', 'OPTIONS') else None)
    page = context.new_page(); page.set_default_timeout(15000)
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    page.locator('[data-lesson-settings] summary').click()
    page.wait_for_selector('[data-finding]')
    accept = page.locator('[data-verification-accept]')
    reject = page.locator('[data-verification-reject]')
    assert accept.count() >= 1 and reject.count() >= 1, 'verification decision controls missing'
    assert page.locator('[data-read-only="true"]').count() == 1
    for button in (accept.first, reject.first):
        button.click(force=True)
        page.wait_for_timeout(200)
    assert writes == [], writes
    print(json.dumps({'count': 5001, 'findings_rendered': True, 'accept_present': True,
                      'reject_present': True, 'write_requests': writes, 'passed': True}, indent=2))
    context.close(); browser.close()
