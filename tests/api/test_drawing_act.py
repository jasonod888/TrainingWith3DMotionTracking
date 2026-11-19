"""Drawing Act end-to-end: create, review, publish, discover and like."""
from test_accounts import imported, system  # noqa: F401 - fixture


def owner_of(system):
    imported(system)
    client, app, _settings, _mail, _store = system
    return client, app


def drawing_body(**changes):
    return {
        'title': 'Draw a cube',
        'medium': 'pencil',
        'steps': [
            {'id': 's1', 'title': 'Box', 'instruction': 'Draw a light box.'},
            {'id': 's2', 'title': 'Shade', 'instruction': 'Shade one face.',
             'media_role': 'detail'},
        ],
        **changes,
    }


def create_drawing(client, **changes):
    response = client.post('/api/drawing/lessons', json=drawing_body(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def test_drawing_save_rejects_a_non_drawing_lesson(system):
    client, app, _settings, _mail, _store = system
    body = imported(system)
    before = client.get(f'/api/lessons/{body.lesson_id}').json()
    response = client.put(f'/api/drawing/lessons/{body.lesson_id}', json={
        'base_revision_id': body.revision_id, 'title': 'Not a drawing', 'medium': 'pencil',
        'steps': [{'id': 's1', 'title': 'Box', 'instruction': 'Should be refused.'}],
    })
    assert response.status_code == 409, response.text
    after = client.get(f'/api/lessons/{body.lesson_id}').json()
    assert after['revision_id'] == before['revision_id']
    from apps.api.database import Lesson, LessonRevision
    from sqlalchemy.orm import Session
    with Session(app.state.engine) as session:
        lesson = session.get(Lesson, body.lesson_id)
        assert lesson is not None and lesson.act_id == 'full_body'
        latest = session.get(LessonRevision, body.revision_id)
        assert latest is not None and latest.act_id == 'full_body'


def test_drawing_schema_3_requires_format_negotiation(system):
    client, _app = owner_of(system)
    manifest = create_drawing(client)
    lesson_id = manifest['lesson_id']
    client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                json={'revision_id': manifest['revision_id']})
    assert client.patch(f'/api/public/lessons/{lesson_id}', json={
        'listed': True, 'title': 'Draw a cube', 'creator_name': 'Ari', 'tags': ['drawing'],
        'rights_acknowledged': True, 'public_roles': ['reference'],
    }).status_code == 200
    old = {'X-Lesson-Formats': '1,2'}
    new = {'X-Lesson-Formats': '1,2,3'}
    assert client.get(f'/api/lessons/{lesson_id}', headers=old).status_code == 406
    assert client.get(f'/api/lessons/{lesson_id}', headers=new).status_code == 200
    assert client.get(f'/api/public/moves/{lesson_id}', headers=old).status_code == 406
    assert client.get(f'/api/public/moves/{lesson_id}', headers=new).status_code == 200


def test_drawing_contract_is_discriminated_and_unassessed(system):
    client, _app = owner_of(system)
    manifest = create_drawing(client)
    assert manifest['schema_version'] == 3
    assert manifest['experience_family'] == 'visual'
    assert manifest['subject'] == 'drawing'
    assert manifest['assessment'] == 'none'
    assert [step['id'] for step in manifest['steps']] == ['s1', 's2']
    for body_field in ('animation', 'landmarks', 'section_set', 'engine'):
        assert body_field not in manifest
    for music_field in ('reference', 'assessment', 'instrument'):
        if music_field == 'assessment':
            continue
        assert music_field not in manifest

    # A body or music field must be refused by the strict drawing reader.
    invalid = client.post('/api/drawing/lessons', json={**drawing_body(), 'animation': {}})
    assert invalid.status_code == 422
    no_steps = client.post('/api/drawing/lessons', json=drawing_body(steps=[]))
    assert no_steps.status_code == 422


def test_drawing_editor_readiness_separates_playback_from_assessment(system):
    client, _app = owner_of(system)
    manifest = create_drawing(client)
    state = client.get(f"/api/lessons/{manifest['lesson_id']}/editor-state").json()
    assert state['act_id'] == 'drawing'
    assert state['lifecycle'] == 'needs-review'
    assert state['readiness']['playbackValid'] is True
    assert state['readiness']['reviewReady'] is True
    assert state['readiness']['assessmentReady'] is False
    assert state['readiness']['assessmentSupport'] == 'unsupported'
    assert state['can_review'] is True
    assert state['can_publish_private'] is False


def test_drawing_private_save_then_publish_and_discover(system):
    client, _app = owner_of(system)
    manifest = create_drawing(client)
    lesson_id = manifest['lesson_id']

    accepted = client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                           json={'revision_id': manifest['revision_id']})
    assert accepted.status_code == 200, accepted.text
    listed = client.patch(f'/api/public/lessons/{lesson_id}', json={
        'listed': True, 'title': 'Draw a cube', 'creator_name': 'Ari',
        'tags': ['drawing', 'basics'], 'rights_acknowledged': True,
        'public_roles': ['reference'],
    })
    assert listed.status_code == 200, listed.text
    assert listed.json()['representations'] == ['interactive_notation']

    public = client.get(f'/api/public/moves/{lesson_id}')
    assert public.status_code == 200, public.text
    body = public.json()
    assert body['act_id'] == 'drawing'
    assert body['public_roles'] == ['reference']
    assert [step['id'] for step in body['steps']] == ['s1', 's2']
    assert set(body['representations']) == {'interactive_notation'}

    discovery = client.get('/api/public/moves', params={'act': 'drawing'}).json()
    assert [item['lesson_id'] for item in discovery['moves']] == [lesson_id]
    item = discovery['moves'][0]
    assert item['act_id'] == 'drawing'
    assert item['effective_actions']['practice'] is True
    assert item['effective_actions']['challenge'] is False
    assert item['representations'] == ['interactive_notation']

    liked = client.put(f'/api/social/moves/{lesson_id}/like', json={})
    assert liked.status_code == 200, liked.text
    assert liked.json() == {'liked': True, 'like_count': 1}
    assert client.get(f'/api/public/moves/{lesson_id}').json()['liked_by_viewer'] is True


