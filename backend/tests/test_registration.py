"""Registration-before-access: a Clerk identity is not an X!Y user until it completed sign-up.

The first tests need no database (flow tokens). The rest run against a real Postgres when
E2E_DATABASE_URL is set (same setup as test_e2e_local.py)."""
import asyncio
import base64
import json
import os
import time
import uuid

import pytest

from test_e2e_local import client  # noqa: F401  (shared fixture)
from test_webhook_security import SECRET, signed

DB = os.environ.get("E2E_DATABASE_URL")
needs_db = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")
NOTICE = "Please sign up first, then sign in to continue."
TERMS = "terms-1.2;privacy-1.4"


# ---------------------------------------------------------------- flow tokens (no database)
def _settings():
    from app.core.config import get_settings
    return get_settings()


def test_flow_token_round_trip_and_return_path_sanitising():
    from app.identity.registration import issue_flow_token, verify_flow_token
    tok = issue_flow_token(_settings(), "sign-up", "google", "/manufacturer/account?x=1")["flowToken"]
    payload = verify_flow_token(_settings(), tok)
    assert (payload["p"], payload["m"], payload["r"]) == ("sign-up", "google", "/manufacturer/account?x=1")
    for bad in ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/a\nb", None, ""]:
        assert verify_flow_token(_settings(), issue_flow_token(_settings(), "sign-up", "manual", bad)["flowToken"])["r"] == "/"


def test_flow_token_cannot_be_relabelled_or_reused_after_expiry():
    from fastapi import HTTPException

    from app.identity.registration import issue_flow_token, verify_flow_token
    tok = issue_flow_token(_settings(), "sign-in", "google", "/")["flowToken"]
    body, sig = tok.split(".")
    data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    data["p"] = "sign-up"  # "the URL says signup"
    forged = base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode() + "." + sig
    for token in [forged, tok + "x", "garbage", "", "a.b.c"]:
        with pytest.raises(HTTPException) as err:
            verify_flow_token(_settings(), token)
        assert err.value.status_code == 400
    old = issue_flow_token(_settings(), "sign-up", "manual", "/", now=time.time() - 3600)["flowToken"]
    with pytest.raises(HTTPException) as err:
        verify_flow_token(_settings(), old)
    assert err.value.detail["code"] == "flow_expired"


def test_flow_endpoint_only_issues_sign_up_tokens():
    from app.api.routes.identity import SignUpFlowRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SignUpFlowRequest(method="password")


# ---------------------------------------------------------------- helpers (database)
def _hdr(c, sub, sid=None):
    import jwt  # noqa: F401
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


async def _flow(c, method="manual", ret="/"):
    r = await c.post("/identity/registration/flows", json={"method": method, "returnPath": ret,
                                                           "termsAccepted": True, "termsVersion": TERMS},
                     headers={"Authorization": ""})
    assert r.status_code == 201, r.text
    return r.json()["flowToken"]


def _new_unregistered(c):
    sub = f"user_new_{uuid.uuid4().hex[:10]}"
    c.unregistered.add(sub)
    return sub


async def _rows(c, sub):
    return await c.sql("SELECT id, registration_completed_at, registration_method, registration_session_id "
                       "FROM users WHERE clerk_user_id=:s", s=sub)


# ---------------------------------------------------------------- scenario 1 / 5 / 6
@needs_db
async def test_unregistered_identity_gets_no_access_and_no_user_record(client):  # noqa: F811
    sub = _new_unregistered(client)
    h = _hdr(client, sub)
    for method, path in [("GET", "/identity/me"), ("PUT", "/identity/me/roles"), ("GET", "/manufacturer/bootstrap"),
                         ("GET", "/manufacturer/companies/search?q=ab"), ("GET", "/manufacturer/notifications"),
                         ("GET", "/visionary/me"), ("GET", "/admin/me")]:
        r = await client.request(method, path, headers=h, json={"roles": ["vendor"]} if method == "PUT" else None)
        assert r.status_code == 403, (path, r.text)
        assert r.json() == {"detail": NOTICE, "code": "registration_required"}, path
    r = await client.get("/identity/registration", headers=h)
    assert r.status_code == 200 and r.json() == {"registered": False}
    assert await _rows(client, sub) == []  # reading never creates (or registers) a user


