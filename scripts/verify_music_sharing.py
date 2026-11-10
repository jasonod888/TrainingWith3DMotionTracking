"""Private music sharing: invitation-only UI, no link/public controls, publish and revoke."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
summary = {'summary_version': 1, 'lesson_id': 'music-share', 'revision_id': 'reviewed-rev',
           'title': 'Shared piano', 'subject': 'piano', 'subject_label': 'Piano',
           'experience_family': 'music', 'instrument': 'piano', 'duration': 8, 'section_count': 2,
           'poster': None, 'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, publishes, invitations, unpublishes = [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      localStorage.setItem('form-studio','1');
    """)
    state = {'published': False, 'mode': 'private', 'invitations': []}

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        method = route.request.method
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
        elif path == 'lessons/music-share/sharing':
            route.fulfill(json={'mode': state['mode'], 'published_revision_id': 'reviewed-rev' if state['published'] else None,
                                'accepted_revision_id': 'reviewed-rev', 'draft_revision_id': 'reviewed-rev',
                                'students': [], 'invitations': state['invitations']})
        elif path == 'lessons/music-share/publish' and method == 'POST':
            body = route.request.post_data_json
            publishes.append(body)
            if body['mode'] != 'invite':
                route.fulfill(status=409, json={'detail': 'Music lessons can only be shared by private invitation.'})
                return
            state['published'] = True
            state['mode'] = 'invite'
            route.fulfill(json={'published_revision_id': body['revision_id'], 'link': None})
        elif path == 'lessons/music-share/invitations' and method == 'POST':
            body = route.request.post_data_json
            invitations.append(body['email'])
            state['invitations'].append({'id': 'inv-1', 'email': body['email'], 'expires_at': '2026-11-17T00:00:00Z'})
            route.fulfill(status=201, json={'id': 'inv-1', 'email': body['email']})
        elif path == 'lessons/music-share/unpublish' and method == 'POST':
            unpublishes.append(True)
            state['published'] = False
            state['mode'] = 'private'
            route.fulfill(json={'message': 'This move is private again.'})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=moves')
    page.get_by_label('Options for Shared piano', exact=True).click()
    page.get_by_role('button', name='Share lesson', exact=True).click()
    expect(page.get_by_role('heading', name='Send it to someone.', exact=True)).to_be_visible()
    expect(page.locator('.music-share')).to_contain_text('cannot be shared by link, with a group or publicly')
    assert page.get_by_role('tab', name='Public').count() == 0
    assert page.get_by_role('tab', name='Link').count() == 0
    page.get_by_label('Email', exact=True).fill('learner@example.test')
    page.get_by_role('checkbox').check()
    page.get_by_role('button', name='Send invitation', exact=True).click()
    expect(page.locator('.music-share')).to_contain_text('Invitation sent to learner@example.test')
    expect(page.locator('.music-share')).to_contain_text('learner@example.test')
    assert publishes == [{'revision_id': 'reviewed-rev', 'mode': 'invite', 'reviewed': True, 'rights_acknowledged': True}], publishes
    assert invitations == ['learner@example.test'], invitations
    page.screenshot(path=str(RESULTS / 'music-share-phone.png'), full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(200)
    page.screenshot(path=str(RESULTS / 'music-share-desktop.png'), full_page=True)
    page.get_by_role('button', name='Make private', exact=True).click()
    expect(page.locator('.music-share')).to_contain_text('This music lesson is private again.')
    assert unpublishes == [True]
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    browser.close()
print('PASS: reviewed music share is invitation-only, publishes once, lists the invitation and can be made private.')
