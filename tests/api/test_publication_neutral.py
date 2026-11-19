"""Act-neutral publication: roles, public projection and release atomicity.

Phase 5 replaces the temporary "music/video-only are never public" refusal with an
explicit representation policy. No private source becomes public: a release names
approved roles, and the projection nulls every other media slot.
"""
import io
import re
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from test_accounts import imported, system  # noqa: F401 - fixture
from support_multi import import_music
from apps.api.auth import now
from apps.api.database import (Lesson, LessonAcceptance, LessonAsset, LessonPublication,
                               LessonRevision)


def owner_of(system):
    lesson = imported(system)
    client, app, settings, _mail, store = system
    return lesson, client, app, settings, store


def accept(client, lesson):
    response = client.post(f'/api/workflow/lessons/{lesson.lesson_id}/accept',
                           json={'revision_id': lesson.revision_id})
    assert response.status_code == 200, response.text
    return response


def accept_revision(client, lesson_id, revision_id):
    return client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                       json={'revision_id': revision_id})


def publish(client, lesson, **overrides):
    body = {'listed': True, 'title': 'Public lesson', 'creator_name': 'Ari',
            'tags': ['demo'], 'rights_acknowledged': True, **overrides}
    return client.patch(f'/api/public/lessons/{lesson.lesson_id}', json=body)


def seed_music_release(client, app, music, source='music-review'):
    """Seed the reviewed acceptance a real music publish path would create."""
    account_id = client.get('/api/auth/session').json()['account']['id']
    with Session(app.state.engine) as session:
        session.get(Lesson, music.lesson_id).published_revision_id = music.revision_id
        session.add(LessonAcceptance(id=uuid4().hex, lesson_id=music.lesson_id,
                                     revision_id=music.revision_id, account_id=account_id,
                                     warnings=[], source=source, accepted_at=now()))
        session.commit()


def enable_range(store):
    """FakeStorage ignores Range; make it behave like object storage for this test."""
    def get_object(Bucket, Key, **kwargs):
        data = store.objects[Key]
        byte_range = kwargs.get('Range')
        if not byte_range:
            body = io.BytesIO(data)
        else:
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', byte_range)
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else len(data) - 1
            start, end = max(0, start), min(end, len(data) - 1)
            body = io.BytesIO(data[start:end + 1])
        length = len(body.getvalue())

        class Stream:
            def iter_chunks(self, chunk_size):
                while chunk := body.read(chunk_size):
                    yield chunk
            def close(self):
                body.close()

        result = {'Body': Stream(), 'ContentLength': length}
        if byte_range and length != len(data):
            result['ContentRange'] = f'bytes {start}-{end}/{len(data)}'
        return result
    store.get_object = get_object


# ---------------------------------------------------------------------------
# Full-body SAM
# ---------------------------------------------------------------------------

def test_sam_release_exposes_only_the_interactive_role(system):
    lesson, client, app, _settings, _store = owner_of(system)
    accept(client, lesson)
    listed = publish(client, lesson)
    assert listed.status_code == 200, listed.text
    assert listed.json()['roles'] == ['interactive_data']

    detail = client.get(f'/api/public/moves/{lesson.lesson_id}')
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body['animation']['key'].startswith('public/')
    assert body['landmarks']['key'].startswith('public/')
    assert body['source_video'] is None and body['focused_video'] is None
    assert body['thumbnail'] is None
    assert body['public_roles'] == ['interactive_data']
    assert set(body['representations']) == {'interactive_3d'}

    listing = client.get('/api/public/moves').json()['moves']
    assert [item['lesson_id'] for item in listing] == [lesson.lesson_id]


def test_sam_byte_range_and_private_asset_denial(system):
    lesson, client, app, _settings, store = owner_of(system)
    accept(client, lesson)
    assert publish(client, lesson).status_code == 200
    detail = client.get(f'/api/public/moves/{lesson.lesson_id}').json()
    animation = detail['animation']['key'].split('/')[-1]

    enable_range(store)
    with patch('apps.api.public.storage_client', return_value=store):
        ranged = client.get(f'/api/public/moves/{lesson.lesson_id}/assets/{animation}',
                            headers={'Range': 'bytes=0-3'})
        assert ranged.status_code == 206, ranged.text
        assert ranged.headers['content-range'].startswith('bytes 0-3/')
        assert ranged.headers['accept-ranges'] == 'bytes'

        assert client.get(f'/api/public/moves/{lesson.lesson_id}/assets/source.mp4').status_code == 404
        assert client.get(f'/api/public/moves/{lesson.lesson_id}/assets/thumbnail.jpg').status_code == 404
        bad = client.get(f'/api/public/moves/{lesson.lesson_id}/assets/{animation}',
                         headers={'Range': 'items=0-3'})
        assert bad.status_code == 416


