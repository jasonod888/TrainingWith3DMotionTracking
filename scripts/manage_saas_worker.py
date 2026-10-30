"""Provision/revoke a conversion-only worker credential; never print its secret."""
import argparse
import os
from pathlib import Path
import secrets
import sys
from uuid import uuid4
from sqlalchemy.orm import Session
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.auth import digest
from apps.api.config import Settings,ROOT
from apps.api.database import WorkerCredential,make_engine
from apps.api.processing import PIPELINE_VERSION


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revoke')
    parser.add_argument('--provider',choices=('local','replicate','fal'),default='local')
    parser.add_argument('--api-url',default='http://host.docker.internal:8001')
    parser.add_argument('--output',type=Path,default=ROOT/'.local/worker.env')
    args=parser.parse_args();engine=make_engine(Settings().sqlalchemy_url)
    with Session(engine) as session:
        if args.revoke:
            credential=session.get(WorkerCredential,args.revoke)
            if not credential:parser.error('Unknown worker.')
            credential.active=False;session.commit();print('Worker revoked.')
        else:
            if args.output.exists():parser.error('Credential file exists. Use a new output path or revoke the previous worker first.')
            token=secrets.token_urlsafe(48);identity=uuid4().hex
            args.output.parent.mkdir(parents=True,exist_ok=True)
            with args.output.open('x',encoding='utf-8') as file:file.write(f'WORKER_API_URL={args.api_url}\nWORKER_TOKEN={token}\nWORKER_PROVIDER={args.provider}\n')
            if os.name!='nt':args.output.chmod(0o600)
            session.add(WorkerCredential(id=identity,token_hash=digest(token),provider=args.provider,pipeline_version=PIPELINE_VERSION,active=True));session.commit()
            print(f'Worker {identity} created. Secret written only to {args.output}.')
    engine.dispose()


if __name__=='__main__':main()
