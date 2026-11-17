from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("                    'source_video': source_asset, 'piano_preview': preview_asset,\n                    'playback': {'sync_offset_seconds': 0.0, 'revision': 1}, 'warnings': []}",
"                    'source_video': source_asset, 'piano_preview': preview_asset,\n                    'playback': {'sync_offset_seconds': 0.12, 'revision': 2}, 'warnings': []}")
p.write_text(t, encoding='utf-8')
print('patched')
