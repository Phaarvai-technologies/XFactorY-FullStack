"""Admins tab -> Edit details: name / phone / (admin-only accounts) email, who may edit whom, the
built-in administrator, X!Y (Clerk) name sync, history. Real PostgreSQL through the real admin API."""
import os
import uuid

import pytest

from test_admin_management import NEW_PASSWORD, bearer, login, make_root
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


@pytest.fixture
def clerk_names(monkeypatch):
    """Clerk's name update replaced; records calls. Set .fail = True to make Clerk refuse."""
    from app.core import clerk

    class Rec(list):
        fail = False
    calls = Rec()

    async def update_user_name(self, clerk_user_id, first, last):
        if calls.fail:
            raise RuntimeError("Clerk rejected the name update (500)")
        calls.append((clerk_user_id, first, last))
    monkeypatch.setattr(clerk.ClerkManagement, "update_user_name", update_user_name)
    return calls


async def _admins(c, h):
    r = await c.get("/admin/admin-users", headers=h)
    assert r.status_code == 200, r.text
    return {a["email"]: a for a in r.json()}


async def _ops(c, root, role="platform_operator"):
    email = f"ops-{uuid.uuid4().hex[:8]}@example.com"
    r = await c.post("/admin/admin-users", headers=root, json={"email": email, "name": "Ops Person", "role": role})
    assert r.status_code == 201, r.text
    temp = r.json()["temporaryPassword"]
    h = bearer((await login(c, email, temp)).json()["token"])
    assert (await c.post("/admin/auth/change-password", headers=h,
                         json={"current_password": temp, "new_password": NEW_PASSWORD})).status_code == 204
    return email, r.json()["admin"]["id"], h


async def test_administrator_edits_admin_details_and_email(client, monkeypatch, clerk_names):  # noqa: F811
    root = await make_root(client, monkeypatch, f"root-{uuid.uuid4().hex[:8]}@example.com")
    email, ops_id, ops_h = await _ops(client, root)
    listed = (await _admins(client, root))[email]
    assert (listed["firstName"], listed["lastName"], listed["phone"]) == ("Ops", "Person", None)
    assert listed["canEditDetails"] and listed["emailEditable"]

    new_email = f"renamed-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.patch(f"/admin/admin-users/{ops_id}", headers=root,
                           json={"firstName": "Priya", "lastName": "Raman", "phone": "+91 98765 43210", "email": new_email})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changed"] == ["first name", "last name", "phone", "email"] and body["clerkSync"] == "not_needed"
    a = body["admin"]
    assert (a["name"], a["email"], a["phone"]) == ("Priya Raman", new_email, "+91 98765 43210")
    assert clerk_names == []                                   # admin-only account: no Clerk call
    # saved: the list, /me of that admin, and sign-in with the new email (old email no longer works)
    assert (await _admins(client, root))[new_email]["name"] == "Priya Raman"
    assert (await client.get("/admin/me", headers=ops_h)).json()["name"] == "Priya Raman"
    assert (await login(client, new_email, NEW_PASSWORD)).status_code == 200
    assert (await login(client, email, NEW_PASSWORD)).status_code == 401
    # history
    hist = await client.sql("""SELECT detail FROM user_activity_events WHERE user_id=CAST(:u AS uuid)
                               AND detail LIKE 'Admin details updated%'""", u=ops_id)
    assert hist and "first name, last name, phone, email" in hist[0][0]

    # no change -> nothing recorded; clearing phone / last name works
    assert (await client.patch(f"/admin/admin-users/{ops_id}", headers=root,
                               json={"firstName": "Priya"})).json()["changed"] == []
    r = await client.patch(f"/admin/admin-users/{ops_id}", headers=root, json={"phone": "", "lastName": ""})
    assert r.json()["changed"] == ["last name", "phone"] and r.json()["admin"]["name"] == "Priya"

    # validation and conflicts
    for bad in ({"firstName": ""}, {"phone": "call me"}, {"email": "nope"}, {"role": "platform_administrator"},
                {"passwordHash": "x"}):
        assert (await client.patch(f"/admin/admin-users/{ops_id}", headers=root, json=bad)).status_code == 422, bad
    other, _, _ = await _ops(client, root)
    r = await client.patch(f"/admin/admin-users/{ops_id}", headers=root, json={"email": other.upper()})
    assert r.status_code == 409 and "already used" in r.json()["detail"]
    assert (await client.patch(f"/admin/admin-users/{uuid.uuid4()}", headers=root,
                               json={"firstName": "X"})).status_code == 404


