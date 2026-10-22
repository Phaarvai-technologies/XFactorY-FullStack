from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from typing import Annotated


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    environment: str = "development"
    database_url: str
    # Database connections. Checking each connection before use costs one extra round trip on
    # every request; instead connections are renewed after DB_POOL_RECYCLE_SECONDS.
    # Set DB_POOL_PRE_PING=true to bring the check back (e.g. if "connection closed" errors appear).
    db_pool_pre_ping: bool = False
    db_pool_recycle_seconds: int = 300
    # Browser origins allowed to call the API: scheme + host (+ port), no path, no trailing "/".
    # Either a JSON list (["https://www.phaarvai.com","https://phaarvai.com"]) or a
    # comma-separated list (https://www.phaarvai.com,https://phaarvai.com). See _origins below.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # Clerk
    clerk_issuer: str
    clerk_jwks_url: str
    clerk_secret_key: str = ""
    clerk_webhook_signing_secret: str = ""
    clerk_authorized_parties: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    # Terms and Conditions + Privacy Policy version shown on the Sign-up page
    # ("Terms v1.2 · Privacy Policy v1.4"). Registration is refused unless the user accepted
    # exactly this version; change it together with frontend TERMS_VERSION.
    terms_version: str = "terms-1.2;privacy-1.4"

    @field_validator("database_url", "clerk_issuer", "clerk_jwks_url", "clerk_secret_key",
                     "clerk_webhook_signing_secret", mode="before")
    @classmethod
    def _trimmed(cls, value):
        """Values pasted into a hosting dashboard often carry a trailing newline / space; in
        DATABASE_URL that becomes part of the database name ('database "postgres\n" does not exist')."""
        return value.strip() if isinstance(value, str) else value

    @field_validator("cors_origins", "clerk_authorized_parties", mode="before")
    @classmethod
    def _origins(cls, value):
        """JSON list or comma-separated text; quotes, spaces and a trailing "/" are removed (an
        origin never has a path, and "https://www.phaarvai.com/" would match no browser request)."""
        import json
        if isinstance(value, str):
            text = value.strip()
            try:
                value = json.loads(text) if text.startswith("[") else text.split(",")
            except ValueError:
                # "[https://a.com, https://b.com]" (no quotes): never stop the server over it
                value = text.strip("[]").split(",")
        return [str(v).strip().strip("'\"").rstrip("/") for v in value if str(v).strip().strip("'\"")]

    @property
    def clerk_issuers(self) -> list[str]:
        """CLERK_ISSUER may list several issuers separated by commas, e.g.
        "https://clerk.phaarvai.com,https://phaarvai.com/__clerk" (Clerk uses the proxy URL as
        the issuer while a proxy is configured for the instance). Trailing "/" is ignored."""
        return [i.strip().rstrip("/") for i in (self.clerk_issuer or "").split(",") if i.strip()]

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

    # Manufacturer applications (app/manufacturer_access.py): after an admin rejects an
    # application, the applicant may send a fresh one this many hours after the rejection.
    manufacturer_reapply_after_hours: int = 24

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
