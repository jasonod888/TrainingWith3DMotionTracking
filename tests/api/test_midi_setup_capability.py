from test_music_conversions import music_app


def test_keyboard_setup_is_off_by_default_and_never_enables_music_processing(tmp_path):
    for enabled in (False,True):
        with music_app(tmp_path/str(enabled),music_piano_conversion_provider='disabled',
                       music_guitar_conversion_provider='disabled',music_midi_setup_enabled=enabled) as (client,*_):
            capabilities=client.get('/api/capabilities').json()
            assert capabilities['music_midi_setup'] is enabled
            assert capabilities['processing']['music_piano'] is False
            assert capabilities['processing']['music_guitar'] is False


def test_instrument_drawing_flags_are_independent_and_do_not_enable_inputs_or_processing(tmp_path):
    for piano,guitar in ((False,False),(True,False),(False,True)):
        with music_app(tmp_path/f'{piano}-{guitar}',music_piano_conversion_provider='disabled',
                music_guitar_conversion_provider='disabled',music_piano_library_ui_enabled=piano,
                music_guitar_library_ui_enabled=guitar) as (client,*_):
            value=client.get('/api/capabilities').json()
            assert value['music_piano_library_ui'] is piano
            assert value['music_guitar_library_ui'] is guitar
            assert value['music_midi_setup'] is False and value['music_history'] is False
            assert value['processing']['music_piano'] is False and value['processing']['music_guitar'] is False
