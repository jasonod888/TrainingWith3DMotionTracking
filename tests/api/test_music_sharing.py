"""Reviewed music sharing: invitation-only release, recipient access, no public exposure."""
from fastapi.testclient import TestClient

from apps.api.database import LessonAcceptance
from sqlalchemy.orm import Session
from test_accounts import login, register
from test_music_media_validation import media, real_media_app
from test_music_review import proposal, review_body

POLICY = {'assessment': 'notes', 'input_modes': ['midi'], 'dimensions': ['pitch', 'timing'],
          'rubric_version': 'piano-midi-v1'}


def test_reviewed_music_release_is_private_invitation_only(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['assessment'] = POLICY
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        assert reviewed.status_code == 200, reviewed.text
        manifest = reviewed.json()
        with Session(app.state.engine) as session:
            acceptance = session.query(LessonAcceptance).one()
            assert acceptance.source == 'music-review' and acceptance.revision_id == manifest['revision_id']

        # Nothing is shared until the reviewed revision is explicitly published by invitation.
        assert client.post(f'/api/lessons/{lesson_id}/invitations',
                           json={'email': 'learner@example.test'}).status_code == 409
        link = client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': manifest['revision_id'], 'mode': 'link', 'reviewed': True, 'rights_acknowledged': True})
        assert link.status_code == 409

        published = client.post(f'/api/lessons/{lesson_id}/publish', json={
            'revision_id': manifest['revision_id'], 'mode': 'invite', 'reviewed': True, 'rights_acknowledged': True})
        assert published.status_code == 200, published.text
        assert published.json()['link'] is None
        invited = client.post(f'/api/lessons/{lesson_id}/invitations', json={'email': 'learner@example.test'})
        assert invited.status_code == 201, invited.text
        token = next(token for email, purpose, token in mail if email == 'learner@example.test' and purpose == 'invite')

        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
            register(learner, mail, 'learner@example.test')
            login(learner, 'learner@example.test')
            inspected = learner.post('/api/shares/inspect', json={'invite': token})
            assert inspected.status_code == 200, inspected.text
            accepted = learner.post('/api/shares/accept', json={'invite': token})
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()['schema_version'] == 2
            assert accepted.json()['revision_id'] == manifest['revision_id']

            summaries = learner.get('/api/shared-lessons/summaries', headers={'X-Lesson-Formats': '1,2'})
            assert summaries.status_code == 200
            assert any(item['lesson_id'] == lesson_id and item['experience_family'] == 'music'
                       for item in summaries.json()), summaries.json()
            detail = learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'})
            assert detail.status_code == 200 and detail.json()['schema_version'] == 2

            # The shared release is never public, and the recipient cannot publish it.
            assert learner.get(f'/api/public/moves/{lesson_id}').status_code == 404
            assert learner.post(f'/api/lessons/{lesson_id}/publish', json={
                'revision_id': manifest['revision_id'], 'mode': 'invite', 'reviewed': True,
                'rights_acknowledged': True}).status_code == 404
            assert learner.post(f'/api/lessons/{lesson_id}/unpublish', json={}).status_code == 404

        assert client.post(f'/api/lessons/{lesson_id}/unpublish', json={}).status_code == 200
        with TestClient(app) as learner:
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
            login(learner, 'learner@example.test')
            assert learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'}).status_code == 404
