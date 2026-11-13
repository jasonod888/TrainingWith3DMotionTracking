"""Playback settings and raw-model receipt on music drafts."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.database import Account, Lesson, MusicDraft
from test_accounts import login, register
from test_music_conversions import music_app


def seed(app):
    with Session(app.state.engine) as session:
        owner = session.scalar(select(Account).where(
            Account.email == 'owner@example.test'))
        session.add(Lesson(id='lesson-1', owner_id=owner.id, title='Piano',
                           subject='piano', experience_family='music',
                           instrument='piano', version=1))
        session.add(MusicDraft(
            id='draft-1', job_id='job-1', lesson_id='lesson-1', owner_id=owner.id,
            subject='piano', instrument='piano', status='draft',
            document={'draft_version': 1, 'subject': 'piano',
                      'instrument': {'instrument': 'piano'},
                      'playback': {'sync_offset_seconds': 0.0, 'revision': 1}},
            playback={'sync_offset_seconds': 0.0, 'revision': 1},
            raw_model=True, correction_operations=0))
        session.commit()


def test_draft_exposes_raw_receipt_and_playback(tmp_path):
    with music_app(tmp_path) as system:
        client, app, *_ = system
        seed(app)
        body = client.get('/api/lessons/lesson-1/music-draft').json()
        assert body['raw_model'] is True
        assert body['correction_operations'] == 0
        assert body['playback'] == {'sync_offset_seconds': 0.0, 'revision': 1}


def test_playback_offset_is_versioned_and_optimistic(tmp_path):
    with music_app(tmp_path) as system:
        client, app, *_ = system
        seed(app)
        saved = client.patch('/api/lessons/lesson-1/music-draft/playback',
                             json={'draft_id':'draft-1','sync_offset_seconds': 0.12, 'revision': 1})
        assert saved.status_code == 200, saved.text
        assert saved.json() == {'sync_offset_seconds': 0.12, 'revision': 2}
        stale = client.patch('/api/lessons/lesson-1/music-draft/playback',
                             json={'draft_id':'draft-1','sync_offset_seconds': 0.2, 'revision': 1})
        assert stale.status_code == 409
        out_of_bounds = client.patch('/api/lessons/lesson-1/music-draft/playback',
                                     json={'draft_id':'draft-1','sync_offset_seconds': 12.0, 'revision': 2})
        assert out_of_bounds.status_code == 422


def test_playback_offset_is_owner_only(tmp_path):
    with music_app(tmp_path) as system:
        client, app, _settings, _store, mail, *_ = system
        seed(app)
        register(client, mail, email='other@example.test')
        login(client, email='other@example.test')
        response = client.patch('/api/lessons/lesson-1/music-draft/playback',
                                json={'draft_id':'draft-1','sync_offset_seconds': 0.1, 'revision': 1})
        assert response.status_code == 404

def test_settings_cannot_mutate_a_replaced_or_finalized_draft(tmp_path):
    with music_app(tmp_path) as (client,app,*_):
        seed(app)
        url='/api/lessons/lesson-1/music-draft/playback'
        assert client.patch(url,json={'draft_id':'old-draft','revision':1,'sync_offset_seconds':.2}).status_code==409
        with Session(app.state.engine) as session:
            session.get(MusicDraft,'draft-1').status='reviewed';session.commit()
        assert client.patch(url,json={'draft_id':'draft-1','revision':1,'sync_offset_seconds':.2}).status_code==409
