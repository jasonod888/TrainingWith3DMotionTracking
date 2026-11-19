"""Act identity, versioned descriptors, negotiated envelopes and publication policy.

These are Phase 1 contract tests: they must pass without a worker, browser, model,
network or live server. Everything runs against the SQLite test app.
"""
import hashlib
import json
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from test_accounts import imported, system  # noqa: F401 - `system` is a pytest fixture
from support_multi import import_music
from apps.api import acts, processing_routes, subjects
from apps.api.auth import now
from apps.api.database import (Base, Lesson, LessonAcceptance, LessonRevision,
                               database_ready)

ACT_HEADER = {'X-Act-Formats': '1'}


def owner_of(system):
    lesson = imported(system)
    client, app, settings, _mail, _store = system
    return lesson, client, app, settings


def manifest_digest(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode('utf-8')).hexdigest()


def test_subject_to_act_mapping_is_explicit_and_complete():
    assert acts.SUBJECT_TO_ACT == {
        'dance': 'full_body',
        'taekwondo': 'full_body',
        'boxing': 'full_body',
        'movement_other': 'full_body',
        'piano': 'piano',
        'guitar': 'guitar',
        'drawing': 'drawing',
    }
    # Every catalogue subject resolves, and the catalogue advertises the same Act.
    assert set(acts.SUBJECT_TO_ACT) == {item['id'] for item in subjects.catalogue()}
    for item in subjects.catalogue():
        assert item['act_id'] == acts.SUBJECT_TO_ACT[item['id']]
    assert acts.act_for_subject('piano').id == 'piano'
    assert acts.act_for_subject('guitar').id == 'guitar'
    assert acts.act_for_subject('movement_other').id == 'full_body'


def test_identity_is_never_inferred_from_content():
    # A title or filename that mentions a discipline is not identity.
    for value in (None, '', 'taekwondo-basics.mp4', 'My Piano Lesson', 'dance'):
        if value in acts.SUBJECT_TO_ACT:
            continue
        with pytest.raises(acts.UnsupportedAct) as exc:
            acts.act_for_subject(value)
        assert exc.value.code == 'unsupported_act'
    with pytest.raises(acts.UnsupportedAct):
        acts.resolve_act(None, None)


def test_descriptors_and_publication_policies_agree_for_every_act():
    for act_id in acts.ACT_IDS:
        descriptor = acts.descriptor_for(act_id)
        policy = acts.publication_policy(act_id)
        assert tuple(descriptor.publication_representations) == policy.representations, act_id


def test_descriptors_are_versioned_frozen_and_data_only():
    assert acts.ACT_DESCRIPTOR_VERSION == 1
    assert acts.ACT_IDS == ('full_body', 'piano', 'guitar', 'drawing')
    guitar = acts.descriptor_for('guitar')
    assert guitar.experience_family == 'music'
    assert 'challenge' not in guitar.practice_modes
    assert 'midi' in guitar.practice_inputs
    assert guitar.publication_representations == ('video', 'audio', 'interactive_notation', 'poster')
    body = acts.descriptor_for('full_body')
    assert set(body.practice_inputs) == {'camera', 'microphone'}
    piano = acts.descriptor_for('piano')
    assert set(piano.practice_inputs) == {'midi', 'microphone', 'uploaded_recording'}
    assert piano.assessment_adapters == ('piano-midi-v1',)
    public = guitar.as_public()
    # Descriptors are data. No executable path, URL, model or provider leaks.
    assert 'module' not in public and 'path' not in public and 'provider' not in public
    assert public['descriptor_version'] == 1
    assert public['processing_routes'] == ['music-guitar']


def test_unknown_act_and_descriptor_version_are_refused():
    with pytest.raises(acts.UnsupportedAct):
        acts.descriptor_for('violin')
    with pytest.raises(acts.UnsupportedAct):
        acts.descriptor_for(None)
    with pytest.raises(acts.UnsupportedActVersion) as exc:
        acts.require_version(2)
    assert exc.value.code == 'unsupported_act'
    assert acts.require_version(None) == 1
    assert acts.require_version(1) == 1


def test_processing_routes_are_linked_to_their_act():
    assert processing_routes.ROUTES['body-default'].act_id == 'full_body'
    assert processing_routes.ROUTES['body-mediapipe'].act_id == 'full_body'
    assert processing_routes.ROUTES['music-piano'].act_id == 'piano'
    assert processing_routes.ROUTES['music-piano-kong'].act_id == 'piano'
    assert processing_routes.ROUTES['music-guitar'].act_id == 'guitar'
    for route in processing_routes.ROUTES.values():
        for subject in route.subjects:
            assert acts.act_for_subject(subject).id == route.act_id
    assert {route.id for route in processing_routes.routes_for_act('piano')} == {
        'music-piano', 'music-piano-kong'}
    assert {route.id for route in processing_routes.routes_for_act('guitar')} == {'music-guitar'}


