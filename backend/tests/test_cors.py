"""CORS for the deployed site (www.phaarvai.com calling the Render backend). No database needed."""
import httpx
import pytest
from fastapi import FastAPI

from app.core.config import Settings
from app.main import install_middleware

SITE = "https://www.phaarvai.com"
BASE = dict(database_url="postgresql+asyncpg://x@localhost:1/x", clerk_issuer="https://i", clerk_jwks_url="https://j")


def settings(**over):
    return Settings(_env_file=None, **{**BASE, **over})


def make_app(**over):
    app = FastAPI()

    @app.post("/api/v1/admin/auth/login")
    async def login():
        return {"token": "t"}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("unexpected")

    install_middleware(app, settings(**over))
    return app


async def call(app, method, path, **kw):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://api.test") as c:
        return await c.request(method, path, **kw)


def preflight_headers(origin=SITE):
    return {"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}


@pytest.mark.parametrize("raw", [
    '["https://www.phaarvai.com","https://phaarvai.com"]',
    "https://www.phaarvai.com,https://phaarvai.com",
    " https://www.phaarvai.com/ , https://phaarvai.com/ ",
    "'https://www.phaarvai.com', \"https://phaarvai.com\"",
    "[https://www.phaarvai.com, https://phaarvai.com]",
    '["https://www.phaarvai.com/", "https://phaarvai.com"]',
])
def test_cors_origins_accept_json_or_comma_list_and_drop_trailing_slash(raw, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", raw)
    s = Settings(_env_file=None, **BASE)
    assert s.cors_origins == ["https://www.phaarvai.com", "https://phaarvai.com"]


def test_authorized_parties_parsed_the_same_way(monkeypatch):
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://www.phaarvai.com/")
    assert Settings(_env_file=None, **BASE).clerk_authorized_parties == ["https://www.phaarvai.com"]


async def test_admin_login_preflight_and_post_from_the_site():
    app = make_app(cors_origins=[SITE, "https://phaarvai.com"])
    pre = await call(app, "OPTIONS", "/api/v1/admin/auth/login", headers=preflight_headers())
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == SITE
    assert pre.headers["access-control-allow-credentials"] == "true"
    r = await call(app, "POST", "/api/v1/admin/auth/login", headers={"Origin": SITE}, json={})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == SITE


async def test_origin_not_listed_is_refused():
    app = make_app(cors_origins=["http://localhost:3000"])   # the default: the reported error
    pre = await call(app, "OPTIONS", "/api/v1/admin/auth/login", headers=preflight_headers())
    assert pre.status_code == 400 and "access-control-allow-origin" not in pre.headers
    trailing = make_app(cors_origins=["https://www.phaarvai.com/"])  # normalised: now allowed
    pre = await call(trailing, "OPTIONS", "/api/v1/admin/auth/login", headers=preflight_headers())
    assert pre.headers.get("access-control-allow-origin") == SITE


async def test_gateway_refusal_and_server_errors_still_carry_cors_headers():
    app = make_app(cors_origins=[SITE], gateway_shared_secret="s3cret")
    pre = await call(app, "OPTIONS", "/api/v1/admin/auth/login", headers=preflight_headers())
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == SITE
    r = await call(app, "POST", "/api/v1/admin/auth/login", headers={"Origin": SITE}, json={})
    assert r.status_code == 403 and "Direct access is not allowed" in r.text      # visible, not a CORS error
    assert r.headers["access-control-allow-origin"] == SITE
    ok = await call(app, "POST", "/api/v1/admin/auth/login", headers={"Origin": SITE, "X-Gateway-Secret": "s3cret"},
                    json={})
    assert ok.status_code == 200
    plain = make_app(cors_origins=[SITE])
    boom = await call(plain, "GET", "/boom", headers={"Origin": SITE})
    assert boom.status_code == 500 and boom.json()["detail"].startswith("Something went wrong")
    assert boom.headers["access-control-allow-origin"] == SITE


def test_production_with_only_localhost_logs_an_error(caplog):
    caplog.set_level("ERROR", logger="xy.cors")
    make_app(environment="production")
    assert "CORS_ORIGINS allows only localhost in production" in caplog.text


def test_pasted_settings_lose_trailing_newlines(monkeypatch):
    # Render log: 'database "postgres\n" does not exist' - a newline pasted into DATABASE_URL
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@db.example:5432/postgres\n")
    monkeypatch.setenv("CLERK_ISSUER", " https://clerk.phaarvai.com\n")
    monkeypatch.setenv("CLERK_JWKS_URL", "https://clerk.phaarvai.com/.well-known/jwks.json \n")
    s = Settings(_env_file=None)
    assert s.database_url.endswith("/postgres") and s.clerk_issuer == "https://clerk.phaarvai.com"
    assert s.clerk_jwks_url.endswith("jwks.json")
