"""Route-owned raw completion, preview lifecycle and pedal conservation."""
import copy
import json
from unittest.mock import patch
from sqlalchemy.orm import Session
from apps.api.database import MusicDraft
from test_music_conversions import music_app, claimed, MUSIC_BODY
from test_music_draft_handoff import draft_payload
from test_music_review import proposal, review_body
from test_music_media_validation import media, real_media_app

def kong_result(client,base,lease):
    reference=client.put(base+'/files/reference.json',headers=lease,content=b'{}').json()
    preview=client.put(base+'/files/preview.wav',headers=lease,content=b'preview').json()
    payload=draft_payload(reference,'a'*64)
    payload.update(piano_preview=preview,preview_identity='b'*64)
    payload['provenance'].update(model='kong',adapter='kong-adapter',engine='pytorch',profile_sha256='a'*64)
    return payload

def test_kong_route_requires_correct_model_and_bound_preview(tmp_path):
    with music_app(tmp_path,music_piano_default_model='kong',music_kong_allowed_run_profiles='a'*64) as (client,app,*_):
        job,lease,base=claimed(client,app,MUSIC_BODY,pipeline='music-piano-kong-v1')
        payload=kong_result(client,base,lease)
        wrong=copy.deepcopy(payload);wrong['provenance']['model']='basic-pitch'
        assert client.post(base+'/draft',headers=lease,json=wrong).status_code==422
        wrong=copy.deepcopy(payload);wrong['piano_preview']=None
        assert client.post(base+'/draft',headers=lease,json=wrong).status_code==422
        wrong=copy.deepcopy(payload);wrong['provenance']['profile_sha256']='c'*64
        assert client.post(base+'/draft',headers=lease,json=wrong).status_code==422
        analysis=client.put(base+'/files/analysis.zip',headers=lease,content=b'analysis').json()
        payload['analysis']=analysis
        with patch('apps.api.conversions.read_verification_report',return_value=({'report':True},None)), \
             patch('apps.api.conversions.read_expression_report',return_value={}), \
             patch('apps.api.conversions.report_identity_matches',return_value=True), \
             patch('apps.api.conversions.automatic_working_document',side_effect=AssertionError('correction ran')), \
             patch('apps.api.conversions.automatic_expression_document',side_effect=AssertionError('expression ran')):
            response=client.post(base+'/draft',headers=lease,json=payload)
        assert response.status_code==200,response.text
        view=client.get('/api/lessons/'+job['id']+'/music-draft').json()
        assert view['raw_model'] is True and view['correction_operations']==0

def test_note_edits_invalidate_audio_and_preserve_pedal(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        lesson,view,*_=proposal(client,app,media(tmp_path,'audio'))
        preview={'key':'lessons/'+lesson+'/preview.wav','mime':'audio/wav','bytes':1,'sha256':'b'*64}
        pedal=[{'onset':.2,'offset':1.7,'type':'sustain'}]
        with Session(app.state.engine) as session:
            row=session.get(MusicDraft,view['draft_id']);row.document={**row.document,'piano_preview':preview,'preview_identity':'c'*64,'pedal':pedal};session.commit()
        view=client.get('/api/lessons/'+lesson+'/music-draft').json()
        body=review_body(view)
        # Unchanged finalisation can reuse its bound preview.
        first=client.post('/api/lessons/'+lesson+'/music-draft/review',json=body).json()
        assert first['piano_preview']==preview
        edit={'base_revision_id':first['revision_id'],'title':'Edited','events':copy.deepcopy(body['events']),'spans':body['spans'],'sections':body['sections'],'confirm_reviewed':True}
        edit['events'][0]['pitch']+=1
        with patch('apps.api.music_edit.storage_client',return_value=store):
            response=client.post('/api/lessons/'+lesson+'/music-revision',json=edit)
        assert response.status_code==200,response.text
        second=response.json();reference=json.loads(store.objects[second['reference']['key']])
        assert second['piano_preview'] is None and second['preview_identity'] is None
        assert reference['pedal']==second['pedal']==pedal

def test_editing_draft_before_finalization_invalidates_preview(tmp_path):
    with real_media_app(tmp_path) as (client,app,settings,store,mail):
        lesson,view,*_=proposal(client,app,media(tmp_path,'audio'))
        with Session(app.state.engine) as session:
            row=session.get(MusicDraft,view['draft_id']);row.document={**row.document,'piano_preview':{'key':'old.wav','mime':'audio/wav','bytes':1,'sha256':'b'*64},'preview_identity':'c'*64};session.commit()
        view=client.get('/api/lessons/'+lesson+'/music-draft').json();body=review_body(view);body['events'][0]['velocity']=.1
        response=client.post('/api/lessons/'+lesson+'/music-draft/review',json=body)
        assert response.status_code==200,response.text
        assert response.json()['piano_preview'] is None
