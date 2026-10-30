"""Verify the local account-enabled CPU container, real email, privacy and restart persistence."""
import json
import hashlib
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.config import Settings
from apps.api.database import Account, AccountToken, Lesson, LessonAsset, LessonRevision, LoginSession, PracticeProgress, make_engine
from apps.api.lessons import import_fixture
from apps.api.storage import storage_client
from scripts.verify_local_deployment import docker


def main():
    settings = Settings()
    if settings.environment != 'development' or any(urlparse(url).hostname not in ('localhost','127.0.0.1') for url in (settings.sqlalchemy_url,settings.storage_endpoint or '')):
        raise SystemExit('This script only supports local development services.')
    engine = make_engine(settings.sqlalchemy_url)
    store = storage_client(settings)
    emails = [f'phase1-{uuid4().hex}@example.test' for _ in range(2)]
    account_ids, imported, checks = [], None, []
    password = uuid4().hex+'-local-test'
    headers = {'Origin':'http://127.0.0.1:8010','X-Form-Request':'1'}
    def report(value):
        checks.append(value)
        print(value, flush=True)
    def wait_ready(client):
        deadline = time.monotonic()+45
        while time.monotonic() < deadline:
            try:
                if client.get('/health/ready').status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(.5)
        raise RuntimeError('Local CPU container did not become ready.')
    with httpx.Client(base_url='http://127.0.0.1:8010', headers=headers, trust_env=False, timeout=30) as owner, \
         httpx.Client(base_url='http://127.0.0.1:8010', headers=headers, trust_env=False, timeout=30) as other, \
         httpx.Client(base_url='http://127.0.0.1:8025', trust_env=False, timeout=10) as mailbox:
        try:
            wait_ready(owner)
            for client,email in zip((owner,other),emails):
                result = client.post('/api/auth/register',json={'email':email,'password':password})
                assert result.status_code == 202, result.text
                with Session(engine) as session:
                    account_ids.append(session.scalar(select(Account.id).where(Account.email == email)))
                messages = mailbox.get('/api/v1/messages').json()['messages']
                message = next(m for m in messages if email in json.dumps(m.get('To',[])))
                content = mailbox.get('/api/v1/message/'+message['ID']).json()
                token = re.search(r'#verify=([A-Za-z0-9_-]+)',content['Text']).group(1)
                assert client.post('/api/auth/verify',json={'token':token}).status_code == 200
                assert client.post('/api/auth/verify',json={'token':token}).status_code == 400
                result = client.post('/api/auth/login',json={'email':email,'password':password})
                assert result.status_code == 200, result.text
                client.headers['X-CSRF-Token'] = result.json()['csrf']
            report('Real email verification, single-use links and cookie sign-in passed in the CPU image.')
            imported = import_fixture(engine, settings, account_ids[0], ROOT/'packages/lesson-schema/fixture.json', ROOT/'packages/lesson-schema')
            path = f'/api/lessons/{imported.lesson_id}'
            asset_path = path+'/assets/synthetic.glb'
            assert other.get(path).status_code == 404
            assert other.get(asset_path).status_code == 404
            assert other.get('/api/lessons').json() == []
            assert owner.get(asset_path).content == (ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
            report('A second account cannot access the first account’s lesson or media.')
            sections = [s.model_dump() for s in imported.section_set.sections]
            sections[0]['label'] = 'Saved across restart'
            saved = owner.put(path+'/sections',json={'base_revision_id':imported.revision_id,'title':'Private restart fixture','sections':sections})
            assert saved.status_code == 200, saved.text
            before = saved.json()
            phase_two = owner.get('/api/capabilities').json()['phase'] >= 2
            position = {'revision_id':before['revision_id'],'time':1.1,'speed':.75,'mode':'sections'}
            if phase_two:
                assert owner.get('/pose-worker.js').status_code == 200
                model = owner.get('/tracking/pose_landmarker_lite.task')
                assert model.status_code == 200 and hashlib.sha256(model.content).hexdigest() == '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
                wasm = owner.get('/tracking/wasm/vision_wasm_internal.wasm',headers={'Range':'bytes=0-3'})
                assert wasm.status_code == 206 and wasm.content == b'\0asm'
                report('Packaged worker, hash-verified pose model and WASM byte-range delivery passed.')
                assert owner.put(path+'/progress',json=position).status_code == 200
                assert other.get(path+'/progress').status_code == 404
            docker('restart','form-saas-postgres-1','form-saas-storage-1')
            docker('restart','form-saas-cpu-check')
            wait_ready(owner)
            assert owner.get('/api/auth/session').status_code == 200
            assert owner.get(path).json() == before
            assert owner.get(asset_path).content == (ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
            if phase_two:
                assert owner.get(path+'/progress').json() == position
                report('Private revision-bound practice position survives service restart.')
            with httpx.Client(base_url='http://127.0.0.1:8010',headers=headers,trust_env=False,timeout=30) as reopened:
                assert reopened.post('/api/auth/login',json={'email':emails[0],'password':password}).status_code == 200
                assert reopened.get(path).json() == before
                if phase_two:
                    assert reopened.get(path+'/progress').json() == position
            report('Accounts, sessions, saved revisions and private media survive database/storage/application restart and reopen in a fresh client.')
            assert owner.request('DELETE',path,json={}).status_code == 200
            assert owner.get(path).status_code == 404
            assert owner.get(asset_path).status_code == 404
            report('Archiving revokes new lesson and media requests immediately.')
        finally:
            if imported:
                for asset in (imported.animation,imported.landmarks):
                    store.delete_object(Bucket=settings.storage_bucket,Key=asset.key)
                with engine.begin() as connection:
                    connection.execute(delete(PracticeProgress).where(PracticeProgress.lesson_id == imported.lesson_id))
                    connection.execute(delete(LessonAsset).where(LessonAsset.lesson_id == imported.lesson_id))
                    connection.execute(delete(LessonRevision).where(LessonRevision.lesson_id == imported.lesson_id))
                    connection.execute(delete(Lesson).where(Lesson.id == imported.lesson_id))
            with engine.begin() as connection:
                connection.execute(delete(LoginSession).where(LoginSession.account_id.in_(account_ids)))
                connection.execute(delete(AccountToken).where(AccountToken.account_id.in_(account_ids)))
                connection.execute(delete(Account).where(Account.id.in_(account_ids)))
            engine.dispose()
    target = ROOT/f'.local/qa/phase-{2 if phase_two else 1}-deployment.json'
    target.parent.mkdir(exist_ok=True,parents=True)
    target.write_text(json.dumps({'passed':True,'checks':checks},indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
