"""Shared Playwright login and prerequisite handling for the Phase 1 capture scripts."""
from __future__ import annotations

import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen

from .paths import fail

FALLBACK_EMAIL = 'owner@ui.test'
FALLBACK_PASSWORD = 'PianoDemo2026!'


def credentials() -> tuple[str, str, str]:
    """Return (email, password, source) from the environment or the local fixture account."""
    email = os.environ.get('PHASE1_UI_EMAIL')
    password = os.environ.get('PHASE1_UI_PASSWORD')
    if email and password:
        return email, password, 'environment'
    return FALLBACK_EMAIL, FALLBACK_PASSWORD, 'documented local fixture account'


def require_server(base_url: str) -> None:
    try:
        with urlopen(base_url + '/', timeout=8) as response:
            if response.status != 200:
                fail(f'{base_url} answered HTTP {response.status}',
                     'Start the web dev server (cd apps/web; npm run dev).')
    except URLError as exc:
        fail(f'could not reach {base_url}: {exc.reason}',
             'Start the web dev server (cd apps/web; npm run dev) and the API on port 8001, or use '
             'the fixture-based audits that need no services.')


def login(context, base_url: str) -> int:
    email, password, _source = credentials()
    response = context.request.post(f'{base_url}/api/auth/login',
        data={'email': email, 'password': password},
        headers={'Origin': base_url, 'X-Form-Request': '1'})
    if response.status != 200:
        fail(f'login failed with HTTP {response.status}',
             'Set PHASE1_UI_EMAIL / PHASE1_UI_PASSWORD for this environment.')
    return response.status


def launch(pw):
    try:
        return pw.chromium.launch()
    except Exception as exc:  # playwright raises a driver-level error when browsers are absent
        fail(f'could not launch Chromium: {exc}',
             'Install browsers with: python -m playwright install chromium')
