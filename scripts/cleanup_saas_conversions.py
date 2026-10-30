"""Retain failed sources for seven days; expire abandoned uploads after one day. Dry-run by default."""
import argparse
from datetime import timedelta
from pathlib import Path
import sys
from sqlalchemy import select
from sqlalchemy.orm import Session
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.auth import now
from apps.api.config import Settings
from apps.api.conversions import stamp
from apps.api.database import Conversion,Lesson,make_engine
from apps.api.storage import storage_client


def cleanup(engine,settings,apply=False):
    store=storage_client(settings);count=0
    with Session(engine) as session:
        jobs=session.scalars(select(Conversion).where(Conversion.state.in_(('uploading','failed','cancelled','ready_for_review'))).with_for_update()).all()
        for job in jobs:
            age=now()-stamp(job.created_at)
            expired=job.state=='uploading' and age>timedelta(days=1)
            failed=job.state=='failed' and age>timedelta(days=7)
            if not (expired or failed or job.state in ('cancelled','ready_for_review')):continue
            count+=1
            if not apply:continue
            if job.upload_id:
                try:store.abort_multipart_upload(Bucket=settings.storage_bucket,Key=job.source_key,UploadId=job.upload_id)
                except Exception:pass
            store.delete_object(Bucket=settings.storage_bucket,Key=job.source_key)
            prefix=f'attempts/{job.id}/'
            for page in store.get_paginator('list_objects_v2').paginate(Bucket=settings.storage_bucket,Prefix=prefix):
                for obj in page.get('Contents',[]):store.delete_object(Bucket=settings.storage_bucket,Key=obj['Key'])
            if not job.lesson_id and not session.get(Lesson,job.id):
                for page in store.get_paginator('list_objects_v2').paginate(Bucket=settings.storage_bucket,Prefix=f'lessons/{job.id}/'):
                    for obj in page.get('Contents',[]):store.delete_object(Bucket=settings.storage_bucket,Key=obj['Key'])
            if expired:job.state='cancelled'
            if failed:job.error='source_expired'
        if apply:session.commit()
    return count


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    settings=Settings();engine=make_engine(settings.sqlalchemy_url)
    print(f'{cleanup(engine,settings,args.apply)} conversion records eligible; '+('cleanup applied.' if args.apply else 'no data changed.'))
    engine.dispose()


if __name__=='__main__':main()