def test_drawing_private_edit_does_not_move_the_release(system):
    client, _app = owner_of(system)
    manifest = create_drawing(client)
    lesson_id = manifest['lesson_id']
    client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                json={'revision_id': manifest['revision_id']})
    assert client.patch(f'/api/public/lessons/{lesson_id}', json={
        'listed': True, 'title': 'Draw a cube', 'creator_name': 'Ari',
        'tags': ['drawing'], 'rights_acknowledged': True, 'public_roles': ['reference'],
    }).status_code == 200

    saved = client.put(f'/api/drawing/lessons/{lesson_id}', json={
        'base_revision_id': manifest['revision_id'], 'title': 'Draw a cube (private)',
        'medium': 'charcoal',
        'steps': [{'id': 's1', 'title': 'Box', 'instruction': 'Draw a darker box.'}],
    })
    assert saved.status_code == 200, saved.text
    new_revision = saved.json()['revision_id']
    assert new_revision != manifest['revision_id']

    workflow = client.get(f'/api/workflow/lessons/{lesson_id}').json()
    assert workflow['latest_revision_id'] == new_revision
    assert workflow['published_revision_id'] == manifest['revision_id']
    public = client.get(f'/api/public/moves/{lesson_id}').json()
    assert public['revision_id'] == manifest['revision_id']
    assert [step['id'] for step in public['steps']] == ['s1', 's2']

    stale = client.put(f'/api/drawing/lessons/{lesson_id}', json={
        'base_revision_id': manifest['revision_id'], 'title': 'Stale', 'medium': 'pencil',
        'steps': [{'id': 's1', 'title': 'Box', 'instruction': 'Old base.'}],
    })
    assert stale.status_code == 409
