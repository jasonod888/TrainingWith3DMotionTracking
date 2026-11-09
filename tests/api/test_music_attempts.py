"""Separate music summary history: opt-in gate, immutable identity, privacy and bounds."""
import json
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import Lesson, LessonGrant, LessonRevision, MusicPracticeAttempt, MimicAttempt
from apps.api.permissions import accept_revision
from support_multi import import_music
from test_accounts import login, register
from test_music_conversions import music_app


def imported_music(system):
    lesson = import_music(system)
    with Session(system[1].state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        revision.manifest = {**revision.manifest, 'assessment': {'assessment': 'notes', 'input_modes': ['midi'],
            'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}}
        session.commit()
    return lesson


def payload(lesson):
    return {'summary_version': 1, 'status': 'complete', 'id': str(uuid4()), 'save_requested': True,
        'revision_id': lesson.revision_id, 'reference_sha256': lesson.reference.sha256,
        'rubric_version': 'piano-midi-v1', 'section_id': 'all', 'start': 0, 'end': lesson.duration,
        'speed': 1, 'run': 0, 'assessment': 'unscored', 'alignment': 'none',
        'note_window': {'total': 5, 'eligible': 4, 'matched': 2, 'missing': 1, 'extra': 1}}


def test_music_history_is_off_by_default_and_pose_history_refuses_music(tmp_path):
    with music_app(tmp_path) as system:
        client, app, *_ = system
        lesson = imported_music(system)
        path = f'/api/lessons/{lesson.lesson_id}/music-attempts'
        assert client.get('/api/capabilities').json()['music_history'] is False
        assert client.get(path).status_code == 404
        assert client.post(path, json=payload(lesson)).status_code == 404
        pose = f'/api/lessons/{lesson.lesson_id}/attempts'
        assert client.get(pose).status_code == 409
        assert client.post(pose, json={'id':str(uuid4()),'revision_id':lesson.revision_id,
            'start':0,'end':lesson.duration,'score':100,'coverage':1,'cue':'','section':'','configuration':''}).status_code == 409
        with Session(app.state.engine) as session:
            assert session.query(MusicPracticeAttempt).count() == session.query(MimicAttempt).count() == 0


def test_summary_save_is_exact_idempotent_bounded_and_deletable(tmp_path, monkeypatch):
    monkeypatch.setattr('apps.api.music_attempts.MAX_SUMMARIES', 1)
    with music_app(tmp_path, music_history_enabled=True) as system:
        client, app, *_ = system
        lesson = imported_music(system)
        path = f'/api/lessons/{lesson.lesson_id}/music-attempts'
        value = payload(lesson)
        for change in ({'score':100},{'events':[]},{'device_id':'keyboard'},{'save_requested':False},
                       {'summary_version':2},{'status':'interrupted'},{'assessment':'scored'}, {'alignment':'device-qualified'},
                       {'start':float('inf')}, {'note_window':{**value['note_window'],'eligible':6}},
                       {'note_window':{**value['note_window'],'total':20001}}):
            # JSON forbids Infinity, so use a numeric overflow token to exercise the API.
            if change.get('start') == float('inf'):
                response=client.post(path, content=json.dumps({**value,'start':0}).replace('"start": 0','"start": 1e999'),headers={'Content-Type':'application/json'})
            else:
                response=client.post(path,json={**value,**change})
            assert response.status_code == 422, response.text
        for change, status in (({'reference_sha256':'a'*64},409),({'revision_id':'old'},409),
                               ({'end':lesson.duration+1},422),({'section_id':'unknown'},422)):
            assert client.post(path,json={**value,**change}).status_code == status
        result=client.post(path,json=value)
        assert result.status_code == 201, result.text
        assert result.json()['evidence']=='client-reported'
        assert 'score' not in result.json()
        assert client.post(path,json=value).json()==result.json()
        assert client.post(path,json={**value,'alignment':'visual-estimate'}).status_code==409
        assert client.post(path,json={**value,'id':str(uuid4())}).status_code==409  # quota
        assert client.get(path).json()==[result.json()]
        assert client.delete(path+'/'+value['id'],headers={'Content-Type':'application/json'}).status_code==200
        assert client.get(path).json()==[]
        assert client.delete(path+'/'+value['id'],headers={'Content-Type':'application/json'}).status_code==404


def test_history_is_personal_even_for_simulated_future_music_recipient(tmp_path):
    with music_app(tmp_path,music_history_enabled=True) as system:
        client, app, settings, store, mail = system
        lesson = imported_music(system)
        path=f'/api/lessons/{lesson.lesson_id}/music-attempts'
        value=payload(lesson)
        assert client.post(path,json=value).status_code==201
        with TestClient(app) as other:
            other.headers.update({'Origin':'http://testserver','X-Form-Request':'1'})
            register(other,mail,'music-history-other@example.test');login(other,'music-history-other@example.test')
            assert other.get(path).status_code==404
            assert other.post(path,json=payload(lesson)).status_code==404
            assert other.delete(path+'/'+value['id'],headers={'Content-Type':'application/json'}).status_code==404
            other_id=other.get('/api/auth/session').json()['account']['id']
            # Music sharing remains blocked by the real API. Seed future released access
            # directly to prove a lesson owner cannot read another learner's summary.
            with Session(app.state.engine) as session:
                row=session.get(Lesson,lesson.lesson_id);row.published_revision_id=lesson.revision_id;row.distribution='invite'
                accept_revision(session,row,session.get(LessonRevision,lesson.revision_id),row.owner_id,source='music-review')
                session.add(LessonGrant(lesson_id=row.id,account_id=other_id,source='invite'));session.commit()
            assert other.get(path).json()==[]
            own=payload(lesson)
            assert other.post(path,json=own).status_code==201
            assert len(client.get(path).json())==1
            assert client.delete(path+'/'+own['id'],headers={'Content-Type':'application/json'}).status_code==404
            with Session(app.state.engine) as session:
                session.get(LessonGrant,(lesson.lesson_id,other_id)).revoked=True;session.commit()
            assert other.get(path).status_code==404
            assert other.delete(path+'/'+own['id'],headers={'Content-Type':'application/json'}).status_code==200
