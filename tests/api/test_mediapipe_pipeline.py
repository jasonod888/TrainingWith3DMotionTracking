"""CPU MediaPipe body route: routing, credentials, completion, privacy and edges.

These tests never run a model. They exercise the server contract around the
``body-mediapipe-v1`` route and the shared worker API, which is where route
scoping, nullable-animation completion and the public privacy guard live.
"""
import json
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from test_accounts import system, imported  # noqa: F401  (pytest fixtures)
from test_conversions import conversion, uploaded  # noqa: F401
from apps.api.auth import digest
from apps.api.contracts import LessonManifest
from apps.api.database import LessonRevision, WorkerCredential
from apps.api.processing import MEDIAPIPE_ENGINE_VERSION, MEDIAPIPE_PIPELINE_VERSION, PIPELINE_VERSION
from apps.api.processing_routes import BODY_ROUTES, ROUTES, body_route, body_status, route_for
from apps.api.conversions import Heartbeat, body_processing
from process_video_mediapipe import (MARKER_VISIBILITY, SCORING_VISIBILITY, STANDING_VISIBILITY,
    playback_duration, pose_reference_contract, segmentation_contract, usable_scoring_pose)
import numpy as np


def test_playback_duration_includes_the_final_frame_interval():
    ten = np.arange(10) / 10
    assert ten[-1] == pytest.approx(.9)
    assert playback_duration(ten, 10) == pytest.approx(1.0)
    assert playback_duration(np.array([0., .2]), 5) == pytest.approx(.4)
    for fps in (30000 / 1001, 24000 / 1001):
        times = np.arange(120) / fps
        assert playback_duration(times, fps) == pytest.approx(120 / fps)


def test_any_unrepaired_matte_gap_disables_derivatives():
    times = np.arange(20) / 30
    complete = [True] * 20
    assert segmentation_contract(times, 20, complete)['available'] is True
    for index in (0, 10, 19):
        observed = list(complete); observed[index] = False
        value = segmentation_contract(times, 19, observed)
        assert value['available'] is False
        assert value['reason'] == 'unrepaired_matte_gap'
    # Exact 95%/0.5s boundary still cannot hide the single missing frame.
    observed = list(complete); observed[10] = False
    boundary = segmentation_contract(times, 19, observed)
    assert boundary['coverage'] == pytest.approx(.95)
    assert boundary['available'] is False
    # Repaired frames cannot be counted as observed.
    assert segmentation_contract(times, 20, complete, repaired_frames=1)['available'] is False


def test_pose_quality_failure_stays_separate_from_derivative_failure():
    times = np.arange(20) / 30
    usable = [True] * 20
    assert pose_reference_contract(times, usable)['acceptable'] is True
    bad_pose = [True] * 18 + [False, False]
    assert pose_reference_contract(times, bad_pose)['acceptable'] is False
    # A pose-acceptable reference can still have a derivative-only failure.
    observed = [True] * 19 + [False]
    assert pose_reference_contract(times, usable)['acceptable'] is True
    assert segmentation_contract(times, 19, observed)['available'] is False


def test_scoring_visibility_matches_browser_and_keeps_marker_calibration_separate():
    assert SCORING_VISIBILITY == .60
    assert MARKER_VISIBILITY == .55
    assert STANDING_VISIBILITY == .65
    world = np.zeros((33, 3), dtype=np.float32)
    angles = ((11, 13, 15), (12, 14, 16), (13, 11, 23), (14, 12, 24),
              (11, 23, 25), (12, 24, 26), (23, 25, 27), (24, 26, 28))
    for value, expected in ((.55, False), (.59, False), (.60, True)):
        visibility = np.full(33, value, dtype=np.float32)
        assert usable_scoring_pose(world, visibility) is expected, value
    # Only five of the eight scoring angles visible at 0.60 is insufficient.
    visibility = np.zeros(33, dtype=np.float32)
    for a, b, c in angles[:5]:
        visibility[[a, b, c]] = .60
    assert usable_scoring_pose(world, visibility) is False
    for a, b, c in angles[:6]:
        visibility[[a, b, c]] = .60
    assert usable_scoring_pose(world, visibility) is True


