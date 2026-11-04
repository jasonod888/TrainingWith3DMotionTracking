"""Shared helpers for multi-discipline tests: subject metadata and music fixtures."""
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from apps.api.auth import digest
from apps.api.config import ROOT
from apps.api.database import WorkerCredential
from apps.api.lessons import import_music_fixture

FIXTURES = ROOT / 'packages' / 'lesson-schema' / 'fixtures'


def music_manifest(subject='piano', **changes):
    value = json.loads((FIXTURES / 'music-v2.json').read_text(encoding='utf-8'))
    value['subject'] = subject
    value['instrument'] = {'instrument': subject}
    value.update(changes)
    return value


def write_music_fixture(directory, subject='piano'):
    """Create a minimal music fixture: manifest plus its reviewed reference asset."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    reference = b'{"schema":1,"events":[]}'
    (directory / 'reference.json').write_bytes(reference)
    manifest = music_manifest(subject)
    manifest['reference'] = {'key': 'fixture/reference.json', 'mime': 'application/json',
                             'bytes': len(reference), 'sha256': hashlib.sha256(reference).hexdigest()}
    path = directory / 'manifest.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    return path


def import_music(system, subject='piano', directory=None):
    """Import a music fixture for the signed-in owner; returns the manifest."""
    client, app, settings, _mail, _store = system
    directory = Path(directory) if directory else settings.web_dist_dir.parent / f'music-{uuid4().hex}'
    path = write_music_fixture(directory, subject)
    owner_id = client.get('/api/auth/session').json()['account']['id']
    return import_music_fixture(app.state.engine, settings, owner_id, path, path.parent)


def music_worker(app, token, pipeline_version='music-piano-v1', provider='local'):
    with Session(app.state.engine) as session:
        session.add(WorkerCredential(id=uuid4().hex, token_hash=digest(token), active=True,
                                     provider=provider, pipeline_version=pipeline_version))
        session.commit()
    return {'Authorization': 'Bearer ' + token}