@needs_db
async def test_webhook_or_sync_created_row_is_not_registration(client, monkeypatch):  # noqa: F811
    from app.api.routes import webhooks
    from app.core import welcome
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", SECRET)
    sent = []
    monkeypatch.setattr(welcome, "send_welcome_soon", lambda uid: sent.append(uid))
    monkeypatch.setattr(webhooks, "send_welcome_soon", lambda uid: sent.append(uid), raising=False)
    sub = _new_unregistered(client)
    raw, headers = signed({"type": "user.created", "data": {
        "id": sub, "first_name": "Gee", "last_name": "Oogle", "primary_email_address_id": "e1",
        "email_addresses": [{"id": "e1", "email_address": f"{sub}@example.com",
                             "verification": {"status": "verified"}}]}})
    r = await client.post("/webhooks/clerk", content=raw, headers={**headers, "Authorization": ""})
    assert r.status_code == 200, r.text
    rows = await _rows(client, sub)
    assert len(rows) == 1 and rows[0].registration_completed_at is None
    assert sent == []  # no welcome email for an identity that never signed up
    r = await client.get("/manufacturer/bootstrap", headers=_hdr(client, sub))
    assert r.status_code == 403 and r.json()["code"] == "registration_required"


# ---------------------------------------------------------------- scenario 2 / 7
@needs_db
async def test_explicit_sign_up_registers_once_and_is_idempotent(client, monkeypatch):  # noqa: F811
    from app.api.routes import identity
    sent = []
    monkeypatch.setattr(identity, "send_welcome_soon", lambda uid: sent.append(uid))
    sub = _new_unregistered(client)
    h = _hdr(client, sub)
    tok = await _flow(client, "google", "/manufacturer/account")
    r = await client.post("/identity/registration/complete", json={"flowToken": tok}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"registered": True, "alreadyRegistered": False, "returnPath": "/manufacturer/account"}
    # repeated callback (same token) and a later second sign-up attempt (new token): no-ops
    for t in [tok, await _flow(client)]:
        r = await client.post("/identity/registration/complete", json={"flowToken": t}, headers=h)
        assert r.status_code == 200 and r.json()["alreadyRegistered"] is True
    rows = await _rows(client, sub)
    assert len(rows) == 1 and rows[0].registration_completed_at is not None
    assert rows[0].registration_method == "google"
    assert len(sent) == 1  # welcome exactly once
    assert (await client.get("/identity/registration", headers=h)).json() == {"registered": True}
    assert (await client.get("/identity/me", headers=h)).status_code == 200
    assert (await client.get("/manufacturer/bootstrap", headers=h)).status_code == 200


@needs_db
async def test_concurrent_completions_and_late_webhook_keep_one_registered_user(client, monkeypatch):  # noqa: F811
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", SECRET)
    sub = _new_unregistered(client)
    h = _hdr(client, sub)
    toks = [await _flow(client) for _ in range(3)]
    results = await asyncio.gather(*[client.post("/identity/registration/complete", json={"flowToken": t},
                                                 headers=h) for t in toks])
    assert [r.status_code for r in results] == [200, 200, 200], [r.text for r in results]
    assert sorted(r.json()["alreadyRegistered"] for r in results) == [False, True, True]
    # The Clerk webhook arrives after registration: updates the row, never un-registers it.
    for event in ("user.created", "user.updated"):
        raw, headers = signed({"type": event, "data": {
            "id": sub, "first_name": "Late", "last_name": "Hook", "primary_email_address_id": "e1",
            "email_addresses": [{"id": "e1", "email_address": f"{sub}@example.com",
                                 "verification": {"status": "verified"}}]}})
        assert (await client.post("/webhooks/clerk", content=raw, headers={**headers, "Authorization": ""})).status_code == 200
    rows = await _rows(client, sub)
    assert len(rows) == 1 and rows[0].registration_completed_at is not None


