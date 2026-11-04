"""Discovery filters: subject filtering happens server-side, before any pagination."""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_accounts import login, register, system, imported
from test_public import list_public
from apps.api.database import LessonGrant


def owner_of(system):
    lesson = imported(system)
    client, app, settings, mail, store = system
    return lesson, client, app, settings, mail


def test_owned_summaries_filter_by_subject(system):
    lesson, client, app, settings, mail = owner_of(system)
    assert client.get('/api/lessons/summaries?subject=dance').json() == []
    assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'dance'}).status_code == 200
    dance = client.get('/api/lessons/summaries?subject=dance').json()
    assert [item['lesson_id'] for item in dance] == [lesson.lesson_id]
    assert client.get('/api/lessons/summaries?subject=movement_other').json() == []
    assert client.get('/api/lessons/summaries?subject=violin').status_code == 422


def test_shared_summaries_follow_the_released_label(system):
    lesson, client, app, settings, mail = owner_of(system)
    published = client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                            json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                  'reviewed': True, 'rights_acknowledged': True})
    assert published.status_code == 200, published.text
    with TestClient(app) as recipient:
        recipient.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
        register(recipient, mail, 'filter@example.test')
        login(recipient, 'filter@example.test')
        account_id = recipient.get('/api/auth/session').json()['account']['id']
        with Session(app.state.engine) as session:
            session.add(LessonGrant(lesson_id=lesson.lesson_id, account_id=account_id, source='invite'))
            session.commit()

        def ids(subject):
            values = recipient.get(f'/api/shared-lessons/summaries?subject={subject}',
                                   headers={'X-Lesson-Formats': '1,2'}).json()
            return [item['lesson_id'] for item in values]

        assert ids('movement_other') == [lesson.lesson_id]
        assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'dance'}).status_code == 200
        # The recipient follows the release, not the owner's unpublished relabel.
        assert ids('movement_other') == [lesson.lesson_id]
        assert ids('dance') == []
        assert client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                           json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                 'reviewed': True, 'rights_acknowledged': True}).status_code == 200
        assert ids('dance') == [lesson.lesson_id]


def test_group_moves_expose_the_subject(system):
    lesson, client, app, settings, mail = owner_of(system)
    assert client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id}).status_code == 200
    group = client.post('/api/groups', json={'name': 'Subject group'}).json()
    added = client.post(f"/api/groups/{group['id']}/lessons", json={'lesson_id': lesson.lesson_id})
    assert added.status_code == 200, added.text
    detail = client.get(f"/api/groups/{group['id']}").json()
    move = next(item for item in detail['moves'] if item['lesson_id'] == lesson.lesson_id)
    assert move['subject'] == 'movement_other'
    assert move['subject_label'] == 'Full Body Movement'
    assert move['experience_family'] == 'body'


def test_public_listing_filters_by_released_subject(system):
    lesson, client, app, settings, mail = owner_of(system)
    assert client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id}).status_code == 200
    assert list_public(client, lesson).status_code == 200
    moves = client.get('/api/public/moves?subject=movement_other').json()['moves']
    assert [item['lesson_id'] for item in moves] == [lesson.lesson_id]
    assert moves[0]['subject_label'] == 'Full Body Movement'
    assert client.get('/api/public/moves?subject=dance').json()['moves'] == []
    assert client.get('/api/public/moves?subject=violin').status_code == 422
    # The public filter follows the released label, so it changes only after publishing.
    assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'dance'}).status_code == 200
    assert client.get('/api/public/moves?subject=dance').json()['moves'] == []
    assert client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                       json={'revision_id': lesson.revision_id, 'mode': 'invite',
                             'reviewed': True, 'rights_acknowledged': True}).status_code == 200
    assert [item['lesson_id'] for item in client.get('/api/public/moves?subject=dance').json()['moves']] == [lesson.lesson_id]
