from pathlib import Path
p = Path('tests/api/test_music_kong_adapter.py')
t = p.read_text(encoding='utf-8')
t = t.replace("        'est_pedal_events': None}", "        'est_pedal_events': [{'onset_time': 0.2, 'offset_time': 1.1}]}")
t = t.replace("    assert draft['piano_preview']['mime'] == 'audio/wav'", "    assert draft['piano_preview']['mime'] == 'audio/wav'\n    assert draft['pedal'] == [{'onset': 0.2, 'offset': 1.1, 'type': 'sustain'}]")
p.write_text(t, encoding='utf-8')
print('test patched')