@needs_db
async def test_registration_requires_a_genuine_sign_up_token(client):  # noqa: F811
    from app.identity.registration import issue_flow_token
    sub = _new_unregistered(client)
    h = _hdr(client, sub)
    sign_in_token = issue_flow_token(_settings(), "sign-in", "google", "/")["flowToken"]
    r = await client.post("/identity/registration/complete", json={"flowToken": sign_in_token}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_sign_up"
    r = await client.post("/identity/registration/complete", json={"flowToken": "x" * 40}, headers=h)
    assert r.status_code == 400
    r = await client.post("/identity/registration/complete", json={"flowToken": await _flow(client)},
                          headers={"Authorization": ""})
    assert r.status_code == 401
    assert await _rows(client, sub) == []
    # A used token cannot register a second account.
    tok = await _flow(client)
    assert (await client.post("/identity/registration/complete", json={"flowToken": tok}, headers=h)).status_code == 200
    other = _new_unregistered(client)
    r = await client.post("/identity/registration/complete", json={"flowToken": tok}, headers=_hdr(client, other))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "flow_used"
    assert await _rows(client, other) == []


@needs_db
async def test_unverified_email_is_not_registered(client, monkeypatch):  # noqa: F811
    from app.identity import auth as identity_auth

    async def unverified(clerk_user_id, settings):
        return {"id": clerk_user_id, "primary_email_address_id": "e1",
                "email_addresses": [{"id": "e1", "email_address": f"{clerk_user_id}@example.com",
                                     "verification": {"status": "unverified"}}]}

    monkeypatch.setattr(identity_auth, "_fetch_clerk_user", unverified)
    sub = _new_unregistered(client)
    r = await client.post("/identity/registration/complete", json={"flowToken": await _flow(client)},
                          headers=_hdr(client, sub))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "email_unverified"
    assert await _rows(client, sub) == []


# ---------------------------------------------------------------- scenario 10: outages
@needs_db
async def test_outages_are_errors_not_sign_up_first(client, monkeypatch):  # noqa: F811
    import httpx
    from fastapi import HTTPException

    from app.identity import auth as identity_auth
    from app.identity import registration
    from app.main import app

    sub = _new_unregistered(client)
    h = _hdr(client, sub)

    async def clerk_down(clerk_user_id, settings):
        raise HTTPException(503, "Unable to reach Clerk right now. Please try again.")

    monkeypatch.setattr(identity_auth, "_fetch_clerk_user", clerk_down)
    r = await client.post("/identity/registration/complete", json={"flowToken": await _flow(client)}, headers=h)
    assert r.status_code == 503 and await _rows(client, sub) == []

    async def db_down(*_a, **_k):
        raise OSError("connection refused")

    monkeypatch.setattr(registration, "registration_row", db_down)  # every registration check reads this
    raw = httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                            base_url="http://t/api/v1")
    for path in ["/identity/registration", "/identity/me", "/manufacturer/bootstrap"]:
        r = await raw.get(path, headers=h)
        assert r.status_code >= 500, (path, r.status_code, r.text)
        assert "registration_required" not in r.text and NOTICE not in r.text


# ---------------------------------------------------------------- scenario 8: existing accounts
@needs_db
async def test_suspended_and_legacy_accounts(client):  # noqa: F811
    sub = _new_unregistered(client)
    h = _hdr(client, sub)
    await client.register(sub)
    await client.sql("UPDATE users SET status='suspended' WHERE clerk_user_id=:s", s=sub)
    r = await client.get("/identity/registration", headers=h)
    assert r.status_code == 403 and "suspended" in r.json()["detail"]
    assert "suspended" in (await client.get("/identity/me", headers=h)).json()["detail"]
    await client.sql("UPDATE users SET status='active' WHERE clerk_user_id=:s", s=sub)

    # Backfilled ("legacy") account keeps working; a backfill never touches registered rows.
    legacy = _new_unregistered(client)
    await client.sql("""INSERT INTO users (clerk_user_id, email, display_name, status, registration_completed_at,
                        registration_method) VALUES (:s, :e, 'Legacy', 'active', now(), 'legacy')""",
                     s=legacy, e=f"{legacy}@example.com")
    assert (await client.get("/identity/me", headers=_hdr(client, legacy))).status_code == 200