# ---------------------------------------------------------------------------
# Full-body video-only (MediaPipe)
# ---------------------------------------------------------------------------

def test_video_only_requires_and_projects_a_prepared_preview(system):
    lesson, client, app, _settings, store = owner_of(system)
    preview_key = f'lessons/{lesson.lesson_id}/preview.mp4'
    source_key = f'lessons/{lesson.lesson_id}/source.mp4'
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        manifest = dict(revision.manifest)
        manifest.update({
            'engine': 'mediapipe',
            'engine_version': 'mediapipe-pose-heavy-v1',
            'root_motion': 'hip-relative',
            'animation': None,
            'source_video': {'key': source_key, 'mime': 'video/mp4', 'bytes': 6,
                             'sha256': 'a' * 64},
            'focused_video': {'key': preview_key, 'mime': 'video/mp4', 'bytes': 5,
                              'sha256': 'b' * 64},
        })
        revision.manifest = manifest
        session.add(LessonAsset(lesson_id=lesson.lesson_id, key=preview_key, mime='video/mp4',
                                bytes=5, sha256='b' * 64))
        session.add(LessonAsset(lesson_id=lesson.lesson_id, key=source_key, mime='video/mp4',
                                bytes=6, sha256='a' * 64))
        session.commit()
    store.objects[preview_key] = b'video'
    store.objects[source_key] = b'source'
    accept(client, lesson)

    refused = publish(client, lesson)
    assert refused.status_code == 409
    assert 'approved public representation' in refused.json()['detail']

    listed = publish(client, lesson, public_roles=['playable_preview'])
    assert listed.status_code == 200, listed.text
    assert listed.json()['roles'] == ['playable_preview']

    body = client.get(f'/api/public/moves/{lesson.lesson_id}').json()
    assert body['playable_preview']['key'].startswith('public/')
    assert body['animation'] is None
    assert body['source_video'] is None and body['focused_video'] is None
    assert set(body['representations']) == {'video'}

    with patch('apps.api.public.storage_client', return_value=store):
        assert client.get(f'/api/public/moves/{lesson.lesson_id}/assets/preview.mp4').status_code == 200
        # The raw source is never an allowed public asset, even for a video-only lesson.
        assert client.get(f'/api/public/moves/{lesson.lesson_id}/assets/source.mp4').status_code == 404


# ---------------------------------------------------------------------------
# Piano and guitar
# ---------------------------------------------------------------------------

def test_music_requires_a_chosen_representation(system):
    owner_of(system)
    music = import_music(system)
    client, app, _settings, _mail, store = system
    accept_response = client.post('/api/workflow/lessons/{id}/accept'.format(id=music.lesson_id),
                                  json={'revision_id': music.revision_id})
    assert accept_response.status_code == 409, 'workflow acceptance cannot bypass music review'
    seed_music_release(client, app, music)

    refused = publish(client, music, public_roles=['playable_preview'])
    assert refused.status_code == 409
    assert 'prepared playable preview' in refused.json()['detail']

    no_roles = publish(client, music)
    assert no_roles.status_code == 409
    assert 'approved public representation' in no_roles.json()['detail']

    listed = publish(client, music, public_roles=['reference'])
    assert listed.status_code == 200, listed.text
    assert listed.json()['representations'] == ['interactive_notation']

    body = client.get(f'/api/public/moves/{music.lesson_id}').json()
    assert body['reference']['key'].startswith('public/')
    assert body['source_video'] is None
    assert body['piano_preview'] is None
    assert body['analysis'] is None
    assert body['public_roles'] == ['reference']

    with patch('apps.api.public.storage_client', return_value=store):
        assert client.get(f'/api/public/moves/{music.lesson_id}/assets/reference.json').status_code == 200
        assert client.get(f'/api/public/moves/{music.lesson_id}/assets/source.mp4').status_code == 404


def test_guitar_publishes_the_same_way(system):
    owner_of(system)
    guitar = import_music(system, subject='guitar')
    client, app, _settings, _mail, _store = system
    seed_music_release(client, app, guitar)
    listed = publish(client, guitar, public_roles=['reference'])
    assert listed.status_code == 200, listed.text
    body = client.get(f'/api/public/moves/{guitar.lesson_id}').json()
    assert body['public_roles'] == ['reference']
    assert body['subject'] == 'guitar'


