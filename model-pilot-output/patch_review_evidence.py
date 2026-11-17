from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}]}).encode(),",
"            'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}],\n            'review': {'reviewer_id': 'acct-1', 'reviewed_at': '2026-11-13T00:00:00Z',\n                       'draft_id': 'd1', 'source_reference_sha256': 'a' * 64}}).encode(),")
p.write_text(t, encoding='utf-8')
print('patched')
