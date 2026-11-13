"""The performance document keeps every target distinct and never invents a measurement."""
import math

import pytest

import scripts.piano_performance as performance

SOURCE = {'sha256': 'a' * 64, 'duration_seconds': 12.5, 'sample_rate': 44100, 'channels': 2}
OUTPUT = {'sample_rate': 48000, 'channels': 2, 'tail_seconds': 2.0}


def document():
    return performance.new_document(performance_id='perf-1', source=SOURCE)


def note(**overrides):
    payload = {'note_id': 'n1', 'pitch_midi': 60, 'onset_seconds': 0.5}
    payload.update(overrides)
    return payload


def test_new_document_is_valid_and_leaves_unknowns_unknown():
    built = document()
    performance.validate(built)
    assert built['notes'] == [] and built['pedal'] == []
    assert built['timeline'] == {'origin': 'source_start', 'sample_rate': 44100}
    assert built['sound_model']['renderer'] is None


def test_add_note_records_only_what_was_measured():
    built = document()
    stored = performance.add_note(built, **note())
    assert stored['key_release_seconds'] is None
    assert stored['velocity_midi'] is None
    assert stored['audible_end'] is None
    assert stored['written'] is None
    assert stored['legacy'] is None


def test_legacy_events_are_not_reinterpreted_as_release_or_velocity():
    events = [{'id': 'a', 'onset': 0.25, 'duration': 0.75, 'pitch': 64, 'velocity': 0.42}]
    built = performance.from_legacy_events(events, source=SOURCE, performance_id='legacy-1')
    stored = built['notes'][0]
    assert stored['key_release_seconds'] is None
    assert stored['velocity_midi'] is None
    assert stored['legacy'] == {'duration_seconds': 0.75, 'velocity_amplitude': 0.42,
                                'semantics': 'legacy-not-release'}
    assert built['provenance']['origin'] == 'legacy'


def test_note_off_uses_measured_release_then_documented_estimate():
    release, estimated = performance.note_off_seconds({'onset_seconds': 1.0,
                                                       'key_release_seconds': 1.4})
    assert (release, estimated) == (1.4, False)

    legacy = {'onset_seconds': 1.0, 'key_release_seconds': None,
              'legacy': {'duration_seconds': 0.5}}
    assert performance.note_off_seconds(legacy) == (1.5, True)

    bare = {'onset_seconds': 1.0, 'key_release_seconds': None, 'legacy': None}
    with pytest.raises(performance.PerformanceError, match='must be chosen explicitly'):
        performance.note_off_seconds(bare)


def test_unknown_fields_are_rejected_at_every_level():
    built = document()
    built['notes'].append({'id': 'n1', 'pitch_midi': 60, 'onset_seconds': 0.0,
                           'key_release_seconds': None, 'release_provenance': None,
                           'audible_end': None, 'velocity_midi': None,
                           'velocity_provenance': None, 'render_intensity': None,
                           'written': None, 'legacy': None, 'tags': [],
                           'duration_seconds': 0.4})
    with pytest.raises(performance.PerformanceError, match='unknown field'):
        performance.validate(built)

    built = document()
    built['notes'].append({'id': 'n1', 'pitch_midi': 60, 'onset_seconds': 0.0,
                           'key_release_seconds': None, 'release_provenance': None,
                           'audible_end': None, 'velocity_midi': None,
                           'velocity_provenance': None, 'render_intensity': None,
                           'written': {'duration_ticks': 480, 'duration_seconds': 0.4},
                           'legacy': None, 'tags': []})
    with pytest.raises(performance.PerformanceError, match='unknown field'):
        performance.validate(built)


def test_a_missing_required_field_is_rejected():
    built = document()
    built['notes'].append({'id': 'n1', 'pitch_midi': 60, 'onset_seconds': 0.0})
    with pytest.raises(performance.PerformanceError, match='missing required field'):
        performance.validate(built)


@pytest.mark.parametrize('overrides,message', [
    ({'pitch_midi': 128}, 'pitch_midi'),
    ({'pitch_midi': -1}, 'pitch_midi'),
    ({'pitch_midi': True}, 'pitch_midi'),
    ({'pitch_midi': 60.5}, 'pitch_midi'),
    ({'onset_seconds': -0.1}, 'onset_seconds'),
    ({'onset_seconds': math.inf}, 'onset_seconds'),
    ({'onset_seconds': math.nan}, 'onset_seconds'),
    ({'velocity_midi': 0}, 'velocity_midi'),
    ({'velocity_midi': 128}, 'velocity_midi'),
    ({'render_intensity': 1.5}, 'render_intensity'),
])
def test_note_ranges_are_enforced(overrides, message):
    built = document()
    with pytest.raises(performance.PerformanceError, match=message):
        performance.add_note(built, **note(**overrides))


def test_key_release_must_follow_the_onset():
    built = document()
    with pytest.raises(performance.PerformanceError, match='after the onset'):
        performance.add_note(built, **note(onset_seconds=1.0, key_release_seconds=1.0))


