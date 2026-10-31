"""Acceptance is separate from publishing, idempotent and revision-bound."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import system, imported
from apps.api.database import LessonAcceptance


def owner_of(system):
    lesson = imported(system)
    client, app, _, mail, _ = system
    return lesson, client, app, mail


def accept(client, lesson, warnings=None):
    return client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id, 'warnings': warnings or []})


def test_acceptance_is_recorded_once_and_exposed_in_workflow(system):
    lesson, owner, app, _ = owner_of(system)
    status = owner.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert status['accepted_revision_id'] is None
    assert status['latest_revision_id'] == lesson.revision_id

    response = accept(owner, lesson, ['Low confidence on the left arm'])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['accepted_revision_id'] == lesson.revision_id
    assert body['warnings'] == ['Low confidence on the left arm']

    assert accept(owner, lesson).status_code == 200
    with Session(app.state.engine) as session:
        count = session.scalar(select(func.count()).select_from(LessonAcceptance).where(
            LessonAcceptance.lesson_id == lesson.lesson_id))
        assert count == 1


def test_accepting_a_stale_revision_is_a_conflict(system):
    lesson, owner, app, _ = owner_of(system)
    accept(owner, lesson)
    edit = {'base_revision_id': lesson.revision_id, 'title': lesson.title,
            'sections': [section.model_dump() for section in lesson.section_set.sections]}
    newer = owner.put(f'/api/lessons/{lesson.lesson_id}/sections', json=edit)
    assert newer.status_code == 200, newer.text
    stale = accept(owner, lesson)
    assert stale.status_code == 409
    fresh = newer.json()
    accepted = owner.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                          json={'revision_id': fresh['revision_id']})
    assert accepted.status_code == 200
    assert accepted.json()['accepted_revision_id'] == fresh['revision_id']


def test_non_owner_cannot_accept(system):
    lesson, owner, app, mail = owner_of(system)
    student = __import__('test_sharing').learner(app, mail)
    assert student.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                        json={'revision_id': lesson.revision_id}).status_code == 404


def test_publishing_records_a_legacy_acceptance_and_metadata_does_not(system):
    lesson, owner, app, _ = owner_of(system)
    published = owner.post(f'/api/lessons/{lesson.lesson_id}/publish',
                           json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                 'reviewed': True, 'rights_acknowledged': True})
    assert published.status_code == 200, published.text
    with Session(app.state.engine) as session:
        record = session.scalar(select(LessonAcceptance).where(
            LessonAcceptance.lesson_id == lesson.lesson_id, LessonAcceptance.revision_id == lesson.revision_id))
        assert record and record.source == 'publish'

    edit = {'base_revision_id': lesson.revision_id, 'title': 'Renamed move',
            'sections': [section.model_dump() for section in lesson.section_set.sections]}
    newer = owner.put(f'/api/lessons/{lesson.lesson_id}/sections', json=edit).json()
    status = owner.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert status['latest_revision_id'] == newer['revision_id']
    assert status['accepted_revision_id'] == lesson.revision_id
    assert status['published_revision_id'] == lesson.revision_id