def mediapipe_credential(app, provider='local', pipeline=MEDIAPIPE_PIPELINE_VERSION):
    token = uuid4().hex
    with Session(app.state.engine) as session:
        session.add(WorkerCredential(id=uuid4().hex, token_hash=digest(token), provider=provider,
                                     pipeline_version=pipeline, active=True))
        session.commit()
    return {'Authorization': 'Bearer ' + token}


def advance(client, base, headers, stage):
    response = client.post(base + '/heartbeat', headers=headers, json={'stage': stage})
    assert response.status_code == 200, response.text
    return response.json()


def put_asset(client, base, headers, name, content):
    response = client.put(base + '/files/' + name, headers={**headers, 'Content-Type': 'application/octet-stream'},
                          content=content)
    assert response.status_code == 200, response.text
    return response.json()


def mediapipe_manifest(job, attempt, assets, **overrides):
    value = {
        'schema_version': 1, 'lesson_id': job['id'], 'revision_id': attempt,
        'title': 'CPU move', 'duration': 1.9, 'source_start': 0, 'frame_rate': 29.97,
        'engine': 'mediapipe', 'engine_version': MEDIAPIPE_ENGINE_VERSION,
        'units': 'metres', 'landmark_axes': 'x-right/y-down/z-forward',
        'root_motion': 'hip-relative', 'confidence': 'unmeasured', 'standing_time': 0.0,
        'animation': None,
        'landmarks': assets['reference.json'], 'source_video': assets['preview.mp4'],
        'thumbnail': assets['thumbnail.jpg'],
        'section_set': {'id': job['id'], 'revision': 1, 'duration': 1.9,
                        'sections': [{'id': 'whole', 'label': 'Full movement', 'start': 0, 'end': 1.9}]},
        'warnings': [],
    }
    value.update(overrides)
    return value


def run_mediapipe_job(client, app, settings):
    """Upload, claim, produce and complete one video-only conversion."""
    settings.body_pipeline = 'mediapipe'
    job, path = uploaded(client)
    headers = mediapipe_credential(app)
    claim = client.post('/api/worker/claim', headers=headers, json={})
    assert claim.status_code == 200, claim.text
    claim = claim.json()
    assert claim['id'] == job['id'] and claim['pipeline_version'] == MEDIAPIPE_PIPELINE_VERSION
    base = '/api/worker/jobs/' + job['id']
    lease = {**headers, 'X-Job-Lease': claim['attempt_token']}
    advance(client, base, lease, 'processing')
    advance(client, base, lease, 'exporting')
    advance(client, base, lease, 'verifying')
    assets = {
        'reference.json': put_asset(client, base, lease, 'reference.json', b'{"times":[0]}'),
        'preview.mp4': put_asset(client, base, lease, 'preview.mp4', b'\x00\x00\x00\x18ftypmp42'),
        'thumbnail.jpg': put_asset(client, base, lease, 'thumbnail.jpg', b'\xff\xd8\xff\xd9'),
    }
    return job, path, base, lease, claim, assets


def test_route_is_registered_default_sam_and_local_only():
    assert body_route(type('S', (), {'body_pipeline': 'sam-3d-body'})()).id == 'body-default'
    assert body_route(type('S', (), {'body_pipeline': 'mediapipe'})()).id == 'body-mediapipe'
    route = ROUTES['body-mediapipe']
    assert route.pipeline_version == MEDIAPIPE_PIPELINE_VERSION == 'body-mediapipe-v1'
    assert route.required_assets == ('reference.json', 'preview.mp4', 'thumbnail.jpg')
    assert route.optional_assets == ('instructor.mp4', 'instructor-alpha.webm')
    assert route.local_only
    # BODY_ROUTES keeps the operator-facing setting values in one place.
    assert set(BODY_ROUTES) == {'sam-3d-body', 'mediapipe'}
    assert 'reference.glb' not in route.work_assets


class SettingsStub:
    def __init__(self, **values):
        self.conversion_provider = 'local'
        self.body_pipeline = 'sam-3d-body'
        self.remote_conversion_enabled = False
        self.conversion_target = ''
        for key, value in values.items():
            setattr(self, key, value)


