"""Subject metadata is catalogue-owned, additive, metadata-only and release aware."""
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from test_accounts import system, imported
from apps.api import subjects
from apps.api.database import Base, Lesson, LessonRevision, database_ready
from apps.api.lessons import subject_projection


def owner_of(system):
    lesson = imported(system)
    client, app, _settings, _mail, _store = system
    return lesson, client, app


def test_catalogue_is_the_single_source():
    assert [item['id'] for item in subjects.catalogue()] == [
        'movement_other', 'dance', 'taekwondo', 'boxing', 'piano', 'guitar']
    assert subjects.label_for('movement_other') == 'Full Body Movement'
    assert subjects.label_for(None) == 'Full Body Movement'
    assert subjects.family_for('piano') == 'music'
    assert subjects.instrument_for('guitar') == 'guitar'


def test_capabilities_publish_catalogue_and_per_capability_availability(system):
    client, _app, _settings, _mail, _store = system
    body = client.get('/api/capabilities').json()
    assert [item['id'] for item in body['subjects']][0] == 'movement_other'
    assert body['lesson_formats'] == [1, 2]
    assert body['processing'] == {'conversion': True, 'music_piano': False, 'music_guitar': False}


def test_legacy_lesson_keeps_the_full_body_label(system):
    lesson, client, _app = owner_of(system)
    status = client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert status['subject'] == 'movement_other'
    assert status['subject_label'] == 'Full Body Movement'
    assert status['experience_family'] == 'body'
    assert status['instrument'] is None


def test_relabelling_is_metadata_only(system):
    """A relabel must not mint a revision: that would drop progress and force a re-check."""
    lesson, client, app = owner_of(system)
    accepted = client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                           json={'revision_id': lesson.revision_id})
    assert accepted.status_code == 200, accepted.text
    saved = client.put(f'/api/lessons/{lesson.lesson_id}/progress',
                       json={'revision_id': lesson.revision_id, 'time': 1.0, 'speed': 0.5, 'mode': 'sections'})
    assert saved.status_code == 200, saved.text

    response = client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'taekwondo'})
    assert response.status_code == 200, response.text
    assert response.json()['subject_label'] == 'Taekwondo'
    assert response.json()['revision_id'] == lesson.revision_id

    detail = client.get(f'/api/lessons/{lesson.lesson_id}').json()
    assert detail['revision_id'] == lesson.revision_id and detail['schema_version'] == 1
    status = client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert status['subject'] == 'taekwondo'
    assert status['latest_revision_id'] == lesson.revision_id
    assert status['accepted_revision_id'] == lesson.revision_id
    progress = client.get(f'/api/lessons/{lesson.lesson_id}/progress').json()
    assert progress and progress['time'] == 1.0
    with Session(app.state.engine) as session:
        assert session.query(LessonRevision).filter(LessonRevision.lesson_id == lesson.lesson_id).count() == 1
        assert session.get(Lesson, lesson.lesson_id).subject == 'taekwondo'


def test_published_label_is_frozen_until_the_owner_publishes(system):
    lesson, client, app = owner_of(system)
    published = client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                            json={'revision_id': lesson.revision_id, 'mode': 'invite',
                                  'reviewed': True, 'rights_acknowledged': True})
    assert published.status_code == 200, published.text
    assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'dance'}).status_code == 200

    with Session(app.state.engine) as session:
        row = session.get(Lesson, lesson.lesson_id)
        released = session.get(LessonRevision, lesson.revision_id)
        # A reader keeps the label the release carried; the owner sees the draft label.
        assert subject_projection(row, released)['subject_label'] == 'Full Body Movement'
        assert subject_projection(row, released, current=True)['subject_label'] == 'Dance'
        assert row.published_revision_id == lesson.revision_id

    # Publishing again is the act that adopts the current label.
    again = client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                        json={'revision_id': lesson.revision_id, 'mode': 'invite',
                              'reviewed': True, 'rights_acknowledged': True})
    assert again.status_code == 200, again.text
    with Session(app.state.engine) as session:
        row = session.get(Lesson, lesson.lesson_id)
        assert subject_projection(row, session.get(LessonRevision, lesson.revision_id))['subject_label'] == 'Dance'


def test_editing_after_a_relabel_does_not_change_the_published_label(system):
    lesson, client, app = owner_of(system)
    assert client.post(f'/api/lessons/{lesson.lesson_id}/publish',
                       json={'revision_id': lesson.revision_id, 'mode': 'invite',
                             'reviewed': True, 'rights_acknowledged': True}).status_code == 200
    assert client.patch(f'/api/lessons/{lesson.lesson_id}/subject', json={'subject': 'boxing'}).status_code == 200
    edited = client.put(f'/api/lessons/{lesson.lesson_id}/sections',
                        json={'base_revision_id': lesson.revision_id, 'title': lesson.title,
                              'sections': [section.model_dump() for section in lesson.section_set.sections]})
    assert edited.status_code == 200, edited.text
    with Session(app.state.engine) as session:
        row = session.get(Lesson, lesson.lesson_id)
        assert row.published_revision_id == lesson.revision_id
        published_revision = session.get(LessonRevision, lesson.revision_id)
        assert subject_projection(row, published_revision)['subject_label'] == 'Full Body Movement'


def test_contradictory_or_impossible_selections_are_refused(system):
    lesson, client, _app = owner_of(system)
    url = f'/api/lessons/{lesson.lesson_id}/subject'
    assert client.patch(url, json={'subject': 'piano', 'instrument': 'guitar'}).status_code == 422
    assert client.patch(url, json={'subject': 'dance', 'instrument': 'piano'}).status_code == 422
    assert client.patch(url, json={'subject': 'violin'}).status_code == 422
    # A movement lesson cannot become music: the stored content has no music assets.
    assert client.patch(url, json={'subject': 'piano'}).status_code == 422
    accepted = client.patch(url, json={'subject': 'dance'})
    assert accepted.status_code == 200 and accepted.json()['instrument'] is None


def test_database_ready_checks_every_subject_column(tmp_path):
    engine = create_engine(f'sqlite:///{(tmp_path / "probe.db").as_posix()}')
    Base.metadata.create_all(engine)
    database_ready(engine)
    with engine.begin() as connection:
        connection.execute(text('DROP INDEX ix_lessons_subject'))
        connection.execute(text('ALTER TABLE lessons DROP COLUMN subject'))
    with pytest.raises(Exception):
        database_ready(engine)
