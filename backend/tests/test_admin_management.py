"""Admins tab: list admins, add (temporary password + forced change), revoke, restore,
change role, reset password, and the guard rails. Admins are not listed among registered
users. Real PostgreSQL; skipped without E2E_DATABASE_URL."""
import io
import os
import sys
import uuid

import pytest

from test_admin import no_clerk  # noqa: F401  (fixture)
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")

PASSWORD = "Blue-Lathe-2026-x"
NEW_PASSWORD = "Green-Press-2027-y"


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


async def login(c, email, password):
    r = await c.post("/admin/auth/login", headers={"Authorization": ""}, json={"email": email, "password": password})
    return r


async def make_root(c, monkeypatch, email):
    """An administrator created in the terminal (like `python -m app.admin_account create`)."""
    from app import admin_account
    monkeypatch.setattr(sys, "stdin", io.StringIO(PASSWORD + "\n"))
    assert await admin_account.create(email, "Root Admin", True) == 0
    r = await login(c, email, PASSWORD)
    assert r.status_code == 200, r.text
    return bearer(r.json()["token"])


async def test_admins_tab_full_flow(client, monkeypatch, no_clerk):  # noqa: F811
    root_email = f"root-{uuid.uuid4().hex[:8]}@example.com"
    root = await make_root(client, monkeypatch, root_email)

    # --- list: the root admin is there, marked as you
    r = await client.get("/admin/admin-users", headers=root)
    assert r.status_code == 200, r.text
    me = next(a for a in r.json() if a["email"] == root_email)
    assert me["isYou"] and me["status"] == "active" and me["role"] == "platform_administrator"
    assert me["hasAdminAccount"] and not me["hasXyAccount"]

    # --- add a new admin: temporary password, shown once
    new_email = f"ops-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/admin/admin-users", headers=root,
                          json={"email": new_email, "name": "Ops Person", "role": "platform_operator"})
    assert r.status_code == 201, r.text
    temp = r.json()["temporaryPassword"]
    ops = r.json()["admin"]
    assert len(temp) == 16 and ops["mustChangePassword"] and ops["roleLabel"] == "Operator"
    assert (await client.post("/admin/admin-users", headers=root,
                              json={"email": new_email, "name": "x", "role": "platform_operator"})).status_code == 409
    assert (await client.post("/admin/admin-users", headers=root,
                              json={"email": "not-an-email", "role": "platform_operator"})).status_code == 422

    # --- the new admin must change the temporary password before anything else
    r = await login(client, new_email, temp)
    assert r.status_code == 200, r.text
    ops_h = bearer(r.json()["token"])
    me_r = await client.get("/admin/me", headers=ops_h)
    assert me_r.status_code == 200 and me_r.json()["mustChangePassword"] is True
    assert (await client.get("/admin/overview", headers=ops_h)).status_code == 403
    r = await client.post("/admin/auth/change-password", headers=ops_h,
                          json={"current_password": temp, "new_password": NEW_PASSWORD})
    assert r.status_code == 204, r.text
    assert (await client.get("/admin/me", headers=ops_h)).json()["mustChangePassword"] is False
    assert (await client.get("/admin/overview", headers=ops_h)).status_code == 200

    # --- only administrators manage admins
    r = await client.post(f"/admin/admin-users/{me['id']}/revoke", headers=ops_h)
    assert r.status_code == 403
    assert (await client.get("/admin/admin-users", headers=ops_h)).status_code == 200   # can view

    # --- admins are not in the registered users list
    users = (await client.get("/admin/users?page_size=100", headers=root)).json()["rows"]
    assert not any(u["email"] in (root_email, new_email) for u in users)

    # --- change role, revoke (sessions end, sign-in blocked), restore
    r = await client.patch(f"/admin/admin-users/{ops['id']}/role", headers=root, json={"role": "support_specialist"})
    assert r.status_code == 200 and r.json()["role"] == "support_specialist"
    r = await client.post(f"/admin/admin-users/{ops['id']}/revoke", headers=root)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert (await client.get("/admin/me", headers=ops_h)).status_code in (401, 403)
    assert (await login(client, new_email, NEW_PASSWORD)).status_code == 403
    r = await client.post(f"/admin/admin-users/{ops['id']}/restore", headers=root, json={})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["role"] == "support_specialist"
    assert (await login(client, new_email, NEW_PASSWORD)).status_code == 200

    # --- reset password: new temporary password, old one stops working
    r = await client.post(f"/admin/admin-users/{ops['id']}/reset-password", headers=root)
    assert r.status_code == 200, r.text
    assert (await login(client, new_email, NEW_PASSWORD)).status_code == 401
    assert (await login(client, new_email, r.json()["temporaryPassword"])).status_code == 200

    # --- guard rails
    r = await client.post(f"/admin/admin-users/{me['id']}/revoke", headers=root)
    assert r.status_code == 422 and "own" in r.json()["detail"]
    r = await client.patch(f"/admin/admin-users/{me['id']}/role", headers=root, json={"role": "platform_operator"})
    assert r.status_code == 422
    r = await client.post(f"/admin/admin-users/{me['id']}/reset-password", headers=root)
    assert r.status_code == 422
    assert (await client.post(f"/admin/admin-users/{uuid.uuid4()}/revoke", headers=root)).status_code == 404


async def test_builtin_admin_cannot_be_revoked(client, monkeypatch, no_clerk):  # noqa: F811
    from app import admin_account
    from app.core.config import get_settings
    default = get_settings().admin_default_email
    monkeypatch.setattr(sys, "stdin", io.StringIO(PASSWORD + "\n"))
    assert await admin_account.setup(None, True) == 0          # creates or re-enables it
    monkeypatch.setattr(sys, "stdin", io.StringIO(PASSWORD + "\n"))
    assert await admin_account.setup(None, True) == 0          # running again is safe
    root = await make_root(client, monkeypatch, f"root-{uuid.uuid4().hex[:8]}@example.com")
    builtin = next(a for a in (await client.get("/admin/admin-users", headers=root)).json() if a["email"] == default)
    assert builtin["isDefault"] and builtin["status"] == "active"
    r = await client.post(f"/admin/admin-users/{builtin['id']}/revoke", headers=root)
    assert r.status_code == 422 and "built-in" in r.json()["detail"]
    assert await admin_account.revoke_access(default) == 1


async def test_lookup_command_is_read_only_and_finds_the_admin(client, monkeypatch, no_clerk, capsys):  # noqa: F811
    from sqlalchemy import text

    from app import lookup
    email = f"look-{uuid.uuid4().hex[:8]}@example.com"
    await make_root(client, monkeypatch, email)
    capsys.readouterr()
    assert await lookup.user(email) == 0
    out = capsys.readouterr().out
    assert email in out and "platform_administrator" in out and "password hash not shown" in out
    assert "scrypt" not in out and "token_hash" not in out
    assert await lookup.user("no-such-person-xyz") == 1
    assert await lookup.recent(5) == 0 and email in capsys.readouterr().out
    s = await lookup._session()
    try:
        with pytest.raises(Exception, match="read-only"):
            await s.execute(text("UPDATE users SET display_name = 'x' WHERE email = :e"), {"e": email})
    finally:
        await s.close()
