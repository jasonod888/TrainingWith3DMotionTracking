"""Phase 1 check: is the real draft reachable through the running API?

Read-only. Authenticates against the local disposable UI-test account, then requests the
draft through the Vite proxy exactly as the browser does. Writes a small summary JSON;
no musical data is modified and no token or password is printed.

Credentials come from PHASE1_UI_EMAIL / PHASE1_UI_PASSWORD. If they are unset the script
falls back to the documented disposable local UI-test account, which only exists in the
local development database. Override both for any other environment.

Usage (from the repository root):
  python docs/qualification/piano-workspace-phase-01/scripts/check-real-draft.py
  python docs/qualification/piano-workspace-phase-01/scripts/check-real-draft.py --base-url http://127.0.0.1:5173 --lesson <id>
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.paths import SCRATCH, fail, write_json

DEFAULT_LESSON = '0df28929d427406cb86d9bb5e2dcd35b'
# Disposable local UI-test account for the form_ui_test database. Not a production user.
FALLBACK_EMAIL = 'owner@ui.test'
FALLBACK_PASSWORD = 'PianoDemo2026!'


def main() -> None:
    parser = argparse.ArgumentParser(description='Verify the real draft is reachable (read-only).')
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--lesson', default=DEFAULT_LESSON)
    parser.add_argument('--out', type=Path, default=SCRATCH / 'real-draft-summary.json')
    args = parser.parse_args()

    email = os.environ.get('PHASE1_UI_EMAIL') or FALLBACK_EMAIL
    password = os.environ.get('PHASE1_UI_PASSWORD') or FALLBACK_PASSWORD
    credential_source = 'environment' if os.environ.get('PHASE1_UI_EMAIL') else 'documented local fixture account'

    base = args.base_url.rstrip('/')
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    login = urllib.request.Request(
        base + '/api/auth/login',
        data=json.dumps({'email': email, 'password': password}).encode(),
        headers={'Content-Type': 'application/json', 'Origin': base, 'X-Form-Request': '1'})
    try:
        with opener.open(login, timeout=15) as response:
            account = json.load(response)['account']
    except urllib.error.HTTPError as exc:
        fail(f'login failed with HTTP {exc.code}',
             'Check PHASE1_UI_EMAIL / PHASE1_UI_PASSWORD. The fallback account only exists in the '
             'local form_ui_test database after the documented local seed.')
    except urllib.error.URLError as exc:
        fail(f'could not reach {base}: {exc.reason}',
             'Start the web dev server (cd apps/web; npm run dev) and the API on port 8001, '
             'or use the fixture-based audits that need no services.')

    request = urllib.request.Request(base + f'/api/lessons/{args.lesson}/music-draft')
    try:
        with opener.open(request, timeout=120) as response:
            draft = json.load(response)
    except urllib.error.HTTPError as exc:
        fail(f'draft request failed with HTTP {exc.code}',
             'The lesson must exist in the database this API serves and belong to the signed-in account.')

    events = draft.get('events') or []
    summary = {
        'base_url': base,
        'credential_source': credential_source,
        'account': account.get('email'),
        'lesson_id': draft.get('lesson_id'),
        'draft_id': draft.get('draft_id'),
        'status': draft.get('status'),
        'title': draft.get('title'),
        'duration_seconds': draft.get('duration'),
        'event_count': len(events),
        'working_corrected': bool(draft.get('working_corrected')),
        'raw_model': bool(draft.get('raw_model')),
        'has_notation': 'notation' in draft,
        'has_alignment': 'alignment' in draft,
        'playback': draft.get('playback'),
        'source_video_present': bool(draft.get('source_video')),
        'spans': len(draft.get('spans') or []),
        'first_event': events[0] if events else None,
        'last_event': events[-1] if events else None,
    }
    write_json(args.out, summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