def test_capabilities_publish_acts_and_reject_unknown_version(system):
    client, _app, _settings, _mail, _store = system
    body = client.get('/api/capabilities').json()
    assert body['act_descriptor_version'] == 1
    assert [item['id'] for item in body['acts']] == ['full_body', 'piano', 'guitar', 'drawing']
    assert all(item['descriptor_version'] == 1 for item in body['acts'])
    # Existing flags are unchanged: one capability key per processing family.
    assert body['processing'] == {'conversion': True, 'music_piano': False, 'music_guitar': False}
    assert all('act_id' in route for route in body['routes'])

    refused = client.get('/api/capabilities', params={'act_version': 2})
    assert refused.status_code == 422
    assert refused.json()['code'] == 'unsupported_act'
    garbage = client.get('/api/capabilities', params={'act_version': 'newest'})
    assert garbage.status_code == 422 and garbage.json()['code'] == 'unsupported_act'


def test_summary_v1_is_unchanged_and_v2_adds_act_and_capabilities(system):
    lesson, client, _app, _settings = owner_of(system)
    v1 = client.get('/api/lessons/summaries').json()
    assert v1[0]['summary_version'] == 1
    assert 'act' not in v1[0] and 'effective_capabilities' not in v1[0]
    assert v1[0]['capabilities'] == {'preview': True, 'practice': True, 'live_input': 'camera'}

    v2 = client.get('/api/lessons/summaries', headers=ACT_HEADER).json()
    item = v2[0]
    assert item['summary_version'] == 2
    assert item['act_id'] == 'full_body'
    assert item['act'] == {'id': 'full_body', 'label': 'Full Body', 'descriptor_version': 1}
    assert item['subject'] == 'movement_other' and item['lesson_id'] == lesson.lesson_id
    # Inputs are a set, not one exclusive live_input value.
    assert item['capabilities']['inputs'] == ['camera', 'microphone']
    assert item['capabilities']['live_input'] == 'camera'
    effective = item['effective_capabilities']
    assert effective['canPractice']['available'] is True
    assert effective['canEdit']['available'] is True
    assert set(effective['inputs']) == {'camera', 'microphone'}
    assert effective['canChallenge']['support'] == 'supported'


def test_detail_envelope_wraps_the_unchanged_manifest(system):
    lesson, client, _app, _settings = owner_of(system)
    url = f'/api/lessons/{lesson.lesson_id}'
    plain = client.get(url).json()
    assert plain['schema_version'] == 1 and 'context_version' not in plain

    envelope = client.get(url, headers=ACT_HEADER).json()
    assert envelope['context_version'] == 1
    assert envelope['act_id'] == 'full_body'
    assert envelope['act']['id'] == 'full_body'
    # The specialized document is byte-identical, not reinterpreted.
    assert envelope['document'] == plain
    assert envelope['capabilities']['canPractice']['available'] is True
    assert envelope['capabilities']['canAssess']['available'] is True


def test_unknown_act_is_refused_rather_than_rendered_as_body(system):
    lesson, client, _app, _settings = owner_of(system)
    client, app, _settings, _mail, _store = system
    with Session(app.state.engine) as session:
        session.get(Lesson, lesson.lesson_id).act_id = 'violin'
        session.commit()

    refused = client.get(f'/api/lessons/{lesson.lesson_id}')
    assert refused.status_code == 422 and refused.json()['code'] == 'unsupported_act'
    envelope = client.get(f'/api/lessons/{lesson.lesson_id}', headers=ACT_HEADER)
    assert envelope.status_code == 422 and envelope.json()['code'] == 'unsupported_act'
    summaries = client.get('/api/lessons/summaries', headers=ACT_HEADER)
    assert summaries.status_code == 422 and summaries.json()['code'] == 'unsupported_act'


def test_new_revision_snapshot_carries_act_identity(system):
    lesson, client, app, _settings = owner_of(system)
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        sections = revision.manifest['section_set']['sections']
    response = client.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id,
        'title': 'Renamed lesson',
        'sections': sections,
    })
    assert response.status_code == 200, response.text
    with Session(app.state.engine) as session:
        created = session.get(LessonRevision, response.json()['revision_id'])
        assert created is not None and created.act_id == 'full_body'


def test_act_identity_does_not_change_reference_hashes_or_release(system):
    lesson, client, app, _settings = owner_of(system)
    with Session(app.state.engine) as session:
        before_revision = session.get(LessonRevision, lesson.revision_id)
        before_digest = manifest_digest(before_revision.manifest)
        before_asset = dict(before_revision.manifest['animation'])
        row = session.get(Lesson, lesson.lesson_id)
        assert row.act_id == 'full_body' and before_revision.act_id == 'full_body'

    assert client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id}).status_code == 200
    assert client.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Front kick', 'creator_name': 'Ari',
        'tags': ['kick'], 'rights_acknowledged': True}).status_code == 200

    with Session(app.state.engine) as session:
        after = session.get(LessonRevision, lesson.revision_id)
        assert manifest_digest(after.manifest) == before_digest
        assert after.manifest['animation'] == before_asset
        assert session.get(Lesson, lesson.lesson_id).published_revision_id == lesson.revision_id


