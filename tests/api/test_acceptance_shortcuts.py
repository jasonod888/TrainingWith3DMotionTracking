"""Unreviewed music cannot be accepted through either legacy shortcut."""
from sqlalchemy.orm import Session

from test_accounts import imported, system
from apps.api.database import LessonAcceptance
from support_multi import import_music


def owner_of(system):
    lesson = imported(system)
    client, app, _settings, _mail, _store = system
    return lesson, client, app


def accepts(app, lesson_id):
    with Session(app.state.engine) as session:
        return session.query(LessonAcceptance).filter(LessonAcceptance.lesson_id == lesson_id).count()


def publish(client, lesson_id, revision_id):
    return client.post(f'/api/lessons/{lesson_id}/publish',
                       json={'revision_id': revision_id, 'mode': 'invite',
                             'reviewed': True, 'rights_acknowledged': True})


def test_publish_shortcut_does_not_accept_unreviewed_music(system):
    lesson, client, app = owner_of(system)
    music = import_music(system)
    response = publish(client, music.lesson_id, music.revision_id)
    assert response.status_code == 409, response.text
    assert 'reviewed reference' in response.json()['detail']
    assert accepts(app, music.lesson_id) == 0
    assert client.get(f'/api/lessons/{music.lesson_id}',
                      headers={'X-Lesson-Formats': '1,2'}).status_code == 200


def test_acceptance_endpoint_does_not_accept_unreviewed_music(system):
    lesson, client, app = owner_of(system)
    music = import_music(system)
    response = client.post(f'/api/workflow/lessons/{music.lesson_id}/accept',
                           json={'revision_id': music.revision_id})
    assert response.status_code == 409
    assert accepts(app, music.lesson_id) == 0


def test_trim_accept_shortcut_is_refused_for_music(system):
    lesson, client, app = owner_of(system)
    music = import_music(system)
    response = client.put(f'/api/lessons/{music.lesson_id}/trim',
                          json={'base_revision_id': music.revision_id, 'start_frame': 0,
                                'end_frame': 15, 'accept': True})
    assert response.status_code == 409
    assert accepts(app, music.lesson_id) == 0


def test_movement_shortcuts_are_unchanged(system):
    lesson, client, app = owner_of(system)
    accepted = publish(client, lesson.lesson_id, lesson.revision_id)
    assert accepted.status_code == 200, accepted.text
    assert accepts(app, lesson.lesson_id) == 1
    trimmed = client.put(f'/api/lessons/{lesson.lesson_id}/trim',
                         json={'base_revision_id': lesson.revision_id, 'start_frame': 0,
                               'end_frame': 15, 'accept': True})
    assert trimmed.status_code == 200, trimmed.text
    assert accepts(app, lesson.lesson_id) == 2
