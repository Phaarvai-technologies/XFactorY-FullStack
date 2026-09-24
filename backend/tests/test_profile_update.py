"""Manufacturer profile update flow (PATCH /manufacturer/profile) against a real
PostgreSQL database with the XY schema. Skipped when E2E_DATABASE_URL is not set.

Covers: existing value -> new value, NULL -> new value, untouched optional
fields, several fields at once, page refresh, sign-out/sign-in, explicit
clearing, invalid input, images, and no duplicate records.
"""
import asyncio
import os

import pytest

from test_e2e_local import ACCOUNT, PNG, PNG2, client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def db_row(client, sql, **params):
    rows = await client.sql(sql, u=client.user, **params)
    return rows[0] if rows else None


ORG = """(SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
          JOIN users us ON us.id=m.user_id WHERE us.clerk_user_id=:u AND o.organization_type='manufacturer')"""


async def profile_row(client):
    return await db_row(client, f"""
        SELECT o.display_name, o.description, op.about_company, op.vision, op.establishment_year,
               op.employee_count, op.business_type, op.organization_size, op.logo_file_id,
               f.city, f.postal_code, f.country_name, f.country_code, f.map_pin, f.serviceable_areas,
               (f.location IS NULL) AS no_geo
        FROM organizations o JOIN organization_profiles op ON op.organization_id=o.id
        LEFT JOIN facilities f ON f.organization_id=o.id AND f.is_headquarters
        WHERE o.id={ORG}""")


async def patch(client, body, expect=200):
    r = await client.patch("/manufacturer/profile", json=body)
    assert r.status_code == expect, r.text
    return r.json()


