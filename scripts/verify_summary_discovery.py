"""Mixed-family discovery uses summaries, then loads only the selected lesson. No devices."""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
body = json.loads((ROOT / 'packages/lesson-schema/fixture.json').read_text(encoding='utf-8'))
body.update(lesson_id='body-fixture', revision_id='body-v1', title='Movement fixture',
            source_video=None, thumbnail=None)
music = json.loads((ROOT / 'packages/lesson-schema/fixtures/music-v2.json').read_text(encoding='utf-8'))
music.update(lesson_id='music-fixture', revision_id='music-v1', title='Piano fixture')


def summary(value, subject, family, instrument=None):
    return dict(summary_version=1, lesson_id=value['lesson_id'], revision_id=value['revision_id'],
                title=value['title'], subject=subject, subject_label=subject.title(),
                experience_family=family, instrument=instrument, duration=value['duration'],
                section_count=len(value['section_set']['sections']), poster=None,
                capabilities=dict(preview=True, practice=family == 'body',
                                  live_input='camera' if family == 'body' else 'none'))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors, calls = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.deviceRequests=[];
      localStorage.setItem('form-studio','1');
      navigator.mediaDevices.getUserMedia=()=>{deviceRequests.push('camera');throw Error('Unexpected camera');};
      navigator.requestMIDIAccess=()=>{deviceRequests.push('midi');throw Error('Unexpected MIDI');};
      navigator.permissions.query=()=>{deviceRequests.push('permission');throw Error('Unexpected permission');};
    """)

    def api(route):
        path = route.request.url.split('/api/', 1)[1].split('?')[0]
        calls.append(path)
        if path == 'auth/session':
            route.fulfill(json={'account': dict(id='tester', email='test@example.test', platform_role='member',
                                              status='active', mfa_enrolled=False), 'csrf': 'test'})
        elif path == 'demo':
            route.fulfill(status=404, json={'detail': 'No demo'})
        elif path == 'lessons/summaries':
            route.fulfill(json=[summary(body, 'dance', 'body'), summary(music, 'piano', 'music', 'piano')])
        elif path == 'shared-lessons/summaries':
            route.fulfill(json=[dict(summary(music, 'guitar', 'music', 'guitar'), lesson_id='guitar-fixture',
                                    revision_id='guitar-v1', title='Shared guitar fixture')])
        elif path == 'capabilities':
            route.fulfill(json={'subject_filter': True, 'processing': {}})
        elif path == 'public/subjects':
            route.fulfill(json={'subjects': [{'subject': 'boxing', 'subject_label': 'Boxing', 'count': 1}]})
        elif path == 'public/moves':
            route.fulfill(json={'moves': []})
        elif path == 'workflow/lessons':
            route.fulfill(json={'lessons': []})
        elif path == 'groups':
            route.fulfill(json={'groups': [dict(id='group-fixture', name='Tuesday practice', description='',
                                                role='member', members=1, moves=2)]})
        elif path == 'groups/group-fixture':
            route.fulfill(json=dict(id='group-fixture', name='Tuesday practice', description='', role='member',
                                    can_manage=False, contribution_policy='members', invitations=[], members=[],
                                    moves=[
                                        dict(lesson_id='music-fixture', title='Piano fixture', revision_id='music-v1',
                                             duration=8, sections=2, access_kind='grant', can_remove=False,
                                             subject='piano', subject_label='Piano', experience_family='music',
                                             instrument='piano'),
                                        dict(lesson_id='body-fixture', title='Movement fixture', revision_id='body-v1',
                                             duration=2, sections=2, access_kind='grant', can_remove=False,
                                             subject='dance', subject_label='Dance', experience_family='body',
                                             instrument=None),
                                    ]))
        elif path == 'conversions':
            route.fulfill(json={'jobs': [], 'worker_online': False})
        elif path == 'lessons/music-fixture':
            route.fulfill(json=music)
        elif path == 'lessons/body-fixture':
            route.fulfill(json=body)
        elif path.endswith('/assets/reference.json'):
            route.fulfill(json={'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
                                'duration': 8, 'events': [{'id': 'a', 'onset': 0.5, 'pitch': 60}],
                                'spans': [{'start': 0.2, 'end': 7.5}]})
        else:
            route.fulfill(status=404, json={'detail': 'Not found'})

    page.route('**/api/**', api)
    page.goto(os.environ.get('PRACTICE_TEST_URL', 'http://127.0.0.1:5196') + '/')
    expect(page.get_by_role('button', name='Open Piano fixture', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Open Shared guitar fixture', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Boxing', exact=True)).to_be_visible()
    expect(page.locator('.feed-card-own').filter(has_text='Piano fixture').get_by_label('Lesson subject: Piano')).to_be_visible()
    page.screenshot(path=str(ROOT/'test-results/summary-badges-phone.png'))
    page.set_viewport_size({'width':1280,'height':800})
    page.screenshot(path=str(ROOT/'test-results/summary-badges-desktop.png'))
    page.set_viewport_size({'width':390,'height':844})
    assert not any(path in calls for path in ('lessons', 'shared-lessons', 'lessons/music-fixture', 'lessons/body-fixture'))
    page.get_by_role('button', name='Open Piano fixture', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Piano fixture')
    assert 'lessons/music-fixture' in calls and 'lessons/body-fixture' not in calls
    page.get_by_role('button', name='Back', exact=True).click()
    page.get_by_role('button', name='Open Movement fixture', exact=True).click()
    expect(page.get_by_role('button', name='Back to feed', exact=True)).to_be_visible()
    expect(page.get_by_text('Original video unavailable', exact=True)).to_be_visible()
    page.get_by_role('button', name='Back to feed', exact=True).click()
    expect(page.get_by_role('button', name='Open Piano fixture', exact=True)).to_be_visible()
    page.get_by_role('button', name='Open navigation', exact=True).click()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Studio', exact=True).click()
    expect(page.get_by_role('button', name='Adjust Movement fixture', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Adjust Piano fixture', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='Share Piano fixture', exact=True)).to_have_count(0)
    page.get_by_role('button', name='Preview', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Piano fixture')
    # Browser Back takes the history restoration path rather than navigate().
    page.go_back()
    expect(page.get_by_role('heading',name='Your library at a glance.',exact=True)).to_be_visible()
    expect(page.locator('.music-home')).to_have_count(0)
    page.get_by_role('button',name='Preview',exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Piano fixture')
    # Leaving a music lesson destroys its screen, then the group entry path routes the
    # shared release and the movement grant to their own screens.
    page.get_by_role('button', name='Back', exact=True).click()
    expect(page.get_by_role('button', name='Open Piano fixture', exact=True)).to_be_visible()
    expect(page.locator('.music-home')).to_have_count(0)
    page.get_by_role('button', name='Open navigation', exact=True).click()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Groups', exact=True).click()
    page.get_by_role('button', name=re.compile('Tuesday practice')).click()
    page.locator('.group-move', has_text='Piano fixture').get_by_role('button', name='Try it', exact=True).click()
    expect(page.locator('.music-home h1')).to_have_text('Piano fixture')
    page.get_by_role('button', name='Back', exact=True).click()
    page.get_by_role('button', name='Open navigation', exact=True).click()
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Groups', exact=True).click()
    page.get_by_role('button', name=re.compile('Tuesday practice')).click()
    page.locator('.group-move', has_text='Movement fixture').get_by_role('button', name='Try it', exact=True).click()
    expect(page.get_by_role('button', name='Back to feed', exact=True)).to_be_visible()
    expect(page.locator('.music-home')).to_have_count(0)
    assert errors == [], errors
    assert page.evaluate('window.deviceRequests') == []
    assert not any(path.endswith('.glb') for path in calls)
    browser.close()
print('PASS: mixed summaries, public-only subject, lazy body/music detail, Back navigation, no device requests or 3D assets.')

