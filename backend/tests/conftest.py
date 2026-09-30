"""Runs before any `app` import, so tests never read the real backend/.env values
(DATABASE_URL, Clerk issuer) and never touch a real database."""
import os

E2E_DB = os.environ.get("E2E_DATABASE_URL")
os.environ["DATABASE_URL"] = E2E_DB or "postgresql+asyncpg://test:test@localhost:1/test"
os.environ["CLERK_ISSUER"] = "https://test.clerk.accounts.dev"
os.environ["CLERK_JWKS_URL"] = "https://test.clerk.accounts.dev/.well-known/jwks.json"
os.environ["CLERK_AUTHORIZED_PARTIES"] = '["http://localhost:3000"]'
os.environ["CLERK_SECRET_KEY"] = "sk_test_dummy"
os.environ["SUPABASE_URL"] = "https://proj.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "dummy"
