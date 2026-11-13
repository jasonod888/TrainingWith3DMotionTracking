"""Package 2: raw outputs are conserved and their semantics are never relabelled."""
import json
from pathlib import Path

import numpy as np
import pytest

import scripts.piano_model_adapters as adapters
import scripts.piano_model_registry as registry_module
import scripts.piano_performance as performance
import scripts.piano_reconstruction_harness as harness

ROOT = Path(__file__).resolve().parents[2]
SOURCE = {'sha256': 'a' * 64, 'duration_seconds': 2.0, 'sample_rate': 22050,
          'channels': 1}


def entry(name):
    return registry_module.variant(registry_module.build(), name)


def bp_notes():
    return [{'id': 'bp-1', 'pitch': 60, 'onset_seconds': 0.2, 'offset_seconds': 0.7,
             'amplitude': 0.42},
            {'id': 'bp-2', 'pitch': 64, 'onset_seconds': 0.9, 'offset_seconds': 1.4,
             'amplitude': 0.31}]


def kong_notes():
    return [{'id': 'kong-1', 'pitch': 61, 'onset_seconds': 0.25, 'offset_seconds': 0.8,
             'velocity': 83},
            {'id': 'kong-2', 'pitch': 65, 'onset_seconds': 1.0, 'offset_seconds': 1.5,
             'velocity': 110}]


def canonical(name, notes, **kwargs):
    return adapters.canonicalise(entry(name), notes, source=SOURCE, duration=2.0, **kwargs)


def test_basic_pitch_field_manifest_never_claims_velocity():
    fields = adapters.field_manifest(entry('basic-pitch-native'))['fields']
    assert fields['velocity_midi']['status'] == 'amplitude_proxy'
    assert fields['velocity_midi']['units'] is None
    assert fields['key_release']['status'] == 'not_estimated'
    assert fields['audible_end']['status'] == 'not_estimated'
    assert fields['pedal']['status'] == 'none'
    assert fields['written_duration']['status'] == 'not_estimated'


def test_kong_field_manifest_declares_model_estimated_velocity_and_pedal():
    fields = adapters.field_manifest(entry('kong-piano'))['fields']
    assert fields['velocity_midi']['status'] == 'model_estimated'
    assert fields['velocity_midi']['units'] == 'midi_1_127'
    assert fields['pedal']['status'] == 'native_trajectory'
    assert fields['pedal']['types'] == ['sustain']


def test_basic_pitch_canonical_document_keeps_amplitude_out_of_velocity():
    result = canonical('basic-pitch-native', bp_notes())
    document = result['document']
    performance.validate(document)
    assert len(document['notes']) == 2
    for note in document['notes']:
        assert note['velocity_midi'] is None
        assert note['velocity_provenance']['kind'] == 'amplitude_proxy'
        assert note['key_release_seconds'] is None
        assert note['audible_end'] is None
    native = result['native']
    assert native['offset_convention'] == 'basic-pitch-native/offset'
    assert [event['amplitude'] for event in native['events']] == [0.42, 0.31]
    assert [event['offset_seconds'] for event in native['events']] == [0.7, 1.4]
    assert result['counts'] == {'notes': 2, 'dropped_outside_interval': 0,
                                'offset_beyond_interval': 0, 'pedal_spans': 0}


def test_kong_canonical_document_keeps_model_velocity_and_pedal_spans():
    result = canonical('kong-piano', kong_notes(),
                       pedal_spans=[{'onset_seconds': 0.3, 'offset_seconds': 1.2}])
    document = result['document']
    performance.validate(document)
    assert [note['velocity_midi'] for note in document['notes']] == [83, 110]
    assert document['notes'][0]['velocity_provenance']['kind'] == 'model_estimated'
    assert [event['value'] for event in document['pedal']] == [1.0, 0.0]
    assert result['native']['pedal']['status'] == 'native_trajectory'
    assert result['native']['pedal']['spans'] == [{'onset_seconds': 0.3,
                                                   'offset_seconds': 1.2}]


def test_wrong_units_are_rejected_not_relabelled():
    with pytest.raises(adapters.AdapterError, match='amplitude proxy is not MIDI velocity'):
        canonical('basic-pitch-native', [{'id': 'x', 'pitch': 60, 'onset_seconds': 0.1,
                                          'offset_seconds': 0.4, 'velocity': 90}])
    with pytest.raises(adapters.AdapterError, match='needs a MIDI velocity'):
        canonical('kong-piano', [{'id': 'x', 'pitch': 60, 'onset_seconds': 0.1,
                                  'offset_seconds': 0.4, 'amplitude': 0.5}])


