"""Admin email + password sign-in (alongside Clerk). Real PostgreSQL; skipped without E2E_DATABASE_URL."""
import io
import os
import sys
import uuid

import pytest

from test_admin import auth, make_admin, new_manufacturer, no_clerk  # noqa: F401  (fixtures)
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

GOOD = "Blue-Lathe-2026-x"


async def create_account(monkeypatch, email, password=GOOD, name="Asha Verma"):
    from app import admin_account
    monkeypatch.setattr(sys, "stdin", io.StringIO(password + "\n"))
    return await admin_account.create(email, name, True)


async def login(c, email, password):
    return await c.post("/admin/auth/login", headers={"Authorization": ""}, json={"email": email, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_password_hashing_and_rules():
    from app.admin import accounts
    h = accounts.hash_password(GOOD)
    assert h.startswith("scrypt$") and GOOD not in h
    assert accounts.verify_password(GOOD, h) and not accounts.verify_password(GOOD + "x", h)
    assert accounts.hash_password(GOOD) != h  # random salt
    assert accounts.password_problem("short1") == "Use at least 12 characters."
    assert accounts.password_problem("onlyletterslong") is not None
    assert accounts.password_problem("ashaverma12345", "ashaverma@x.com") is not None
    assert accounts.password_problem(GOOD, "a@x.com") is None


async def test_login_me_logout(client, monkeypatch):
    email = f"staff_{uuid.uuid4().hex[:6]}@xy.test"
    assert await create_account(monkeypatch, email) == 0

    # same answer for a wrong password and an unknown email
    bad = await login(client, email, "Wrong-password-123")
    unknown = await login(client, f"nobody_{uuid.uuid4().hex[:6]}@xy.test", GOOD)
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json() == {"detail": "Incorrect email or password."}

    r = await login(client, email.upper(), GOOD)  # email is case-insensitive
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert token.startswith("xya_") and r.json()["idleMinutes"] == 60
    me = (await client.get("/admin/me", headers=bearer(token))).json()
    assert me["authMethod"] == "password" and me["name"] == "Asha Verma"
    assert me["roles"] == ["platform_administrator"]
    assert (await client.get("/admin/overview", headers=bearer(token))).status_code == 200

    # only the hash is stored
    rows = await client.sql("SELECT token_hash FROM admin_sessions s JOIN admin_accounts a ON a.id=s.account_id "
                            "WHERE a.email=:e", e=email)
    assert rows and all(token not in r[0] for r in rows)
    pw = await client.sql("SELECT password_hash FROM admin_accounts WHERE email=:e", e=email)
    assert GOOD not in pw[0][0]

    # an admin session token is not accepted by the manufacturer / identity APIs
    assert (await client.get("/manufacturer/bootstrap", headers=bearer(token))).status_code == 401
    assert (await client.get("/identity/me", headers=bearer(token))).status_code == 401

    assert (await client.post("/admin/auth/logout", headers=bearer(token))).status_code == 204
    r = await client.get("/admin/me", headers=bearer(token))
    assert r.status_code == 401 and "sign in again" in r.json()["detail"]
    assert (await client.get("/admin/me", headers=bearer("xya_madeup"))).status_code == 401

    # sign-in attempts are visible in the user's troubleshooting events
    ev = await client.sql("SELECT kind FROM user_activity_events e JOIN users u ON u.id=e.user_id "
                          "WHERE u.email=:e ORDER BY e.created_at", e=email)
    assert [k[0] for k in ev] == ["admin_login_failed", "admin_login"]


async def test_lockout(client, monkeypatch):
    email = f"lock_{uuid.uuid4().hex[:6]}@xy.test"
    await create_account(monkeypatch, email)
    for _ in range(4):
        assert (await login(client, email, "Nope-nope-1234")).status_code == 401
    r = await login(client, email, "Nope-nope-1234")
    assert r.status_code == 429 and r.headers["retry-after"] == "900"
    r = await login(client, email, GOOD)  # correct password is refused while locked
    assert r.status_code == 429 and "Try again in" in r.json()["detail"]
    # `enable` clears the lock
    from app import admin_account
    assert await admin_account.set_status(email, True) == 0
    assert (await login(client, email, GOOD)).status_code == 200


async def test_idle_and_absolute_expiry(client, monkeypatch):
    email = f"idle_{uuid.uuid4().hex[:6]}@xy.test"
    await create_account(monkeypatch, email)
    t1 = (await login(client, email, GOOD)).json()["token"]
    t2 = (await login(client, email, GOOD)).json()["token"]
    from app.admin.accounts import token_hash
    await client.sql("UPDATE admin_sessions SET last_used_at=now() - interval '61 minutes' WHERE token_hash=:h",
                     h=token_hash(t1))
    await client.sql("UPDATE admin_sessions SET expires_at=now() - interval '1 second' WHERE token_hash=:h",
                     h=token_hash(t2))
    assert (await client.get("/admin/me", headers=bearer(t1))).status_code == 401
    assert (await client.get("/admin/me", headers=bearer(t2))).status_code == 401


async def test_change_password(client, monkeypatch):
    email = f"chg_{uuid.uuid4().hex[:6]}@xy.test"
    await create_account(monkeypatch, email)
    here = (await login(client, email, GOOD)).json()["token"]
    other = (await login(client, email, GOOD)).json()["token"]
    url = "/admin/auth/change-password"
    r = await client.post(url, headers=bearer(here), json={"current_password": "wrong", "new_password": "Green-Mill-2027-y"})
    assert r.status_code == 422 and "current password" in r.json()["detail"]
    r = await client.post(url, headers=bearer(here), json={"current_password": GOOD, "new_password": "short"})
    assert r.status_code == 422 and "12 characters" in r.json()["detail"]
    r = await client.post(url, headers=bearer(here), json={"current_password": GOOD, "new_password": "Green-Mill-2027-y"})
    assert r.status_code == 204
    assert (await client.get("/admin/me", headers=bearer(here))).status_code == 200   # this device stays signed in
    assert (await client.get("/admin/me", headers=bearer(other))).status_code == 401  # others are signed out
    assert (await login(client, email, GOOD)).status_code == 401
    assert (await login(client, email, "Green-Mill-2027-y")).status_code == 200
    # Clerk admins manage their password in Clerk
    clerk_admin = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    r = await client.post(url, headers=clerk_admin, json={"current_password": "a", "new_password": "b"})
    assert r.status_code == 422 and "Clerk" in r.json()["detail"]


async def test_disable_suspend_and_link(client, monkeypatch, no_clerk):  # noqa: F811
    from app import admin_account
    email = f"dis_{uuid.uuid4().hex[:6]}@xy.test"
    await create_account(monkeypatch, email)
    token = (await login(client, email, GOOD)).json()["token"]
    assert await admin_account.set_status(email, False) == 0
    assert (await client.get("/admin/me", headers=bearer(token))).status_code == 401
    r = await login(client, email, GOOD)
    assert r.status_code == 403 and "disabled" in r.json()["detail"]
    assert await admin_account.set_status(email, True) == 0

    # another admin suspends this staff admin: sessions end, Clerk is not called
    token = (await login(client, email, GOOD)).json()["token"]
    boss = await make_admin(client, f"admin_{uuid.uuid4().hex[:8]}")
    uid = (await client.sql("SELECT user_id FROM admin_accounts WHERE email=:e", e=email))[0][0]
    users = (await client.get("/admin/users", headers=boss, params={"q": email})).json()["rows"]
    assert users[0]["staffOnly"] is True and users[0]["userType"] == "Admin"
    r = await client.post(f"/admin/users/{uid}/suspend", headers=boss, json={"reason": "Left the company"})
    assert r.status_code == 200 and r.json()["clerkSynced"] is True
    assert no_clerk == []
    assert (await client.get("/admin/me", headers=bearer(token))).status_code == 401
    assert (await login(client, email, GOOD)).status_code == 403

    # an existing X!Y (Clerk) user gets a password login linked to the same user: both work
    sub = f"user_{uuid.uuid4().hex[:10]}"
    assert (await client.get("/identity/me", headers=auth(client, sub))).status_code == 200
    clerk_email = (await client.sql("SELECT email::text, id FROM users WHERE clerk_user_id=:s", s=sub))[0]
    await create_account(monkeypatch, clerk_email[0])
    linked = await client.sql("SELECT user_id FROM admin_accounts WHERE email=:e", e=clerk_email[0])
    assert linked[0][0] == clerk_email[1]
    token = (await login(client, clerk_email[0], GOOD)).json()["token"]
    a = (await client.get("/admin/me", headers=bearer(token))).json()
    b = (await client.get("/admin/me", headers=auth(client, sub))).json()
    assert a["id"] == b["id"] and a["authMethod"] == "password" and b["authMethod"] == "clerk"
    assert await create_account(monkeypatch, clerk_email[0]) == 1  # no duplicates


async def test_staff_account_claimed_by_verified_clerk_signup(client, monkeypatch):
    email = f"claim_{uuid.uuid4().hex[:6]}@example.com"
    await create_account(monkeypatch, email)
    staff_uid = (await client.sql("SELECT user_id FROM admin_accounts WHERE email=:e", e=email))[0][0]
    before = (await client.get("/admin/overview", headers=bearer(
        (await login(client, email, GOOD)).json()["token"]))).json()["cards"]["totalUsers"]

    from app.core.database import SessionFactory
    from app.identity.repository import upsert_user
    sub = f"user_{uuid.uuid4().hex[:10]}"
    async with SessionFactory() as s:
        uid = await upsert_user(s, clerk_user_id=sub, email=email, display_name="Claimer", email_verified=True)
        await s.commit()
    assert uid == staff_uid  # one person, both sign-in methods
    after = (await client.get("/admin/me", headers=auth(client, sub))).json()
    assert after["id"] == str(staff_uid)
    token = (await login(client, email, GOOD)).json()["token"]
    cards = (await client.get("/admin/overview", headers=bearer(token))).json()["cards"]
    assert cards["totalUsers"] == before + 1  # now a real platform user
