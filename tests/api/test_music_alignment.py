"""Phase 5: validated notation, versioned alignment and offset survive save/reopen."""
import copy
import json
from unittest.mock import patch

from test_music_edit import _notation_for
from test_music_media_validation import media, real_media_app
from test_music_review import proposal, review_body

SPB = 60 / (120 * 480)


def alignment(duration=2.0, offset=0.25, anchors=None):
    ticks = round(duration / SPB)
    return {
        'alignment_version': 1, 'mode': 'anchored' if anchors else 'estimated', 'basis': 'tempo',
        'offset_seconds': offset,
        'anchors': anchors or [],
        'passages': [{'kind': 'timed', 'source_seconds': [0, duration], 'ticks': [0, ticks]}],
    }


def test_review_persists_notation_alignment_offset_and_is_idempotent(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['notation'] = _notation_for(body['events'], duration=view['duration'])
        body['alignment'] = alignment(view['duration'], offset=0.25,
                                      anchors=[{'seconds': 1.0, 'tick': 960}])
        body['offset_seconds'] = 0.25
        url = f'/api/lessons/{lesson_id}/music-draft/review'
        first = client.post(url, json=body)
        assert first.status_code == 200, first.text
        manifest = first.json()
        reference = json.loads(store.objects[manifest['reference']['key']])
        assert reference['notation']['notation_version'] == 1
        assert reference['alignment']['alignment_version'] == 1
        assert reference['alignment']['offset_seconds'] == 0.25
        assert reference['alignment']['anchors'] == [{'seconds': 1.0, 'tick': 960}]
        assert reference['alignment']['mode'] == 'anchored'
        assert reference['alignment']['score_ticks'] == round(view['duration'] / SPB)
        assert reference['notation']['events'][0]['notes'][0]['spelling']

        retry = client.post(url, json=body)
        assert retry.status_code == 200
        assert retry.json()['revision_id'] == manifest['revision_id']


def test_alignment_disagreeing_with_the_clip_is_rejected(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        url = f'/api/lessons/{lesson_id}/music-draft/review'
        body = review_body(view)
        gap = alignment(view['duration'])
        gap['passages'] = [
            {'kind': 'timed', 'source_seconds': [0, 0.5], 'ticks': [0, 480]},
            {'kind': 'timed', 'source_seconds': [0.8, view['duration']], 'ticks': [480, 1920]},
        ]
        assert client.post(url, json={**body, 'alignment': gap}).status_code == 422
        reversed_order = alignment(view['duration'])
        reversed_order['passages'][0]['ticks'] = [500, 400]
        assert client.post(url, json={**body, 'alignment': reversed_order}).status_code == 422
        off_clip = alignment(view['duration'])
        off_clip['anchors'] = [{'seconds': 9.0, 'tick': 10}]
        off_clip['mode'] = 'anchored'
        assert client.post(url, json={**body, 'offset_seconds': 0.25, 'alignment': off_clip}).status_code == 422
        too_large = alignment(view['duration'])
        assert client.post(url, json={**body, 'offset_seconds': 12, 'alignment': too_large}).status_code == 422
        notation = _notation_for(body['events'], duration=view['duration'])
        notation['performance'][0]['pitch'] = 127
        assert client.post(url, json={**body, 'notation': notation}).status_code == 422


def test_legacy_save_without_notation_or_alignment_still_opens(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        url = f'/api/lessons/{lesson_id}/music-draft/review'
        body = review_body(view)
        assert 'notation' not in body and 'alignment' not in body
        response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        reference = json.loads(store.objects[response.json()['reference']['key']])
        assert 'notation' not in reference
        assert 'alignment' not in reference


def test_edit_round_trips_alignment_and_authored_spelling(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        notation = _notation_for(body['events'], duration=view['duration'])
        reviewed = client.post(f'/api/lessons/{lesson_id}/music-draft/review',
                               json={**body, 'notation': notation, 'alignment': alignment(view['duration'])})
        assert reviewed.status_code == 200, reviewed.text
        manifest = reviewed.json()

        edited_notation = copy.deepcopy(notation)
        edited_notation['events'][0]['notes'][0]['spelling'] = 'B#3'
        edit = {
            'base_revision_id': manifest['revision_id'], 'title': 'Edited spelling',
            'events': body['events'], 'spans': body['spans'], 'sections': body['sections'],
            'assessment': {'assessment': 'none', 'input_modes': ['none'], 'dimensions': [],
                           'rubric_version': 'music-watch-v1'},
            'confirm_reviewed': True, 'notation': edited_notation,
            'alignment': alignment(view['duration'], offset=-0.5,
                                   anchors=[{'seconds': 0.5, 'tick': 480}]),
        }
        with patch('apps.api.music_edit.storage_client', return_value=store):
            response = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert response.status_code == 200, response.text
        edited = response.json()
        reference = json.loads(store.objects[edited['reference']['key']])
        assert reference['notation']['events'][0]['notes'][0]['spelling'] == 'B#3'
        assert reference['alignment']['offset_seconds'] == -0.5
        assert reference['alignment']['anchors'] == [{'seconds': 0.5, 'tick': 480}]
        assert reference['review']['edited_from_revision'] == manifest['revision_id']
        # Retrying the identical edit is idempotent, not a duplicate finalisation.
        with patch('apps.api.music_edit.storage_client', return_value=store):
            again = client.post(f'/api/lessons/{lesson_id}/music-revision', json=edit)
        assert again.status_code == 200
        assert again.json()['revision_id'] == edited['revision_id']


def test_persisted_integrity_invariants_are_enforced(tmp_path):
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, _lease, _base, _payload = proposal(client, app, media(tmp_path, 'audio'))
        url = f'/api/lessons/{lesson_id}/music-draft/review'
        body = review_body(view)
        notation = _notation_for(body['events'], duration=view['duration'])

        reversing = alignment(view['duration'], anchors=[{'seconds': 1, 'tick': 1500},
                                                         {'seconds': 1.5, 'tick': 500}])
        assert client.post(url, json={**body, 'alignment': reversing}).status_code == 422

        disagreeing = alignment(view['duration'], anchors=[{'seconds': 1, 'tick': 1500}])
        disagreeing['mode'] = 'anchored'
        assert client.post(url, json={**body, 'alignment': disagreeing}).status_code == 422

        wrong_pitch = copy.deepcopy(notation)
        wrong_pitch['events'][0]['notes'][0]['pitch'] = 127
        assert client.post(url, json={**body, 'notation': wrong_pitch}).status_code == 422

        unowned = copy.deepcopy(notation)
        for event in unowned['events']:
            for note in event['notes']:
                note['performance_ids'] = []
        assert client.post(url, json={**body, 'notation': unowned}).status_code == 422