async def test_profile_update_flow(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201

    # First edits in the wizard: only these fields are sent.
    body = await patch(client, {"company": {"name": "Raman Precision", "about": "Old about text"},
                                "location": {"address": "Plot 12", "city": "Chennai", "country": "India"},
                                "infra": {"electricity": "400 kVA"}})
    assert body["profileData"]["company"]["about"] == "Old about text"
    row = await profile_row(client)
    assert row.vision is None and row.establishment_year is None and row.business_type is None

    # 1) Existing value -> new value
    body = await patch(client, {"company": {"about": "New about text"}})
    assert body["profileData"]["company"]["about"] == "New about text"          # returned record
    row = await profile_row(client)
    assert row.about_company == "New about text" and row.description == "New about text"

    # 2) NULL -> new value
    body = await patch(client, {"company": {"vision": "Quality first", "estYear": "2005"}})
    assert body["profileData"]["company"]["vision"] == "Quality first"
    row = await profile_row(client)
    assert row.vision == "Quality first" and row.establishment_year == 2005

    # 3) Empty optional fields left unchanged: not sent -> untouched (values and NULLs)
    await patch(client, {"company": {"employees": "120"}})
    await patch(client, {})                                                       # nothing sent
    row = await profile_row(client)
    assert (row.about_company, row.vision, row.establishment_year, row.employee_count) == \
           ("New about text", "Quality first", 2005, 120)
    assert row.business_type is None and row.city == "Chennai"
    infra = await client.sql(f"""SELECT ii.code, mi.text_value FROM manufacturer_infrastructure mi
        JOIN infrastructure_items ii ON ii.id=mi.infrastructure_item_id WHERE mi.organization_id={ORG}""", u=client.user)
    assert dict(infra)["electricity"] == "400 kVA"

    # 4) Multiple fields (several sections) updated together
    body = await patch(client, {
        "company": {"name": "Raman Precision Pvt Ltd", "businessType": "Private Limited",
                    "orgSize": "Medium (50–249 employees)"},
        "location": {"city": "Chengalpattu", "zip": "603003", "pin": "12.6921, 79.9766",
                     "serviceableAreas": ["Chennai", "Bengaluru"]},
        "infra": {"water": "20,000 L/day"},
        "faqs": [{"q": "What's your MOQ?", "a": "100 pcs"}]})
    pd = body["profileData"]
    assert pd["company"]["name"] == "Raman Precision Pvt Ltd"
    assert pd["company"]["businessType"] == "Private Limited"
    assert pd["location"]["city"] == "Chengalpattu" and pd["location"]["zip"] == "603003"
    assert pd["location"]["pin"] == "12.6921, 79.9766" and pd["location"]["serviceableAreas"] == ["Chennai", "Bengaluru"]
    assert pd["infra"]["water"] == "20,000 L/day" and pd["infra"]["electricity"] == "400 kVA"   # untouched one kept
    assert pd["faqs"] == [{"q": "What's your MOQ?", "a": "100 pcs"}]
    assert pd["company"]["vision"] == "Quality first"                                             # untouched
    assert body["state"]["epic2"]["companyDetailsDone"] and body["state"]["epic2"]["locationDone"]
    row = await profile_row(client)
    assert row.display_name == "Raman Precision Pvt Ltd" and row.city == "Chengalpattu"
    assert row.country_code == "IN" and not row.no_geo

    # 5) Page refresh: a new GET returns exactly what the PATCH returned
    refreshed = (await client.get("/manufacturer/bootstrap")).json()
    assert refreshed["profileData"] == body["profileData"]

    # 6) Sign out and sign in again: brand-new session token, same saved values
    client.headers["Authorization"] = f"Bearer {client.make_token()}"
    again = (await client.get("/manufacturer/bootstrap")).json()
    assert again["profileData"] == body["profileData"]
    assert again["state"]["epic2"]["companyDetailsDone"] is True

    # Explicit clearing by the user -> NULL; a required field (name) is never blanked
    body = await patch(client, {"company": {"vision": "", "estYear": "", "name": ""},
                                "location": {"pin": None, "zip": ""}})
    row = await profile_row(client)
    assert row.vision is None and row.establishment_year is None and row.postal_code is None
    assert row.map_pin is None and row.no_geo
    assert row.display_name == "Raman Precision Pvt Ltd"
    assert body["profileData"]["company"]["vision"] == "" and body["profileData"]["location"]["pin"] is None

    # Invalid input is rejected and changes nothing (never silently becomes NULL)
    await patch(client, {"company": {"employees": "300"}})
    for bad in ({"company": {"estYear": "1500"}}, {"company": {"employees": "many"}}, {"location": {"pin": "north"}}):
        r = await client.patch("/manufacturer/profile", json=bad)
        assert r.status_code == 422, bad
    assert (await profile_row(client)).employee_count == 300

    # Images: new data URL -> uploaded; existing URL sent back -> kept (no upload); null -> removed
    body = await patch(client, {"company": {"logo": PNG}})
    logo_url, logo_file = body["profileData"]["company"]["logo"], (await profile_row(client)).logo_file_id
    assert logo_url and logo_file
    uploads = len(client.uploads)
    body = await patch(client, {"company": {"logo": logo_url, "about": "About v3"}})
    assert len(client.uploads) == uploads and (await profile_row(client)).logo_file_id == logo_file
    body = await patch(client, {"company": {"logo": PNG2}})
    assert (await profile_row(client)).logo_file_id != logo_file
    body = await patch(client, {"company": {"logo": None}})
    assert body["profileData"]["company"]["logo"] is None and (await profile_row(client)).logo_file_id is None

    # No duplicate records after all these updates
    counts = await db_row(client, f"""SELECT
        (SELECT count(*) FROM organizations o JOIN memberships m ON m.organization_id=o.id
           JOIN users us ON us.id=m.user_id WHERE us.clerk_user_id=:u AND o.organization_type='manufacturer'),
        (SELECT count(*) FROM organization_profiles WHERE organization_id={ORG}),
        (SELECT count(*) FROM facilities WHERE organization_id={ORG} AND is_headquarters),
        (SELECT count(*) FROM manufacturer_infrastructure WHERE organization_id={ORG}),
        (SELECT count(*) FROM manufacturer_onboarding WHERE organization_id={ORG}),
        (SELECT count(*) FROM users WHERE clerk_user_id=:u)""")
    assert tuple(counts) == (1, 1, 1, 2, 1, 1), tuple(counts)


async def test_old_put_still_works_and_does_not_clear_images(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    full = {"company": {"name": "Acme", "logo": PNG, "about": "a"}, "location": {"city": "Chennai"}}
    assert (await client.put("/manufacturer/profile", json=full)).status_code == 200
    full["company"]["logo"] = None                     # PUT: null logo = unchanged (legacy behaviour)
    body = (await client.put("/manufacturer/profile", json=full)).json()
    assert body["profileData"]["company"]["logo"]


async def test_concurrent_first_requests_create_one_organization(client):
    """Roles page + dashboard hitting the API at the same moment for a new user."""
    results = await asyncio.gather(*(client.get("/manufacturer/bootstrap") for _ in range(6)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    n = await db_row(client, """SELECT count(*) FROM organizations o JOIN memberships m ON m.organization_id=o.id
        JOIN users us ON us.id=m.user_id WHERE us.clerk_user_id=:u AND o.organization_type='manufacturer'""")
    assert n[0] == 1


async def test_update_only_touches_the_signed_in_users_record(client):
    assert (await client.post("/manufacturer/account", json=ACCOUNT)).status_code == 201
    marker = f"About text of {client.user}"
    await patch(client, {"company": {"about": marker}})
    rows = await client.sql(f"""SELECT organization_id = {ORG} FROM organization_profiles
                                WHERE about_company = :m""", u=client.user, m=marker)
    assert [r[0] for r in rows] == [True]      # exactly one row changed: this user's organization
