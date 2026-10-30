"""Explicit local storage initialization; never creates a cloud bucket automatically."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.config import Settings
from apps.api.storage import storage_client
settings=Settings()
if settings.environment!='development' or not settings.storage_endpoint or not settings.storage_endpoint.startswith(('http://localhost:','http://127.0.0.1:')):
    raise SystemExit('This helper only initializes local development storage.')
client=storage_client(settings)
try:
    client.head_bucket(Bucket=settings.storage_bucket)
except client.exceptions.ClientError as error:
    if str(error.response['Error']['Code']) not in ('404','NoSuchBucket'):
        raise
    client.create_bucket(Bucket=settings.storage_bucket)
print('Local storage ready.')