async def test_who_can_edit_and_built_in_admin(client, monkeypatch, clerk_names):  # noqa: F811
    root_email = f"root-{uuid.uuid4().hex[:8]}@example.com"
    root = await make_root(client, monkeypatch, root_email)
    root_id = (await _admins(client, root))[root_email]["id"]
    email, ops_id, ops_h = await _ops(client, root)
    other_email, other_id, _ = await _ops(client, root)

    # a non-administrator edits only their own details
    r = await client.patch(f"/admin/admin-users/{ops_id}", headers=ops_h, json={"firstName": "Self", "lastName": "Edit"})
    assert r.status_code == 200 and r.json()["admin"]["name"] == "Self Edit"
    r = await client.patch(f"/admin/admin-users/{other_id}", headers=ops_h, json={"firstName": "Hacked"})
    assert r.status_code == 403
    listed = await _admins(client, ops_h)
    assert listed[email]["canEditDetails"] and not listed[other_email]["canEditDetails"]
    assert (await client.patch(f"/admin/admin-users/{ops_id}", headers={"Authorization": ""},
                               json={"firstName": "x"})).status_code == 401

    # the built-in administrator: name and phone editable, email not
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "admin_default_email", root_email)
    me = (await _admins(client, root))[root_email]
    assert me["isDefault"] and me["canEditDetails"] and not me["emailEditable"]
    r = await client.patch(f"/admin/admin-users/{root_id}", headers=root, json={"firstName": "Vignesh", "lastName": "P"})
    assert r.status_code == 200 and r.json()["admin"]["name"] == "Vignesh P"
    assert (await client.get("/admin/me", headers=root)).json()["name"] == "Vignesh P"
    r = await client.patch(f"/admin/admin-users/{root_id}", headers=root, json={"email": "elsewhere@example.com"})
    assert r.status_code == 422 and "built-in" in r.json()["detail"]
    # and nobody can take the built-in email
    r = await client.patch(f"/admin/admin-users/{ops_id}", headers=root, json={"email": root_email})
    assert r.status_code in (409, 422)


async def test_xy_account_admin_name_synced_to_clerk(client, monkeypatch, clerk_names):  # noqa: F811
    root = await make_root(client, monkeypatch, f"root-{uuid.uuid4().hex[:8]}@example.com")
    sub = f"user_xyadmin_{uuid.uuid4().hex[:8]}"
    assert (await client.get("/identity/me", headers=bearer(client.token_for(sub)))).status_code == 200
    await client.sql("""INSERT INTO platform_role_assignments (user_id, platform_role)
                        SELECT id, 'platform_operator' FROM users WHERE clerk_user_id=:s""", s=sub)
    xy = next(a for a in (await _admins(client, root)).values() if a["email"] == f"{sub}@example.com")
    assert xy["hasXyAccount"] and not xy["emailEditable"]

    r = await client.patch(f"/admin/admin-users/{xy['id']}", headers=root, json={"firstName": "Meera", "lastName": "Nair"})
    assert r.status_code == 200 and r.json()["clerkSync"] == "updated"
    assert clerk_names == [(sub, "Meera", "Nair")]
    # phone only: no Clerk call
    r = await client.patch(f"/admin/admin-users/{xy['id']}", headers=root, json={"phone": "+91 90000 11111"})
    assert r.json()["clerkSync"] == "not_needed" and len(clerk_names) == 1
    # email is managed in the X!Y account
    r = await client.patch(f"/admin/admin-users/{xy['id']}", headers=root, json={"email": "new@example.com"})
    assert r.status_code == 422 and "X!Y account" in r.json()["detail"]
    # Clerk unavailable: saved here, reported as failed (not an error)
    clerk_names.fail = True
    r = await client.patch(f"/admin/admin-users/{xy['id']}", headers=root, json={"firstName": "Meenakshi"})
    assert r.status_code == 200 and r.json()["clerkSync"] == "failed"
    assert r.json()["admin"]["name"] == "Meenakshi Nair"
