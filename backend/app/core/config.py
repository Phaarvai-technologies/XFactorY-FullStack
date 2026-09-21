from pathlib import Path
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"

class Settings(BaseSettings):
    
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


    environment: str = "development"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/xy_factory"
    clerk_issuer: str = ""
    clerk_jwks_url: str = ""
    clerk_secret_key: str = ""
    clerk_webhook_signing_secret: str = ""
    clerk_authorized_parties: list[str] = ["http://localhost:3000"]
    cors_origins: list[str] = ["http://localhost:3000"]

    @field_validator("clerk_authorized_parties", "cors_origins", mode="before")
    @classmethod
    def split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    def validate_production(self) -> None:
        if self.environment == "production":
            required = {
                "CLERK_ISSUER": self.clerk_issuer,
                "CLERK_JWKS_URL": self.clerk_jwks_url,
                "CLERK_SECRET_KEY": self.clerk_secret_key,
                "CLERK_WEBHOOK_SIGNING_SECRET": self.clerk_webhook_signing_secret,
            }
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise RuntimeError(f"Missing production settings: {', '.join(missing)}")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_production()
    return settings
