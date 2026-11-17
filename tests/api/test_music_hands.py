from apps.api.config import Settings
from apps.api.contracts import MusicEvent
from apps.api import music_hands
from apps.api.music_hands import model_status, run_model
from apps.api.music_notation import _validate_hand_metadata, validate_notation
from test_music_edit import _notation_for


def events():
    return [MusicEvent(id='a', onset=0.0, duration=0.5, pitch=36),
            MusicEvent(id='b', onset=1.0, duration=0.5, pitch=84)]


def test_backend_fingerprint_matches_canonical_compact_recipe():
    from apps.api.music_hands import hand_fingerprint
    assert hand_fingerprint(events()) == (
        'ph1:43190c888ac6872a7f2ee5482d2a7455067c7e53240f21802aee16fdc3ffe01a'
    )


def test_hand_metadata_validation_accepts_manual_and_automatic_entries():
    _validate_hand_metadata({
        'hand_assignment_version': 1,
        'hand_assignments': {
            'a': {'hand': 'left', 'source': 'manual', 'confidence': 'clear', 'manual': True},
            'b': {'hand': 'right', 'source': 'baseline', 'confidence': 'ambiguous', 'manual': False,
                  'fingerprint': 'ph1:' + 'a' * 64},
        },
    }, {'a', 'b'})


def test_hand_metadata_validation_rejects_orphans_and_invalid_automatic_entries():
    import pytest
    for assignments in (
        {'missing': {'hand': 'left', 'source': 'manual', 'confidence': 'clear', 'manual': True}},
        {'a': {'hand': 'left', 'source': 'midi2hands', 'confidence': 'clear', 'manual': False,
               'fingerprint': 'ph1:' + 'a' * 64}},
    ):
        with pytest.raises(ValueError):
            _validate_hand_metadata({'hand_assignment_version': 1, 'hand_assignments': assignments},
                                    {'a'})


def test_canonical_save_validator_preserves_valid_hand_metadata():
    from types import SimpleNamespace
    events = [
        {'id': 'a', 'onset': 0.0, 'duration': 0.5, 'pitch': 60, 'velocity': 0.5,
         'confidence': None, 'optional': False, 'string': None, 'fret': None},
        {'id': 'b', 'onset': 1.0, 'duration': 0.5, 'pitch': 64, 'velocity': 0.5,
         'confidence': None, 'optional': False, 'string': None, 'fret': None},
    ]
    notation = _notation_for(events, duration=2.0)
    notation['hand_assignment_version'] = 1
    notation['hand_assignments'] = {
        'a': {'hand': 'left', 'source': 'manual', 'confidence': 'clear', 'manual': True},
        'b': {'hand': 'right', 'source': 'hybrid', 'confidence': 'ambiguous', 'manual': False,
              'fingerprint': 'ph1:' + 'b' * 64,
              'model': {'name': 'midi2hands', 'version': '78e546b'}},
    }
    checked = validate_notation(notation, [
        SimpleNamespace(id='a', onset=0.0, duration=0.5, pitch=60, velocity=0.5, optional=False),
        SimpleNamespace(id='b', onset=1.0, duration=0.5, pitch=64, velocity=0.5, optional=False),
    ], 2.0)
    assert checked['hand_assignments']['a']['hand'] == 'left'
    assert checked['hand_assignments']['b']['source'] == 'hybrid'
    assert checked['hand_assignment_version'] == 1


def test_bounded_endpoint_serializes_real_predictions_without_a_database_fixture():
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from apps.api.music_hands import install_music_hands

    class FakeSession:
        def scalar(self, _statement):
            return SimpleNamespace(experience_family='music', instrument='piano', subject='piano')

    def fake_db():
        yield FakeSession()

    application = FastAPI()
    install_music_hands(application, Settings(), lambda: SimpleNamespace(id='owner'), fake_db)
    body = {'events': [{'id': 'a', 'onset': 0.0, 'duration': 0.5, 'pitch': 36},
                       {'id': 'b', 'onset': 1.0, 'duration': 0.5, 'pitch': 84}]}
    with TestClient(application) as client:
        response = client.post('/api/lessons/example/hand-estimates', json=body)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report['ok'] is True
    assert len(report['predictions']) == 2
    assert report['performance_fingerprint'] == (
        'ph1:43190c888ac6872a7f2ee5482d2a7455067c7e53240f21802aee16fdc3ffe01a'
    )


def test_model_status_and_real_bounded_adapter_operation_are_available():
    settings = Settings()
    status = model_status(settings)
    assert status['available'] is True
    assert status['model_sha256'] == '6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd'
    assert status['max_events'] == 20000
    disabled = model_status(Settings(hands_model_enabled=False))
    assert disabled['available'] is False
    result = run_model(settings, events())
    assert result['ok'] is True
    assert len(result['predictions']) == 2
    assert result['performance_fingerprint'].startswith('ph1:')


def test_model_cache_coalesces_and_copies_results(monkeypatch):
    import time
    from concurrent.futures import ThreadPoolExecutor

    calls = []

    def fake(settings, request_events):
        calls.append(len(request_events))
        time.sleep(0.08)
        return {'ok': True, 'performance_fingerprint': music_hands.hand_fingerprint(request_events),
                'predictions': [], 'model': {}}

    monkeypatch.setattr(music_hands, '_run_model_uncached', fake)
    music_hands.clear_model_cache()
    settings = Settings()
    first = run_model(settings, events())
    second = run_model(settings, events())
    assert calls == [2]
    assert first == second and first is not second, 'cache hits must be defensive copies'
    with ThreadPoolExecutor(max_workers=2) as pool:
        music_hands.clear_model_cache()
        results = list(pool.map(lambda _: run_model(settings, events()), range(2)))
    assert calls == [2, 2], 'same-input concurrent work must coalesce to one subprocess'
    assert results[0] == results[1]
    other = run_model(settings, [MusicEvent(id='c', onset=0, duration=.5, pitch=60)])
    assert calls[-1] == 1, 'different fingerprints must not share a cache entry'


def test_model_cpu_work_is_bounded_to_one_subprocess(monkeypatch):
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    active = 0
    maximum = 0
    lock = threading.Lock()

    def fake(settings, request_events):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        time.sleep(0.06)
        with lock:
            active -= 1
        return {'ok': True, 'performance_fingerprint': music_hands.hand_fingerprint(request_events),
                'predictions': [], 'model': {}}

    monkeypatch.setattr(music_hands, '_run_model_uncached', fake)
    music_hands.clear_model_cache()
    settings = Settings()
    distinct = [
        [MusicEvent(id='x', onset=0, duration=.5, pitch=60)],
        [MusicEvent(id='y', onset=1, duration=.5, pitch=64)],
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda request_events: run_model(settings, request_events), distinct))
    assert maximum == 1, 'the CPU adapter must have one bounded execution slot'


def test_2001_note_real_model_run_is_complete():
    settings = Settings()
    music_hands.clear_model_cache()
    notes = [MusicEvent(id=f'long-{index}', onset=index * 0.01, duration=0.1,
                        pitch=60 + (index % 12)) for index in range(2001)]
    result = run_model(settings, notes)
    assert result['ok'] is True
    assert len(result['predictions']) == 2001
    assert {note['id'] for note in result['predictions']} == {note.id for note in notes}
