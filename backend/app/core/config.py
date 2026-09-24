from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

LOCAL_FRONTEND_URL = "http://localhost:3000"
PRODUCTION_FRONTEND_URL = "https://x-factor-y-full-stack-cwlx.vercel.app"


class Settings(BaseSettings):
    # Application
    environment: str = "development"

    # Supabase PostgreSQL
    database_url: str

    # CORS
    cors_origins: list[str] = [
        LOCAL_FRONTEND_URL,
        PRODUCTION_FRONTEND_URL,
    ]

    # Clerk
    clerk_issuer: str
    clerk_jwks_url: str
    clerk_secret_key: str = ""
    clerk_webhook_signing_secret: str = ""

    # Valid JWT frontend origins
    clerk_authorized_parties: list[str] = [
        LOCAL_FRONTEND_URL,
        PRODUCTION_FRONTEND_URL,
    ]

    # Supabase Storage
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "manufacturer-assets"

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, value: str) -> str:
        normalized_value = value.strip().lower()

        if normalized_value not in {"development", "production", "test"}:
            raise ValueError(
                "ENVIRONMENT must be development, production, or test"
            )

        return normalized_value

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
