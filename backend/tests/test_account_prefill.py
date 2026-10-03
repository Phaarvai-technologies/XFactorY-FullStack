"""Manufacturer onboarding prefill from the Clerk sign-up data (real PostgreSQL;
skipped without E2E_DATABASE_URL). The fake Clerk user is "Jordan Lee" <user@example.com>."""
import asyncio
import os

import pytest

from test_e2e_local import ACCOUNT, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


@pytest.fixture
def clerk_updates(monkeypatch):
    from app.core import clerk
    calls = []

    async def fake_update(self, clerk_user_id, first, last):
        calls.append((clerk_user_id, first, last))

    monkeypatch.setattr(clerk.ClerkManagement, "update_user_name", fake_update)
    return calls


async def user_row(client):
    rows = await client.sql("""SELECT u.first_name, u.last_name, u.email, u.display_name, op.contact_email
        FROM users u
        LEFT JOIN memberships m ON m.user_id=u.id
        LEFT JOIN organization_profiles op ON op.organization_id=m.organization_id
        WHERE u.clerk_user_id=:u""", u=client.user)
    return rows[0]


def form(client, **changes):
    """What the onboarding form submits: prefilled values plus the user's edits."""
    return {**ACCOUNT, "firstName": "Jordan", "lastName": "Lee", "contact": f"{client.user}@example.com", **changes}


async def counts(client):
    return (await client.sql("""SELECT
        (SELECT count(*) FROM users WHERE clerk_user_id=:u),
        (SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:u),
        (SELECT count(*) FROM marketplace_role_selections r JOIN users u ON u.id=r.user_id
           WHERE u.clerk_user_id=:u AND r.role_selected='manufacturer' AND r.status='active'),
        (SELECT count(*) FROM manufacturer_onboarding mo JOIN memberships m ON m.organization_id=mo.organization_id
           JOIN users u ON u.id=m.user_id WHERE u.clerk_user_id=:u)""", u=client.user))[0]


async def test_onboarding_prefill_and_updates(client, clerk_updates):
    # Signed up in Clerk -> the roles page / Manufacturer page stores the user record
    assert (await client.get("/identity/me")).status_code == 200
    body = (await client.get("/manufacturer/bootstrap")).json()
    assert body["user"] == {"firstName": "Jordan", "lastName": "Lee", "email": f"{client.user}@example.com"}
    assert body["accountExists"] is False

    # Kept unchanged -> saved record preserved, Clerk not touched
    r = await client.post("/manufacturer/account", json=form(client))
    assert r.status_code == 201, r.text
    row = await user_row(client)
    assert (row.first_name, row.last_name, row.email) == ("Jordan", "Lee", f"{client.user}@example.com")
    assert row.contact_email == f"{client.user}@example.com"
    assert clerk_updates == []

    # Edited last name -> user record updated and pushed to Clerk
    r = await client.post("/manufacturer/account", json=form(client, lastName="Lee-Smith"))
    assert r.status_code == 201
    row = await user_row(client)
    assert (row.first_name, row.last_name, row.display_name) == ("Jordan", "Lee-Smith", "Jordan Lee-Smith")
    assert clerk_updates == [(client.user, "Jordan", "Lee-Smith")]
    assert r.json()["user"]["lastName"] == "Lee-Smith"

    # Edited email -> manufacturer contact email; the Clerk sign-in email stays
    await client.post("/manufacturer/account", json=form(client, lastName="Lee-Smith", contact="sales@raman.in"))
    row = await user_row(client)
    assert row.contact_email == "sales@raman.in" and row.email == f"{client.user}@example.com"

    # Sign out / sign in again, and the identity path running again: edited name kept
    client.headers["Authorization"] = f"Bearer {client.make_token()}"
    assert (await client.get("/identity/me")).json()["user"]["last_name"] == "Lee-Smith"
    assert (await client.get("/manufacturer/bootstrap")).json()["user"]["lastName"] == "Lee-Smith"

    # Double / concurrent submits -> still exactly one of everything
    results = await asyncio.gather(*(client.post("/manufacturer/account", json=form(client, lastName="Lee-Smith"))
                                     for _ in range(4)))
    assert all(x.status_code == 201 for x in results)
    assert tuple(await counts(client)) == (1, 1, 1, 1)

    # Blank names are rejected, nothing is overwritten
    r = await client.post("/manufacturer/account", json=form(client, firstName="  "))
    assert r.status_code == 422
    assert (await user_row(client)).first_name == "Jordan"


async def test_missing_name_is_filled_from_clerk(client, clerk_updates):
    assert (await client.get("/manufacturer/bootstrap")).status_code == 200
    await client.sql("UPDATE users SET first_name=NULL, last_name=NULL WHERE clerk_user_id=:u", u=client.user)
    user = (await client.get("/manufacturer/bootstrap")).json()["user"]
    assert (user["firstName"], user["lastName"]) == ("Jordan", "Lee")


async def test_clerk_down_does_not_block_the_save(client, monkeypatch):
    from app.core import clerk

    async def failing(self, *a):
        raise RuntimeError("Clerk unavailable")

    monkeypatch.setattr(clerk.ClerkManagement, "update_user_name", failing)
    r = await client.post("/manufacturer/account", json=form(client, firstName="Priya"))
    assert r.status_code == 201
    assert (await user_row(client)).first_name == "Priya"
