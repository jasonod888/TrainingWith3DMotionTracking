import sqlite3, json
c = sqlite3.connect('model-pilot-output/review-browser/review.db')
row = c.execute("select manifest from lesson_revisions where id='r1'").fetchone()
m = json.loads(row[0])
print({k: m.get(k) for k in ('playback', 'piano_preview', 'source_video')})
