"""Public subject filtering happens in the query, before pagination."""
import json
from uuid import uuid4

from sqlalchemy.orm import Session

from test_accounts import login, register, system
from apps.api.auth import now
from apps.api.config import ROOT
from apps.api.database import Lesson, LessonAcceptance, LessonPublication, LessonRevision


def seed_public(session, owner_id, subject, count, prefix):
    base = json.loads((ROOT / 'packages' / 'lesson-schema' / 'fixture.json').read_text(encoding='utf-8'))
    ids = []
    for index in range(count):
        lesson_id, revision_id = uuid4().hex, uuid4().hex
        title = f'{prefix} {index}'
        manifest = {**base, 'lesson_id': lesson_id, 'revision_id': revision_id, 'title': title}
        session.add(Lesson(id=lesson_id, owner_id=owner_id, title=title, subject=subject,
                           experience_family='body', published_revision_id=revision_id,
                           distribution='public'))
        session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=1, manifest=manifest,
                                   subject=subject, experience_family='body'))
        session.add(LessonAcceptance(id=uuid4().hex, lesson_id=lesson_id, revision_id=revision_id,
                                     account_id=owner_id, warnings=[], source='owner'))
        session.add(LessonPublication(lesson_id=lesson_id, revision_id=revision_id, title=title,
                                      creator_name='Ari', listed=True, listed_at=now()))
        ids.append(lesson_id)
    return ids


def seeded(system):
    client, app, settings, mail, store = system
    register(client, mail)
    login(client)
    owner_id = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        dance = seed_public(session, owner_id, 'dance', 30, 'Dance')
        movement = seed_public(session, owner_id, 'movement_other', 3, 'Movement')
        session.commit()
    return client, dance, movement


def test_subject_filter_applies_before_pagination(system):
    client, dance, movement = seeded(system)
    first = client.get('/api/public/moves?subject=dance&limit=24').json()['moves']
    assert len(first) == 24
    assert {item['subject'] for item in first} == {'dance'}

    second = client.get('/api/public/moves?subject=dance&offset=24&limit=24').json()['moves']
    assert len(second) == 6
    assert {item['subject'] for item in second} == {'dance'}

    # Every dance lesson is reachable across the pages: nothing was lost to a client-side
    # filter applied after the page had already been cut.
    assert {item['lesson_id'] for item in first + second} == set(dance)
    assert not ({item['lesson_id'] for item in first + second} & set(movement))


def test_other_subjects_are_not_mixed_into_a_filtered_page(system):
    client, dance, movement = seeded(system)
    other = client.get('/api/public/moves?subject=movement_other').json()['moves']
    assert {item['lesson_id'] for item in other} == set(movement)
    assert len(other) == 3
    assert client.get('/api/public/moves?subject=violin').status_code == 422


def test_unfiltered_listing_still_returns_everything(system):
    client, dance, movement = seeded(system)
    page = client.get('/api/public/moves?limit=24').json()['moves']
    assert len(page) == 24
    assert client.get('/api/public/moves?limit=50').json()['moves'].__len__() == 33
