"""Deterministic guitar TAB solver, chord/strum detection and adapter merging."""
from __future__ import annotations

import pytest

from apps.api.music_notation import validate_notation
from scripts.guitar_tab_solver import (
    assign_guitar_tab,
    detect_guitar_chords_and_strums,
    enrich_events,
    open_strings,
    positions_for_pitch,
    strum_direction,
    validate_guitar_chord,
)
from scripts.music_guitar_adapter import merge_transcriptions

OPEN = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}


def event(onset: float, pitch: int) -> dict:
    return {'id': f'n-{onset}-{pitch}', 'onset': onset, 'duration': 0.25, 'pitch': pitch,
            'velocity': 0.8, 'confidence': None, 'optional': False}


def test_open_strings_are_assigned_to_their_own_string() -> None:
    events = [event(index * 0.3, pitch) for index, pitch in enumerate([40, 45, 50, 55, 59, 64])]
    tabbed = assign_guitar_tab(events)
    assert [(item['string'], item['fret']) for item in tabbed] == [(6, 0), (5, 0), (4, 0), (3, 0), (2, 0), (1, 0)]
    for item in tabbed:
        assert OPEN[item['string']] + item['fret'] == item['pitch']


def test_a_pitch_offers_every_playable_string_and_none_outside_the_neck() -> None:
    options = positions_for_pitch(64)
    assert (1, 0) in options
    assert (2, 5) in options
    assert all(0 <= fret <= 24 for _, fret in options)
    assert positions_for_pitch(127) == []


def test_simultaneous_chord_notes_use_distinct_strings_within_four_frets() -> None:
    chord = [event(0.0, pitch) for pitch in (48, 52, 55)]
    tabbed = assign_guitar_tab(chord)
    strings = [item['string'] for item in tabbed]
    assert len(set(strings)) == 3
    frets = [item['fret'] for item in tabbed if item['fret'] > 0]
    assert frets and max(frets) - min(frets) <= 3
    for item in tabbed:
        assert OPEN[item['string']] + item['fret'] == item['pitch']


def test_unplayable_pitch_is_left_unpositioned_instead_of_crashing() -> None:
    tabbed = assign_guitar_tab([event(0, 127)])
    assert tabbed[0]['string'] is None and tabbed[0]['fret'] is None


def test_detects_a_strummed_chord_and_its_direction() -> None:
    events = [event(0.0, 48), event(0.01, 52), event(0.02, 55)]
    tabbed = assign_guitar_tab(events)
    assert strum_direction(tabbed) in ('down', 'up')
    chords = detect_guitar_chords_and_strums(tabbed, 2.0)
    assert len(chords) == 1
    chord = chords[0]
    assert chord['name'] == 'C'
    assert len(chord['frets']) == 6
    assert chord['start'] == 0.0
    assert 1 <= chord['position'] <= 24
    validate_guitar_chord(chord)


def test_low_to_high_is_a_downstroke_and_high_to_low_an_upstroke() -> None:
    down = [{'onset': 0, 'pitch': 40, 'string': 6}, {'onset': 0.01, 'pitch': 45, 'string': 5},
            {'onset': 0.02, 'pitch': 50, 'string': 4}]
    up = [{'onset': 0, 'pitch': 50, 'string': 4}, {'onset': 0.01, 'pitch': 45, 'string': 5},
          {'onset': 0.02, 'pitch': 40, 'string': 6}]
    assert strum_direction(down) == 'down'
    assert strum_direction(up) == 'up'


def test_a_single_note_is_not_a_chord() -> None:
    tabbed = assign_guitar_tab([event(0, 64), event(0.5, 65)])
    assert detect_guitar_chords_and_strums(tabbed, 2.0) == []


def test_chord_contract_rejects_unplayable_shapes() -> None:
    with pytest.raises(ValueError):
        validate_guitar_chord({'id': 'x', 'name': 'C', 'start': 0, 'frets': [-1, -1, -1, -1, -1, -1], 'position': 1})
    with pytest.raises(ValueError):
        validate_guitar_chord({'id': 'x', 'name': 'C', 'start': 0, 'frets': [1, 8, 1, 1, 1, 1], 'position': 1})
    with pytest.raises(ValueError):
        validate_guitar_chord({'id': 'x', 'name': 'C', 'start': 0, 'frets': [-1, 3, 2, 0, 1, 0], 'position': 30})


def test_enrich_events_returns_positions_and_valid_chords() -> None:
    events = [event(0.0, 48), event(0.01, 52), event(0.02, 55), event(0.5, 64)]
    tabbed, chords = enrich_events(events, 2.0)
    assert all(item['string'] is not None for item in tabbed)
    assert chords and all(len(chord['frets']) == 6 for chord in chords)


def test_merge_keeps_riley_timing_and_adds_missed_basic_pitch_notes() -> None:
    riley = [{'onset': 0.1, 'duration': 0.2, 'pitch': 64, 'velocity': 0.8, 'confidence': None},
             {'onset': 0.5, 'duration': 0.2, 'pitch': 67, 'velocity': 0.8, 'confidence': None}]
    basic = [{'onset': 0.1, 'duration': 0.2, 'pitch': 65, 'velocity': 0.7, 'confidence': None},
             {'onset': 0.8, 'duration': 0.2, 'pitch': 72, 'velocity': 0.6, 'confidence': None}]
    merged = merge_transcriptions(riley, basic)
    assert len(merged) == 3
    assert merged[0]['onset'] == 0.1 and merged[0]['pitch'] == 65
    assert any(item['pitch'] == 72 for item in merged)
    assert [item['id'] for item in merged] == ['guitar-1', 'guitar-2', 'guitar-3']


def test_open_strings_accepts_names_and_rejects_invalid_values() -> None:
    assert open_strings('drop_d')[6] == 38
    assert open_strings('dadgad')[1] == 62
    assert open_strings((38, 45, 50, 55, 59, 64))[6] == 38
    for invalid in ('bogus', True, {'tuning': 'standard'}, ['standard'], [40, 45, 50, 55, 59]):
        with pytest.raises(ValueError):
            open_strings(invalid)
    with pytest.raises(ValueError):
        open_strings([40, 45, 50, 55, 59, True])


def test_validate_notation_rejects_bad_tuning_types_with_value_error() -> None:
    for document in (
        {'notation_version': 1, 'subject': 'guitar', 'guitar_tuning': ['standard']},
        {'notation_version': 1, 'subject': 'guitar', 'guitar_capo': {'value': 2}},
        {'notation_version': 1, 'subject': 'guitar', 'guitar_tuning': True},
        {'notation_version': 1, 'subject': 'piano', 'guitar_tuning': 'drop_d'},
    ):
        with pytest.raises(ValueError):
            validate_notation(document, [], 1.0)


def test_fixture_guitar_draft_carries_tab_positions(tmp_path) -> None:
    from scripts.music_transcription import fixture_document
    audio = tmp_path / 'analysis.wav'
    audio.write_bytes(b'RIFF-guitar-fixture')
    document = fixture_document({'duration': 2, 'subject': 'guitar', 'instrument': 'guitar'}, audio)
    assert document['subject'] == 'guitar'
    assert document['guitar_chords'] == []
    assert all(event['string'] is not None and event['fret'] is not None for event in document['events'])
    for event in document['events']:
        assert OPEN[event['string']] + event['fret'] == event['pitch']
