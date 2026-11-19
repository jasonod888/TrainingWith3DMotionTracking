"""Discovery, recommendations and owner summaries use bounded, constant SQL.

The listener counts every statement the route issues (including auth), then compares
a small library with a larger one at the same page size. An N+1 regression makes the
larger count grow with the number of lessons.
"""
import json
from uuid import uuid4

from sqlalchemy import event
from sqlalchemy.orm import Session

from test_accounts import imported, system  # noqa: F401 - fixture
from apps.api.auth import now
from apps.api.config import ROOT
from apps.api.database import (Lesson, LessonAcceptance, LessonPublication,
                               LessonRevision, LessonTag)

BODY = json.loads((ROOT / 'packages' / 'lesson-schema' / 'fixture.json').read_text(encoding='utf-8'))


def seed(session, owner, count, start=0, subject='dance', title=None):
    ids = []
    family = 'music' if subject in ('piano', 'guitar') else 'body'
    for index in range(start, start + count):
        lesson_id, revision_id = uuid4().hex, uuid4().hex
        lesson_title = title or f'Budget lesson {index}'
        manifest = {**BODY, 'lesson_id': lesson_id, 'revision_id': revision_id, 'title': lesson_title}
        session.add(Lesson(id=lesson_id, owner_id=owner, title=lesson_title, subject=subject,
                           experience_family=family, instrument=subject if family == 'music' else None,
                           act_id=subject if subject in ('piano', 'guitar') else 'full_body',
                           published_revision_id=revision_id, distribution='public'))
        session.add(LessonRevision(id=revision_id, lesson_id=lesson_id, version=1,
                                   manifest=manifest, subject=subject,
                                   experience_family=family,
                                   instrument=subject if family == 'music' else None,
                                   act_id=subject if subject in ('piano', 'guitar') else 'full_body'))
        session.add(LessonAcceptance(id=uuid4().hex, lesson_id=lesson_id, revision_id=revision_id,
                                     account_id=owner, warnings=[], source='owner'))
        session.add(LessonPublication(lesson_id=lesson_id, revision_id=revision_id, title=title,
                                      creator_name='Creator', listed=True,
                                      listed_at=now(), roles=['interactive_data']))
        session.add(LessonTag(lesson_id=lesson_id, tag='budget'))
        ids.append(lesson_id)
    return ids


def count_queries(engine, action):
    statements = []

    def before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, 'before_cursor_execute', before)
    try:
        action()
    finally:
        event.remove(engine, 'before_cursor_execute', before)
    return len(statements)


