"""POST /api/v1/webhooks/clerk: only Clerk-signed requests are processed, and payload
values never become SQL. The first tests need no database; the last one uses the
real one when E2E_DATABASE_URL is set."""
import base64
import json
import os
import time
import uuid

import httpx
import pytest
from svix.webhooks import Webhook

SECRET = "whsec_" + base64.b64encode(b"x" * 24).decode()
INJECTION = "Robert'); DROP TABLE users; --"
URL = "/api/v1/webhooks/clerk"


def signed(body: dict, secret: str = SECRET) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    msg_id, ts = f"msg_{uuid.uuid4().hex}", int(time.time())
    from datetime import datetime, timezone
    sig = Webhook(secret).sign(msg_id, datetime.fromtimestamp(ts, tz=timezone.utc), raw.decode())
    return raw, {"svix-id": msg_id, "svix-timestamp": str(ts), "svix-signature": sig,
                 "content-type": "application/json"}


class Recorder:
    """Stands in for the database session and records every statement."""
    calls: list = []

    def __init__(self):
        Recorder.calls = []

    def begin(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement, params=None):
        Recorder.calls.append((str(statement), params))
        return type("R", (), {"rowcount": 1, "scalar_one": lambda self: uuid.uuid4()})()


@pytest.fixture
def app_client(monkeypatch):
    from app.api.routes import webhooks
    from app.core.config import get_settings
    from app.main import app
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", SECRET)
    recorder = Recorder()
    monkeypatch.setattr(webhooks, "SessionFactory", recorder)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t"), recorder


async def test_unsigned_or_forged_requests_never_reach_the_database(app_client):
    client, _ = app_client
    attack = {"type": "organization.created", "data": {"id": "org_1", "name": INJECTION}}
    async with client:
        r = await client.post(URL, content=json.dumps(attack), headers={"content-type": "application/json"})
        assert r.status_code == 400 and r.json()["detail"] == "Invalid Clerk webhook signature"
        raw, headers = signed(attack, secret="whsec_" + base64.b64encode(b"y" * 24).decode())  # wrong key
        assert (await client.post(URL, content=raw, headers=headers)).status_code == 400
        raw, headers = signed(attack)
        tampered = raw.replace(b"org_1", b"org_2")  # body changed after signing
        assert (await client.post(URL, content=tampered, headers=headers)).status_code == 400
        headers["svix-timestamp"] = str(int(time.time()) - 3600)  # replayed an hour later
        assert (await client.post(URL, content=raw, headers=headers)).status_code == 400
    assert Recorder.calls == []


async def test_no_secret_configured_refuses_everything(app_client, monkeypatch):
    client, _ = app_client
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", "")
    raw, headers = signed({"type": "user.deleted", "data": {"id": "user_1"}})
    async with client:
        assert (await client.post(URL, content=raw, headers=headers)).status_code == 503
    assert Recorder.calls == []


async def test_payload_values_are_bound_parameters_never_sql(app_client):
    client, _ = app_client
    events = [
        {"type": "organization.created", "data": {"id": "org_1", "name": INJECTION}},
        {"type": "organization.deleted", "data": {"id": INJECTION}},
        {"type": "organizationMembership.created",
         "data": {"role": "org:admin", "public_user_data": {"user_id": INJECTION}, "organization": {"id": "org_1"}}},
        {"type": "organizationMembership.deleted",
         "data": {"public_user_data": {"user_id": INJECTION}, "organization": {"id": "org_1"}}},
    ]
    async with client:
        for event in events:
            raw, headers = signed(event)
            assert (await client.post(URL, content=raw, headers=headers)).status_code == 200, event
    assert Recorder.calls
    for sql, params in Recorder.calls:
        assert "DROP TABLE" not in sql and "Robert" not in sql  # the SQL text is fixed
    assert any(INJECTION in (params or {}).values() for _, params in Recorder.calls)  # the value travels as data


@pytest.mark.parametrize("data", [
    {"id": {"$ne": 1}},                       # object instead of an id
    {"id": ["user_1", "user_2"]},             # list instead of an id
    {"id": "x" * 5000},                        # far longer than a Clerk id
    {"id": "user_1\x00"},                      # NUL byte
])
async def test_wrongly_typed_fields_are_rejected_before_sql(app_client, data):
    client, _ = app_client
    raw, headers = signed({"type": "organization.deleted", "data": data})
    async with client:
        r = await client.post(URL, content=raw, headers=headers)
    assert r.status_code == 422
    assert Recorder.calls == []


@pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")
async def test_signed_event_with_sql_text_is_stored_literally(monkeypatch):
    from sqlalchemy import text

    from app.core.config import get_settings
    from app.core.database import engine
    from app.main import app
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", SECRET)
    org, sub = f"org_{uuid.uuid4().hex[:10]}", f"user_{uuid.uuid4().hex[:10]}"
    user = {"type": "user.created", "data": {
        "id": sub, "first_name": INJECTION, "last_name": "x' OR '1'='1",
        "primary_email_address_id": "e1",
        "email_addresses": [{"id": "e1", "email_address": f"{sub}@example.com", "verification": {"status": "verified"}}]}}
    organization = {"type": "organization.created", "data": {"id": org, "name": INJECTION}}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        for event in (user, organization):
            raw, headers = signed(event)
            assert (await client.post(URL, content=raw, headers=headers)).status_code == 200
    async with engine.connect() as conn:
        first = (await conn.execute(text("SELECT first_name FROM users WHERE clerk_user_id=:s"), {"s": sub})).scalar()
        name = (await conn.execute(text("SELECT display_name FROM organizations WHERE clerk_organization_id=:o"),
                                   {"o": org})).scalar()
        users = (await conn.execute(text("SELECT count(*) FROM users"))).scalar()
    await engine.dispose()
    assert first == INJECTION and name == INJECTION and users > 0  # stored as text; users table intact
