from functools import lru_cache
from pathlib import Path
from typing import Literal

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

    # Admin dashboard: comma-separated emails that are made platform
    # administrators on their first visit to /admin (bootstrap the first admins).
    # More admins can then be granted with `python -m app.grant_admin <email>`.
    admin_emails: str = ""
    # The built-in administrator (created with `python -m app.admin_account setup`). It cannot
    # be revoked, disabled or have its role changed from the Admins tab.
    admin_default_email: str = "admin@phaarvai.com"

    # Admin email + password sign-in (`python -m app.admin_account create ...`).
    # A session ends after ADMIN_SESSION_HOURS, or earlier after ADMIN_IDLE_MINUTES
    # without activity. After ADMIN_MAX_FAILED_LOGINS wrong passwords in a row the
    # account is locked for ADMIN_LOCKOUT_MINUTES.
    # Set (same value on the gateway) when the backend has a public URL, e.g. on Render:
    # requests that skip the gateway are then refused. Empty = off (local / docker compose).
    gateway_shared_secret: str = ""

    # Outgoing email (SMTP) for the app's own emails (welcome, review result, admin notices).
    # Clerk sends its own emails (verification codes) itself; nothing here is needed for those.
    # SMTP_HOST empty = email off (nothing is sent; attempts are logged as "skipped").
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_security: Literal["none", "starttls", "ssl"] = "none"
    smtp_timeout_seconds: int = 10
    email_from: str = "X!Y Factory <no-reply@xyfactory.local>"
    # Links in emails point here (the frontend), e.g. https://your-app.vercel.app
    app_base_url: str = "http://localhost:3000"

    admin_session_hours: int = 12
    admin_idle_minutes: int = 60
    admin_max_failed_logins: int = 5
    admin_lockout_minutes: int = 15

    @property
    def admin_email_list(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
