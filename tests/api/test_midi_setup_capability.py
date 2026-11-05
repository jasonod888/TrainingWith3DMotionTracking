from test_music_conversions import music_app


def test_keyboard_setup_is_off_by_default_and_never_enables_music_processing(tmp_path):
    for enabled in (False,True):
        with music_app(tmp_path/str(enabled),music_piano_conversion_provider='disabled',
                       music_guitar_conversion_provider='disabled',music_midi_setup_enabled=enabled) as (client,*_):
            capabilities=client.get('/api/capabilities').json()
            assert capabilities['music_midi_setup'] is enabled
            assert capabilities['processing']['music_piano'] is False
            assert capabilities['processing']['music_guitar'] is False
