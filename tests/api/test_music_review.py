"""Explicit owner finalisation, immutable reference identities and private source retention."""
import copy
import hashlib
import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import Lesson, LessonAcceptance, LessonRevision, MusicReview
from support_multi import music_worker
from test_accounts import login, register
from test_music_media_validation import media, real_media_app, upload
from test_music_draft_handoff import claimed, draft_payload


def proposal(client,app,path,target=None):
    if target:
        data=path.read_bytes()
        job=client.post('/api/conversions',json={'title':'Replacement','filename':path.name,
            'bytes':len(data),'start':0,'duration':2,'subject':'piano','instrument':'piano','lesson_id':target}).json()
        assert client.put(f"/api/conversions/{job['id']}/parts/1",content=data,headers={'Content-Type':'application/octet-stream'}).status_code==200
        assert client.post(f"/api/conversions/{job['id']}/complete",json={}).status_code==200
        headers={'Authorization':'Bearer draft-worker'}
        claim=client.post('/api/worker/claim',headers=headers,json={}).json()
        lease={**headers,'X-Job-Lease':claim['attempt_token']}
        base='/api/worker/jobs/'+claim['id']
        for stage in ('processing','exporting','verifying'):
            assert client.post(base+'/heartbeat',headers=lease,json={'stage':stage}).status_code==200
    else:
        assert upload(client,path).json()['state']=='queued'
        claim,lease,base=claimed(client,app,'unused')
    reference=client.put(base+'/files/reference.json',headers=lease,content=b'{"proposal":true}').json()
    payload=draft_payload(reference,'a'*64)
    result=client.post(base+'/draft',headers=lease,json=payload)
    assert result.status_code==200,result.text
    lesson_id=result.json()['lesson_id']
    view=client.get('/api/lessons/'+lesson_id+'/music-draft').json()
    return lesson_id,view,lease,base,payload


def review_body(view):
    return {'draft_id':view['draft_id'],'reference_sha256':view['reference']['sha256'],
            'title':'Reviewed piano','events':view['events'],'spans':view['spans'],
            'sections':[{'id':'whole','label':'Whole lesson','start':0,'end':2}],
            'assessment':{'assessment':'notes','input_modes':['midi','microphone'],
                          'dimensions':['pitch','timing'],'rubric_version':'piano-midi-v1'},
            'confirm_reviewed':True}


