"""Publish already-converted avatar clips to a lesson's storage and asset records.

Production does this automatically: the worker retargets after canonical export and posts to
`/jobs/{id}/derivatives`. This script exists to backfill lessons converted before that step,
without re-running inference.

    python scripts/publish_lesson_clips.py --lesson <id> \
        --male .../male.glb --female .../female.glb --report .../report.json

Runs where the API's storage and database are reachable (boto3 + psycopg).
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import boto3
import psycopg
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
NAMES = {'avatar-male.glb': 'model/gltf-binary', 'avatar-female.glb': 'model/gltf-binary',
         'avatar-report.json': 'application/json'}


def load_env():
    """Read .env into os.environ without overriding anything already set."""
    env_path = ROOT / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip())


def storage(settings):
    return boto3.client('s3',
                        endpoint_url=os.environ.get('STORAGE_ENDPOINT') or None,
                        region_name=os.environ.get('STORAGE_REGION', 'us-east-1'),
                        aws_access_key_id=os.environ.get('STORAGE_ACCESS_KEY'),
                        aws_secret_access_key=os.environ.get('STORAGE_SECRET_KEY'),
                        config=Config(s3={'addressing_style': os.environ.get(
                            'STORAGE_ADDRESSING_STYLE', 'path')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--lesson', required=True)
    parser.add_argument('--male', required=True, type=Path)
    parser.add_argument('--female', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()

    load_env()
    bucket = os.environ.get('STORAGE_BUCKET', 'form')
    database = os.environ.get('DATABASE_URL', 'postgresql+psycopg://form:form@localhost:5433/form')
    client = storage(None)

    uploads = {'avatar-male.glb': args.male, 'avatar-female.glb': args.female,
               'avatar-report.json': args.report}
    for name, path in uploads.items():
        if not path.exists():
            raise SystemExit(f'missing {name}: {path}')

    with psycopg.connect(database.replace('postgresql+psycopg://', 'postgresql://'),
                         connect_timeout=15) as conn, conn.cursor() as cur:
        cur.execute("select 1 from lessons where id = %s", (args.lesson,))
        if not cur.fetchone():
            raise SystemExit(f'lesson {args.lesson} does not exist')
        for name, path in uploads.items():
            payload = path.read_bytes()
            digest = hashlib.sha256(payload).hexdigest()
            key = f'lessons/{args.lesson}/{name}'
            client.put_object(Bucket=bucket, Key=key, Body=payload,
                              ContentType=NAMES[name], Metadata={'sha256': digest})
            cur.execute('delete from lesson_assets where key = %s and lesson_id = %s',
                        (key, args.lesson))
            cur.execute(
                'insert into lesson_assets (key, lesson_id, mime, bytes, sha256) '
                'values (%s, %s, %s, %s, %s)',
                (key, args.lesson, NAMES[name], len(payload), digest))
            print(f'{name:20} {len(payload):>9,} bytes -> {key}')
        conn.commit()
    print(f'published avatar clips for {args.lesson}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
