"""ENVIRONMENT=production: API docs are off and database errors do not reveal table/column names.
Development keeps both (docs + detailed messages). No database needed."""
import os
import subprocess
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError


def _status(environment: str) -> str:
    code = (
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "c = TestClient(app)\n"
        "print(c.get('/docs').status_code, c.get('/openapi.json').status_code, c.get('/health/live').status_code)\n"
    )
    env = {**os.environ, "ENVIRONMENT": environment, "DATABASE_URL": "postgresql+asyncpg://x@localhost/x",
           "CLERK_ISSUER": "x", "CLERK_JWKS_URL": "x", "PYTHONPATH": "."}
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=60,
                         cwd=os.path.dirname(os.path.dirname(__file__)))
    assert out.returncode == 0, out.stderr
    return out.stdout.strip().splitlines()[-1]


def test_api_docs_only_outside_production():
    assert _status("development") == "200 200 200"
    assert _status("production") == "404 404 200"


class _PgError(Exception):
    def __init__(self, pgcode, message):
        super().__init__(message)
        self.pgcode = pgcode


class _Db:
    async def rollback(self):
        return None


def _service(environment: str):
    from app.core.config import Settings
    from app.services.manufacturer import ManufacturerService
    svc = ManufacturerService.__new__(ManufacturerService)
    svc.settings = Settings(database_url="postgresql+asyncpg://x@localhost/x", clerk_issuer="x",
                            clerk_jwks_url="x", environment=environment)
    svc.repo = type("Repo", (), {"db": _Db()})()
    return svc


async def _fail(pgcode, message):
    raise DBAPIError("SELECT 1", {}, _PgError(pgcode, message))


@pytest.mark.parametrize("pgcode,status", [("XX000", 500), ("22P02", 422), ("42703", 500)])
async def test_database_errors_hide_details_in_production(pgcode, status):
    secret = 'column "secret_internal_col" of relation "users" does not exist'
    with pytest.raises(HTTPException) as prod:
        await _service("production")._run(_fail(pgcode, secret))
    assert prod.value.status_code == status and "secret_internal_col" not in prod.value.detail
    with pytest.raises(HTTPException) as dev:
        await _service("development")._run(_fail(pgcode, secret))
    assert dev.value.status_code == status and "secret_internal_col" in dev.value.detail