@needs_db
async def test_backfill_marks_only_accounts_with_evidence(client):  # noqa: F811
    from pathlib import Path
    engaged, idle = _new_unregistered(client), _new_unregistered(client)
    for s in (engaged, idle):
        await client.sql("INSERT INTO users (clerk_user_id, email, display_name) VALUES (:s, :e, 'x')",
                         s=s, e=f"{s}@example.com")
    await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                        SELECT id, 'vendor', 'active' FROM users WHERE clerk_user_id=:s""", s=engaged)
    sql = (Path(__file__).resolve().parents[1] / "database/backfills/014_registration_backfill.sql").read_text()
    update = sql[sql.index("UPDATE users u"):sql.index("COMMIT;")]
    await client.sql(update)
    assert (await _rows(client, engaged))[0].registration_method == "legacy"
    assert (await _rows(client, idle))[0].registration_completed_at is None


# ---------------------------------------------------------------- Terms and Conditions
@needs_db
async def test_terms_must_be_explicitly_accepted_for_both_methods(client):  # noqa: F811
    from app.identity.registration import issue_flow_token
    for method in ("manual", "google"):
        for body, status, code in [
            ({"method": method}, 422, "terms_required"),                                  # not ticked
            ({"method": method, "termsAccepted": False, "termsVersion": TERMS}, 422, "terms_required"),
            ({"method": method, "termsAccepted": True}, 409, "terms_outdated"),           # no version
            ({"method": method, "termsAccepted": True, "termsVersion": "terms-0.9"}, 409, "terms_outdated"),
        ]:
            r = await client.post("/identity/registration/flows", json=body, headers={"Authorization": ""})
            assert r.status_code == status and r.json()["detail"]["code"] == code, (body, r.text)
    # A validly signed sign-up token WITHOUT terms (e.g. issued before this change) cannot register.
    sub = _new_unregistered(client)
    no_terms = issue_flow_token(_settings(), "sign-up", "google", "/")["flowToken"]
    r = await client.post("/identity/registration/complete", json={"flowToken": no_terms}, headers=_hdr(client, sub))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "terms_required"
    old = issue_flow_token(_settings(), "sign-up", "manual", "/", terms_version="terms-0.9")["flowToken"]
    r = await client.post("/identity/registration/complete", json={"flowToken": old}, headers=_hdr(client, sub))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "terms_outdated"
    assert await _rows(client, sub) == []


@needs_db
async def test_completed_sign_up_records_terms_version_and_time(client):  # noqa: F811
    import time as _t
    sub = _new_unregistered(client)
    before = int(_t.time())
    tok = await _flow(client, "google")
    r = await client.post("/identity/registration/complete", json={"flowToken": tok}, headers=_hdr(client, sub))
    assert r.status_code == 200, r.text
    row = (await client.sql("""SELECT accepted_terms_version, extract(epoch FROM terms_accepted_at)::bigint,
                                      registration_completed_at IS NOT NULL FROM users WHERE clerk_user_id=:s""", s=sub))
    assert len(row) == 1
    version, accepted_at, registered = row[0]
    assert version == TERMS and registered and before - 1 <= accepted_at <= int(_t.time()) + 1


@needs_db
async def test_historical_account_terms_stay_unknown_until_genuinely_accepted(client):  # noqa: F811
    legacy = _new_unregistered(client)
    await client.sql("""INSERT INTO users (clerk_user_id, email, display_name, registration_completed_at,
                        registration_method) VALUES (:s, :e, 'Legacy', now(), 'legacy')""",
                     s=legacy, e=f"{legacy}@example.com")
    assert (await client.get("/identity/me", headers=_hdr(client, legacy))).status_code == 200  # access kept
    row = (await client.sql("SELECT accepted_terms_version, terms_accepted_at FROM users WHERE clerk_user_id=:s", s=legacy))[0]
    assert tuple(row) == (None, None)  # nothing inferred
    r = await client.post("/identity/registration/complete", json={"flowToken": await _flow(client)},
                          headers=_hdr(client, legacy))
    assert r.status_code == 200 and r.json()["alreadyRegistered"] is True
    row = (await client.sql("SELECT accepted_terms_version, registration_method FROM users WHERE clerk_user_id=:s", s=legacy))[0]
    assert tuple(row) == (TERMS, "legacy")  # explicit acceptance recorded, registration untouched


# ---------------------------------------------------------------- Sign-up with an existing email
@needs_db
async def test_account_status_answers_only_registered_and_writes_nothing(client, monkeypatch):  # noqa: F811
    """Sign-up page, after Clerk said "email taken": registered X!Y account → true (the page says
    "You already have an account. Please sign in." at once); a Clerk identity whose users row came
    only from the webhook / never finished sign-up → false; unknown email → false. Read-only."""
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "clerk_webhook_signing_secret", SECRET)
    status = lambda email: client.post("/identity/registration/account-status",  # noqa: E731
                                       json={"email": email}, headers={"Authorization": ""})
    sub = _new_unregistered(client)
    email = f"{sub}@example.com"
    r = await status(email)
    assert r.status_code == 200 and r.json() == {"registered": False}
    raw, headers = signed({"type": "user.created", "data": {
        "id": sub, "first_name": "Gee", "last_name": "Oogle", "primary_email_address_id": "e1",
        "email_addresses": [{"id": "e1", "email_address": email, "verification": {"status": "verified"}}]}})
    assert (await client.post("/webhooks/clerk", content=raw, headers={**headers, "Authorization": ""})).status_code == 200
    assert (await status(email.upper())).json() == {"registered": False}      # webhook row is not registration
    before = await client.sql("SELECT count(*) FROM users")
    tok = await _flow(client)
    assert (await client.post("/identity/registration/complete", json={"flowToken": tok},
                              headers=_hdr(client, sub))).status_code == 200
    assert (await status(f"  {email.upper()} ")).json() == {"registered": True}   # case / spaces ignored
    assert (await client.sql("SELECT count(*) FROM users")) == before            # no duplicate user
    assert (await status("nobody-" + email)).json() == {"registered": False}
    assert (await status("x")).status_code == 422
