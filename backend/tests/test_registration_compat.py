"""Regression: registered users from before explicit registration (migration 014) were told to
sign up. Real Postgres (E2E_DATABASE_URL), real endpoints; Clerk's API is the only stand-in."""
import os
import uuid

import pytest

from test_e2e_local import client  # noqa: F401  (shared fixture)

needs_db = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")
NOTICE = "Please sign up first, then sign in to continue."


def _tag():
    return uuid.uuid4().hex[:8]


def _hdr(c, sub):
    return {"Authorization": f"Bearer {c.token_for(sub)}"}


def clerk_api(monkeypatch, users: dict, calls: list | None = None, fail: Exception | None = None):
    """Clerk Backend API stand-in: users[clerk_id] = extra fields (password_enabled, ...)."""
    from app.identity import auth as identity_auth

    async def fetch(clerk_user_id, settings):
        if calls is not None:
            calls.append(clerk_user_id)
        if fail:
            raise fail
        extra = users.get(clerk_user_id, {})
        return {"id": clerk_user_id, "first_name": "Old", "last_name": "User", "primary_email_address_id": "e1",
                "email_addresses": [{"id": "e1", "email_address": extra.get("email", f"{clerk_user_id}@example.com"),
                                     "verification": {"status": "verified"}}],
                "password_enabled": extra.get("password_enabled", False),
                "legal_accepted_at": extra.get("legal_accepted_at")}

    monkeypatch.setattr(identity_auth, "_fetch_clerk_user", fetch)


async def legacy_user(c, *, days_old=90, email=None) -> str:
    """A users row exactly as the pre-014 sync created it: no registration marker."""
    sub = f"user_old_{_tag()}"
    c.unregistered.add(sub)
    await c.sql("""INSERT INTO users (clerk_user_id, email, display_name, first_name, last_name, created_at)
                   VALUES (:s, :e, 'Old User', 'Old', 'User', now() - make_interval(days => :d))""",
                s=sub, e=email or f"{sub}@example.com", d=days_old)
    return sub


async def marker(c, sub):
    return tuple((await c.sql("SELECT registration_completed_at IS NOT NULL, registration_method FROM users "
                              "WHERE clerk_user_id=:s", s=sub))[0])


# ---------------------------------------------------------------- the affected flow
@needs_db
async def test_existing_registered_password_account_signs_in(client, monkeypatch):  # noqa: F811
    calls = []
    sub = await legacy_user(client)
    clerk_api(monkeypatch, {sub: {"password_enabled": True}}, calls)
    h = _hdr(client, sub)
    # what the Sign-in page asks right after the password is accepted
    r = await client.get("/identity/registration", headers=h)
    assert r.status_code == 200 and r.json() == {"registered": True}, r.text
    assert await marker(client, sub) == (True, "legacy_password")
    # the dashboard and protected APIs now work; Clerk is not asked again
    assert (await client.get("/identity/me", headers=h)).status_code == 200
    assert (await client.get("/manufacturer/bootstrap", headers=h)).status_code == 200
    assert calls == [sub]


@needs_db
async def test_database_evidence_needs_no_clerk_call(client, monkeypatch):  # noqa: F811
    calls = []
    clerk_api(monkeypatch, {}, calls)
    cases = {}
    for label in ("legacy_activity", "legacy_terms", "legacy_signup_flow"):
        sub = await legacy_user(client)
        if label == "legacy_activity":
            await client.sql("""INSERT INTO marketplace_role_selections (user_id, role_selected, status)
                                SELECT id, 'vendor', 'active' FROM users WHERE clerk_user_id=:s""", s=sub)
        elif label == "legacy_terms":
            await client.sql("UPDATE users SET accepted_terms_version='v1.2' WHERE clerk_user_id=:s", s=sub)
        else:
            await client.sql("""INSERT INTO registration_flows (token_hash, purpose, method, return_path, expires_at,
                                completed_clerk_user_id) VALUES (:h, 'sign-up', 'google', '/', now(), :s)""",
                             h=f"old-{_tag()}", s=sub)
        cases[label] = sub
    for label, sub in cases.items():
        assert (await client.get("/identity/me", headers=_hdr(client, sub))).status_code == 200, label  # direct API
        assert await marker(client, sub) == (True, label)
    assert calls == []


@needs_db
async def test_google_account_with_legal_acceptance_is_recognised(client, monkeypatch):  # noqa: F811
    sub = await legacy_user(client)
    clerk_api(monkeypatch, {sub: {"legal_accepted_at": 1760000000000}})
    assert (await client.get("/identity/registration", headers=_hdr(client, sub))).json() == {"registered": True}
    assert await marker(client, sub) == (True, "legacy_legal_terms")


# ---------------------------------------------------------------- still blocked
@needs_db
async def test_accounts_without_evidence_stay_unregistered(client, monkeypatch):  # noqa: F811
    # e.g. the old bug's opaque Google sign-up: a row and a Clerk user, nothing else
    accidental = await legacy_user(client)
    # an account created after the cutoff (must complete Sign-up, even with a password)
    recent = await legacy_user(client, days_old=0)
    clerk_api(monkeypatch, {recent: {"password_enabled": True}})
    for sub in (accidental, recent):
        h = _hdr(client, sub)
        assert (await client.get("/identity/registration", headers=h)).json() == {"registered": False}
        r = await client.get("/identity/me", headers=h)
        assert r.status_code == 403 and r.json() == {"detail": NOTICE, "code": "registration_required"}
        r = await client.get("/manufacturer/bootstrap", headers=h)
        assert r.status_code == 403 and r.json()["code"] == "registration_required"
        assert await marker(client, sub) == (False, None)


