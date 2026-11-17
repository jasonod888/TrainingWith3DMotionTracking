from pathlib import Path
p = Path('apps/api/music_review.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            pedal=proposal.pedal,", "            pedal=proposal.pedal,\n            preview_identity=proposal.preview_identity,")
p.write_text(t, encoding='utf-8')
print('review')
