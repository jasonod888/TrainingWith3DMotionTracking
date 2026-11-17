from pathlib import Path
p = Path('tests/api/test_music_kong_adapter.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    assert entry['renderer'] == 'additive-reference-1'", "    assert entry['renderer'] == 'additive-reference-1'\n    assert len(entry['preview_identity']) == 64\n    draft['preview_identity'] = entry['preview_identity']\n    MusicDraftDocument.model_validate(draft)")
p.write_text(t, encoding='utf-8')
print('test')
