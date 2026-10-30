import boto3
from botocore.config import Config

def storage_client(settings):
    options = dict(endpoint_url=settings.storage_endpoint, region_name=settings.storage_region,
                   config=Config(signature_version='s3v4', s3={'addressing_style':settings.storage_addressing_style}))
    if settings.storage_access_key:
        options.update(aws_access_key_id=settings.storage_access_key, aws_secret_access_key=settings.storage_secret_key)
    return boto3.client('s3', **options)

def check_storage(settings):
    storage_client(settings).head_bucket(Bucket=settings.storage_bucket)
