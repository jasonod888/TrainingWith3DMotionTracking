"""Resolve an uncertain remote submission after checking the provider dashboard. Never submits work."""
import argparse
from pathlib import Path
import sys
from sqlalchemy import select
from sqlalchemy.orm import Session
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.config import Settings
from apps.api.database import Conversion,make_engine
from apps.api.provider_adapters import request_id
from apps.api.storage import storage_client


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job_id')
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--attach-request',help='Resume polling this existing paid request; never creates a new request.')
    action.add_argument('--confirmed-no-active-request',action='store_true',help='Release the held slot only after verifying no billable work remains.')
    args=parser.parse_args();settings=Settings();engine=make_engine(settings.sqlalchemy_url)
    with Session(engine) as session:
        job=session.scalar(select(Conversion).where(Conversion.id==args.job_id).with_for_update())
        if not job or job.provider=='local' or job.submission_state not in ('unknown','prepared') or job.state not in ('failed','cancelled'):
            parser.error('Only uncertain, stopped remote jobs can be reconciled.')
        if args.attach_request:
            if job.state=='cancelled' or job.attempts>=3:parser.error('Cancelled or exhausted jobs cannot resume. Stop the provider request and release the slot instead.')
            identity=request_id(args.attach_request)
            if session.scalar(select(Conversion.id).where(Conversion.provider==job.provider,Conversion.provider_request_id==identity,Conversion.id!=job.id)):
                parser.error('This request is already assigned to a different job.')
            storage_client(settings).head_object(Bucket=settings.storage_bucket,Key=job.source_key)
            job.provider_request_id=identity;job.submission_state='submitted';job.state='queued';job.error=None;job.lease_until=None
            print('Existing provider request attached for polling; no new work submitted.')
        else:
            job.submission_state='resolved'
            print('Held processing slot released. This job remains stopped and cannot be retried.')
        session.commit()
    engine.dispose()


if __name__=='__main__':main()
