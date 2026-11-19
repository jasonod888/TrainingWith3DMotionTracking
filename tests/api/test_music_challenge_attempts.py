"""Experimental whole-piece MIDI challenge reports: gated, versioned, scoreless."""
import json
from copy import deepcopy
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import LessonRevision, MusicPracticeAttempt
from support_multi import import_music
from test_music_conversions import music_app


def imported_music(system):
    lesson = import_music(system)
    with Session(system[1].state.engine) as session:
        revision = session.get(LessonRevision, lesson.revision_id)
        revision.manifest = {**revision.manifest, 'assessment': {'assessment': 'notes', 'input_modes': ['midi'],
            'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'}}
        session.commit()
        return revision.manifest


def payload(manifest):
    sections = manifest['section_set']['sections']
    first, *rest = sections
    first_end = first['end']
    first_start = first['start']
    # Counts are deliberately small but internally consistent; the endpoint must not
    # infer or fabricate a score from them.
    reported = [{'id': first['id'], 'label': first['label'], 'start': first_start, 'end': first_end,
                 'expected_required': 4, 'assessed_required': 3, 'matched_required': 2,
                 'missing_required': 1, 'extra': 0, 'reference_coverage': 0.75, 'recall': 2 / 3,
                 'timing': {'available': True, 'confidence': 'limited', 'matches': 2,
                            'mean_absolute_error_seconds': 0.04, 'score': 0.8,
                            'on_time': 1, 'early': 1, 'late': 0}}]
    for section in rest:
        reported.append({'id': section['id'], 'label': section['label'], 'start': section['start'], 'end': section['end'],
                         'expected_required': 1, 'assessed_required': 1, 'matched_required': 0,
                         'missing_required': 0, 'extra': 0, 'reference_coverage': 1, 'recall': 0,
                         'timing': {'available': False, 'confidence': 'none', 'matches': 0,
                                    'mean_absolute_error_seconds': None, 'score': None,
                                    'on_time': 0, 'early': 0, 'late': 0}})
    # Keep the aggregate consistent with the section rows when the fixture has one section.
    expected = sum(section['expected_required'] for section in reported)
    assessed = sum(section['assessed_required'] for section in reported)
    matched = sum(section['matched_required'] for section in reported)
    missing = sum(section['missing_required'] for section in reported)
    extra = sum(section['extra'] for section in reported)
    return {'report_version': 2, 'status': 'insufficient-evidence', 'id': str(uuid4()), 'save_requested': True,
            'revision_id': manifest['revision_id'], 'reference_sha256': manifest['reference']['sha256'],
            'rubric_version': 'piano-midi-v1', 'scorer_version': 'piano-challenge-v1', 'subject': 'piano',
            'input_mode': 'midi', 'speed': 1, 'policy_qualified': False, 'score': None,
            'score_reason': 'experimental-policy', 'start': 0, 'end': manifest['duration'],
            'offset_seconds': 0.12,
            'alignment': {'offset_seconds': 0.12, 'offset_real_seconds': 0.12, 'ambiguous': False,
                          'support': 0.8, 'peak_separation_seconds': 0.5},
            'coverage': {'reference': assessed / expected, 'capture': 0.9, 'support': 0.8},
            'counts': {'expected_required': expected, 'assessed_required': assessed,
                       'matched_required': matched, 'matched_optional': 0, 'missing_required': missing,
                       'extra': extra, 'unassessed_required': expected - assessed, 'outside_attacks': 0},
            'timing': {'available': True, 'confidence': 'limited', 'matches': matched,
                       'mean_absolute_error_seconds': 0.04, 'score': 0.8,
                       'on_time': matched - 1, 'early': 1, 'late': 0},
            'sections': reported, 'latency_measured': False, 'input_latency_ms': 0, 'model_profile': None}