def test_audible_end_interval_rules():
    built = document()
    with pytest.raises(performance.PerformanceError, match='needs an interval'):
        performance.add_note(built, **note(audible_end={'earliest': None, 'latest': None,
                                                        'status': 'scorable'}))
    with pytest.raises(performance.PerformanceError, match='both be set or both be null'):
        performance.add_note(built, **note(audible_end={'earliest': 1.0, 'latest': None,
                                                        'status': 'uncertain'}))
    with pytest.raises(performance.PerformanceError, match='cannot precede the onset'):
        performance.add_note(built, **note(onset_seconds=1.0,
                                           audible_end={'earliest': 0.5, 'latest': 1.2,
                                                        'status': 'scorable'}))
    with pytest.raises(performance.PerformanceError, match='latest must not precede'):
        performance.add_note(built, **note(onset_seconds=0.0,
                                           audible_end={'earliest': 2.0, 'latest': 1.0,
                                                        'status': 'scorable'}))
    performance.add_note(built, **note(audible_end={'earliest': 2.0, 'latest': 2.6,
                                                    'status': 'scorable'}))
    assert built['notes'][0]['audible_end']['status'] == 'scorable'


def test_duplicate_identifiers_are_rejected():
    built = document()
    performance.add_note(built, **note(note_id='same'))
    with pytest.raises(performance.PerformanceError, match='duplicate note id'):
        performance.add_note(built, **note(note_id='same', onset_seconds=1.0))

    performance.add_pedal(built, pedal_id='p1', pedal_type='sustain',
                          onset_seconds=0.0, value=1.0)
    with pytest.raises(performance.PerformanceError, match='duplicate pedal id'):
        performance.add_pedal(built, pedal_id='p1', pedal_type='sustain',
                              onset_seconds=0.5, value=0.0)


def test_pedal_contract():
    built = document()
    with pytest.raises(performance.PerformanceError, match='unsupported pedal'):
        performance.add_pedal(built, pedal_id='p1', pedal_type='harmonic',
                              onset_seconds=0.0, value=0.5)
    with pytest.raises(performance.PerformanceError, match='value'):
        performance.add_pedal(built, pedal_id='p1', pedal_type='sustain',
                              onset_seconds=0.0, value=1.5)
    performance.add_pedal(built, pedal_id='p1', pedal_type='soft',
                          onset_seconds=0.2, value=0.0, confidence=0.9)
    assert built['pedal'][0]['confidence'] == 0.9


def test_written_notation_is_ticks_and_never_seconds():
    built = document()
    performance.add_note(built, **note(written={'duration_ticks': 480, 'voice': 2, 'tie': True}))
    assert built['notes'][0]['written']['duration_ticks'] == 480
    with pytest.raises(performance.PerformanceError, match='duration_ticks'):
        performance.add_note(document(), **note(written={'duration_ticks': 0}))


def test_legacy_block_requires_the_not_release_label():
    built = document()
    with pytest.raises(performance.PerformanceError, match='legacy-not-release'):
        performance.add_note(built, **note(legacy={'duration_seconds': 0.3,
                                                   'velocity_amplitude': 0.5,
                                                   'semantics': 'physical-release'}))


def test_semantics_version_mismatch_is_rejected_not_migrated():
    built = document()
    built['semantics_version'] = 'piano-performance-semantics-2'
    with pytest.raises(performance.PerformanceError, match='unsupported semantics'):
        performance.validate(built)


def test_source_identity_is_validated():
    broken = dict(SOURCE, sha256='not-a-hash')
    with pytest.raises(performance.PerformanceError, match='hex digest'):
        performance.new_document(performance_id='p', source=broken)
    with pytest.raises(performance.PerformanceError, match='positive'):
        performance.new_document(performance_id='p', source=dict(SOURCE, duration_seconds=0))


def test_document_hash_covers_provenance():
    built = document()
    first = performance.document_sha256(built)
    built['provenance']['notes'].append('audit note')
    assert performance.document_sha256(built) != first


def test_json_round_trip_preserves_every_field():
    built = document()
    performance.add_note(built, **note(key_release_seconds=0.9, velocity_midi=72,
                                       render_intensity=0.4,
                                       written={'duration_ticks': 240},
                                       velocity_provenance={'method': 'model',
                                                            'uncertainty': 0.2}))
    performance.add_pedal(built, pedal_id='p1', pedal_type='sustain',
                          onset_seconds=0.1, value=1.0)
    text = performance.to_json(built)
    restored = performance.from_json(text)
    assert restored == built
    assert performance.document_sha256(restored) == performance.document_sha256(built)


def test_notes_active_at_does_not_invent_a_release():
    built = document()
    performance.add_note(built, **note(note_id='known', onset_seconds=0.0,
                                       key_release_seconds=1.0))
    performance.add_note(built, **note(note_id='unknown', onset_seconds=0.0,
                                       key_release_seconds=None))
    active = performance.notes_active_at(built, 0.5)
    assert [item['id'] for item in active] == ['known']