@needs_db
async def test_unknown_identity_is_still_unregistered(client, monkeypatch):  # noqa: F811
    sub = f"user_new_{_tag()}"
    client.unregistered.add(sub)
    clerk_api(monkeypatch, {})
    assert (await client.get("/identity/registration", headers=_hdr(client, sub))).json() == {"registered": False}


# ---------------------------------------------------------------- errors are errors
@needs_db
async def test_clerk_outage_or_missing_config_is_an_error_not_unregistered(client, monkeypatch):  # noqa: F811
    from fastapi import HTTPException

    from app.core.config import get_settings
    sub = await legacy_user(client)
    h = _hdr(client, sub)
    clerk_api(monkeypatch, {}, fail=HTTPException(503, "Unable to reach Clerk right now. Please try again."))
    for path in ("/identity/registration", "/identity/me", "/manufacturer/bootstrap"):
        r = await client.get(path, headers=h)
        assert r.status_code == 503, (path, r.text)
        assert "registration_required" not in r.text and NOTICE not in r.text
    monkeypatch.setattr(get_settings(), "clerk_secret_key", "")
    r = await client.get("/identity/registration", headers=h)
    assert r.status_code == 503 and "not configured" in r.json()["detail"]
    assert await marker(client, sub) == (False, None)
    # an invalid token is a 401, never "not registered"
    r = await client.get("/identity/registration", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


@needs_db
async def test_email_owned_by_another_clerk_identity_is_not_sent_to_sign_up(client, monkeypatch):  # noqa: F811
    """Same person, different Clerk user id (e.g. another Clerk instance): report it, never
    'sign up' (that would fail on the existing email), and never re-link by email."""
    old = await legacy_user(client)
    new = f"user_other_{_tag()}"
    client.unregistered.add(new)
    clerk_api(monkeypatch, {new: {"email": f"{old}@example.com", "password_enabled": True}})
    r = await client.get("/identity/registration", headers=_hdr(client, new))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "identity_mismatch"
    assert (await client.sql("SELECT clerk_user_id FROM users WHERE email=:e", e=f"{old}@example.com"))[0][0] == old


@needs_db
async def test_suspended_and_new_registrations_unchanged(client, monkeypatch):  # noqa: F811
    sub = await legacy_user(client)
    clerk_api(monkeypatch, {sub: {"password_enabled": True}})
    await client.sql("UPDATE users SET status='suspended' WHERE clerk_user_id=:s", s=sub)
    r = await client.get("/identity/registration", headers=_hdr(client, sub))
    assert r.status_code == 403 and "suspended" in r.json()["detail"]
    assert await marker(client, sub) == (False, None)
    # a brand-new explicit registration still signs in normally
    fresh = f"user_fresh_{_tag()}"
    await client.register(fresh)
    assert (await client.get("/identity/registration", headers=_hdr(client, fresh))).json() == {"registered": True}
    assert (await client.get("/identity/me", headers=_hdr(client, fresh))).status_code == 200


@needs_db
async def test_admin_sign_in_recognises_existing_admin(client, monkeypatch):  # noqa: F811
    sub = await legacy_user(client)
    clerk_api(monkeypatch, {})
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, 'platform_administrator' FROM users WHERE clerk_user_id=:s""", s=sub)
    r = await client.get("/admin/me", headers=_hdr(client, sub))
    assert r.status_code == 200, r.text
    assert await marker(client, sub) == (True, "legacy_activity")


# ---------------------------------------------------------------- diagnostics (read-only)
def test_config_report_flags_instance_mismatch():
    import base64

    from app.diagnose_registration import config_report, publishable_key_host

    class S:  # minimal settings
        clerk_issuers = ["https://clerk.phaarvai.com"]
        clerk_jwks_url = "https://clerk.phaarvai.com/.well-known/jwks.json"
        clerk_secret_key = "sk_live_secret_value"
        clerk_webhook_signing_secret = ""
        database_url = "postgresql+asyncpg://u:pw@db.example.com:5432/prod"

    pk_dev = "pk_test_" + base64.b64encode(b"fun-cat-1.clerk.accounts.dev$").decode()
    assert publishable_key_host(pk_dev) == ("test", "fun-cat-1.clerk.accounts.dev")
    report = "\n".join(config_report(S(), pk_dev))
    assert "PROBLEM: frontend Clerk host fun-cat-1.clerk.accounts.dev is not in CLERK_ISSUER" in report
    assert "test key but CLERK_SECRET_KEY is a live key" in report
    assert "sk_live_secret_value" not in report and "pw" not in report.split("database")[1]
    pk_live = "pk_live_" + base64.b64encode(b"clerk.phaarvai.com$").decode()
    assert "same Clerk host" in "\n".join(config_report(S(), pk_live))


@needs_db
async def test_account_report_verdicts(client):  # noqa: F811
    from app.core.config import get_settings
    from app.core.database import SessionFactory
    from app.diagnose_registration import account_report
    sub = await legacy_user(client)
    email = f"{sub}@example.com"
    async with SessionFactory() as session:
        no_ev = "\n".join(await account_report(session, get_settings(), email, [{"id": sub}]))
        pw = "\n".join(await account_report(session, get_settings(), email, [{"id": sub, "password_enabled": True}]))
        other = "\n".join(await account_report(session, get_settings(), email, [{"id": "user_somebody_else"}]))
        none = "\n".join(await account_report(session, get_settings(), "nobody@example.com", []))
    assert "NO EVIDENCE" in no_ev and "RECOGNISED AT NEXT SIGN-IN (legacy_password)" in pw
    assert "ID MISMATCH" in other and "NO ACCOUNT" in none
    assert await marker(client, sub) == (False, None)  # read-only