def test_challenge_is_off_by_default_and_requires_both_flags(tmp_path):
    with music_app(tmp_path, music_history_enabled=True) as system:
        client, *_ = system
        manifest = imported_music(system)
        assert client.get('/api/capabilities').json()['music_challenge'] is False
        assert client.get('/api/capabilities').json()['music_inference'] is False
        response = client.post(f"/api/lessons/{manifest['lesson_id']}/music-challenge-attempts", json=payload(manifest))
        assert response.status_code == 404
    with music_app(tmp_path / 'challenge', music_history_enabled=True, music_challenge_enabled=True) as system:
        client, *_ = system
        manifest = imported_music(system)
        assert client.get('/api/capabilities').json()['music_challenge'] is True
        response = client.post(f"/api/lessons/{manifest['lesson_id']}/music-challenge-attempts", json=payload(manifest))
        assert response.status_code == 201, response.text
        result = response.json()
        assert result['evidence'] == 'client-reported'
        assert result['score'] is None
        assert result['report_version'] == 2


def test_challenge_report_is_idempotent_and_scoreless(tmp_path):
    with music_app(tmp_path, music_history_enabled=True, music_challenge_enabled=True) as system:
        client, app, *_ = system
        manifest = imported_music(system)
        value = payload(manifest)
        path = f"/api/lessons/{manifest['lesson_id']}/music-challenge-attempts"
        first = client.post(path, json=value)
        assert first.status_code == 201, first.text
        assert client.post(path, json=value).json() == first.json()
        assert client.post(path, json={**value, 'score': 100}).status_code == 422
        assert client.post(path, json={**value, 'policy_qualified': True}).status_code == 422
        assert client.post(path, json={**value, 'status': 'complete'}).status_code == 422
        assert client.post(path, json={**value, 'scorer_version': 'other-v1'}).status_code == 422
        assert client.post(path, json={**value, 'start': 1}).status_code == 422
        assert client.post(path, json={**value, 'reference_sha256': 'a' * 64}).status_code == 409
        changed = deepcopy(value); changed['alignment']['support'] = 0.7
        assert client.post(path, json=changed).status_code == 409
        with Session(app.state.engine) as session:
            rows = session.query(MusicPracticeAttempt).all()
            assert len(rows) == 1 and rows[0].summary['report_version'] == 2
            assert rows[0].summary['score'] is None
        history = client.get(f"/api/lessons/{manifest['lesson_id']}/music-attempts").json()
        assert len(history) == 1 and history[0]['evidence'] == 'client-reported'
        assert history[0]['note_window']['total'] == value['counts']['expected_required']

        low = payload(manifest)
        low['timing'] = {'available': False, 'confidence': 'none', 'matches': 2,
                         'mean_absolute_error_seconds': None, 'score': None,
                         'on_time': 0, 'early': 0, 'late': 0}
        assert client.post(path, json=low).status_code == 201


def test_microphone_report_binds_to_a_microphone_reviewed_rubric(tmp_path):
    with music_app(tmp_path, music_history_enabled=True, music_challenge_enabled=True) as system:
        client, app, *_ = system
        manifest = imported_music(system)
        with Session(app.state.engine) as session:
            revision = session.get(LessonRevision, manifest['revision_id'])
            revision.manifest = {**revision.manifest, 'assessment': {
                **revision.manifest['assessment'], 'input_modes': ['microphone'],
            }}
            session.commit()
            manifest = {**manifest, 'assessment': {**manifest['assessment'], 'input_modes': ['microphone']}}
        value = payload(manifest)
        value['input_mode'] = 'microphone'
        assert client.post(f"/api/lessons/{manifest['lesson_id']}/music-challenge-attempts", json=value).status_code == 201


def test_challenge_section_and_count_binding_is_enforced(tmp_path):
    with music_app(tmp_path, music_history_enabled=True, music_challenge_enabled=True) as system:
        client, *_ = system
        manifest = imported_music(system)
        value = payload(manifest)
        path = f"/api/lessons/{manifest['lesson_id']}/music-challenge-attempts"
        wrong_section = deepcopy(value)
        wrong_section['sections'][0]['id'] = 'not-a-reviewed-section'
        assert client.post(path, json=wrong_section).status_code == 422
        bad_counts = deepcopy(value)
        bad_counts['counts']['assessed_required'] += 1
        bad_counts['counts']['unassessed_required'] -= 1
        assert client.post(path, json=bad_counts).status_code == 422
        missing_section = deepcopy(value)
        missing_section['sections'] = missing_section['sections'][:-1] if len(missing_section['sections']) > 1 else []
        assert client.post(path, json=missing_section).status_code == 422
