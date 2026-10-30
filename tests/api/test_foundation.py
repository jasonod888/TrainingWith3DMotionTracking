import json
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from apps.api.config import Settings, ROOT
from apps.api.contracts import LessonManifest, SectionSet, Asset, JobState, can_transition
from apps.api.main import create_app

FIXTURE = ROOT/'packages/lesson-schema/fixture.json'

def test_manifest_contract():
    manifest=LessonManifest.model_validate_json(FIXTURE.read_text())
    assert manifest.engine=='synthetic'
    assert manifest.confidence=='unmeasured'
    assert manifest.section_set.sections[-1].end==manifest.duration

@pytest.mark.parametrize('change', ['gap','duplicate','short','duration','nan'])
def test_bad_sections_rejected(change):
    value=json.loads(FIXTURE.read_text())['section_set']
    if change=='gap': value['sections'][1]['start']=1.2
    if change=='duplicate': value['sections'][1]['id']=value['sections'][0]['id']
    if change=='short': value['sections'][0]['end']=.01;value['sections'][1]['start']=.01
    if change=='duration': value['duration']=3
    if change=='nan': value['sections'][0]['end']=float('nan')
    with pytest.raises(ValidationError): SectionSet.model_validate(value)

@pytest.mark.parametrize('key',['../private.key','a/../key','/absolute','C:/private','a//b'])
def test_unsafe_keys_rejected(key):
    with pytest.raises(ValidationError):Asset(key=key,mime='text/plain',bytes=0,sha256='0'*64)

def test_jobs_cannot_skip_verification_or_reopen_success():
    assert can_transition(JobState.QUEUED,JobState.PROCESSING)
    assert not can_transition(JobState.PROCESSING,JobState.READY)
    assert not can_transition(JobState.READY,JobState.PROCESSING)
    assert not can_transition(JobState.CANCELLED,JobState.READY)

def test_config_maps_provider_database_urls_and_iam_defaults():
    s=Settings(database_url='postgres://user:password@host/db',_env_file=None)
    assert s.sqlalchemy_url=='postgresql+psycopg://user:password@host/db'
    assert s.storage_access_key is None

def test_api_demo_disabled_by_default(tmp_path):
    with TestClient(create_app(Settings(database_url='sqlite://',web_dist_dir=tmp_path,demo_enabled=False,_env_file=None))) as c:
        assert c.get('/health/live').status_code==200
        assert c.get('/api/demo').status_code==404
        assert c.get('/api/demo/assets/private.key').status_code==404
        assert c.get('/api/capabilities').json()['accounts'] is False
        assert c.get('/api/unknown').status_code==404

def test_readiness_checks_both_database_and_storage(tmp_path):
    with TestClient(create_app(Settings(database_url='sqlite://',web_dist_dir=tmp_path,_env_file=None))) as c:
        with patch('apps.api.main.database_ready'),patch('apps.api.main.check_storage'):
            assert c.get('/health/ready').status_code==200
        with patch('apps.api.main.database_ready',side_effect=RuntimeError('secret database address')):
            response=c.get('/health/ready')
            assert response.status_code==503
            assert 'secret' not in response.text

def test_only_manifest_listed_demo_assets_served(tmp_path):
    (tmp_path/'manifest.json').write_text(FIXTURE.read_text())
    (tmp_path/'synthetic.glb').write_bytes(b'fixture')
    (tmp_path/'private.key').write_text('never expose')
    with TestClient(create_app(Settings(database_url='sqlite://',demo_enabled=True,demo_assets_dir=tmp_path,web_dist_dir=tmp_path/'no-web',_env_file=None))) as c:
        assert c.get('/api/demo').status_code==200
        assert c.get('/api/demo/assets/synthetic.glb').status_code==200
        assert c.get('/api/demo/assets/private.key').status_code==404

def test_json_schema_is_current():
    schema=json.loads((ROOT/'packages/lesson-schema/manifest.schema.json').read_text())
    assert schema==LessonManifest.model_json_schema()
