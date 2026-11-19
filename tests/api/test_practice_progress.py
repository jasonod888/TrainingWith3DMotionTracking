"""Plan-scoped practice progress and neutral attempts for every Act."""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import imported, login, register, system  # noqa: F401 - fixture
from support_multi import import_music
from apps.api.database import LessonRevision


def owner_of(system):
    lesson = imported(system)
    client, app, _settings, mail, _store = system
    return lesson, client, app, mail


def other_client(app, mail):
    client = TestClient(app)
    client.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
    register(client, mail, email='other@example.test')
    login(client, email='other@example.test')
    return client


def save_progress(client, lesson, plan_id='plan-a', **changes):
    return client.put('/api/practice/progress', json={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id, 'plan_id': plan_id,
        'unit_id': 'unit-1', 'time': 12.5, 'speed': 0.75, 'mode': 'sections', 'loop': True,
        'repetitions': 2, 'countdown_seconds': 3, 'rest_seconds': 2, **changes,
    })


def read_progress(client, lesson, plan_id='plan-a'):
    return client.get('/api/practice/progress', params={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id, 'plan_id': plan_id,
    })


def attempt(lesson, **changes):
    return {
        'attempt_id': 'attempt-1', 'lesson_id': lesson.lesson_id,
        'revision_id': lesson.revision_id, 'act_id': 'full_body', 'mode': 'practice',
        'plan_id': 'plan-a', 'unit_id': 'unit-1', 'duration_ms': 42_000,
        'status': 'completed', 'assessment_adapter': 'pose-v1', 'rubric_version': 'pose-v1',
        'report': {'score': 88}, **changes,
    }


def test_progress_is_scoped_by_plan_and_upserts(system):
    lesson, client, _app, _mail = owner_of(system)
    saved = save_progress(client, lesson)
    assert saved.status_code == 200, saved.text
    assert saved.json()['time'] == 12.5 and saved.json()['plan_id'] == 'plan-a'

    assert read_progress(client, lesson).json()['time'] == 12.5
    assert read_progress(client, lesson, plan_id='plan-b').json() is None

    updated = save_progress(client, lesson, time=20)
    assert updated.status_code == 200
    assert read_progress(client, lesson).json()['time'] == 20


def test_progress_refuses_a_stale_revision(system):
    lesson, client, app, _mail = owner_of(system)
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        sections = revision.manifest['section_set']['sections']
    newer = client.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id, 'title': 'Newer plan',
        'sections': sections,
    })
    assert newer.status_code == 200

    stale = save_progress(client, lesson)
    assert stale.status_code == 409
    response = read_progress(client, lesson)
    assert response.status_code == 409


def test_progress_and_attempts_are_isolated_per_account(system):
    lesson, client, app, mail = owner_of(system)
    assert save_progress(client, lesson).status_code == 200
    assert client.post('/api/practice/attempts', json=attempt(lesson)).status_code == 201

    other = other_client(app, mail)
    cross_progress = other.get('/api/practice/progress', params={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id, 'plan_id': 'plan-a'})
    assert cross_progress.status_code == 404
    cross_attempt = other.post('/api/practice/attempts', json=attempt(lesson, attempt_id='attempt-2'))
    assert cross_attempt.status_code == 404
    assert other.get('/api/practice/attempts', params={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id}).status_code == 404


def test_attempt_envelope_distinguishes_unassessed_and_assessed(system):
    lesson, client, _app, _mail = owner_of(system)
    assessed = client.post('/api/practice/attempts', json=attempt(lesson))
    assert assessed.status_code == 201, assessed.text
    assert assessed.json()['status'] == 'completed'
    assert assessed.json()['assessment_adapter'] == 'pose-v1'

    invalid = client.post('/api/practice/attempts', json=attempt(
        lesson, attempt_id='attempt-2', status='unassessed'))
    assert invalid.status_code == 422, 'unassessed cannot claim an adapter'

    unassessed = client.post('/api/practice/attempts', json=attempt(
        lesson, attempt_id='attempt-3', status='unassessed', mode='challenge',
        assessment_adapter=None, rubric_version=None, report=None))
    assert unassessed.status_code == 201, unassessed.text
    assert unassessed.json()['status'] == 'unassessed'
    assert unassessed.json()['assessment_adapter'] is None

    listed = client.get('/api/practice/attempts', params={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id})
    assert listed.status_code == 200
    assert [row['status'] for row in listed.json()] == ['unassessed', 'completed']

    duplicate = client.post('/api/practice/attempts', json=attempt(lesson))
    assert duplicate.status_code == 200, 'the same attempt id is idempotent'
    assert len(client.get('/api/practice/attempts', params={
        'lesson_id': lesson.lesson_id, 'revision_id': lesson.revision_id}).json()) == 2


def test_feedback_disabled_body_attempt_is_accepted_unassessed(system):
    client, _app, _settings, _mail, _store = system
    lesson = imported(system)
    response = client.post('/api/practice/attempts', json=attempt(
        lesson, attempt_id='attempt-unassessed', status='unassessed',
        assessment_adapter=None, rubric_version=None, report={'scored': False}))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['status'] == 'unassessed'
    assert body['assessment_adapter'] is None and body['rubric_version'] is None


def test_music_practice_uses_the_same_contract(system):
    lesson, client, _app, _mail = owner_of(system)
    music = import_music(system)
    saved = client.put('/api/practice/progress', json={
        'lesson_id': music.lesson_id, 'revision_id': music.revision_id, 'plan_id': 'piano-bars-2',
        'unit_id': None, 'time': 4, 'speed': 1, 'mode': 'sections', 'loop': False,
        'repetitions': 0, 'countdown_seconds': 0, 'rest_seconds': 1.5,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()['plan_id'] == 'piano-bars-2'

    chained = client.post('/api/practice/attempts', json={
        'attempt_id': 'piano-attempt-1', 'lesson_id': music.lesson_id,
        'revision_id': music.revision_id, 'act_id': 'piano', 'mode': 'challenge',
        'plan_id': 'piano-bars-2', 'unit_id': None, 'duration_ms': 8_000,
        'status': 'insufficient_evidence', 'assessment_adapter': 'piano-midi-v1',
        'rubric_version': 'piano-midi-v1', 'report': {'coverage': 0.1},
    })
    assert chained.status_code == 201, chained.text
    assert chained.json()['status'] == 'insufficient_evidence'
    assert chained.json()['act_id'] == 'piano'
