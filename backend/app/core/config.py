from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    environment: str = "development"
    database_url: str
    cors_origins: list[str] = ["http://localhost:3000"]

    # Clerk
    clerk_issuer: str
    clerk_jwks_url: str
    clerk_secret_key: str = ""
    clerk_webhook_signing_secret: str = ""
    clerk_authorized_parties: list[str] = ["http://localhost:3000"]

    # Supabase Storage (logo, cover and machinery images)
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "manufacturer-assets"

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
