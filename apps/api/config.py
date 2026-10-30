from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    environment: str = 'development'
    database_url: str = 'postgresql+psycopg://form:form@localhost:5433/form'
    demo_enabled: bool = False
    demo_assets_dir: Path = ROOT / 'web/dist/assets'
    web_dist_dir: Path = ROOT / 'apps/web/dist'
    storage_endpoint: str | None = None
    storage_region: str = 'us-east-1'
    storage_bucket: str = 'form'
    storage_addressing_style: str = 'path'
    storage_access_key: str | None = None
    storage_secret_key: str | None = None
    public_url: str = 'http://127.0.0.1:5173'
    session_days: int = 7
    smtp_host: str = 'localhost'
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = False
    mail_from: str = 'Form <hello@form.local>'
    max_upload_bytes: int = 250 * 1024 * 1024
    max_conversion_seconds: int = 120
    max_active_conversions: int = 2
    max_account_storage_bytes: int = 2 * 1024 * 1024 * 1024
    worker_lease_seconds: int = 120
    upload_temp_dir: Path = ROOT / '.local/upload-tmp'

    @model_validator(mode='after')
    def deployment_security(self):
        origin = urlparse(self.public_url)
        if origin.scheme not in ('http', 'https') or not origin.hostname or origin.path not in ('', '/') or origin.query or origin.fragment or origin.username:
            raise ValueError('PUBLIC_URL must be a browser origin without a path, query, credentials or fragment.')
        if self.environment != 'development':
            if origin.scheme != 'https' or not self.smtp_starttls:
                raise ValueError('Hosted environments require an HTTPS public URL and SMTP STARTTLS.')
        if not 1 <= self.session_days <= 30:
            raise ValueError('Session lifetime must be between 1 and 30 days.')
        return self

    @property
    def sqlalchemy_url(self):
        return self.database_url.replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1)
