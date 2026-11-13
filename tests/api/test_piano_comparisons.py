"""Package 6: owner-only comparison records, execution, results and assets."""
import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

import apps.api.piano_comparisons as api_module
import scripts.piano_reconstruction_harness as harness
from apps.api.database import (Lesson, LessonRevision, MusicDraft, PianoComparison,
                               PianoComparisonSource, PianoModelRun)
from test_accounts import login, register
from test_music_conversions import music_app


def owner(session):
    from apps.api.database import Account
    return session.scalar(select(Account).where(Account.email == 'owner@example.test'))


def add_source(tmp_path, app, *, reference=None, lesson_id=None):
    path = tmp_path / 'source.wav'
    harness.write_wav(path, np.zeros(22050, dtype=np.float32), 22050, bit_depth=16)
    with Session(app.state.engine) as session:
        record = PianoComparisonSource(
            id='source-1', owner_id=owner(session).id, lesson_id=lesson_id,
            label='Test source', path=str(path), sha256='a' * 64, seconds=1.0,
            reference_path=str(reference) if reference else None)
        session.add(record)
        session.commit()
    return 'source-1'


def fake_executor(*, fail=(), write_document=False):
    def execute(comparison_id, engine, settings):
        with Session(engine) as session:
            parent = session.get(PianoComparison, comparison_id)
            children = list(session.scalars(select(PianoModelRun).where(
                PianoModelRun.comparison_id == comparison_id)).all())
            for child in children:
                if child.status != 'queued':
                    continue
                child.attempt += 1
                run_dir = (Path(settings.piano_comparison_dir) / comparison_id / 'runs'
                           / child.variant / f'attempt-{child.attempt}')
                run_dir.mkdir(parents=True, exist_ok=True)
                child.run_dir = str(run_dir)
                if child.variant in fail:
                    child.status = 'failed'
                    child.error = 'simulated failure'
                    continue
                receipt = {'schema': 'piano-model-run-receipt-1', 'version': 1,
                           'mode': 'raw-model-comparison-v1', 'variant': child.variant,
                           'correction_enabled': False,
                           'expression_correction_enabled': False,
                           'correction_operations': 0, 'warnings': []}
                (run_dir / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
                if write_document:
                    (run_dir / 'document.json').write_text(json.dumps({'notes': []}),
                                                           encoding='utf-8')
                child.receipt = receipt
                child.status = 'ready'
            statuses = [child.status for child in children]
            if any(value in ('ready', 'partial') for value in statuses):
                parent.status = ('complete' if all(value in ('ready', 'partial')
                                                   for value in statuses) else 'partial')
            elif any(value == 'failed' for value in statuses):
                parent.status = 'failed'
            else:
                parent.status = 'blocked'
            session.commit()
    return execute


def create(client, variants=None, source='source-1'):
    body = {'source_id': source}
    if variants is not None:
        body['variants'] = variants
    response = client.post('/api/piano-comparisons', json=body)
    assert response.status_code == 200, response.text
    return response.json()


def current(client, comparison_id):
    """Read the post-background state; the POST response predates execution."""
    return client.get(f'/api/piano-comparisons/{comparison_id}').json()


def test_create_records_blocked_rows_and_queues_permitted_models(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        view = create(client)
        statuses = {run['variant']: run['status'] for run in current(client, view['id'])['runs']}
        assert statuses['transkun-v2'] == 'blocked_license'
        assert statuses['onsets-frames-piano'] == 'blocked_license'
        assert statuses['basic-pitch-native'] == 'ready'
        assert statuses['kong-piano'] == 'ready'
        assert current(client, view['id'])['status'] == 'partial'
        assert view['result_available'] is False


def test_status_and_results_are_owner_only_and_computed_from_runs(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, _store, mail, *_ = system
        reference = tmp_path / 'reference.json'
        reference.write_text('{}', encoding='utf-8')
        add_source(tmp_path, app, reference=reference)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        view = create(client, ['basic-pitch-native', 'kong-piano'])
        seen = {}
        def fake_evaluate(reference_path, runs, *, interval, registry, source_audio=None):
            seen['reference'] = reference_path
            seen['runs'] = runs
            seen['interval'] = interval
            seen['source_audio'] = source_audio
            return {'schema': 'piano-model-comparison-1', 'models': {}}
        monkeypatch.setattr(api_module.comparison_module, 'evaluate', fake_evaluate)
        result = client.get(f"/api/piano-comparisons/{view['id']}/results")
        assert result.status_code == 200
        assert result.json()['schema'] == 'piano-model-comparison-1'
        assert seen['reference'] == str(reference)
        assert set(seen['runs']) == {'basic-pitch-native', 'kong-piano'}
        assert seen['interval'] == [0.0, 1.0]
        register(client, mail, email='other@example.test')
        login(client, email='other@example.test')
        assert client.get(f"/api/piano-comparisons/{view['id']}").status_code == 404
        assert client.get(f"/api/piano-comparisons/{view['id']}/results").status_code == 404


def test_cross_owner_source_cannot_be_used(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, _store, mail, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        register(client, mail, email='other@example.test')
        login(client, email='other@example.test')
        response = client.post('/api/piano-comparisons',
                               json={'source_id': 'source-1'})
        assert response.status_code == 404


def test_assets_are_allowlisted_and_owner_only(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, _store, mail, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor(write_document=True))
        view = create(client, ['basic-pitch-native'])
        base = f"/api/piano-comparisons/{view['id']}/runs/basic-pitch-native/assets"
        receipt = client.get(f'{base}/receipt.json')
        assert receipt.status_code == 200 and receipt.json()['variant'] == 'basic-pitch-native'
        document = client.get(f'{base}/document.json')
        assert document.status_code == 200 and document.json() == {'notes': []}
        assert client.get(f'{base}/preview.wav').status_code == 404
        assert client.get(f'{base}/../../etc/passwd').status_code == 404
        assert client.get(f'{base}/not-an-asset').status_code == 404


def test_unknown_and_duplicate_variants_are_refused(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        assert client.post('/api/piano-comparisons', json={
            'source_id': 'source-1', 'variants': ['not-a-model']}).status_code == 422
        assert client.post('/api/piano-comparisons', json={
            'source_id': 'source-1',
            'variants': ['kong-piano', 'kong-piano']}).status_code == 422


def test_retry_marks_a_failed_run_queued_without_touching_other_runs(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor(fail=('kong-piano',)))
        view = create(client, ['basic-pitch-native', 'kong-piano'])
        runs = {run['variant']: run for run in current(client, view['id'])['runs']}
        assert runs['kong-piano']['status'] == 'failed'
        monkeypatch.setattr(api_module, '_execute', lambda *args: None)
        response = client.post(
            f"/api/piano-comparisons/{view['id']}/runs/kong-piano/retry", json={})
        assert response.status_code == 200
        retried = {run['variant']: run for run in response.json()['runs']}
        assert retried['kong-piano']['status'] == 'queued'
        assert retried['basic-pitch-native']['status'] == 'ready'


def test_cancel_moves_queued_children_to_cancelled(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', lambda *args: None)
        view = create(client, ['basic-pitch-native', 'kong-piano'])
        response = client.post(f"/api/piano-comparisons/{view['id']}/cancel", json={})
        assert response.status_code == 200
        payload = response.json()
        assert payload['cancel_requested'] is True
        assert payload['status'] == 'cancelled'
        assert all(run['status'] == 'cancelled' for run in payload['runs'])


def test_comparison_does_not_touch_a_linked_lesson(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        with Session(app.state.engine) as session:
            lesson = Lesson(id='lesson-1', owner_id=owner(session).id, title='Piano',
                            subject='piano', experience_family='music', instrument='piano',
                            version=1)
            session.add(lesson)
            session.commit()
        add_source(tmp_path, app, lesson_id='lesson-1')
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        view = create(client, ['basic-pitch-native'])
        assert view['lesson_id'] == 'lesson-1'
        with Session(app.state.engine) as session:
            assert session.get(Lesson, 'lesson-1').version == 1
            assert session.get(Lesson, 'lesson-1').published_revision_id is None


def test_source_audio_is_served_owner_only(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, _store, mail, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        view = create(client, ['basic-pitch-native'])
        response = client.get(f"/api/piano-comparisons/{view['id']}/source")
        assert response.status_code == 200
        assert response.headers['content-type'] == 'audio/wav'
        register(client, mail, email='other2@example.test')
        login(client, email='other2@example.test')
        assert client.get(f"/api/piano-comparisons/{view['id']}/source").status_code == 404


def test_sources_are_owner_scoped(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, _store, mail, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', fake_executor())
        listed = client.get('/api/piano-comparisons/sources')
        assert listed.status_code == 200
        assert [item['id'] for item in listed.json()['sources']] == ['source-1']
        assert listed.json()['sources'][0]['has_reference'] is False
        register(client, mail, email='other3@example.test')
        login(client, email='other3@example.test')
        assert client.get('/api/piano-comparisons/sources').json()['sources'] == []


def test_execution_renders_previews_before_marking_ready(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)

        def fake_adapter(entry, path, interval, output_dir, *, timeout, python):
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / 'document.json').write_text(json.dumps({'notes': []}),
                                                      encoding='utf-8')
            receipt = {'schema': 'piano-model-run-receipt-1', 'version': 1,
                       'mode': 'raw-model-comparison-v1', 'variant': entry['id'],
                       'correction_enabled': False,
                       'expression_correction_enabled': False,
                       'correction_operations': 0, 'warnings': []}
            (output_dir / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
            return receipt

        rendered = []
        def fake_render(document_path, output_dir, native_path=None):
            rendered.append(str(document_path))
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / 'preview.json').write_text('{}', encoding='utf-8')
            return {'common': {'gain_policy': {'common_gain_db': 0.0}},
                    'previews': {'as_transcribed': {'clipping': False}}}

        monkeypatch.setattr(api_module.job_module, '_default_runner', fake_adapter)
        monkeypatch.setattr(api_module.preview_module, 'render_run', fake_render)
        view = create(client, ['basic-pitch-native'])
        current_view = current(client, view['id'])
        assert current_view['runs'][0]['status'] == 'ready'
        assert rendered
        with Session(app.state.engine) as session:
            child = session.scalar(select(PianoModelRun).where(
                PianoModelRun.comparison_id == view['id']))
            assert child.receipt['preview']['clipping'] is False


def test_a_lesson_source_can_be_frozen_and_registered(tmp_path, monkeypatch):
    import io
    import scripts.piano_reconstruction_harness as harness
    with music_app(tmp_path, piano_comparison_dir=tmp_path / 'comparisons') as system:
        client, app, settings, *_ = system
        with Session(app.state.engine) as session:
            session.add(Lesson(id='lesson-1', owner_id=owner(session).id, title='Piano',
                               subject='piano', experience_family='music',
                               instrument='piano', version=1))
            session.add(LessonRevision(
                id='rev-1', lesson_id='lesson-1', version=1,
                manifest={'source_video': {'key': 'lessons/lesson-1/source.mp4',
                                           'mime': 'audio/wav', 'bytes': 1,
                                           'sha256': 'b' * 64}}))
            session.commit()
        wav = tmp_path / 'source.wav'
        harness.write_wav(wav, np.zeros(22050, dtype=np.float32), 22050, bit_depth=16)
        payload = wav.read_bytes()
        # Identical audio registered for a different lesson must not steal this
        # lesson's label/link when entering comparison from its review page.
        with Session(app.state.engine) as session:
            session.add(PianoComparisonSource(
                id='another-recording', owner_id=owner(session).id,
                lesson_id='another-lesson', label='Other recording', path=str(wav),
                sha256=__import__('hashlib').sha256(payload).hexdigest(), seconds=1.0))
            session.commit()
        class Body:
            def read(self): return payload
        class Store:
            def get_object(self, **kwargs): return {'Body': Body()}
        monkeypatch.setattr(api_module, 'storage_client', lambda settings: Store())
        response = client.post('/api/piano-comparisons/sources',
                               json={'lesson_id': 'lesson-1'})
        assert response.status_code == 200, response.text
        source = response.json()
        assert source['lesson_id'] == 'lesson-1'
        assert source['id'] != 'another-recording'
        repeated = client.post('/api/piano-comparisons/sources', json={'lesson_id': 'lesson-1'})
        assert repeated.json()['id'] == source['id']
        assert source['seconds'] == pytest.approx(1.0)
        with Session(app.state.engine) as session:
            row = session.get(PianoComparisonSource, source['id'])
            assert Path(row.path).is_file()
            assert row.sha256 == __import__('hashlib').sha256(payload).hexdigest()


def test_registering_a_lesson_without_a_source_is_refused(tmp_path):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        with Session(app.state.engine) as session:
            session.add(Lesson(id='lesson-2', owner_id=owner(session).id, title='Piano',
                               subject='piano', experience_family='music',
                               instrument='piano', version=1))
            session.commit()
        response = client.post('/api/piano-comparisons/sources',
                               json={'lesson_id': 'lesson-2'})
        assert response.status_code == 409


def test_new_unreviewed_upload_registers_its_own_draft_source(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        asset = {'key': 'lessons/new-upload/retained.mp4', 'mime': 'video/mp4'}
        with Session(app.state.engine) as session:
            owner_id = owner(session).id
            session.add(Lesson(id='new-upload', owner_id=owner_id, title='New river recording',
                               subject='piano', experience_family='music', instrument='piano', version=1))
            session.flush()
            session.add(MusicDraft(id='new-draft', job_id='new-job', lesson_id='new-upload',
                                   owner_id=owner_id, subject='piano', instrument='piano',
                                   status='draft', document={'source_video': asset}))
            session.commit()
        expected_path = tmp_path / 'frozen.wav'
        captured = []
        def freeze(settings, actual):
            captured.append(actual)
            return expected_path, 'c' * 64, 209.594
        monkeypatch.setattr(api_module, '_freeze_retained_source', freeze)
        response = client.post('/api/piano-comparisons/sources', json={'lesson_id': 'new-upload'})
        assert response.status_code == 200, response.text
        assert captured == [asset]
        assert response.json()['lesson_id'] == 'new-upload'
        assert response.json()['seconds'] == 209.594


def test_results_are_unavailable_before_any_run_finishes(tmp_path, monkeypatch):
    with music_app(tmp_path) as system:
        client, app, settings, *_ = system
        add_source(tmp_path, app)
        monkeypatch.setattr(api_module, '_execute', lambda *args: None)
        view = create(client, ['kong-piano'])
        assert client.get(f"/api/piano-comparisons/{view['id']}/results").status_code == 409