def test_mediapipe_is_unavailable_on_remote_providers_while_sam_remote_survives():
    local = SettingsStub(body_pipeline='mediapipe', conversion_provider='local')
    assert body_status(local)['available'] is True
    remote = SettingsStub(body_pipeline='mediapipe', conversion_provider='replicate',
                          remote_conversion_enabled=True, conversion_target='owner/pipeline')
    # Reporting MediaPipe available on a remote provider would promise CPU work no
    # worker can claim.
    assert body_status(remote)['available'] is False
    sam_remote = SettingsStub(body_pipeline='sam-3d-body', conversion_provider='replicate',
                              remote_conversion_enabled=True, conversion_target='owner/pipeline')
    assert body_status(sam_remote)['available'] is True
    assert body_processing(remote)['pipeline_version'] == MEDIAPIPE_PIPELINE_VERSION


def test_route_selection_follows_the_configured_body_pipeline():
    sam = SettingsStub()
    media = SettingsStub(body_pipeline='mediapipe')
    assert route_for('dance', None, settings=sam).pipeline_version == PIPELINE_VERSION
    assert route_for('taekwondo', None, settings=media).pipeline_version == MEDIAPIPE_PIPELINE_VERSION
    # Music selection is untouched by the body switch.
    assert route_for('piano', 'piano', settings=media).id == 'music-piano'


def test_limits_and_listing_report_the_active_body_route(conversion):
    client, app, _, _, system = conversion
    settings = system[2]
    settings.body_pipeline = 'mediapipe'
    limits = client.get('/api/conversions/limits').json()
    assert limits['body_route']['pipeline_version'] == MEDIAPIPE_PIPELINE_VERSION
    assert limits['processing']['pipeline_version'] == MEDIAPIPE_PIPELINE_VERSION
    assert limits['processing']['available'] is True
    listing = client.get('/api/conversions').json()
    assert listing['body_route']['pipeline_version'] == MEDIAPIPE_PIPELINE_VERSION
    settings.body_pipeline = 'sam-3d-body'
    assert client.get('/api/conversions/limits').json()['body_route']['pipeline_version'] == PIPELINE_VERSION


def test_credentials_are_scoped_to_the_exact_provider_and_pipeline(conversion):
    client, app, _, local, system = conversion
    settings = system[2]
    settings.body_pipeline = 'mediapipe'
    job, _ = uploaded(client)
    # A SAM-scoped credential must not claim MediaPipe work.
    assert client.post('/api/worker/claim', headers=local, json={}).json() is None
    media = mediapipe_credential(app)
    claim = client.post('/api/worker/claim', headers=media, json={}).json()
    assert claim['id'] == job['id']
    # ... and the MediaPipe credential must not appear as a SAM worker for a SAM job.
    settings.body_pipeline = 'sam-3d-body'
    job2, _ = uploaded(client)
    assert client.post('/api/worker/claim', headers=media, json={}).json() is None
    assert client.post('/api/worker/claim', headers=local, json={}).json()['id'] == job2['id']


def test_mediapipe_completes_without_a_glb_and_skips_avatar_derivatives(conversion):
    client, app, _, _, system = conversion
    job, path, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
    # A GLB is not part of this route at all.
    assert client.put(base + '/files/reference.glb', headers={**lease, 'Content-Type': 'application/octet-stream'},
                      content=b'glTF\x02\x00\x00\x00').status_code == 422
    manifest = mediapipe_manifest(job, claim['attempt_token'], assets)
    response = client.post(base + '/finish', headers=lease, json=manifest)
    assert response.status_code == 200, response.text
    lesson_id = response.json()['lesson_id']
    assert client.get(path).json()['state'] == 'ready_for_review'
    detail = client.get('/api/lessons/' + lesson_id).json()
    assert detail['animation'] is None
    assert detail['engine'] == 'mediapipe'
    assert detail['engine_version'] == MEDIAPIPE_ENGINE_VERSION
    assert detail['root_motion'] == 'hip-relative'
    assert detail['frame_rate'] == 29.97
    assert detail['source_video']['key'].endswith('preview.mp4')
    # No avatar presentation is attached to a video-only completion.
    assert not detail.get('presentation')
    assert 'avatar-male.glb' not in json.dumps(detail)


