"""Prune retained Basic Pitch analysis artifacts after the retention window.

Only owner-only `*-analysis.zip` assets are considered. The original reference, source
video and lesson are untouched. Use --dry-run first.
"""
import argparse
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.config import ROOT, Settings
from apps.api.database import LessonAsset, make_engine
from apps.api.storage import storage_client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=None)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    settings = Settings(_env_file=None)
    days = args.days or settings.music_analysis_retention_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    store = storage_client(settings)
    engine = make_engine(settings.sqlalchemy_url)
    removed = []
    with Session(engine) as session:
        records = session.scalars(select(LessonAsset).where(
            LessonAsset.key.like('lessons/%/%-analysis.zip'))).all()
        for record in records:
            try:
                head = store.head_object(Bucket=settings.storage_bucket, Key=record.key)
            except Exception as error:
                print('skip missing', record.key, type(error).__name__)
                continue
            modified = head.get('LastModified')
            if modified and modified < cutoff:
                removed.append(record.key)
                if not args.dry_run:
                    store.delete_object(Bucket=settings.storage_bucket, Key=record.key)
                    session.delete(record)
        if not args.dry_run:
            session.commit()
    print(f"{'would remove' if args.dry_run else 'removed'} {len(removed)} artifact(s), retention {days} days")
    for key in removed:
        print(key)


if __name__ == '__main__':
    main()
