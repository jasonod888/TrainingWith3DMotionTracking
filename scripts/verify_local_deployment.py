"""Verify only this project's local deployment, including outage recovery and restart persistence."""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import httpx
from sqlalchemy.orm import Session

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from apps.api.config import Settings
from apps.api.database import Lesson,LessonRevision,make_engine
from apps.api.storage import storage_client

def docker(*args):
    subprocess.run(['docker',*args],cwd=ROOT,check=True,capture_output=True,text=True,timeout=60)

def main():
    settings=Settings()
    if settings.environment!='development' or urlparse(settings.sqlalchemy_url).hostname not in ('localhost','127.0.0.1') or urlparse(settings.storage_endpoint or '').hostname not in ('localhost','127.0.0.1'):
        raise SystemExit('This check only supports the isolated local development services.')
    engine=make_engine(settings.sqlalchemy_url)
    storage=storage_client(settings)
    identity=f'verification-{uuid4().hex}'
    key=f'verification/{identity}/synthetic.glb'
    fixture=json.loads((ROOT/'packages/lesson-schema/fixture.json').read_text())
    payload=(ROOT/'packages/lesson-schema/synthetic.glb').read_bytes()
    results=[]
    def report(value):
        results.append(value)
        print(value,flush=True)
    with httpx.Client(base_url='http://127.0.0.1:8010',trust_env=False,timeout=30) as http:
        def ready():
            deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                try:
                    if http.get('/health/ready').status_code==200:return
                except httpx.HTTPError:pass
                time.sleep(.5)
            raise RuntimeError('Local application did not become ready.')
        try:
            ready()
            assert http.get('/health/live').status_code==200
            index=http.get('/')
            assert index.status_code==200 and 'text/html' in index.headers['content-type'] and 'Form' in index.text
            assert http.get('/api/demo').status_code==404
            assert http.get('/api/capabilities').json()['accounts'] is True
            report('CPU application: live, ready, frontend served, undeployed features disabled.')
            with Session(engine) as session:
                session.add(Lesson(id=identity,owner_id='verification',title='Synthetic restart check'))
                session.flush()
                session.add(LessonRevision(id=identity,lesson_id=identity,manifest=fixture,version=1))
                session.commit()
            storage.put_object(Bucket=settings.storage_bucket,Key=key,Body=payload)
            try:
                docker('compose','stop','storage')
                assert http.get('/health/live').status_code==200
                assert http.get('/health/ready').status_code==503
                report('Storage outage: liveness stays healthy; readiness returns 503.')
            finally:
                docker('compose','start','storage')
            ready()
            docker('compose','restart','postgres','storage')
            ready()
            engine.dispose()
            with Session(engine) as session:
                assert session.get(LessonRevision,identity).manifest==fixture
            result=storage.get_object(Bucket=settings.storage_bucket,Key=key)['Body'].read()
            assert hashlib.sha256(result).digest()==hashlib.sha256(payload).digest()
            report('Database and private media persist across service restarts.')
            docker('restart','form-saas-cpu-check')
            ready()
            report('CPU application recovers after its own restart.')
        finally:
            storage.delete_object(Bucket=settings.storage_bucket,Key=key)
            with engine.begin() as connection:
                connection.execute(LessonRevision.__table__.delete().where(LessonRevision.id==identity))
                connection.execute(Lesson.__table__.delete().where(Lesson.id==identity))
            engine.dispose()
    evidence=ROOT/'.local/qa/local-deployment.json'
    evidence.parent.mkdir(parents=True,exist_ok=True)
    evidence.write_text(json.dumps({'checks':results,'passed':True},indent=2))

if __name__=='__main__':
    main()