@pytest.mark.parametrize('overrides', [
    {'animation': {'key': 'attempts/x/y/reference.glb', 'mime': 'model/gltf-binary', 'bytes': 12,
                   'sha256': 'a' * 64}},
    {'root_motion': 'estimated-camera-relative'},
    {'engine_version': 'sam-3d-body-v1'},
    {'frame_rate': 0},
    {'frame_rate': 241},
])
def test_mediapipe_completion_rejects_a_non_video_only_contract(conversion, overrides):
    client, app, _, _, system = conversion
    job, _, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
    manifest = mediapipe_manifest(job, claim['attempt_token'], assets, **overrides)
    assert client.post(base + '/finish', headers=lease, json=manifest).status_code == 422


def test_mediapipe_completion_requires_each_required_asset(conversion):
    client, app, _, _, system = conversion
    # Three attempts in one test would otherwise trip the default active-conversion
    # limit; each is still a real conversion, so raise the fixture's ceiling rather
    # than cancelling work the assertions depend on.
    system[2].max_active_conversions = 5
    for missing in ('reference.json', 'preview.mp4', 'thumbnail.jpg'):
        job, _, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
        manifest = mediapipe_manifest(job, claim['attempt_token'], assets)
        manifest[{'reference.json': 'landmarks', 'preview.mp4': 'source_video',
                  'thumbnail.jpg': 'thumbnail'}[missing]] = None
        assert client.post(base + '/finish', headers=lease, json=manifest).status_code == 422


def test_heartbeat_frame_cap_allows_ten_thousand_plus_frames(conversion):
    client, app, _, _, system = conversion
    job, _, base, lease, _, _ = run_mediapipe_job(client, app, system[2])
    # A 300 s 30 fps clip is 9000 frames; the cap must not cut a legitimate run off.
    assert Heartbeat(stage='processing', frames=20000).frames == 20000
    with pytest.raises(ValidationError):
        Heartbeat(stage='processing', frames=20001)
    response = client.post(base + '/heartbeat', headers=lease, json={'stage': 'verifying', 'frames': 20000})
    assert response.status_code == 200, response.text


def test_video_only_lesson_cannot_be_published_publicly(conversion):
    client, app, _, _, system = conversion
    job, _, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
    manifest = mediapipe_manifest(job, claim['attempt_token'], assets)
    lesson_id = client.post(base + '/finish', headers=lease, json=manifest).json()['lesson_id']
    revision_id = client.get('/api/lessons/' + lesson_id).json()['revision_id']
    accepted = client.post(f'/api/workflow/lessons/{lesson_id}/accept', json={'revision_id': revision_id})
    assert accepted.status_code == 200, accepted.text
    body = {'listed': True, 'title': 'CPU move', 'creator_name': 'Ari', 'tags': ['move'],
            'rights_acknowledged': True}
    response = client.patch(f'/api/public/lessons/{lesson_id}', json=body)
    assert response.status_code == 409
    assert 'approved public representation' in response.json()['detail'].lower()
    # The same lesson is still readable to its owner, so nothing vanished.
    assert client.get('/api/lessons/' + lesson_id).status_code == 200


def test_public_projection_never_leaks_media_without_an_approved_role():
    from apps.api.public import public_keys
    value = public_keys({'schema_version': 1, 'animation': None,
                         'landmarks': {'key': 'lessons/x/reference.json', 'mime': 'application/json',
                                       'bytes': 1, 'sha256': 'a' * 64},
                         'presentation': {}}, 'lesson')
    # A video-only lesson has no approved public role yet, so even landmarks and a
    # private-looking reference are removed instead of being exposed.
    assert value['animation'] is None
    assert value['source_video'] is None
    assert value['landmarks'] is None
    assert value['public_roles'] == []


