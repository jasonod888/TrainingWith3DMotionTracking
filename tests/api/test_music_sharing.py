"""Reviewed music sharing: invitation-only release, recipient access, no public exposure."""
from fastapi.testclient import TestClient

from apps.api.database import Lesson, LessonAcceptance, LessonGrant, LessonRevision, GroupLesson, GroupCollection, GroupMember, LessonPublication, LessonTag
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
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1', 'X-Lesson-Formats':'1,2'})
            register(learner, mail, 'learner@example.test')
            login(learner, 'learner@example.test')
            inspected = learner.post('/api/shares/inspect', json={'invite': token})
            assert inspected.status_code == 200, inspected.text
            # Legacy acceptance must fail before creating a grant or consuming the invite.
            assert learner.post('/api/shares/accept', json={'invite': token},headers={'X-Lesson-Formats':'1'}).status_code == 406
            with Session(app.state.engine) as session:
                assert session.query(LessonGrant).count()==0
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
            learner.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1', 'X-Lesson-Formats':'1,2'})
            login(learner, 'learner@example.test')
            assert learner.get(f'/api/lessons/{lesson_id}', headers={'X-Lesson-Formats': '1,2'}).status_code == 404


def test_music_cannot_gain_group_or_public_access_even_from_stale_associations(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        lesson_id,view,*_=proposal(client,app,media(tmp_path,'audio'))
        manifest=client.post(f'/api/lessons/{lesson_id}/music-draft/review',json=review_body(view)).json()
        group=client.post('/api/groups',json={'name':'Music boundary test'}).json()
        assert client.post(f"/api/groups/{group['id']}/lessons",json={'lesson_id':lesson_id}).status_code==409
        public=f'/api/public/lessons/{lesson_id}'
        assert client.patch(public,json={'listed':True,'title':'Private piano','creator_name':'Teacher',
            'tags':['private-music-test'],'rights_acknowledged':True}).status_code==409
        assert client.post(f'/api/lessons/{lesson_id}/publish',json={'revision_id':manifest['revision_id'],
            'mode':'invite','reviewed':True,'rights_acknowledged':True}).status_code==200
        with TestClient(app) as other:
            other.headers.update({'Origin':'http://testserver','X-Form-Request':'1','X-Lesson-Formats':'1,2'})
            register(other,mail,'uninvited-music@example.test');login(other,'uninvited-music@example.test')
            other_id=other.get('/api/auth/session').json()['account']['id']
            with Session(app.state.engine) as session:
                owner=session.get(Lesson,lesson_id).owner_id
                # Simulate previously persisted bypass rows; no new route should create them.
                session.add(GroupMember(group_id=group['id'],account_id=other_id,role='member'))
                session.add(GroupLesson(group_id=group['id'],lesson_id=lesson_id,added_by=owner))
                session.add(GroupCollection(group_id=group['id'],lesson_id=lesson_id,added_by=owner))
                session.add(LessonPublication(lesson_id=lesson_id,revision_id=manifest['revision_id'],title='Private piano',creator_name='Teacher',listed=True))
                session.add(LessonTag(lesson_id=lesson_id,tag='private-music-test'));session.commit()
            assert other.get(f'/api/lessons/{lesson_id}',headers={'X-Lesson-Formats':'1,2'}).status_code==404
            assert other.get(f"/api/lessons/{lesson_id}/assets/{manifest['reference']['key'].split('/')[-1]}").status_code==404
            assert other.get(f"/api/groups/{group['id']}").json()['moves']==[]
            assert other.get('/api/groups').json()['groups'][0]['moves']==0
            assert other.get('/api/shared-lessons/summaries').json()==[]
            assert other.get(f'/api/public/moves/{lesson_id}').status_code==404
            assert other.get('/api/public/subjects').json()['subjects']==[]
            assert other.get('/api/public/tags').json()['tags']==[]
            assert other.get('/api/public/moves?limit=1').json()['moves']==[]


def test_new_review_is_not_released_until_explicit_publish_and_old_assets_stay_private(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        source=media(tmp_path,'audio');lesson_id,view,*_=proposal(client,app,source)
        first=client.post(f'/api/lessons/{lesson_id}/music-draft/review',json=review_body(view)).json()
        publish=f'/api/lessons/{lesson_id}/publish'
        def release(revision,**extra):return client.post(publish,json={'revision_id':revision,'mode':'invite','reviewed':True,'rights_acknowledged':True,**extra})
        assert release(first['revision_id']).status_code==200
        assert client.post(f'/api/lessons/{lesson_id}/invitations',json={'email':'versions@example.test'}).status_code==201
        token=next(token for email,purpose,token in reversed(mail) if email=='versions@example.test' and purpose=='invite')
        with TestClient(app) as recipient:
            recipient.headers.update({'Origin':'http://testserver','X-Form-Request':'1','X-Lesson-Formats':'1,2'})
            register(recipient,mail,'versions@example.test');login(recipient,'versions@example.test')
            assert recipient.post('/api/shares/accept',json={'invite':token}).status_code==200
            _,second_view,*_=proposal(client,app,source,target=lesson_id)
            body=review_body(second_view);body['title']='New reviewed version'
            second=client.post(f'/api/lessons/{lesson_id}/music-draft/review',json=body).json()
            detail=f'/api/lessons/{lesson_id}'
            assert recipient.get(detail).json()['revision_id']==first['revision_id']
            new_asset=f"{detail}/assets/{second['reference']['key'].split('/')[-1]}"
            assert recipient.get(new_asset).status_code==404
            assert release(first['revision_id'],keep_current_release=True).status_code==409
            assert client.post(f'{detail}/invitations',json={'email':'new-recipient@example.test'}).status_code==201
            assert recipient.get(detail).json()['revision_id']==first['revision_id']
            assert release(second['revision_id']).status_code==200
            assert recipient.get(detail).json()['revision_id']==second['revision_id']
            assert recipient.get(new_asset).status_code==200
            recipient_id=recipient.get('/api/auth/session').json()['account']['id']
            assert client.delete(f'{detail}/students/{recipient_id}',headers={'Content-Type':'application/json'}).status_code==200
            assert recipient.get(detail).status_code==404 and recipient.get(new_asset).status_code==404