def test_rights_and_acceptance_block_every_act(system):
    lesson, client, app, _settings, _store = owner_of(system)
    accept(client, lesson)
    no_rights = publish(client, lesson, rights_acknowledged=False)
    assert no_rights.status_code == 422
    assert 'right' in no_rights.json()['detail'].lower()

    # A reviewed music revision still needs acceptance before any audience.
    music = import_music(system)
    readiness = client.get(f'/api/lessons/{music.lesson_id}/publishability',
                           params={'audience': 'public', 'roles': 'reference'}).json()
    assert readiness['publishable'] is False
    assert 'revision_not_accepted' in readiness['missing']
    blocked = publish(client, music, public_roles=['reference'])
    assert blocked.status_code == 409
    assert 'Check this revision' in blocked.json()['detail']


def test_publishability_endpoint_reports_actionable_readiness(system):
    lesson, client, app, _settings, _store = owner_of(system)
    accept(client, lesson)
    ready = client.get(f'/api/lessons/{lesson.lesson_id}/publishability',
                       params={'audience': 'public'}).json()
    assert ready['publishable'] is False
    assert 'rights_not_acknowledged' in ready['missing']
    assert ready['roles'] == ['interactive_data']

    music = import_music(system)
    seed_music_release(client, app, music)
    pending = client.get(f'/api/lessons/{music.lesson_id}/publishability',
                         params={'audience': 'public', 'roles': 'reference'}).json()
    assert 'rights_not_acknowledged' in pending['missing']
    assert pending['allowed_roles'] == ['poster', 'playable_preview', 'reference']


# ---------------------------------------------------------------------------
# Atomic release identity
# ---------------------------------------------------------------------------

def test_private_edit_and_failed_update_leave_the_release_untouched(system):
    lesson, client, app, _settings, _store = owner_of(system)
    accept(client, lesson)
    assert publish(client, lesson).status_code == 200

    with Session(app.state.engine) as session:
        sections = session.get(LessonRevision, lesson.revision_id).manifest['section_set']['sections']
    saved = client.put(f'/api/lessons/{lesson.lesson_id}/sections', json={
        'base_revision_id': lesson.revision_id, 'title': 'Private edit', 'sections': sections})
    assert saved.status_code == 200
    new_revision = saved.json()['revision_id']

    # An unrelated private edit does not move the release.
    assert client.get(f'/api/public/moves/{lesson.lesson_id}').json()['revision_id'] == lesson.revision_id
    workflow = client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert workflow['latest_revision_id'] == new_revision
    assert workflow['published_revision_id'] == lesson.revision_id

    # Accept the new revision, then break its public representation. The update fails
    # atomically and the prior release stays visible.
    assert accept_revision(client, lesson.lesson_id, new_revision).status_code == 200
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, new_revision)
        manifest = dict(revision.manifest)
        manifest['animation'] = None
        revision.manifest = manifest
        session.commit()
    refused = publish(client, lesson, release_revision_id=new_revision,
                      public_roles=['interactive_data'])
    assert refused.status_code == 409

    body = client.get(f'/api/public/moves/{lesson.lesson_id}')
    assert body.status_code == 200
    assert body.json()['revision_id'] == lesson.revision_id
    assert client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()['published_revision_id'] == lesson.revision_id


def test_unlisting_and_moderation_hide_a_music_release(system):
    owner_of(system)
    music = import_music(system)
    client, app, _settings, _mail, _store = system
    seed_music_release(client, app, music)
    assert publish(client, music, public_roles=['reference']).status_code == 200
    assert client.get(f'/api/public/moves/{music.lesson_id}').status_code == 200

    assert client.patch(f'/api/public/lessons/{music.lesson_id}', json={'listed': False}).status_code == 200
    assert client.get(f'/api/public/moves/{music.lesson_id}').status_code == 404
    assert client.get('/api/public/moves').json()['moves'] == []

    assert publish(client, music, public_roles=['reference']).status_code == 200
    with Session(app.state.engine) as session:
        session.get(LessonPublication, music.lesson_id).moderation_hidden = True
        session.commit()
    assert client.get(f'/api/public/moves/{music.lesson_id}').status_code == 404

    with Session(app.state.engine) as session:
        session.get(LessonPublication, music.lesson_id).moderation_hidden = False
        session.commit()
    assert client.get(f'/api/public/moves/{music.lesson_id}').status_code == 200