def test_amplitude_out_of_range_is_rejected():
    with pytest.raises(adapters.AdapterError, match='within 0..1'):
        canonical('basic-pitch-native', [{'id': 'x', 'pitch': 60,
                                          'onset_seconds': 0.1,
                                          'offset_seconds': 0.4, 'amplitude': 1.4}])


def test_duplicate_and_invalid_times_are_rejected():
    with pytest.raises(adapters.AdapterError, match='duplicate native event id'):
        canonical('basic-pitch-native', [bp_notes()[0], dict(bp_notes()[0])])
    with pytest.raises(adapters.AdapterError, match='offset precedes onset'):
        canonical('basic-pitch-native', [{'id': 'x', 'pitch': 60,
                                          'onset_seconds': 0.5,
                                          'offset_seconds': 0.4, 'amplitude': 0.2}])


def test_events_outside_the_interval_are_dropped_and_counted():
    notes = bp_notes() + [{'id': 'late', 'pitch': 67, 'onset_seconds': 2.5,
                           'offset_seconds': 2.9, 'amplitude': 0.2}]
    result = canonical('basic-pitch-native', notes)
    assert result['counts']['dropped_outside_interval'] == 1
    assert result['native']['note_count'] == 2


def test_a_silent_model_result_is_an_error_not_an_empty_success():
    with pytest.raises(adapters.AdapterError, match='no events inside'):
        canonical('basic-pitch-native', [])


def test_conservation_detects_a_changed_pitch():
    result = canonical('basic-pitch-native', bp_notes())
    result['document']['notes'][0]['pitch_midi'] = 61
    with pytest.raises(adapters.ConservationError, match='pitch changed'):
        adapters.verify_conservation(result['document'], result['native'])


def test_conservation_detects_a_shifted_onset():
    result = canonical('basic-pitch-native', bp_notes())
    result['document']['notes'][0]['onset_seconds'] += 0.001
    with pytest.raises(adapters.ConservationError, match='onset changed'):
        adapters.verify_conservation(result['document'], result['native'])


def test_conservation_detects_amplitude_becoming_velocity():
    result = canonical('basic-pitch-native', bp_notes())
    result['document']['notes'][0]['velocity_midi'] = 42
    with pytest.raises(adapters.ConservationError, match='amplitude became a MIDI velocity'):
        adapters.verify_conservation(result['document'], result['native'])


def test_conservation_detects_a_lost_pedal_span():
    result = canonical('kong-piano', kong_notes(),
                       pedal_spans=[{'onset_seconds': 0.3, 'offset_seconds': 1.2}])
    result['document']['pedal'].pop()
    with pytest.raises(adapters.ConservationError, match='pedal events do not match'):
        adapters.verify_conservation(result['document'], result['native'])


def test_prepared_audio_is_deterministic_mono_and_resampled(tmp_path):
    rate = 44100
    samples = np.zeros((rate, 2), dtype=np.float32)
    samples[:, 0] = 0.25
    samples[:, 1] = -0.25
    source = tmp_path / 'source.wav'
    harness.write_wav(source, samples, rate, bit_depth=16)
    first = adapters.prepare_audio(source, tmp_path / 'prepared.wav',
                                   interval=[0.0, 1.0], sample_rate=22050)
    digest = first['sha256']
    second = adapters.prepare_audio(source, tmp_path / 'prepared.wav',
                                    interval=[0.0, 1.0], sample_rate=22050)
    assert second['sha256'] == digest
    assert first['channels'] == 1 and first['sample_rate'] == 22050
    assert first['frames'] == 22050
    assert 'resample-poly:44100->22050' in first['conversion']['rules']
    assert 'downmix-to-mono' in first['conversion']['rules']


def test_prepared_audio_trims_the_declared_interval(tmp_path):
    source = tmp_path / 'source.wav'
    harness.write_wav(source, np.zeros((16000, 1), dtype=np.float32), 16000, bit_depth=16)
    info = adapters.prepare_audio(source, tmp_path / 'prepared.wav',
                                  interval=[0.5, 1.0], sample_rate=16000)
    assert info['frames'] == 8000
    assert info['seconds'] == pytest.approx(0.5)
    assert info['conversion']['interval'] == [0.5, 1.0]


def test_run_refuses_a_blocked_variant(tmp_path):
    with pytest.raises(adapters.AdapterError, match='not runnable'):
        adapters.run(entry('transkun-v2'), tmp_path / 'x.wav', [0.0, 1.0],
                     tmp_path / 'out')


def test_field_manifest_round_trips_through_json():
    manifest = adapters.field_manifest(entry('kong-piano'))
    assert json.loads(json.dumps(manifest))['schema'] == adapters.SCHEMA_FIELDS
