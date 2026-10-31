"""Public listing exposes an accepted release, never private source media."""
from unittest.mock import patch
from test_accounts import system, imported


def list_public(owner, lesson, **overrides):
    body = {'listed': True, 'title': 'Front kick', 'creator_name': 'Ari', 'tags': ['kick', 'basics'],
            'rights_acknowledged': True, **overrides}
    return owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json=body)


def test_public_listing_requires_acceptance_and_rights(system):
    lesson = imported(system)
    owner, app, _, _, _ = system
    assert list_public(owner, lesson).status_code == 409
    assert owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id}).status_code == 200
    assert list_public(owner, lesson, rights_acknowledged=False).status_code == 422
    assert list_public(owner, lesson, tags=[]).status_code == 422
    assert list_public(owner, lesson, creator_name='ari@example.test').status_code == 422
    assert list_public(owner, lesson).status_code == 200


def test_public_detail_and_assets_hide_source_media(system):
    lesson = imported(system)
    owner, app, _, _, store = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    assert list_public(owner, lesson).status_code == 200
    with patch('apps.api.public.storage_client', return_value=store):
        from fastapi.testclient import TestClient
        with TestClient(app) as anonymous:
            moves = anonymous.get('/api/public/moves')
            assert moves.status_code == 200
            assert moves.json()['moves'][0]['title'] == 'Front kick'
            assert moves.json()['moves'][0]['tags'] == ['basics', 'kick']
            detail = anonymous.get(f"/api/public/moves/{lesson.lesson_id}")
            assert detail.status_code == 200, detail.text
            body = detail.json()
            assert body['source_video'] is None
            assert body['creator_name'] == 'Ari'
            assert body['title'] == 'Front kick'
            assert anonymous.get(f"/api/public/moves/{lesson.lesson_id}/assets/synthetic.glb").status_code == 200
            assert anonymous.get(f"/api/public/moves/{lesson.lesson_id}/assets/preview.mp4").status_code == 404
            assert anonymous.get(f"/api/public/moves/{lesson.lesson_id}/assets/thumbnail.jpg").status_code == 404
            assert anonymous.get('/api/public/moves?tag=kick').json()['moves']
            assert anonymous.get('/api/public/moves?q=front').json()['moves']
            assert not anonymous.get('/api/public/moves?q=missing').json()['moves']


def test_unlisting_withdraws_public_access_but_keeps_private_grants(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    assert list_public(owner, lesson).status_code == 200
    owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={'listed': False})
    from fastapi.testclient import TestClient
    with TestClient(app) as anonymous:
        assert anonymous.get(f"/api/public/moves/{lesson.lesson_id}").status_code == 404
        assert anonymous.get('/api/public/moves').json()['moves'] == []
    assert owner.get(f'/api/lessons/{lesson.lesson_id}').status_code == 200


def test_only_the_owner_can_list_a_move(system):
    lesson = imported(system)
    owner, app, _, mail, _ = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    from test_sharing import learner
    other = learner(app, mail, 'other@example.test')
    assert other.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Mine now', 'creator_name': 'Other', 'tags': ['kick'], 'rights_acknowledged': True}).status_code == 404


def test_source_thumbnail_is_private_for_anonymous_and_signed_in_public_readers(system):
    from sqlalchemy.orm import Session
    from apps.api.database import LessonAsset, LessonRevision
    from test_sharing import learner
    lesson = imported(system)
    owner, app, _, mail, store = system
    key = f'lessons/{lesson.lesson_id}/thumbnail.jpg'
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        manifest = dict(revision.manifest)
        manifest['thumbnail'] = {'key': key, 'mime': 'image/jpeg', 'sha256': '0' * 64, 'bytes': 20}
        revision.manifest = manifest
        session.add(LessonAsset(key=key, lesson_id=lesson.lesson_id, mime='image/jpeg', sha256='0' * 64, bytes=20))
        session.commit()
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    assert list_public(owner, lesson).status_code == 200
    from fastapi.testclient import TestClient
    with TestClient(app) as anonymous:
        assert anonymous.get('/api/public/moves').json()['moves'][0]['thumbnail_url'] is None
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}').json()['thumbnail'] is None
        assert anonymous.get(f'/api/public/moves/{lesson.lesson_id}/assets/thumbnail.jpg').status_code == 404
    viewer = learner(app, mail, 'public@example.test')
    assert viewer.get(f'/api/lessons/{lesson.lesson_id}').json()['thumbnail'] is None
    assert viewer.get(f'/api/lessons/{lesson.lesson_id}/assets/thumbnail.jpg').status_code == 404


def test_public_metadata_keeps_release_and_explicit_update_moves_all_audiences(system):
    from test_sharing import learner
    lesson = imported(system)
    owner, app, _, mail, _ = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    owner.post(f'/api/lessons/{lesson.lesson_id}/publish', json={
        'revision_id': lesson.revision_id, 'mode': 'invite', 'reviewed': True, 'rights_acknowledged': True})
    friend = learner(app, mail, 'friend@example.test')
    owner.post(f'/api/lessons/{lesson.lesson_id}/invitations', json={'email': 'friend@example.test'})
    token = next(t for e, purpose, t in reversed(mail) if purpose == 'invite')
    friend.post('/api/shares/accept', json={'invite': token})
    assert list_public(owner, lesson).status_code == 200
    edited = owner.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id, 'title': 'Private new title', 'sections': [s.model_dump() for s in lesson.section_set.sections]}).json()
    new_id = edited['revision_id']
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': new_id})
    assert list_public(owner, lesson, title='Updated public title').status_code == 200
    assert owner.get(f'/api/public/moves/{lesson.lesson_id}').json()['revision_id'] == lesson.revision_id
    assert owner.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'release_revision_id': new_id, 'rights_acknowledged': True}).status_code == 200
    assert owner.get(f'/api/public/moves/{lesson.lesson_id}').json()['title'] == 'Updated public title'
    assert owner.get(f'/api/public/moves/{lesson.lesson_id}').json()['revision_id'] == new_id
    assert friend.get(f'/api/lessons/{lesson.lesson_id}').json()['revision_id'] == new_id
    assert friend.put(f'/api/lessons/{lesson.lesson_id}/progress', json={
        'revision_id': new_id, 'time': 0, 'speed': 1, 'mode': 'continuous'}).status_code == 200


def test_owner_can_save_progress_on_the_public_release_while_editing_a_private_draft(system):
    lesson = imported(system)
    owner, app, _, _, _ = system
    owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept', json={'revision_id': lesson.revision_id})
    assert list_public(owner, lesson).status_code == 200
    owner.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id, 'title': 'Private edit', 'sections': [s.model_dump() for s in lesson.section_set.sections]})
    assert owner.put(f'/api/lessons/{lesson.lesson_id}/progress', json={
        'revision_id': lesson.revision_id, 'time': 1, 'speed': 1, 'mode': 'continuous'}).status_code == 200
    assert owner.get(f'/api/lessons/{lesson.lesson_id}/progress?revision_id={lesson.revision_id}').json()['time'] == 1
    assert owner.post('/api/mimic-pairs', json={'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id}).status_code == 201
