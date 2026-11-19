"""Shared editor lifecycle: readiness, revision identity and release separation."""
from sqlalchemy.orm import Session

from test_accounts import imported, system  # noqa: F401 - `system` is a pytest fixture
from support_multi import import_music
from apps.api.database import Lesson, LessonRevision


def owner_of(system):
    lesson = imported(system)
    client, app, _settings, _mail, _store = system
    return lesson, client, app


def editor_state(client, lesson_id):
    response = client.get(f'/api/lessons/{lesson_id}/editor-state')
    assert response.status_code == 200, response.text
    return response.json()


def accept(client, lesson):
    return client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id})


def list_public(client, lesson):
    return client.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Front kick', 'creator_name': 'Ari',
        'tags': ['kick'], 'rights_acknowledged': True})


def test_body_editor_state_reports_readiness_and_review_work(system):
    lesson, client, _app = owner_of(system)
    state = editor_state(client, lesson.lesson_id)
    assert state['act_id'] == 'full_body'
    assert state['lifecycle'] == 'needs-review'
    assert state['latest_revision_id'] == lesson.revision_id
    assert state['accepted_revision_id'] is None
    assert state['published_revision_id'] is None
    assert state['readiness']['playbackValid'] is True
    assert state['readiness']['assessmentReady'] is True
    assert state['readiness']['reviewReady'] is True
    assert state['readiness']['blockers'] == []
    assert state['can_review'] is True
    assert state['can_publish_private'] is False
    assert state['can_publish_public'] is False


def test_completed_processing_is_only_review_work(system):
    lesson, client, _app = owner_of(system)
    state = editor_state(client, lesson.lesson_id)
    # The conversion job may be ready_for_review, but the lesson is not reviewed,
    # accepted or released by that fact alone.
    assert state['lifecycle'] == 'needs-review'
    assert state['accepted_revision_id'] is None
    assert state['published_revision_id'] is None
    assert state['can_publish_private'] is False


def test_private_edit_preserves_the_released_revision(system):
    lesson, client, app = owner_of(system)
    assert accept(client, lesson).status_code == 200
    assert list_public(client, lesson).status_code == 200

    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        sections = revision.manifest['section_set']['sections']
    saved = client.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id,
        'title': 'Private retitle',
        'sections': sections,
    })
    assert saved.status_code == 200, saved.text
    new_revision = saved.json()['revision_id']
    assert new_revision != lesson.revision_id

    workflow = client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert workflow['latest_revision_id'] == new_revision
    assert workflow['published_revision_id'] == lesson.revision_id
    assert workflow['accepted_revision_id'] == lesson.revision_id

    # The public release still serves the old immutable revision.
    public = client.get(f'/api/public/moves/{lesson.lesson_id}')
    assert public.status_code == 200
    assert public.json()['revision_id'] == lesson.revision_id

    state = editor_state(client, lesson.lesson_id)
    assert state['lifecycle'] == 'needs-review'
    assert state['latest_revision_id'] == new_revision
    assert state['accepted_revision_id'] == lesson.revision_id
    assert state['published_revision_id'] == lesson.revision_id
    assert state['can_publish_private'] is False


def test_accepting_a_stale_revision_is_a_conflict(system):
    lesson, client, app = owner_of(system)
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        sections = revision.manifest['section_set']['sections']
    assert client.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id,
        'title': 'Newer revision',
        'sections': sections,
    }).status_code == 200
    stale = accept(client, lesson)
    assert stale.status_code == 409
    assert 'changed' in stale.json()['detail'].lower()


def test_music_readiness_separates_playback_from_assessment(system):
    owner_of(system)
    music = import_music(system)
    client, app, _settings, _mail, _store = system

    state = editor_state(client, music.lesson_id)
    assert state['act_id'] == 'piano'
    assert state['readiness']['playbackValid'] is True
    assert state['readiness']['reviewReady'] is True
    assert state['readiness']['assessmentSupport'] == 'supported'
    assert state['readiness']['assessmentReady'] is True

    # Creator turns assessment off: playable and reviewable, but unassessed.
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, music.revision_id)
        manifest = dict(revision.manifest)
        manifest['feedback_enabled'] = False
        revision.manifest = manifest
        session.commit()

    unassessed = editor_state(client, music.lesson_id)
    assert unassessed['readiness']['playbackValid'] is True
    assert unassessed['readiness']['reviewReady'] is True
    assert unassessed['readiness']['assessmentReady'] is False
    assert 'creator' in (unassessed['readiness']['unassessedReason'] or '').lower()


def test_unknown_act_editor_state_is_safe_not_body(system):
    lesson, client, app = owner_of(system)
    with Session(app.state.engine) as session:
        session.get(Lesson, lesson.lesson_id).act_id = 'violin'
        session.commit()
    state = editor_state(client, lesson.lesson_id)
    assert state['act_id'] is None
    assert state['readiness']['playbackValid'] is False
    assert state['readiness']['reviewReady'] is False
    assert state['readiness']['blockers'][0]['code'] == 'no_playable_revision'
