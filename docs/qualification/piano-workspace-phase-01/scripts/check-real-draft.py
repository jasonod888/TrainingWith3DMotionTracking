"""Phase 1 check: is the real 209.6 s / 1,338-note draft reachable through the real API?

Read-only. Authenticates as the local UI-test owner, then requests the draft through the
Vite proxy exactly as the browser does. Prints counts and a structural summary only; it
writes no production data and never prints credentials.
"""
import http.cookiejar
import json
import urllib.request

BASE = 'http://127.0.0.1:5173'
LESSON = '0df28929d427406cb86d9bb5e2dcd35b'

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
login = urllib.request.Request(BASE + '/api/auth/login',
    data=json.dumps({'email': 'owner@ui.test', 'password': 'PianoDemo2026!'}).encode(),
    headers={'Content-Type': 'application/json', 'Origin': BASE, 'X-Form-Request': '1'})
with opener.open(login, timeout=15) as response:
    account = json.load(response)['account']

review = urllib.request.Request(BASE + f'/api/lessons/{LESSON}/music-draft')
with opener.open(review, timeout=90) as response:
    draft = json.load(response)

events = draft.get('events') or []
ok = len(events) == 1338 and abs(float(draft.get('duration', 0)) - 209.594) < 0.001
summary = {
    'account': account.get('email'),
    'lesson_id': draft.get('lesson_id'),
    'draft_id': draft.get('draft_id'),
    'status': draft.get('status'),
    'title': draft.get('title'),
    'duration_seconds': draft.get('duration'),
    'event_count': len(events),
    'matches_spec_example': ok,
    'working_corrected': bool(draft.get('working_corrected')),
    'raw_model': bool(draft.get('raw_model')),
    'has_notation': 'notation' in draft,
    'playback': draft.get('playback'),
    'source_video_present': bool(draft.get('source_video')),
    'first_event': events[0] if events else None,
    'last_event': events[-1] if events else None,
    'spans': len(draft.get('spans') or []),
}
print(json.dumps(summary, indent=2))