def test_owner_review_creates_exact_private_revision_and_is_idempotent(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        source=media(tmp_path,'audio')
        lesson_id,view,lease,base,payload=proposal(client,app,source)
        assert store.objects[view['source_video']['key']]==source.read_bytes()
        assert client.get('/api/lessons/'+lesson_id+'/assets/'+view['source_video']['key'].split('/')[-1]).status_code==200
        # The handoff retry is attempt-specific even after it has completed.
        assert client.post(base+'/draft',headers={**lease,'X-Job-Lease':'0'*48},json=payload).status_code==409
        other_worker=music_worker(app,'other-draft-worker')
        assert client.post(base+'/draft',headers={**other_worker,'X-Job-Lease':lease['X-Job-Lease']},json=payload).status_code==409
        body=review_body(view)
        body['events'][0]['pitch']=62
        url='/api/lessons/'+lesson_id+'/music-draft/review'
        assert client.post(url,json={**body,'confirm_reviewed':False}).status_code==422
        bad=copy.deepcopy(body);bad['events'][0]['duration']=100
        assert client.post(url,json=bad).status_code==422
        with TestClient(app) as other:
            other.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
            register(other,mail,'music-review-other@example.test');login(other,'music-review-other@example.test')
            assert other.post(url,json=body).status_code==404
            assert other.get('/api/lessons/'+lesson_id+'/assets/'+view['source_video']['key'].split('/')[-1]).status_code==404
        response=client.post(url,json=body)
        assert response.status_code==200,response.text
        manifest=response.json()
        reference=json.loads(store.objects[manifest['reference']['key']])
        assert reference['events'][0]['pitch']==62
        assert hashlib.sha256(store.objects[manifest['reference']['key']]).hexdigest()==manifest['reference']['sha256']
        assert manifest['assessment']['assessment']=='notes'
        assert manifest['source_video']==view['source_video']
        assert client.post(url,json=body).json()==manifest
        changed=copy.deepcopy(body);changed['events'][0]['pitch']=63
        assert client.post(url,json=changed).status_code==409
        with Session(app.state.engine) as session:
            assert session.query(LessonRevision).count()==1
            assert session.query(MusicReview).count()==1
            record=session.query(MusicReview).one()
            assert reference['review']['reviewer_id']==record.reviewer_id
            assert record.document['provenance']==view['provenance']
            assert session.query(LessonAcceptance).one().source=='music-review'
            assert session.get(Lesson,lesson_id).published_revision_id is None
        assert client.get('/api/lessons/'+lesson_id,headers={'X-Lesson-Formats':'1,2'}).status_code==200
        assert client.get('/api/public/moves/'+lesson_id).status_code==404
        assert client.post('/api/conversions',json={'title':'Different instrument','filename':'guitar.mp4',
            'bytes':source.stat().st_size,'start':0,'duration':2,'subject':'guitar','instrument':'guitar','lesson_id':lesson_id}).status_code==409
        assert client.post('/api/lessons/'+lesson_id+'/publish',json={'revision_id':manifest['revision_id'],
            'mode':'link','reviewed':True,'rights_acknowledged':True}).status_code==409
        shared=client.post('/api/lessons/'+lesson_id+'/publish',json={'revision_id':manifest['revision_id'],
            'mode':'invite','reviewed':True,'rights_acknowledged':True})
        assert shared.status_code==200,shared.text
        assert client.get('/api/public/moves/'+lesson_id).status_code==404


def test_replacement_drafts_do_not_overwrite_assets_and_stale_review_is_refused(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        source=media(tmp_path,'audio')
        lesson_id,first,*_=proposal(client,app,source)
        original_reference=store.objects[first['reference']['key']]
        _,second,*_=proposal(client,app,source,target=lesson_id)
        assert first['reference']['key']!=second['reference']['key']
        assert store.objects[first['reference']['key']]==original_reference
        url='/api/lessons/'+lesson_id+'/music-draft/review'
        assert client.post(url,json=review_body(first)).status_code==409
        reviewed=client.post(url,json=review_body(second))
        assert reviewed.status_code==200,reviewed.text
        frozen=reviewed.json()['reference']['key']
        frozen_bytes=store.objects[frozen]
        _,third,*_=proposal(client,app,source,target=lesson_id)
        assert store.objects[frozen]==frozen_bytes
        latest=client.post(url,json=review_body(third))
        assert latest.status_code==200,latest.text
        assert latest.json()['reference']['key']!=frozen
        with Session(app.state.engine) as session:
            assert sorted(row.version for row in session.query(LessonRevision).all())==[1,2]


def test_review_can_choose_midi_feedback_without_enabling_scoring_or_publishing(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        source = media(tmp_path, 'audio')
        lesson_id, view, lease, base, payload = proposal(client, app, source)
        body = review_body(view)
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
        url = '/api/lessons/' + lesson_id + '/music-draft/review'
        bad = copy.deepcopy(body)
        bad['assessment']['dimensions'] = ['pitch', 'loudness']
        assert client.post(url, json=bad).status_code == 422
        for dimensions in (['pitch'], ['timing'], [], ['pitch', 'pitch']):
            bad['assessment']['dimensions'] = dimensions
            assert client.post(url, json=bad).status_code == 422
        watch_with_midi = copy.deepcopy(body)
        watch_with_midi['assessment'] = {'assessment': 'none', 'input_modes': ['midi'], 'dimensions': []}
        assert client.post(url, json=watch_with_midi).status_code == 422
        response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        manifest = response.json()
        assert manifest['assessment']['assessment'] == 'notes'
        assert manifest['assessment']['input_modes'] == ['midi', 'microphone']
        assert manifest['assessment']['dimensions'] == ['pitch', 'timing']
        assert manifest['assessment']['rubric_version'] == 'piano-midi-v1'
        assert client.post(url, json=body).json() == manifest
        changed = copy.deepcopy(body)
        changed['assessment'] = {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [], 'rubric_version': 'music-watch-v1'}
        # The draft was already reviewed; a different legacy policy is a conflict, not
        # a new mandatory-notes rejection.
        assert client.post(url, json=changed).status_code == 409
        with Session(app.state.engine) as session:
            assert session.query(MusicReview).one().document['assessment'] == body['assessment']
        assert 'score' not in manifest
        assert client.post('/api/lessons/' + lesson_id + '/publish', json={'revision_id': manifest['revision_id'],
            'mode': 'link', 'reviewed': True, 'rights_acknowledged': True}).status_code == 409
        shared = client.post('/api/lessons/' + lesson_id + '/publish', json={'revision_id': manifest['revision_id'],
            'mode': 'invite', 'reviewed': True, 'rights_acknowledged': True})
        assert shared.status_code == 200, shared.text


def test_reviewer_can_disable_feedback_without_losing_the_note_rubric(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        lesson_id,view,lease,base,payload=proposal(client,app,media(tmp_path,'audio'))
        body=review_body(view)
        body['feedback_enabled']=False
        url=f'/api/lessons/{lesson_id}/music-draft/review'
        bad=copy.deepcopy(body);bad['feedback_enabled']='false'
        assert client.post(url,json=bad).status_code==422
        response=client.post(url,json=body)
        assert response.status_code==200,response.text
        manifest=response.json()
        assert manifest['feedback_enabled'] is False
        assert manifest['assessment']['assessment']=='notes'
        assert client.get(f'/api/lessons/{lesson_id}',headers={'X-Lesson-Formats':'1,2'}).json()['feedback_enabled'] is False
        shared=client.post(f'/api/lessons/{lesson_id}/publish',json={
            'revision_id':manifest['revision_id'],'mode':'invite','reviewed':True,'rights_acknowledged':True})
        assert shared.status_code==200,shared.text


def test_review_persists_positions_and_chords(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, lease, base, payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['events'][0].update(pitch=60, string=2, fret=1)
        body['guitar_chords'] = [{'id': 'c', 'name': 'C', 'start': 0,
                                  'frets': [-1, 3, 2, 0, 1, 0], 'position': 1}]
        body['assessment'] = {'assessment': 'notes', 'input_modes': ['midi', 'microphone'],
                              'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}
        url = f'/api/lessons/{lesson_id}/music-draft/review'
        bad = copy.deepcopy(body)
        bad['guitar_chords'][0]['frets'][1] = 6
        assert client.post(url, json=bad).status_code == 422
        response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        reference = json.loads(store.objects[response.json()['reference']['key']])
        assert reference['events'][0]['string'] == 2 and reference['events'][0]['fret'] == 1
        assert reference['guitar_chords'][0]['frets'][1] == 3