def test_public_discovery_query_count_is_constant(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    owner = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        ids = seed(session, owner, 5)
        session.commit()
    small = count_queries(app.state.engine,
                          lambda: client.get('/api/public/moves', params={'limit': 10}))
    with Session(app.state.engine) as session:
        seed(session, owner, 25, start=5)
        session.commit()
    large = count_queries(app.state.engine,
                          lambda: client.get('/api/public/moves', params={'limit': 10}))
    assert large == small, f'public discovery scaled {small} -> {large} queries'
    assert large <= 10, f'public discovery used {large} queries'

    seed_id = ids[0]
    small_recs = count_queries(app.state.engine, lambda: client.get(
        '/api/public/recommendations', params={'lesson_id': seed_id, 'limit': 6}))
    assert small_recs <= 20, f'recommendations used {small_recs} queries'
    with Session(app.state.engine) as session:
        seed(session, owner, 25, start=30)
        session.commit()
    large_recs = count_queries(app.state.engine, lambda: client.get(
        '/api/public/recommendations', params={'lesson_id': seed_id, 'limit': 6}))
    assert large_recs == small_recs, f'recommendations scaled {small_recs} -> {large_recs}'

    small_summaries = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons/summaries', headers={'X-Lesson-Formats': '1,2'}))
    with Session(app.state.engine) as session:
        seed(session, owner, 25, start=55)
        session.commit()
    large_summaries = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons/summaries', headers={'X-Lesson-Formats': '1,2'}))
    assert large_summaries == small_summaries, \
        f'owner summaries scaled {small_summaries} -> {large_summaries}'
    assert large_summaries <= 8, f'owner summaries used {large_summaries} queries'


def test_owned_summaries_paginate_with_constant_queries(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    owner = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        seed(session, owner, 30)
        session.commit()
    first = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons', params={'limit': 5, 'offset': 0}))
    payload = client.get('/api/lessons', params={'limit': 5, 'offset': 0}).json()
    assert isinstance(payload, dict)
    assert len(payload['lessons']) == 5
    assert payload['total'] >= 30 and payload['has_more'] is True
    with Session(app.state.engine) as session:
        seed(session, owner, 25, start=30)
        session.commit()
    second = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons', params={'limit': 5, 'offset': 0}))
    assert second == first, f'owned list scaled {first} -> {second}'
    assert second <= 8

    recommendations = client.get('/api/public/recommendations', params={'limit': 3}).json()
    assert recommendations['candidate_limit'] == 60
    assert recommendations['candidate_count'] <= recommendations['candidate_limit']

def test_summary_search_subject_and_facets_apply_before_pagination(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    owner = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        seed(session, owner, 12, start=0, subject='dance')
        seed(session, owner, 1, start=12, subject='piano', title='Etude')
        seed(session, owner, 1, start=13, subject='guitar', title='Study')
        seed(session, owner, 1, start=14, subject='piano', title='Moonlight Sonata')
        session.commit()
    headers = {'X-Lesson-Formats': '1,2', 'X-Act-Formats': '1'}
    searched = client.get('/api/lessons/summaries',
                          params={'limit': 5, 'offset': 0, 'q': 'moonlight'},
                          headers=headers).json()
    assert [item['title'] for item in searched['lessons']] == ['Moonlight Sonata']
    assert searched['total'] == 1 and searched['has_more'] is False
    piano = client.get('/api/lessons/summaries',
                       params={'limit': 5, 'offset': 0, 'subject': 'piano'},
                       headers=headers).json()
    assert all(item['subject'] == 'piano' for item in piano['lessons'])
    assert piano['total'] >= 2 and piano['has_more'] is False
    assert {'dance', 'piano', 'guitar'}.issubset(set(piano['available_subjects']))
    assert len(piano['available_subjects']) >= 3
    count = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons/summaries', params={'limit': 5, 'offset': 0, 'q': 'moonlight'},
        headers=headers))
    assert count <= 10


def test_owner_summaries_are_sql_paginated(system):
    client, app, _settings, _mail, _store = system
    imported(system)
    owner = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        seed(session, owner, 30)
        session.commit()
    headers = {'X-Lesson-Formats': '1,2', 'X-Act-Formats': '1'}
    payload = client.get('/api/lessons/summaries',
                         params={'limit': 10, 'offset': 0}, headers=headers).json()
    assert isinstance(payload, dict)
    assert len(payload['lessons']) == 10
    assert payload['total'] >= 30
    assert payload['has_more'] is True
    count = count_queries(app.state.engine, lambda: client.get(
        '/api/lessons/summaries', params={'limit': 10, 'offset': 0}, headers=headers))
    assert count <= 8, f'paginated summaries used {count} queries'


def test_discovery_item_hydration_is_batched(system):
    """A page of many cards still uses one revision/acceptance/tag/like batch."""
    client, app, _settings, _mail, _store = system
    imported(system)
    owner = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        seed(session, owner, 30)
        session.commit()
    count = count_queries(app.state.engine,
                          lambda: client.get('/api/public/moves', params={'limit': 30}))
    assert count <= 10, f'30 cards used {count} queries'
    payload = client.get('/api/public/moves', params={'limit': 30}).json()
    assert len(payload['moves']) == 30
    assert all(item['tags'] == ['budget'] for item in payload['moves'])
    assert all(item['roles'] == ['interactive_data'] for item in payload['moves'])
