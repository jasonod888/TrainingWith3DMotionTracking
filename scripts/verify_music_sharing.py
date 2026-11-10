"""Private music sharing: invitation-only UI, no link/public controls, publish and revoke."""
import json
import hashlib
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
summary = {'summary_version': 1, 'lesson_id': 'music-share', 'revision_id': 'reviewed-rev',
           'title': 'Shared piano', 'subject': 'piano', 'subject_label': 'Piano',
           'experience_family': 'music', 'instrument': 'piano', 'duration': 8, 'section_count': 2,
           'poster': None, 'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}

manifest = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
manifest.update(lesson_id='music-share', revision_id='reviewed-rev', title='Shared piano')
reference = json.dumps({'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument':'piano'},
    'duration': 8, 'events':[{'id':'c4','onset':0.5,'pitch':60}], 'spans':[{'start':0.2,'end':7.5}],
    'review':{'reviewer_id':'owner','reviewed_at':'2026-11-10T00:00:00Z','draft_id':'fixture',
              'source_reference_sha256':'a'*64}}).encode()
manifest['reference'].update(key='lessons/music-share/reference.json', bytes=len(reference),
                             sha256=hashlib.sha256(reference).hexdigest())

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, publishes, invitations, unpublishes, accept_headers = [], [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.add_init_script("""
      window.deviceRequests=[];
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      localStorage.setItem('form-studio','1');
    """)
    state = {'published': False, 'mode': 'private', 'invitations': [], 'latest': 'reviewed-rev', 'released': None}

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
        elif path == 'shares/inspect':
            route.fulfill(json={'title':'Shared piano','sections':2,'duration':8})
        elif path == 'shares/accept':
            accept_headers.append(route.request.headers.get('x-lesson-formats'))
            route.fulfill(json=manifest)
        elif path == 'lessons/music-share/assets/reference.json':
            route.fulfill(body=reference, content_type='application/json')
        elif path == 'lessons/music-share/sharing':
            route.fulfill(json={'mode': state['mode'], 'published_revision_id': state['released'] if state['published'] else None,
                                'accepted_revision_id': state['latest'], 'draft_revision_id': state['latest'],
                                'students': [], 'invitations': state['invitations']})
        elif path == 'lessons/music-share/publish' and method == 'POST':
            body = route.request.post_data_json
            publishes.append(body)
            if body['mode'] != 'invite':
                route.fulfill(status=409, json={'detail': 'Music lessons can only be shared by private invitation.'})
                return
            state['published'] = True
            state['released'] = body['revision_id']
            state['mode'] = 'invite'
            route.fulfill(json={'published_revision_id': body['revision_id'], 'link': None})
        elif path == 'lessons/music-share/invitations' and method == 'POST':
            body = route.request.post_data_json
            invitations.append(body['email'])
            state['invitations'].append({'id': 'inv-' + str(len(invitations)), 'email': body['email'], 'expires_at': '2026-11-17T00:00:00Z'})
            route.fulfill(status=201, json={'id': 'inv-' + str(len(invitations)), 'email': body['email']})
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
    # A newer review must not silently replace the release when inviting another person.
    state['latest'] = 'new-reviewed-rev'
    page.reload()
    page.get_by_label('Options for Shared piano', exact=True).click()
    page.get_by_role('button', name='Share lesson', exact=True).click()
    expect(page.get_by_role('button', name='Update shared version', exact=True)).to_be_visible()
    page.get_by_label('Email', exact=True).fill('another@example.test')
    page.get_by_role('checkbox').check()
    page.get_by_role('button', name='Send invitation', exact=True).click()
    expect(page.locator('.music-share')).to_contain_text('Invitation sent to another@example.test')
    assert len(publishes) == 1 and state['released'] == 'reviewed-rev', publishes
    page.get_by_role('button', name='Update shared version', exact=True).click()
    expect(page.locator('.music-share')).to_contain_text('Shared version updated for everyone.')
    assert len(publishes) == 2 and state['released'] == 'new-reviewed-rev', publishes
    expect(page.get_by_role('button', name='Update shared version', exact=True)).to_have_count(0)
    page.get_by_role('button', name='Make private', exact=True).click()
    expect(page.locator('.music-share')).to_contain_text('This music lesson is private again.')
    assert unpublishes == [True]
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5173') + '/?page=join#invite=' + 'a'*32)
    page.get_by_role('button', name='Try this move', exact=False).click()
    expect(page.get_by_role('heading', name='Shared piano', exact=True)).to_be_visible()
    expect(page.get_by_role('slider', name='Lesson position', exact=True)).to_be_visible()
    assert accept_headers == ['1,2'], accept_headers
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    browser.close()
print('PASS: reviewed music share is invitation-only, preserves the release on new invitations, explicitly updates, lists invitations and can be made private.')
