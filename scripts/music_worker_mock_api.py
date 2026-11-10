"""Local mock worker API for the container lifecycle smoke test.

Serves one fixture job, a source media file and the draft handoff. In cancel mode the
first heartbeat succeeds and later ones return 409 so the worker must terminate its
adapter, clean its attempt directory and stop.
"""
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SOURCE = Path(os.environ.get('MOCK_SOURCE', '/data/source.mp4')).read_bytes()
DIGEST = hashlib.sha256(SOURCE).hexdigest()
MODE = os.environ.get('MOCK_MODE', 'complete')
JOB_ID = 'a' * 32
TOKEN = 'b' * 48
STATE = {'claimed': False, 'heartbeats': 0, 'drafts': 0}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        path = self.path.split('?')[0]
        if path == '/api/worker/claim':
            if STATE['claimed']:
                self.reply(200, None)
                return
            STATE['claimed'] = True
            self.reply(200, {'id': JOB_ID, 'title': 'Mock piano', 'bytes': len(SOURCE), 'sha256': DIGEST,
                             'start': 0, 'duration': 2, 'attempt_token': TOKEN, 'provider': 'local',
                             'pipeline_version': 'music-piano-v1', 'subject': 'piano', 'instrument': 'piano',
                             'output_roles': {'reference': {'name': 'reference.json', 'mime': 'application/json'}},
                             'provider_target': '', 'submission_state': 'none'})
            return
        if path.endswith('/heartbeat'):
            STATE['heartbeats'] += 1
            if MODE == 'cancel' and STATE['heartbeats'] > 1:
                self.reply(409, {'detail': 'Cancelled for the smoke test.'})
                return
            self.reply(200, {'ok': True})
            return
        if path.endswith('/draft'):
            STATE['drafts'] += 1
            Path('/tmp/mock-draft.json').write_bytes(body)
            self.reply(200, {'draft': True, 'lesson_id': JOB_ID})
            return
        if path.endswith('/fail'):
            self.reply(200, {'ok': True})
            return
        self.reply(404, {'detail': 'Not found'})

    def do_GET(self):
        if self.path.split('?')[0].endswith('/source'):
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(len(SOURCE)))
            self.end_headers()
            self.wfile.write(SOURCE)
            return
        self.reply(404, {'detail': 'Not found'})

    def do_PUT(self):
        length = int(self.headers.get('Content-Length') or 0)
        data = self.rfile.read(length)
        path = self.path.split('?')[0]
        if '/files/' in path:
            name = path.rsplit('/', 1)[-1]
            self.reply(200, {'key': f'attempts/{JOB_ID}/{TOKEN}/{name}', 'mime': 'application/json',
                             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            return
        self.reply(404, {'detail': 'Not found'})

    def log_message(self, *args):
        pass


ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
