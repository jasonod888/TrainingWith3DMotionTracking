"""Attack decoding regressions. Run with the optional Basic Pitch environment."""
import numpy as np
import pytest

pytest.importorskip('basic_pitch')
from scripts.music_basic_pitch_adapter import decode_predictions, note_events, DEFAULT_DECODING, PIANO_DECODING

THRESHOLDS = {'onset_threshold': .6, 'frame_threshold': .3, 'minimum_note_length': 80,
              'onset_prominence': .2, 'minimum_attack_spacing_ms': 70}
DECODING = {**DEFAULT_DECODING, 'decoding_version': PIANO_DECODING, 'infer_onsets': False}


def prediction(pitches=(60,), attacks=(20,)):
    raw = {'onset': np.zeros((160, 88), dtype=np.float32),
           'note': np.zeros((160, 88), dtype=np.float32),
           'contour': np.zeros((160, 264), dtype=np.float32)}
    for pitch in pitches:
        raw['note'][20:130, pitch - 21] = .7
        for attack in attacks: raw['onset'][attack, pitch - 21] = .85
    return raw


def test_repeated_strikes_survive_continuously_ringing_note():
    raw = prediction(attacks=(20, 50, 80))
    _, notes = decode_predictions(raw, THRESHOLDS, DECODING)
    assert len(notes) == 3
    assert all(n[2] == 60 for n in notes)


def test_chords_and_real_octaves_are_independent():
    _, notes = decode_predictions(prediction((48, 60, 64, 67, 72)), THRESHOLDS, DECODING)
    assert sorted(n[2] for n in notes) == [48, 60, 64, 67, 72]


def test_activation_rise_without_new_attack_does_not_create_a_note():
    raw = prediction()
    raw['note'][50:80, 39] = .95
    _, notes = decode_predictions(raw, THRESHOLDS, DECODING)
    assert len(notes) == 1


def test_close_maxima_of_one_attack_do_not_create_duplicate_strikes():
    raw = prediction(attacks=(20, 24))
    raw['onset'][24, 39] = .95
    _, notes = decode_predictions(raw, THRESHOLDS, DECODING)
    assert len(notes) == 1


def test_shallow_onset_hump_is_not_an_attack():
    raw = prediction()
    raw['onset'][45:85, 39] = .59
    raw['onset'][65, 39] = .65
    _, notes = decode_predictions(raw, THRESHOLDS, DECODING)
    assert len(notes) == 1


def test_decoding_preserves_raw_predictions_and_is_reproducible():
    raw = prediction(); before = {k: v.copy() for k, v in raw.items()}
    first = decode_predictions(raw, THRESHOLDS, DECODING)[1]
    second = decode_predictions(raw, THRESHOLDS, DECODING)[1]
    assert first == second
    assert all(np.array_equal(raw[k], v) for k, v in before.items())


def test_legacy_decoder_remains_available_and_empty_audio_is_valid():
    raw = prediction()
    legacy = decode_predictions(raw, THRESHOLDS, DEFAULT_DECODING)[1]
    assert legacy
    for value in raw.values(): value.fill(0)
    assert decode_predictions(raw, THRESHOLDS, DECODING)[1] == []


def test_piano_mode_refuses_to_reintroduce_inferred_attacks():
    with pytest.raises(ValueError, match='explicit onsets'):
        decode_predictions(prediction(), THRESHOLDS, {**DECODING, 'infer_onsets': True})


def test_events_remain_inside_clip_even_for_a_short_final_note():
    events = note_events([(0.998, 1.2, 60, .7), (-.01, .2, 64, .5), (2, 3, 67, .4)], 1.)
    assert len(events) == 2
    assert all(0 <= e['onset'] < 1 and e['onset'] + e['duration'] <= 1.00001 for e in events)