def test_mediapipe_public_shared_journey_projects_only_approved_video(conversion):
    client, app, _, _, system = conversion
    system[2].max_active_conversions = 5
    job, path, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
    focused = put_asset(client, base, lease, 'instructor.mp4', b'\x00\x00\x00\x18ftypmp42')
    manifest = mediapipe_manifest(job, claim['attempt_token'], assets, focused_video=focused)
    finished = client.post(base + '/finish', headers=lease, json=manifest)
    assert finished.status_code == 200, finished.text
    lesson_id = finished.json()['lesson_id']
    revision_id = client.get('/api/lessons/' + lesson_id).json()['revision_id']
    assert client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                       json={'revision_id': revision_id}).status_code == 200
    listed = client.patch(f'/api/public/lessons/{lesson_id}', json={
        'listed': True, 'title': 'CPU move', 'creator_name': 'Ari', 'tags': ['cpu'],
        'rights_acknowledged': True, 'public_roles': ['playable_preview']})
    assert listed.status_code == 200, listed.text

    discovery = client.get('/api/public/moves', params={'act': 'full_body', 'q': 'CPU'}).json()
    assert lesson_id in {item['lesson_id'] for item in discovery['moves']}
    body = client.get(f'/api/public/moves/{lesson_id}').json()
    assert body['playable_preview']['key'].startswith('public/')
    assert body['source_video'] is None
    assert body['landmarks'] is None
    assert body['animation'] is None
    for private in ('preview.mp4', 'reference.json', 'source.mp4'):
        assert client.get(f'/api/public/moves/{lesson_id}/assets/{private}').status_code == 404


def test_mediapipe_failed_focused_derivative_keeps_private_watch_but_refuses_public(conversion):
    client, app, _, _, system = conversion
    system[2].max_active_conversions = 5
    job, _, base, lease, claim, assets = run_mediapipe_job(client, app, system[2])
    manifest = mediapipe_manifest(job, claim['attempt_token'], assets)
    finished = client.post(base + '/finish', headers=lease, json=manifest)
    assert finished.status_code == 200, finished.text
    lesson_id = finished.json()['lesson_id']
    detail = client.get('/api/lessons/' + lesson_id).json()
    assert detail['source_video'] is not None and detail['landmarks'] is not None
    assert detail['focused_video'] is None
    revision_id = detail['revision_id']
    assert client.post(f'/api/workflow/lessons/{lesson_id}/accept',
                       json={'revision_id': revision_id}).status_code == 200
    refused = client.patch(f'/api/public/lessons/{lesson_id}', json={
        'listed': True, 'title': 'CPU move', 'creator_name': 'Ari', 'tags': ['cpu'],
        'rights_acknowledged': True, 'public_roles': ['playable_preview']})
    assert refused.status_code == 409
    assert 'preview' in refused.json()['detail'].lower() or 'representation' in refused.json()['detail'].lower()


def test_contract_requires_animation_for_3d_and_source_video_for_mediapipe():
    base = json.loads((Path(__file__).resolve().parents[2]
                       / 'packages/lesson-schema/fixture.json').read_text())
    base['engine'] = 'sam-3d-body'
    base['engine_version'] = 'b5c7650'
    base['animation'] = None
    with pytest.raises(ValidationError):
        LessonManifest.model_validate(base)
    base['engine'] = 'mediapipe'
    base['source_video'] = None
    with pytest.raises(ValidationError):
        LessonManifest.model_validate(base)
    # A mediapipe manifest is valid with a source video and no animation.
    base['source_video'] = {'key': 'lessons/x/preview.mp4', 'mime': 'video/mp4', 'bytes': 1, 'sha256': 'a' * 64}
    base['root_motion'] = 'hip-relative'
    assert LessonManifest.model_validate(base).animation is None
    # A synthetic/SAM manifest keeps an integer frame rate.
    base['frame_rate'] = 15
    assert LessonManifest.model_validate(base).frame_rate == 15


def test_fractional_frame_rate_survives_validation_and_trim(system):
    owner, app, _, _, _ = system
    lesson = imported(system)
    with Session(app.state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        value = dict(revision.manifest)
        value['frame_rate'] = 29.97
        revision.manifest = value
        session.commit()
    response = owner.put(f'/api/lessons/{lesson.lesson_id}/trim', json={
        'base_revision_id': lesson.revision_id, 'start_frame': 0, 'end_frame': 30, 'accept': False})
    assert response.status_code == 200, response.text
    trimmed = response.json()
    assert trimmed['frame_rate'] == 29.97
    assert abs(trimmed['duration'] - 30 / 29.97) < 1e-9
    assert abs(trimmed['section_set']['duration'] - trimmed['duration']) < 1e-9