def test_publication_policy_is_act_driven_and_preserves_stricter_checks(system):
    lesson, client, app, _settings = owner_of(system)
    body = acts.publication_policy('full_body')
    assert body.public is True
    assert body.representations == ('interactive_3d', 'video')
    assert 'interactive_data' in body.allowed_roles
    for act_id in ('piano', 'guitar'):
        policy = acts.publication_policy(act_id)
        assert policy.public is True
        assert policy.allowed_roles == ('poster', 'playable_preview', 'reference')
        assert policy.representations  # a public representation exists now
        assert policy.default_roles == ()  # but it must be chosen explicitly

    # Body keeps its existing acceptance + rights + tag requirements.
    assert client.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Front kick', 'creator_name': 'Ari',
        'tags': ['kick'], 'rights_acknowledged': True}).status_code == 409
    assert client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                       json={'revision_id': lesson.revision_id}).status_code == 200
    assert client.patch(f'/api/public/lessons/{lesson.lesson_id}', json={
        'listed': True, 'title': 'Front kick', 'creator_name': 'Ari',
        'tags': ['kick'], 'rights_acknowledged': True}).status_code == 200

    # Music is still invitation-only, and its public projection is refused.
    music = import_music(system)
    assert client.get(f'/api/public/moves/{music.lesson_id}').status_code == 404


def test_music_public_listing_requires_an_approved_representation(system):
    owner_of(system)
    music = import_music(system)
    client, app, _settings, _mail, _store = system
    account_id = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, music.revision_id)
        assert revision is not None and revision.act_id == 'piano'
        # Seed the reviewed release the music publish path would create. Listing still
        # requires an explicit representation: the reviewed reference is not automatic.
        session.get(Lesson, music.lesson_id).published_revision_id = music.revision_id
        session.add(LessonAcceptance(id=uuid4().hex, lesson_id=music.lesson_id,
                                     revision_id=music.revision_id, account_id=account_id,
                                     warnings=[], source='music-review', accepted_at=now()))
        session.commit()
    response = client.patch(f'/api/public/lessons/{music.lesson_id}', json={
        'listed': True, 'title': 'Etude', 'creator_name': 'Ari',
        'tags': ['piano'], 'rights_acknowledged': True})
    assert response.status_code == 409
    assert 'approved public representation' in response.json()['detail']


def test_offline_worker_does_not_disable_existing_playback(system):
    owner_of(system)
    music = import_music(system)
    client, _app, settings, _mail, _store = system

    capabilities = client.get('/api/capabilities').json()
    # The music route is disabled and no worker is online for any route.
    assert capabilities['processing']['music_piano'] is False
    assert all(route['worker_online'] is False
               for route in processing_routes.status(settings).values())

    detail = client.get(f'/api/lessons/{music.lesson_id}',
                        headers={**ACT_HEADER, 'X-Lesson-Formats': '1,2'})
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body['act']['id'] == 'piano'
    # Worker/route availability is a processing concern only.
    assert body['capabilities']['canPractice']['available'] is True
    assert body['capabilities']['canAssess']['available'] is True
    # Challenge exists for piano but this deployment does not accept it yet.
    assert body['capabilities']['canChallenge']['available'] is False
    assert body['capabilities']['canChallenge']['reasonCode'] == 'deployment_disabled'


def test_guitar_practice_is_advertised_without_a_challenge(system):
    owner_of(system)
    music = import_music(system, subject='guitar')
    client, _app, _settings, _mail, _store = system
    detail = client.get(f'/api/lessons/{music.lesson_id}',
                        headers={**ACT_HEADER, 'X-Lesson-Formats': '1,2'}).json()
    assert detail['act']['id'] == 'guitar'
    assert detail['capabilities']['canPractice']['available'] is True
    assert detail['capabilities']['canChallenge']['support'] == 'unsupported'
    assert detail['capabilities']['canChallenge']['reasonCode'] == 'act_unsupported'
    assert set(detail['capabilities']['inputs']) == {'midi', 'microphone'}


def test_database_ready_checks_the_act_column(tmp_path):
    engine = create_engine(f'sqlite:///{(tmp_path / "probe.db").as_posix()}')
    Base.metadata.create_all(engine)
    database_ready(engine)
    with engine.begin() as connection:
        connection.execute(text('ALTER TABLE lessons DROP COLUMN act_id'))
    with pytest.raises(Exception):
        database_ready(engine)
