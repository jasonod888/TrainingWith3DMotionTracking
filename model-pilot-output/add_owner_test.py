from pathlib import Path
p = Path('tests/api/test_music_playback_settings.py')
t = p.read_text(encoding='utf-8')
t = t.replace("from test_music_conversions import music_app", "from test_accounts import login, register\nfrom test_music_conversions import music_app")
t += """

def test_playback_offset_is_owner_only(tmp_path):
    with music_app(tmp_path) as system:
        client, app, _settings, _store, mail, *_ = system
        seed(app)
        register(client, mail, email='other@example.test')
        login(client, email='other@example.test')
        response = client.patch('/api/lessons/lesson-1/music-draft/playback',
                                json={'sync_offset_seconds': 0.1, 'revision': 1})
        assert response.status_code == 404
"""
p.write_text(t, encoding='utf-8')
print('patched')
