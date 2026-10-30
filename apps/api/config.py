from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    @property
    def sqlalchemy_url(self):
        return self.database_url.replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1)
